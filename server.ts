import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { DecodedIdToken } from 'firebase-admin/auth';
import {
  appendBackupIndex,
  appendServerAuditLog,
  deleteFirestoreDocRest,
  fetchFirestoreDocRest,
  listFirestoreCollectionRest,
  loadAdminsDirectory,
  loadBackupsIndex,
  loadInvitationsIndex,
  loadServerAuditLogs,
  loadUsersDirectory,
  patchFirestoreDocRest,
  removeAdminDirectoryEntry,
  removeInvitationIndex,
  ResolvedServerAuth,
  resolveServerAuth,
  serverAuthHasPermission,
  SUPER_ADMIN_EMAIL,
  upsertAdminDirectoryEntry,
  upsertInvitationIndex,
  upsertUserDirectoryEntry,
  verifyBearerToken,
} from './server/firebaseAdmin.ts';
import {
  ensureSeedPdfFilesOnDisk,
  getInitialCatalog,
  loadFileRegistry,
  removeFileRegistryEntry,
  upsertFileRegistryEntry,
} from './server/seedPlatform.ts';
import {
  buildHierarchicalStorageLocation,
  computeDiskStorageUsage,
  computeFileSha256,
  createPhysicalFilesBackupSnapshot,
  DB_BACKUPS_DIR,
  ensureStorageDirectories,
  FILE_BACKUPS_DIR,
  resolvePhysicalFilePath,
  sanitizePathSegment,
  TMP_STORAGE_DIR,
  writeJsonBackupFile,
} from './server/storageManager.ts';
import {
  AdminEntry,
  AdminInvitation,
  ALL_PERMISSIONS,
  BackupSnapshot,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_STORAGE_THRESHOLDS,
  PermissionKey,
  SUPPORTED_FILE_EXTENSIONS,
  UserProfile,
  UserRole,
} from './src/types/academic.ts';
import {
  canAssignRoleChange,
  evaluateStorageQuota,
  generateSafeId,
} from './src/utils/academicLogic.ts';

interface AuthenticatedRequest extends Request {
  authUser?: DecodedIdToken | null;
  authToken?: string;
  serverAuth?: ResolvedServerAuth | null;
  isAdmin?: boolean;
}

const MIME_MAP: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  zip: 'application/zip',
};

function sanitizeStorageFileName(originalName: string): { storageName: string; ext: string } {
  const ext = path.extname(originalName).toLowerCase().replace(/^\./, '');
  const uuid = crypto.randomUUID();
  return {
    storageName: `ust_${Date.now()}_${uuid}.${ext}`,
    ext,
  };
}

function createRateLimiter(options: { windowMs: number; maxRequests: number; keyPrefix: string }) {
  const buckets = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${options.keyPrefix}:${clientIp}`;
    const timestamps = (buckets.get(key) || []).filter((ts) => now - ts < options.windowMs);
    if (timestamps.length >= options.maxRequests) {
      return res.status(429).json({
        error: 'تم تجاوز الحد المسموح من الطلبات مؤقتاً. يرجى المحاولة بعد قليل.',
      });
    }
    timestamps.push(now);
    buckets.set(key, timestamps);
    if (buckets.size > 2000) {
      buckets.clear();
    }
    next();
  };
}

async function attachOptionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
  const token =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : queryToken;

  if (token) {
    const decoded = await verifyBearerToken(token);
    req.authUser = decoded;
    req.authToken = token;
    req.serverAuth = await resolveServerAuth(decoded, token);
    req.isAdmin = Boolean(req.serverAuth?.isStaff);
  } else {
    req.authUser = null;
    req.authToken = undefined;
    req.serverAuth = null;
    req.isAdmin = false;
  }
  next();
}

async function requireAuthenticated(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح: يجب تسجيل الدخول أولاً.' });
  }
  const token = authHeader.slice(7).trim();
  const decoded = await verifyBearerToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'جلسة الدخول غير صالحة أو منتهية.' });
  }
  if (!decoded.email_verified) {
    return res.status(403).json({ error: 'يجب تأكيد البريد الإلكتروني لحساب Google للمتابعة.' });
  }
  const resolved = await resolveServerAuth(decoded, token);
  if (!resolved) {
    return res.status(401).json({ error: 'تعذر التحقق من هوية الحساب.' });
  }
  req.authUser = decoded;
  req.authToken = token;
  req.serverAuth = resolved;
  req.isAdmin = resolved.isStaff;
  next();
}

async function requireStaff(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  await requireAuthenticated(req, res, () => {
    if (!req.serverAuth) return;
    if (req.serverAuth.status === 'suspended') {
      return res.status(403).json({ error: 'تم تعليق هذا الحساب من قبل إدارة المنصة.' });
    }
    if (!req.serverAuth.isStaff) {
      return res.status(403).json({ error: 'ممنوع: هذه العملية مخصصة لإدارة المنصة فقط.' });
    }
    next();
  });
}

function requireAnyPermission(permissions: PermissionKey[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    await requireStaff(req, res, () => {
      const auth = req.serverAuth;
      if (!auth) return;
      const allowed = auth.isSuperAdmin || permissions.some((p) => serverAuthHasPermission(auth, p));
      if (!allowed) {
        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: auth.uid,
          actorEmail: auth.email,
          actorName: auth.displayName,
          actorRole: auth.role,
          action: 'محاولة وصول غير مصرح بها',
          entityType: 'rbac_guard',
          entityId: sanitizePathSegment(req.path, 'endpoint'),
          entityName: `${req.method} ${req.path}`,
          result: 'denied',
          details: `Required any of: ${permissions.join(', ')}`,
          createdAt: new Date().toISOString(),
        });
        return res.status(403).json({ error: 'ليس لديك الصلاحية اللازمة لتنفيذ هذه العملية.' });
      }
      next();
    });
  };
}

async function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  await requireStaff(req, res, () => {
    if (!req.serverAuth?.isSuperAdmin) {
      return res.status(403).json({ error: 'ممنوع: هذه العملية حصرية للمدير الرئيسي / مالك المنصة فقط.' });
    }
    next();
  });
}

function parseExtensionsList(raw: unknown): string[] {
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((x) => String(x).toLowerCase()).filter(Boolean);
  }
  return [...SUPPORTED_FILE_EXTENSIONS];
}

function parsePermissionsInput(raw: unknown): PermissionKey[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is PermissionKey =>
    ALL_PERMISSIONS.includes(item as PermissionKey)
  );
}

async function startServer() {
  ensureStorageDirectories();
  ensureSeedPdfFilesOnDisk();

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const authRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 60, keyPrefix: 'auth' });
  const adminRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 120, keyPrefix: 'admin' });
  const uploadRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 40, keyPrefix: 'upload' });

  const tmpStorage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureStorageDirectories();
      cb(null, TMP_STORAGE_DIR);
    },
    filename: (_req, file, cb) => {
      const { storageName } = sanitizeStorageFileName(file.originalname);
      cb(null, storageName);
    },
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'ust-lecture-platform',
      superAdminConfigured: Boolean(SUPER_ADMIN_EMAIL),
    });
  });

  app.get('/api/catalog/seed', (_req, res) => {
    res.json(getInitialCatalog());
  });

  // --- Authoritative Google Auth Sync + Super Admin Verification + Invitation Claim ---
  app.post('/api/auth/sync', authRateLimiter, requireAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.serverAuth!;
      const token = req.authToken!;
      const nowIso = new Date().toISOString();

      let currentRole: UserRole = auth.role;
      let currentPermissions: PermissionKey[] = auth.permissions;
      let currentStatus = auth.status;
      let claimedInviteId: string | null = null;

      // Check Firestore & server index for pending invitation matching verified Google email
      const localInvites = Object.values(loadInvitationsIndex());
      let matchedInvite: AdminInvitation | undefined = localInvites.find(
        (inv) => inv.status === 'pending' && inv.email.trim().toLowerCase() === auth.email
      );

      if (!matchedInvite) {
        const fsInvites = await listFirestoreCollectionRest('adminInvitations', token);
        const fsMatch = fsInvites.find(
          (inv) =>
            inv.status === 'pending' &&
            typeof inv.email === 'string' &&
            inv.email.trim().toLowerCase() === auth.email
        );
        if (fsMatch) {
          matchedInvite = {
            id: String(fsMatch.id),
            email: String(fsMatch.email).toLowerCase(),
            role: fsMatch.role === 'admin' ? 'admin' : 'moderator',
            permissions: parsePermissionsInput(fsMatch.permissions),
            profileName: fsMatch.profileName ? String(fsMatch.profileName) : undefined,
            status: 'pending',
            invitedBy: String(fsMatch.invitedBy || ''),
            invitedByEmail: String(fsMatch.invitedByEmail || ''),
            createdAt: fsMatch.createdAt,
          };
        }
      }

      if (auth.isSuperAdmin) {
        currentRole = 'super_admin';
        currentPermissions = [...ALL_PERMISSIONS];
        currentStatus = 'active';

        // Ensure Super Admin record exists in admins/{uid}
        const existingAdmin = await fetchFirestoreDocRest('admins', auth.uid, token);
        if (!existingAdmin) {
          await patchFirestoreDocRest(
            'admins',
            auth.uid,
            {
              uid: auth.uid,
              email: auth.email,
              displayName: auth.displayName,
              role: 'super_admin',
              permissions: [...ALL_PERMISSIONS],
              status: 'active',
              addedAt: nowIso,
              addedBy: auth.uid,
            },
            token
          );
        }
        upsertAdminDirectoryEntry({
          uid: auth.uid,
          email: auth.email,
          displayName: auth.displayName,
          role: 'super_admin',
          permissions: [...ALL_PERMISSIONS],
          status: 'active',
          addedAt: nowIso,
          addedBy: auth.uid,
        });
      } else if (matchedInvite && currentStatus === 'active') {
        // Claim invitation only after Google OAuth email verification succeeded
        const invitePerms =
          matchedInvite.permissions.length > 0
            ? matchedInvite.permissions
            : DEFAULT_ROLE_PERMISSIONS[matchedInvite.role];

        const adminResult = await patchFirestoreDocRest(
          'admins',
          auth.uid,
          {
            uid: auth.uid,
            email: auth.email,
            displayName: auth.displayName,
            role: matchedInvite.role,
            permissions: invitePerms,
            status: 'active',
            assignedProfileName: matchedInvite.profileName || '',
            inviteId: matchedInvite.id,
            addedAt: nowIso,
            addedBy: matchedInvite.invitedBy,
          },
          token
        );

        await patchFirestoreDocRest(
          'adminInvitations',
          matchedInvite.id,
          {
            status: 'accepted',
            acceptedAt: nowIso,
            acceptedByUid: auth.uid,
          },
          token,
          ['status', 'acceptedAt', 'acceptedByUid']
        );

        if (adminResult.ok || !loadAdminsDirectory()[auth.uid]) {
          currentRole = matchedInvite.role;
          currentPermissions = invitePerms;
          claimedInviteId = matchedInvite.id;

          upsertInvitationIndex({
            ...matchedInvite,
            status: 'accepted',
            acceptedAt: nowIso,
            acceptedByUid: auth.uid,
          });
          upsertAdminDirectoryEntry({
            uid: auth.uid,
            email: auth.email,
            displayName: auth.displayName,
            role: matchedInvite.role,
            permissions: invitePerms,
            status: 'active',
            assignedProfileName: matchedInvite.profileName,
            inviteId: matchedInvite.id,
            addedAt: nowIso,
            addedBy: matchedInvite.invitedBy,
          });

          appendServerAuditLog({
            id: generateSafeId('log'),
            actorUid: auth.uid,
            actorEmail: auth.email,
            actorName: auth.displayName,
            actorRole: matchedInvite.role,
            action: 'تفعيل دعوة مسؤول عبر حساب Google',
            entityType: 'adminInvitation',
            entityId: matchedInvite.id,
            entityName: auth.email,
            result: 'success',
            createdAt: nowIso,
          });
        }
      }

      const existingFsUser = await fetchFirestoreDocRest('users', auth.uid, token);
      const existingDirUser = loadUsersDirectory()[auth.uid];
      const createdAtValue =
        (existingFsUser?.createdAt as string | undefined) ||
        (existingDirUser?.createdAt as string | undefined) ||
        nowIso;

      const userPayload: UserProfile = {
        uid: auth.uid,
        email: auth.email,
        displayName: String(existingFsUser?.displayName || auth.displayName),
        photoURL: String(auth.photoURL || existingFsUser?.photoURL || ''),
        googleSub: auth.googleSub,
        role: currentRole,
        permissions: currentPermissions,
        status: currentStatus,
        specializationId: existingFsUser?.specializationId
          ? String(existingFsUser.specializationId)
          : existingDirUser?.specializationId,
        academicYearId: existingFsUser?.academicYearId
          ? String(existingFsUser.academicYearId)
          : existingDirUser?.academicYearId,
        createdAt: createdAtValue,
        lastLoginAt: nowIso,
        updatedAt: nowIso,
      };

      // Sync verified profile into Firestore users/{uid}
      if (existingFsUser) {
        const fieldsToUpdate: Record<string, unknown> = {
          googleSub: auth.googleSub,
          photoURL: userPayload.photoURL || '',
          lastLoginAt: nowIso,
          updatedAt: nowIso,
        };
        const mask = ['googleSub', 'photoURL', 'lastLoginAt', 'updatedAt'];
        if (
          existingFsUser.role !== currentRole ||
          JSON.stringify(existingFsUser.permissions || []) !== JSON.stringify(currentPermissions)
        ) {
          fieldsToUpdate.role = currentRole;
          fieldsToUpdate.permissions = currentPermissions;
          mask.push('role', 'permissions');
        }
        await patchFirestoreDocRest('users', auth.uid, fieldsToUpdate, token, mask);
      } else {
        await patchFirestoreDocRest(
          'users',
          auth.uid,
          {
            uid: userPayload.uid,
            email: userPayload.email,
            displayName: userPayload.displayName,
            photoURL: userPayload.photoURL || '',
            googleSub: userPayload.googleSub || auth.uid,
            role: currentRole,
            permissions: currentPermissions,
            status: currentStatus,
            createdAt: nowIso,
            lastLoginAt: nowIso,
            updatedAt: nowIso,
          },
          token
        );
      }

      upsertUserDirectoryEntry(userPayload);

      res.json({
        ...userPayload,
        isSuperAdmin: currentRole === 'super_admin' && currentStatus === 'active',
        isStaff: currentStatus === 'active' && ['super_admin', 'admin', 'moderator'].includes(currentRole),
        claimedInviteId,
      });
    } catch (error) {
      console.error('Auth sync failure:', error);
      res.status(500).json({ error: 'تعذر مزامنة بيانات حساب Google.' });
    }
  });

  // --- Storage Usage & Stats ---
  app.get(
    '/api/storage/stats',
    requireAnyPermission(['storage.view', 'storage.manage', 'lectures.upload']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const settingsDoc = await fetchFirestoreDocRest('settings', 'platform', req.authToken);
        const disk = computeDiskStorageUsage();
        const quotaMB =
          Number(settingsDoc?.storageQuotaMB) ||
          Number(process.env.UST_STORAGE_QUOTA_MB) ||
          1024;
        const thresholds =
          (settingsDoc?.alertThresholds as typeof DEFAULT_STORAGE_THRESHOLDS | undefined) ||
          DEFAULT_STORAGE_THRESHOLDS;
        const evaluation = evaluateStorageQuota({
          usedBytes: disk.lecturesBytes,
          quotaMB,
          thresholds,
        });

        res.json({
          lecturesBytes: disk.lecturesBytes,
          backupsBytes: disk.backupsBytes,
          lecturesFileCount: disk.lecturesFileCount,
          quotaMB,
          quotaBytes: evaluation.quotaBytes,
          remainingBytes: evaluation.remainingBytes,
          usedPct: evaluation.usedPct,
          alertLevel: evaluation.alertLevel,
          canUpload: evaluation.canUpload,
          maxFileSizeMB: Number(settingsDoc?.maxFileSizeMB) || 25,
          allowZipUploads: settingsDoc?.allowZipUploads !== false,
          allowedExtensions: parseExtensionsList(settingsDoc?.allowedExtensions),
          alertThresholds: thresholds,
        });
      } catch (error) {
        console.error('Storage stats error:', error);
        res.status(500).json({ error: 'تعذر قراءة إحصائيات مساحة التخزين.' });
      }
    }
  );

  // --- Hierarchical Upload Endpoint with Real Quota + Extension Enforcement ---
  app.post(
    '/api/files/upload',
    uploadRateLimiter,
    requireAnyPermission(['lectures.upload']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const settingsDoc = await fetchFirestoreDocRest('settings', 'platform', req.authToken);
        const maxFileSizeMB = Number(settingsDoc?.maxFileSizeMB) || 25;
        const allowZipUploads = settingsDoc?.allowZipUploads !== false;
        const allowedExtensions = parseExtensionsList(settingsDoc?.allowedExtensions);
        const quotaMB =
          Number(settingsDoc?.storageQuotaMB) ||
          Number(process.env.UST_STORAGE_QUOTA_MB) ||
          1024;
        const thresholds =
          (settingsDoc?.alertThresholds as typeof DEFAULT_STORAGE_THRESHOLDS | undefined) ||
          DEFAULT_STORAGE_THRESHOLDS;

        const upload = multer({
          storage: tmpStorage,
          limits: {
            fileSize: maxFileSizeMB * 1024 * 1024,
          },
          fileFilter: (_req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase().replace(/^\./, '');
            if (!SUPPORTED_FILE_EXTENSIONS.includes(ext as (typeof SUPPORTED_FILE_EXTENSIONS)[number])) {
              return cb(new Error(`صيغة الملف (.${ext}) غير مدعومة.`));
            }
            if (!allowedExtensions.includes(ext)) {
              return cb(new Error(`صيغة الملف (.${ext}) معطّلة حالياً من إعدادات التخزين.`));
            }
            if (ext === 'zip' && !allowZipUploads) {
              return cb(new Error('رفع ملفات ZIP معطّل حالياً من إعدادات المنصة.'));
            }
            cb(null, true);
          },
        }).single('file');

        upload(req, res, (err) => {
          if (err) {
            if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
              return res.status(400).json({
                error: `حجم الملف يتجاوز الحد الأقصى المسموح (${maxFileSizeMB} ميجابايت).`,
              });
            }
            return res.status(400).json({ error: err.message || 'فشل رفع الملف.' });
          }

          if (!req.file) {
            return res.status(400).json({ error: 'لم يتم إرفاق أي ملف.' });
          }

          // Enforce Storage Quota using real disk usage BEFORE keeping the uploaded file
          const disk = computeDiskStorageUsage();
          const quotaCheck = evaluateStorageQuota({
            usedBytes: disk.lecturesBytes,
            incomingBytes: req.file.size,
            quotaMB,
            thresholds,
          });

          if (!quotaCheck.canUpload) {
            try {
              if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            } catch {
              // ignore cleanup error
            }
            appendServerAuditLog({
              id: generateSafeId('log'),
              actorUid: req.serverAuth!.uid,
              actorEmail: req.serverAuth!.email,
              actorName: req.serverAuth!.displayName,
              actorRole: req.serverAuth!.role,
              action: 'رفض رفع ملف بسبب امتلاء السعة التخزينية',
              entityType: 'storage',
              entityId: 'quota_guard',
              entityName: req.file.originalname,
              result: 'denied',
              createdAt: new Date().toISOString(),
            });
            return res.status(403).json({
              error: quotaCheck.message || 'عذراً، مساحة التخزين المتاحة غير كافية. يرجى مراجعة مسؤول المنصة.',
            });
          }

          // Move file into structured hierarchical folder
          const specId = String(req.body?.specializationId || req.headers['x-spec-id'] || '');
          const yearId = String(req.body?.academicYearId || req.headers['x-year-id'] || '');
          const semId = String(req.body?.semesterId || req.headers['x-semester-id'] || '');
          const subId = String(req.body?.subjectId || req.headers['x-subject-id'] || '');

          const dest = buildHierarchicalStorageLocation({
            specializationId: specId,
            academicYearId: yearId,
            semesterId: semId,
            subjectId: subId,
            storageName: req.file.filename,
          });

          fs.mkdirSync(dest.dirPath, { recursive: true });
          fs.renameSync(req.file.path, dest.fullPath);

          const sha256 = computeFileSha256(dest.fullPath);
          const ext = path.extname(req.file.originalname).toLowerCase().replace(/^\./, '');
          const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

          return res.json({
            fileName: originalName,
            originalName,
            fileExt: ext,
            mimeType: MIME_MAP[ext] || req.file.mimetype || 'application/octet-stream',
            fileSize: req.file.size,
            storageName: req.file.filename,
            storagePath: dest.storagePath,
            sha256,
          });
        });
      } catch (error) {
        console.error('Upload handler failed:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء معالجة رفع الملف.' });
      }
    }
  );

  // Register/Sync File Metadata in Server Index
  app.post(
    '/api/files/register',
    requireAnyPermission(['lectures.upload', 'lectures.edit']),
    (req: AuthenticatedRequest, res: Response) => {
      const body = req.body || {};
      if (!body.id || !body.storageName) {
        return res.status(400).json({ error: 'بيانات الملف ناقصة.' });
      }
      upsertFileRegistryEntry({
        id: String(body.id),
        storageName: path.basename(String(body.storageName)),
        storagePath: body.storagePath ? String(body.storagePath) : undefined,
        sha256: body.sha256 ? String(body.sha256) : undefined,
        originalName: String(body.originalName || body.fileName || 'lecture.pdf'),
        fileName: String(body.fileName || body.originalName || 'lecture.pdf'),
        fileExt: String(body.fileExt || 'pdf'),
        mimeType: String(body.mimeType || 'application/pdf'),
        fileSize: Number(body.fileSize || 0),
        allowDownload: Boolean(body.allowDownload),
        status: body.status === 'draft' ? 'draft' : 'published',
        specializationId: body.specializationId ? String(body.specializationId) : undefined,
        academicYearId: body.academicYearId ? String(body.academicYearId) : undefined,
        semesterId: body.semesterId ? String(body.semesterId) : undefined,
        subjectId: body.subjectId ? String(body.subjectId) : undefined,
        title: body.title ? String(body.title) : undefined,
        uploadedBy: body.uploadedBy ? String(body.uploadedBy) : req.serverAuth?.uid,
        uploadedByEmail: body.uploadedByEmail ? String(body.uploadedByEmail) : req.serverAuth?.email,
      });
      res.json({ ok: true });
    }
  );

  // Physical File Cleanup Endpoint
  app.delete(
    '/api/files/storage/:storageName',
    requireAnyPermission(['lectures.delete', 'lectures.edit']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const storageName = path.basename(req.params.storageName || '');
        const fileId = typeof req.query.fileId === 'string' ? req.query.fileId : '';
        const storagePath = typeof req.query.storagePath === 'string' ? req.query.storagePath : undefined;

        if (!storageName || storageName.includes('..')) {
          return res.status(400).json({ error: 'اسم ملف غير صالح.' });
        }

        // If caller only has lectures.edit (e.g. moderator replacing their own file) and not lectures.delete
        if (!serverAuthHasPermission(req.serverAuth!, 'lectures.delete')) {
          const registry = loadFileRegistry();
          const regEntry = fileId ? registry[fileId] : Object.values(registry).find((r) => r.storageName === storageName);
          if (regEntry?.uploadedBy && regEntry.uploadedBy !== req.serverAuth!.uid) {
            return res.status(403).json({ error: 'لا تملك صلاحية حذف ملفات مستخدمين آخرين.' });
          }
        }

        const resolved = resolvePhysicalFilePath(storageName, storagePath);
        if (resolved && fs.existsSync(resolved)) {
          fs.unlinkSync(resolved);
        }
        if (fileId) {
          removeFileRegistryEntry(fileId);
        }
        res.json({ ok: true });
      } catch (error) {
        console.error('Delete file error:', error);
        res.status(500).json({ error: 'تعذر حذف الملف من التخزين.' });
      }
    }
  );

  // --- Admin Directory (Users, Staff, Invitations) ---
  app.get(
    '/api/admin/directory',
    adminRateLimiter,
    requireAnyPermission(['users.view', 'roles.assign']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const token = req.authToken!;
        const auth = req.serverAuth!;
        const usersMap = { ...loadUsersDirectory() };
        const adminsMap = { ...loadAdminsDirectory() };
        const invitesMap = { ...loadInvitationsIndex() };

        if (auth.isSuperAdmin) {
          const [fsUsers, fsAdmins, fsInvites] = await Promise.all([
            listFirestoreCollectionRest('users', token),
            listFirestoreCollectionRest('admins', token),
            listFirestoreCollectionRest('adminInvitations', token),
          ]);
          for (const u of fsUsers) {
            if (u.uid) usersMap[String(u.uid)] = u as unknown as UserProfile;
          }
          for (const a of fsAdmins) {
            if (a.uid) adminsMap[String(a.uid)] = a as unknown as AdminEntry;
          }
          for (const inv of fsInvites) {
            if (inv.id) invitesMap[String(inv.id)] = inv as unknown as AdminInvitation;
          }
        }

        res.json({
          users: Object.values(usersMap),
          admins: Object.values(adminsMap),
          invitations: auth.isSuperAdmin ? Object.values(invitesMap) : [],
        });
      } catch (error) {
        console.error('Admin directory error:', error);
        res.status(500).json({ error: 'تعذر تحميل سجل المستخدمين والمسؤولين.' });
      }
    }
  );

  // --- Role & Granular Permissions Assignment ---
  app.post(
    '/api/admin/users/:uid/role',
    adminRateLimiter,
    requireAnyPermission(['roles.assign']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const actor = req.serverAuth!;
        const token = req.authToken!;
        const targetUid = String(req.params.uid || '').trim();
        const nextRoleRaw = String(req.body?.role || 'student');
        const nextRole: UserRole =
          nextRoleRaw === 'super_admin' || nextRoleRaw === 'admin' || nextRoleRaw === 'moderator'
            ? nextRoleRaw
            : 'student';

        if (!targetUid) {
          return res.status(400).json({ error: 'معرف المستخدم غير صالح.' });
        }

        const fsUserDoc = await fetchFirestoreDocRest('users', targetUid, token);
        const dirUserDoc = loadUsersDirectory()[targetUid];
        const targetUser: UserProfile | null = fsUserDoc
          ? (fsUserDoc as unknown as UserProfile)
          : dirUserDoc || null;

        if (!targetUser) {
          return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }

        const requestedPerms = parsePermissionsInput(req.body?.permissions);
        const finalPerms: PermissionKey[] =
          nextRole === 'student'
            ? []
            : requestedPerms.length > 0
              ? requestedPerms
              : DEFAULT_ROLE_PERMISSIONS[nextRole];

        const actorProfile: UserProfile = {
          uid: actor.uid,
          email: actor.email,
          displayName: actor.displayName,
          role: actor.role,
          permissions: actor.permissions,
          status: actor.status,
        };

        const check = canAssignRoleChange({
          actor: actorProfile,
          target: targetUser,
          nextRole,
          nextPermissions: finalPerms,
        });

        if (!check.allowed) {
          appendServerAuditLog({
            id: generateSafeId('log'),
            actorUid: actor.uid,
            actorEmail: actor.email,
            actorName: actor.displayName,
            actorRole: actor.role,
            action: 'محاولة مرفوضة لتعديل صلاحيات مستخدم',
            entityType: 'user',
            entityId: targetUid,
            entityName: targetUser.email,
            result: 'denied',
            details: check.reason,
            createdAt: new Date().toISOString(),
          });
          return res.status(403).json({ error: check.reason || 'غير مسموح بهذه العملية.' });
        }

        const nowIso = new Date().toISOString();
        const assignedProfileName = req.body?.assignedProfileName
          ? String(req.body.assignedProfileName).slice(0, 120)
          : undefined;

        await patchFirestoreDocRest(
          'users',
          targetUid,
          {
            role: nextRole,
            permissions: finalPerms,
            updatedAt: nowIso,
          },
          token,
          ['role', 'permissions', 'updatedAt']
        );

        if (nextRole === 'admin' || nextRole === 'moderator') {
          const adminRecord: AdminEntry = {
            uid: targetUid,
            email: targetUser.email,
            displayName: targetUser.displayName,
            role: nextRole,
            permissions: finalPerms,
            status: targetUser.status === 'suspended' ? 'suspended' : 'active',
            assignedProfileName,
            addedAt: nowIso,
            addedBy: actor.uid,
          };
          await patchFirestoreDocRest('admins', targetUid, adminRecord as unknown as Record<string, unknown>, token);
          upsertAdminDirectoryEntry(adminRecord);
        } else {
          await deleteFirestoreDocRest('admins', targetUid, token);
          removeAdminDirectoryEntry(targetUid);
        }

        upsertUserDirectoryEntry({
          ...targetUser,
          role: nextRole,
          permissions: finalPerms,
          updatedAt: nowIso,
        });

        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: actor.uid,
          actorEmail: actor.email,
          actorName: actor.displayName,
          actorRole: actor.role,
          action: `تغيير الدور إلى ${nextRole}`,
          entityType: 'user',
          entityId: targetUid,
          entityName: targetUser.email,
          result: 'success',
          details: `Permissions count: ${finalPerms.length}`,
          createdAt: nowIso,
        });

        res.json({ ok: true, uid: targetUid, role: nextRole, permissions: finalPerms });
      } catch (error) {
        console.error('Update user role error:', error);
        res.status(500).json({ error: 'تعذر تحديث صلاحية المستخدم.' });
      }
    }
  );

  // --- Suspend / Reactivate Account ---
  app.post(
    '/api/admin/users/:uid/status',
    adminRateLimiter,
    requireAnyPermission(['users.manage']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const actor = req.serverAuth!;
        const token = req.authToken!;
        const targetUid = String(req.params.uid || '').trim();
        const nextStatus = req.body?.status === 'suspended' ? 'suspended' : 'active';

        const fsUserDoc = await fetchFirestoreDocRest('users', targetUid, token);
        const dirUserDoc = loadUsersDirectory()[targetUid];
        const targetUser: UserProfile | null = fsUserDoc
          ? (fsUserDoc as unknown as UserProfile)
          : dirUserDoc || null;

        if (!targetUser) {
          return res.status(404).json({ error: 'المستخدم غير موجود.' });
        }

        if (targetUser.role === 'super_admin' || targetUid === actor.uid) {
          return res.status(403).json({ error: 'لا يمكن تعليق حساب المدير الرئيسي أو حسابك الحالي.' });
        }

        if (!actor.isSuperAdmin && targetUser.role !== 'student') {
          return res.status(403).json({ error: 'تعليق حسابات المسؤولين والمشرفين حصري للمدير الرئيسي.' });
        }

        const nowIso = new Date().toISOString();
        await patchFirestoreDocRest(
          'users',
          targetUid,
          { status: nextStatus, updatedAt: nowIso },
          token,
          ['status', 'updatedAt']
        );

        if (targetUser.role === 'admin' || targetUser.role === 'moderator') {
          await patchFirestoreDocRest(
            'admins',
            targetUid,
            { status: nextStatus },
            token,
            ['status']
          );
          const adm = loadAdminsDirectory()[targetUid];
          if (adm) {
            upsertAdminDirectoryEntry({ ...adm, status: nextStatus });
          }
        }

        upsertUserDirectoryEntry({
          ...targetUser,
          status: nextStatus,
          updatedAt: nowIso,
        });

        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: actor.uid,
          actorEmail: actor.email,
          actorName: actor.displayName,
          actorRole: actor.role,
          action: nextStatus === 'suspended' ? 'تعليق حساب مستخدم' : 'إعادة تفعيل حساب مستخدم',
          entityType: 'user',
          entityId: targetUid,
          entityName: targetUser.email,
          result: 'success',
          createdAt: nowIso,
        });

        res.json({ ok: true, uid: targetUid, status: nextStatus });
      } catch (error) {
        console.error('Status update error:', error);
        res.status(500).json({ error: 'تعذر تحديث حالة الحساب.' });
      }
    }
  );

  // --- Super Admin Pending Google Email Invitations ---
  app.get('/api/admin/invitations', adminRateLimiter, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const fsInvites = await listFirestoreCollectionRest('adminInvitations', req.authToken!);
    const map = { ...loadInvitationsIndex() };
    for (const inv of fsInvites) {
      if (inv.id) map[String(inv.id)] = inv as unknown as AdminInvitation;
    }
    res.json({ invitations: Object.values(map) });
  });

  app.post('/api/admin/invitations', adminRateLimiter, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const actor = req.serverAuth!;
      const token = req.authToken!;
      const email = String(req.body?.email || '').trim().toLowerCase();
      const role: 'admin' | 'moderator' = req.body?.role === 'admin' ? 'admin' : 'moderator';
      const permsInput = parsePermissionsInput(req.body?.permissions);
      const permissions = permsInput.length > 0 ? permsInput : DEFAULT_ROLE_PERMISSIONS[role];
      const profileName = req.body?.profileName ? String(req.body.profileName).trim().slice(0, 120) : undefined;

      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صالح لحساب Google.' });
      }
      if (email === SUPER_ADMIN_EMAIL) {
        return res.status(400).json({ error: 'هذا البريد يعود للمدير الرئيسي بالفعل.' });
      }

      const inviteId = generateSafeId('inv');
      const nowIso = new Date().toISOString();
      const invite: AdminInvitation = {
        id: inviteId,
        email,
        role,
        permissions,
        profileName,
        status: 'pending',
        invitedBy: actor.uid,
        invitedByEmail: actor.email,
        createdAt: nowIso,
      };

      const restRes = await patchFirestoreDocRest(
        'adminInvitations',
        inviteId,
        invite as unknown as Record<string, unknown>,
        token
      );
      if (!restRes.ok) {
        return res.status(400).json({ error: 'تعذر حفظ الدعوة في قاعدة البيانات.' });
      }

      upsertInvitationIndex(invite);
      appendServerAuditLog({
        id: generateSafeId('log'),
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorName: actor.displayName,
        actorRole: actor.role,
        action: `إرسال دعوة إدارية (${role})`,
        entityType: 'adminInvitation',
        entityId: inviteId,
        entityName: email,
        result: 'success',
        createdAt: nowIso,
      });

      res.json({ invitation: invite });
    } catch (error) {
      console.error('Create invitation error:', error);
      res.status(500).json({ error: 'تعذر إنشاء دعوة المسؤول.' });
    }
  });

  app.delete('/api/admin/invitations/:id', adminRateLimiter, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const inviteId = String(req.params.id || '').trim();
      await deleteFirestoreDocRest('adminInvitations', inviteId, req.authToken!);
      removeInvitationIndex(inviteId);
      appendServerAuditLog({
        id: generateSafeId('log'),
        actorUid: req.serverAuth!.uid,
        actorEmail: req.serverAuth!.email,
        actorName: req.serverAuth!.displayName,
        actorRole: req.serverAuth!.role,
        action: 'إلغاء دعوة إدارية',
        entityType: 'adminInvitation',
        entityId: inviteId,
        entityName: inviteId,
        result: 'success',
        createdAt: new Date().toISOString(),
      });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'تعذر إلغاء الدعوة.' });
    }
  });

  // --- Immutable Audit Logs ---
  app.get(
    '/api/admin/audit-logs',
    adminRateLimiter,
    requireAnyPermission(['audit_logs.view']),
    (_req: AuthenticatedRequest, res: Response) => {
      res.json({ logs: loadServerAuditLogs() });
    }
  );

  app.post('/api/admin/audit-logs', adminRateLimiter, requireStaff, (req: AuthenticatedRequest, res: Response) => {
    const auth = req.serverAuth!;
    const body = req.body || {};
    const entry = {
      id: generateSafeId('log'),
      actorUid: auth.uid,
      actorEmail: auth.email,
      actorName: auth.displayName,
      actorRole: auth.role,
      action: String(body.action || 'إجراء إداري').slice(0, 120),
      entityType: String(body.entityType || 'system').slice(0, 80),
      entityId: sanitizePathSegment(body.entityId, 'system'),
      entityName: String(body.entityName || 'غير محدد').slice(0, 200),
      result: (body.result === 'denied' || body.result === 'failed' ? body.result : 'success') as
        | 'success'
        | 'denied'
        | 'failed',
      details: body.details ? String(body.details).slice(0, 400) : undefined,
      createdAt: new Date().toISOString(),
    };
    appendServerAuditLog(entry);
    res.json({ ok: true, log: entry });
  });

  // --- Database & File Backups ---
  app.get(
    '/api/backups',
    adminRateLimiter,
    requireAnyPermission(['settings.manage']),
    (_req: AuthenticatedRequest, res: Response) => {
      res.json({ backups: loadBackupsIndex() });
    }
  );

  app.post(
    '/api/backups/create',
    adminRateLimiter,
    requireAnyPermission(['settings.manage']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const auth = req.serverAuth!;
        const token = req.authToken!;
        const backupType: 'database' | 'files' | 'full' =
          req.body?.type === 'files' || req.body?.type === 'full' ? req.body.type : 'database';
        const notes = req.body?.notes ? String(req.body.notes).slice(0, 300) : undefined;
        const backupId = generateSafeId('bkp');
        const nowIso = new Date().toISOString();

        let totalRecords = 0;
        let totalFiles = 0;
        let totalBytes = 0;

        if (backupType === 'database' || backupType === 'full') {
          const [specs, years, sems, subs, files, anns, notifs] = await Promise.all([
            listFirestoreCollectionRest('specializations', token),
            listFirestoreCollectionRest('academicYears', token),
            listFirestoreCollectionRest('semesters', token),
            listFirestoreCollectionRest('subjects', token),
            listFirestoreCollectionRest('lectureFiles', token),
            listFirestoreCollectionRest('announcements', token),
            listFirestoreCollectionRest('notifications', token),
          ]);
          const dbSnapshot = {
            backupId,
            type: backupType,
            createdAt: nowIso,
            createdBy: auth.email,
            collections: {
              specializations: specs,
              academicYears: years,
              semesters: sems,
              subjects: subs,
              lectureFiles: files,
              announcements: anns,
              notifications: notifs,
            },
            serverIndexes: {
              fileRegistry: loadFileRegistry(),
              users: Object.values(loadUsersDirectory()),
              admins: Object.values(loadAdminsDirectory()),
              invitations: Object.values(loadInvitationsIndex()),
              auditLogsCount: loadServerAuditLogs().length,
            },
          };
          totalRecords =
            specs.length +
            years.length +
            sems.length +
            subs.length +
            files.length +
            anns.length +
            notifs.length +
            Object.keys(loadUsersDirectory()).length;
          const written = writeJsonBackupFile(backupId, dbSnapshot);
          totalBytes += written.bytes;
        }

        if (backupType === 'files' || backupType === 'full') {
          const filesSnap = createPhysicalFilesBackupSnapshot(backupId);
          totalFiles = filesSnap.totalFiles;
          totalBytes += filesSnap.totalBytes;
        }

        const record: BackupSnapshot = {
          id: backupId,
          type: backupType,
          status: 'completed',
          totalRecords,
          totalFiles,
          totalBytes,
          createdBy: auth.uid,
          createdByEmail: auth.email,
          notes,
          createdAt: nowIso,
        };

        appendBackupIndex(record);
        if (auth.isSuperAdmin) {
          await patchFirestoreDocRest('backups', backupId, record as unknown as Record<string, unknown>, token);
        }

        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: auth.uid,
          actorEmail: auth.email,
          actorName: auth.displayName,
          actorRole: auth.role,
          action: `إنشاء نسخة احتياطية (${backupType})`,
          entityType: 'backup',
          entityId: backupId,
          entityName: `${backupType} (${totalRecords} سجل / ${totalFiles} ملف)`,
          result: 'success',
          createdAt: nowIso,
        });

        res.json({ backup: record });
      } catch (error) {
        console.error('Create backup error:', error);
        res.status(500).json({ error: 'تعذر إنشاء النسخة الاحتياطية.' });
      }
    }
  );

  app.get(
    '/api/backups/download/:backupId',
    adminRateLimiter,
    requireAnyPermission(['settings.manage']),
    (req: AuthenticatedRequest, res: Response) => {
      const safeId = sanitizePathSegment(req.params.backupId, '');
      if (!safeId) return res.status(400).json({ error: 'معرف النسخة غير صالح.' });
      const dbFile = path.join(DB_BACKUPS_DIR, `${safeId}.json`);
      if (fs.existsSync(dbFile)) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${safeId}-db.json"`);
        return fs.createReadStream(dbFile).pipe(res);
      }
      const filesManifest = path.join(FILE_BACKUPS_DIR, safeId, 'manifest.json');
      if (fs.existsSync(filesManifest)) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${safeId}-files-manifest.json"`);
        return fs.createReadStream(filesManifest).pipe(res);
      }
      return res.status(404).json({ error: 'ملف النسخة الاحتياطية غير موجود.' });
    }
  );

  // --- Resolve File Metadata (Firestore + Server Index) ---
  async function resolveLectureFileMeta(fileId: string, token?: string) {
    const fsDoc = await fetchFirestoreDocRest('lectureFiles', fileId, token);
    if (fsDoc) return fsDoc;
    const registry = loadFileRegistry();
    return registry[fileId] || null;
  }

  // Protected File Inline Preview Endpoint
  app.get('/api/files/view/:fileId', attachOptionalAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const fileId = String(req.params.fileId || '').trim();
      const fileData = await resolveLectureFileMeta(fileId, req.authToken);
      if (!fileData) {
        return res.status(404).json({ error: 'الملف غير موجود.' });
      }
      if (fileData.status !== 'published' && !req.isAdmin) {
        return res.status(403).json({ error: 'هذا الملف غير منشور للعرض حالياً.' });
      }

      const storageName = path.basename(String(fileData.storageName || ''));
      const storagePath = fileData.storagePath ? String(fileData.storagePath) : undefined;
      let fullPath = resolvePhysicalFilePath(storageName, storagePath);
      if (!fullPath) {
        ensureSeedPdfFilesOnDisk();
        fullPath = resolvePhysicalFilePath(storageName, storagePath);
      }
      if (!fullPath || !fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'ملف التخزين غير متوفر على الخادم.' });
      }

      const ext = String(fileData.fileExt || 'pdf').toLowerCase();
      const mimeType = String(fileData.mimeType || MIME_MAP[ext] || 'application/octet-stream');
      const originalName = String(fileData.originalName || fileData.fileName || 'lecture.pdf');
      res.setHeader('Content-Type', mimeType);
      res.setHeader(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`
      );
      fs.createReadStream(fullPath).pipe(res);
    } catch (error) {
      console.error('View file error:', error);
      res.status(500).json({ error: 'تعذر عرض الملف.' });
    }
  });

  // Protected File Download Endpoint
  app.get('/api/files/download/:fileId', attachOptionalAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const fileId = String(req.params.fileId || '').trim();
      const fileData = await resolveLectureFileMeta(fileId, req.authToken);
      if (!fileData) {
        return res.status(404).json({ error: 'الملف غير موجود.' });
      }
      if (fileData.status !== 'published' && !req.isAdmin) {
        return res.status(403).json({ error: 'هذا الملف غير متاح للتحميل.' });
      }
      if (!fileData.allowDownload && !req.isAdmin) {
        return res.status(403).json({ error: 'تم تعطيل تحميل هذا الملف من قبل إدارة المنصة؛ يمكنك معاينته فقط.' });
      }

      const storageName = path.basename(String(fileData.storageName || ''));
      const storagePath = fileData.storagePath ? String(fileData.storagePath) : undefined;
      let fullPath = resolvePhysicalFilePath(storageName, storagePath);
      if (!fullPath) {
        ensureSeedPdfFilesOnDisk();
        fullPath = resolvePhysicalFilePath(storageName, storagePath);
      }
      if (!fullPath || !fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'ملف التخزين غير متوفر على الخادم.' });
      }

      const ext = String(fileData.fileExt || 'pdf').toLowerCase();
      const mimeType = String(fileData.mimeType || MIME_MAP[ext] || 'application/octet-stream');
      const originalName = String(fileData.originalName || fileData.fileName || 'lecture.pdf');
      res.setHeader('Content-Type', mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`
      );
      fs.createReadStream(fullPath).pipe(res);
    } catch (error) {
      console.error('Download file error:', error);
      res.status(500).json({ error: 'تعذر تحميل الملف.' });
    }
  });

  // Extract readable text segments from stored PDF
  app.get('/api/files/extract/:fileId', attachOptionalAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const fileId = String(req.params.fileId || '').trim();
      const fileData = await resolveLectureFileMeta(fileId, req.authToken);
      if (!fileData) {
        return res.status(404).json({ error: 'الملف غير موجود.' });
      }
      if (fileData.status !== 'published' && !req.isAdmin) {
        return res.status(403).json({ error: 'هذا الملف غير متاح للعرض.' });
      }

      const storageName = path.basename(String(fileData.storageName || ''));
      const storagePath = fileData.storagePath ? String(fileData.storagePath) : undefined;
      let fullPath = resolvePhysicalFilePath(storageName, storagePath);
      if (!fullPath) {
        ensureSeedPdfFilesOnDisk();
        fullPath = resolvePhysicalFilePath(storageName, storagePath);
      }
      if (!fullPath || !fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'ملف التخزين غير متوفر.' });
      }

      const raw = fs.readFileSync(fullPath, 'latin1');
      const matches = [...raw.matchAll(/\(([^()]{2,240})\)\s*Tj/g)];
      const lines = matches
        .map((m) => m[1].replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\').trim())
        .filter((line) => line.length > 0);

      res.json({
        fileId,
        originalName: fileData.originalName || fileData.fileName,
        lines,
      });
    } catch (error) {
      console.error('Extract PDF error:', error);
      res.status(500).json({ error: 'تعذر قراءة محتوى الملف.' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`UST Lecture Platform running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
