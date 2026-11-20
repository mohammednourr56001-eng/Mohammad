import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { DecodedIdToken } from 'firebase-admin/auth';
import {
  adminAuth,
  appendBackupIndex,
  appendServerAuditLog,
  consumeAiDailyQuota,
  deleteFirestoreDocRest,
  fetchFirestoreDocRest,
  flushServerIndexWrites,
  getAiQuotaStats,
  getSecurityCounters,
  incrementRejectedUploadsCount,
  listFirestoreCollectionRest,
  loadAdminAssignmentsIndex,
  loadAdminPermissionsIndex,
  loadAdminsDirectory,
  loadBackupsIndex,
  loadInvitationsIndex,
  loadRevokedSessionsMap,
  loadServerAuditLogs,
  loadUsersDirectory,
  patchFirestoreDocRest,
  queryFirestoreCollectionByFieldRest,
  queryPublishedFirestoreCollectionRest,
  recordAiPromptInjectionBlock,
  removeAdminAssignmentIndex,
  removeAdminDirectoryEntry,
  removeAssignmentPermissionsForUid,
  removeInvitationIndex,
  removeUserDirectoryEntry,
  replaceAssignmentPermissionsIndex,
  ResolvedServerAuth,
  resolveServerAuth,
  revokeUserSessionsTimestamp,
  serverAuthHasPermission,
  SUPER_ADMIN_EMAIL,
  touchAdminLastActivity,
  updateBackupIndexRecord,
  upsertAdminAssignmentIndex,
  upsertAdminDirectoryEntry,
  upsertInvitationIndex,
  upsertUserDirectoryEntry,
  verifyBearerToken,
} from './server/firebaseAdmin.ts';
import {
  computeWeakEtag,
  isEtagMatch,
  mergePublishedCatalogSnapshot,
  PublishedCatalogSnapshot,
  sanitizePublicSettings,
  SingleFlightCoordinator,
} from './server/catalogCache.ts';
import {
  ensureSeedPdfFilesOnDisk,
  flushRegistryWrites,
  getInitialCatalog,
  loadFileRegistry,
  removeFileRegistryEntry,
  upsertFileRegistryEntry,
} from './server/seedPlatform.ts';
import {
  buildCentralStorageLocation,
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
  AcademicYear,
  AdminAssignment,
  AdminEntry,
  AdminInvitation,
  ALL_PERMISSIONS,
  Announcement,
  BackupSnapshot,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_SPECIALIZATION_ADMIN_PERMISSIONS,
  DEFAULT_STORAGE_THRESHOLDS,
  LectureFile,
  LectureFileLink,
  PermissionKey,
  ProgramCourseLink,
  Semester,
  Specialization,
  Subject,
  SUPER_ADMIN_ONLY_PERMISSIONS,
  SUPPORTED_FILE_EXTENSIONS,
  UserProfile,
  UserRole,
} from './src/types/academic.ts';
import {
  canAssignRoleChange,
  evaluateStorageQuota,
  generateSafeId,
} from './src/utils/academicLogic.ts';
import {
  buildAssignmentChangeDiffLabel,
  canScopedAdminPerformAction,
  computeSpecializationDashboardSummary,
  sanitizeScopedAdminPermissions,
  SCOPED_ADMIN_ACCESS_DENIED_AR,
  SUPER_ADMIN_UPLOAD_ONLY_AR,
} from './src/utils/scopedAdminLogic.ts';
import {
  buildSecurityCenterSnapshot,
  inspectPromptInjectionRisk,
  validateFileMagicBytes,
  validateUploadFilenameSafety,
} from './src/utils/securityProtection.ts';
import { cacheLayer } from './server/cacheLayer.ts';
import { createObservabilityMiddleware, observability } from './server/observability.ts';
import {
  createSignedUrlToken,
  createTieredRateLimiter,
  enterpriseSecurityHeaders,
  isPersistentSigningSecretConfigured,
  validateMutatingOrigin,
  verifySignedUrlToken,
} from './server/securityMiddleware.ts';
import {
  deleteUserExamAttempts,
  flushExamWrites,
  getExamById,
  listUserAttempts,
  loadAllExams,
  sanitizeExamForStudent,
  submitExamAttempt,
} from './server/examEngine.ts';
import { aiQueueWorker } from './server/aiQueueWorker.ts';

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

const createRateLimiter = createTieredRateLimiter;

async function attachOptionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  // Security: NEVER accept Firebase ID tokens in ?token= URL query strings (prevents history/referrer leakage)
  const authHeader = req.headers.authorization;
  const token =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';

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
    const auth = req.serverAuth;
    if (!auth?.isSuperAdmin) {
      if (auth) {
        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: auth.uid,
          actorEmail: auth.email,
          actorName: auth.displayName,
          actorRole: auth.role,
          action: 'محاولة وصول غير مصرح بها لإجراء سيادي',
          entityType: 'super_admin_guard',
          entityId: sanitizePathSegment(req.path, 'endpoint'),
          entityName: `${req.method} ${req.path}`,
          specializationId: auth.assignedSpecializationId,
          result: 'denied',
          details: 'Super Admin authority required',
          createdAt: new Date().toISOString(),
        });
      }
      return res.status(403).json({ error: 'ممنوع: هذه العملية حصرية للمدير الرئيسي / مالك المنصة فقط.' });
    }
    next();
  });
}

async function requireSuperAdminUploadGuard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  await requireStaff(req, res, () => {
    const auth = req.serverAuth;
    if (!auth?.isSuperAdmin) {
      if (auth) {
        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: auth.uid,
          actorEmail: auth.email,
          actorName: auth.displayName,
          actorRole: auth.role,
          action: 'محاولة رفع أو تعديل ملف غير مصرح بها',
          entityType: 'lecture_upload_guard',
          entityId: sanitizePathSegment(req.path, 'upload'),
          entityName: `${req.method} ${req.path}`,
          specializationId: auth.assignedSpecializationId,
          result: 'denied',
          details: SUPER_ADMIN_UPLOAD_ONLY_AR,
          createdAt: new Date().toISOString(),
        });
      }
      return res.status(403).json({ error: SUPER_ADMIN_UPLOAD_ONLY_AR });
    }
    next();
  });
}

function requireScopedAdminAccess(requiredPermission: PermissionKey) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    await requireStaff(req, res, () => {
      const auth = req.serverAuth;
      if (!auth) return;
      if (auth.isSuperAdmin) {
        return next();
      }
      const requestedSpecIdRaw =
        req.params?.specId ||
        req.body?.specializationId ||
        req.body?.specialization_id ||
        req.query?.specializationId ||
        req.query?.specId ||
        auth.assignedSpecializationId;
      const requestedSpecId = requestedSpecIdRaw ? String(requestedSpecIdRaw).trim() : '';

      if (auth.role !== 'admin' || !auth.assignedSpecializationId) {
        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: auth.uid,
          actorEmail: auth.email,
          actorName: auth.displayName,
          actorRole: auth.role,
          action: 'رفض وصول لعدم وجود تخصص مسند',
          entityType: 'scoped_guard',
          entityId: sanitizePathSegment(req.path, 'scoped'),
          entityName: `${req.method} ${req.path}`,
          result: 'denied',
          details: 'No active assignedSpecializationId on admin account',
          createdAt: new Date().toISOString(),
        });
        return res.status(403).json({ error: SCOPED_ADMIN_ACCESS_DENIED_AR });
      }

      if (requestedSpecId && requestedSpecId !== auth.assignedSpecializationId) {
        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: auth.uid,
          actorEmail: auth.email,
          actorName: auth.displayName,
          actorRole: auth.role,
          action: 'محاولة وصول خارج نطاق التخصص المسند',
          entityType: 'scoped_guard',
          entityId: sanitizePathSegment(requestedSpecId, 'spec'),
          entityName: `${req.method} ${req.path}`,
          specializationId: auth.assignedSpecializationId,
          result: 'denied',
          details: `Assigned: ${auth.assignedSpecializationId} | Attempted: ${requestedSpecId}`,
          createdAt: new Date().toISOString(),
        });
        return res.status(403).json({ error: SCOPED_ADMIN_ACCESS_DENIED_AR });
      }

      const allowedPerms = sanitizeScopedAdminPermissions(auth.permissions);
      if (!allowedPerms.includes(requiredPermission)) {
        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: auth.uid,
          actorEmail: auth.email,
          actorName: auth.displayName,
          actorRole: auth.role,
          action: 'محاولة إجراء غير ممنوح داخل التخصص',
          entityType: 'scoped_guard',
          entityId: sanitizePathSegment(req.path, 'scoped'),
          entityName: `${req.method} ${req.path}`,
          specializationId: auth.assignedSpecializationId,
          result: 'denied',
          details: `Missing permission: ${requiredPermission}`,
          createdAt: new Date().toISOString(),
        });
        return res.status(403).json({ error: 'لا تملك الصلاحية المطلوبة داخل هذا التخصص.' });
      }

      touchAdminLastActivity(auth.uid, auth.assignmentId);
      next();
    });
  };
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
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(enterpriseSecurityHeaders);
  app.use(validateMutatingOrigin);
  app.use(createObservabilityMiddleware(observability));
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const isFileTransfer =
      req.path.startsWith('/files/upload') ||
      req.path.startsWith('/storage/direct-upload') ||
      req.path.startsWith('/files/download') ||
      req.path.startsWith('/cdn/download');
    const timeoutMs = isFileTransfer ? 60_000 : 25_000;
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({ error: 'انتهت مهلة معالجة الطلب على الخادم. يرجى المحاولة مرة أخرى.' });
      }
    }, timeoutMs);
    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));
    next();
  });
  app.use(express.json({ limit: '2mb' }));

  const cachedCatalogRateLimiter = createRateLimiter({ windowMs: 10_000, maxRequests: 15_000, keyPrefix: 'catalog' });
  const publicRateLimiter = createRateLimiter({ windowMs: 10_000, maxRequests: 8_000, keyPrefix: 'public' });
  const authRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 60, keyPrefix: 'auth' });
  const adminRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 120, keyPrefix: 'admin' });
  const uploadRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 40, keyPrefix: 'upload' });
  const examRateLimiter = createRateLimiter({ windowMs: 10_000, maxRequests: 5_000, keyPrefix: 'exam' });
  const aiRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 20, keyPrefix: 'ai' });

  const catalogSingleFlight = new SingleFlightCoordinator();
  const CATALOG_SNAPSHOT_KEY = 'catalog:snapshot:v1';
  const CATALOG_SNAPSHOT_STALE_KEY = 'catalog:snapshot:stale:v1';

  async function invalidatePublicCatalogCaches(fileId?: string): Promise<void> {
    cacheLayer.invalidatePattern('catalog:');
    if (fileId) {
      await cacheLayer.del(`file:meta:${fileId}`);
    } else {
      cacheLayer.invalidatePattern('file:meta:');
    }
    await cacheLayer.del('settings:platform');
  }

  async function getCachedPlatformSettings(token?: string): Promise<Record<string, unknown> | null> {
    if (!token) {
      const cached = await cacheLayer.get<Record<string, unknown>>('settings:platform');
      if (cached) return cached;
    }
    const { value } = await catalogSingleFlight.run('settings:platform', async () => {
      const doc = await fetchFirestoreDocRest('settings', 'platform', token).catch(() => null);
      if (doc) {
        await cacheLayer.set('settings:platform', doc, 120);
      }
      return doc;
    });
    return value;
  }

  async function getOrLoadPublishedCatalogSnapshot(): Promise<{
    snapshot: PublishedCatalogSnapshot;
    cacheStatus: 'HIT' | 'MISS' | 'COALESCED' | 'STALE';
  }> {
    const cached = await cacheLayer.get<PublishedCatalogSnapshot>(CATALOG_SNAPSHOT_KEY);
    if (cached) {
      return { snapshot: cached, cacheStatus: 'HIT' };
    }

    try {
      const { value, coalesced } = await catalogSingleFlight.run(CATALOG_SNAPSHOT_KEY, async () => {
        // Re-check cache inside single-flight in case another waiter populated it
        const rechecked = await cacheLayer.get<PublishedCatalogSnapshot>(CATALOG_SNAPSHOT_KEY);
        if (rechecked) return rechecked;

        const [
          specs,
          years,
          semesters,
          subjects,
          programCourses,
          lectureFileLinks,
          lectureFiles,
          announcements,
          notifications,
          settingsDoc,
        ] = await Promise.all([
          queryPublishedFirestoreCollectionRest('specializations'),
          queryPublishedFirestoreCollectionRest('academicYears'),
          queryPublishedFirestoreCollectionRest('semesters'),
          queryPublishedFirestoreCollectionRest('subjects'),
          queryPublishedFirestoreCollectionRest('programCourses'),
          queryPublishedFirestoreCollectionRest('lectureFileLinks'),
          queryPublishedFirestoreCollectionRest('lectureFiles'),
          queryPublishedFirestoreCollectionRest('announcements'),
          queryPublishedFirestoreCollectionRest('notifications'),
          getCachedPlatformSettings(),
        ]);

        const seed = getInitialCatalog();
        const registryEntries = Object.values(loadFileRegistry());
        const snapshot = mergePublishedCatalogSnapshot({
          firestore: {
            specializations: specs as unknown as Specialization[],
            academicYears: years as unknown as AcademicYear[],
            semesters: semesters as unknown as Semester[],
            subjects: subjects as unknown as Subject[],
            programCourses: programCourses as unknown as ProgramCourseLink[],
            lectureFileLinks: lectureFileLinks as unknown as LectureFileLink[],
            lectureFiles: lectureFiles as unknown as LectureFile[],
            announcements: announcements as unknown as Announcement[],
            notifications: notifications as unknown as Parameters<
              typeof mergePublishedCatalogSnapshot
            >[0]['firestore']['notifications'],
          },
          seed: seed as unknown as Parameters<typeof mergePublishedCatalogSnapshot>[0]['seed'],
          fileRegistryEntries: registryEntries,
          settings: sanitizePublicSettings(settingsDoc, {
            allowedExtensions: [...SUPPORTED_FILE_EXTENSIONS],
            alertThresholds: DEFAULT_STORAGE_THRESHOLDS,
          }),
        });

        await cacheLayer.set(CATALOG_SNAPSHOT_KEY, snapshot, 180);
        await cacheLayer.set(CATALOG_SNAPSHOT_STALE_KEY, snapshot, 3600);
        return snapshot;
      });

      return { snapshot: value, cacheStatus: coalesced ? 'COALESCED' : 'MISS' };
    } catch {
      const stale = await cacheLayer.get<PublishedCatalogSnapshot>(CATALOG_SNAPSHOT_STALE_KEY);
      if (stale) {
        return { snapshot: stale, cacheStatus: 'STALE' };
      }
      const fallback = mergePublishedCatalogSnapshot({
        firestore: {
          specializations: [],
          academicYears: [],
          semesters: [],
          subjects: [],
          programCourses: [],
          lectureFileLinks: [],
          lectureFiles: [],
          announcements: [],
          notifications: [],
        },
        seed: getInitialCatalog() as unknown as Parameters<
          typeof mergePublishedCatalogSnapshot
        >[0]['seed'],
        fileRegistryEntries: Object.values(loadFileRegistry()),
      });
      return { snapshot: fallback, cacheStatus: 'STALE' };
    }
  }

  // Warm distributed cache with initial catalog on startup (non-blocking)
  const initialCatalog = getInitialCatalog();
  await cacheLayer.set('catalog:public', initialCatalog, 120);
  if (cacheLayer.isRedisConfigured()) {
    await cacheLayer.pingRedis();
  }
  void getOrLoadPublishedCatalogSnapshot();

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
    const perf = observability.getPerformanceMetrics();
    res.status(observability.draining ? 503 : 200).json({
      ok: !observability.draining,
      service: 'ust-lecture-platform',
      instanceId: observability.instanceId,
      uptimeSeconds: Math.floor((Date.now() - observability.startedAt) / 1000),
      superAdminConfigured: Boolean(SUPER_ADMIN_EMAIL),
      cacheMode: cacheLayer.getStats().mode,
      p95LatencyMs: perf.p95ResponseMs,
    });
  });

  app.get('/api/liveness', (_req, res) => {
    res.json({ alive: true, instanceId: observability.instanceId });
  });

  app.get('/api/readiness', async (_req, res) => {
    if (observability.draining) {
      return res.status(503).json({ ready: false, reason: 'draining' });
    }
    try {
      await fs.promises.access(TMP_STORAGE_DIR);
    } catch {
      return res.status(503).json({ ready: false, reason: 'storage_unavailable' });
    }
    res.json({
      ready: true,
      instanceId: observability.instanceId,
      cache: cacheLayer.getStats().mode,
    });
  });

  // High-concurrency edge-cacheable published catalog snapshot (replaces 9x onSnapshot per student)
  app.get('/api/catalog/snapshot', cachedCatalogRateLimiter, async (req: Request, res: Response) => {
    const { snapshot, cacheStatus } = await getOrLoadPublishedCatalogSnapshot();
    const etag = computeWeakEtag({
      generatedAt: snapshot.generatedAt,
      specs: snapshot.specializations.length,
      subjects: snapshot.subjects.length,
      files: snapshot.lectureFiles.length,
      links: snapshot.lectureFileLinks.length,
      anns: snapshot.announcements.length,
      notifs: snapshot.notifications.length,
    });
    res.setHeader('X-Cache', cacheStatus);
    res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
    res.setHeader('ETag', etag);

    if (isEtagMatch(req.headers['if-none-match'], etag)) {
      return res.status(304).end();
    }
    res.json(snapshot);
  });

  app.post('/api/catalog/revalidate', adminRateLimiter, requireStaff, async (_req: AuthenticatedRequest, res: Response) => {
    await invalidatePublicCatalogCaches();
    res.json({ ok: true, revalidatedAt: new Date().toISOString() });
  });

  app.get('/api/catalog/seed', cachedCatalogRateLimiter, async (_req, res) => {
    const cached = await cacheLayer.get<ReturnType<typeof getInitialCatalog>>('catalog:public');
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      return res.json(cached);
    }
    const fresh = getInitialCatalog();
    await cacheLayer.set('catalog:public', fresh, 120);
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(fresh);
  });

  // Paginated, cached catalog endpoint for large-scale horizontal reads
  app.get('/api/catalog/lectures', publicRateLimiter, async (req: Request, res: Response) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const specializationId = String(req.query.specializationId || '').trim();
    const subjectId = String(req.query.subjectId || '').trim();
    const q = String(req.query.q || '').trim().toLowerCase();

    const cacheKey = `catalog:lectures:${page}:${limit}:${specializationId}:${subjectId}:${q}`;
    const cached = await cacheLayer.get<{
      items: unknown[];
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    }>(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      return res.json(cached);
    }

    const { value: payload } = await catalogSingleFlight.run(cacheKey, async () => {
      const { snapshot } = await getOrLoadPublishedCatalogSnapshot();
      let items = snapshot.lectureFiles.filter(
        (f) => f.status === 'published' && f.lifecycleStatus !== 'trashed'
      );
      if (specializationId) {
        const linkedFileIds = new Set(
          snapshot.lectureFileLinks
            .filter((l) => l.specializationId === specializationId)
            .map((l) => l.lectureFileId)
        );
        items = items.filter(
          (f) => f.specializationId === specializationId || linkedFileIds.has(f.id)
        );
      }
      if (subjectId) {
        const linkedFileIds = new Set(
          snapshot.lectureFileLinks
            .filter((l) => l.subjectId === subjectId)
            .map((l) => l.lectureFileId)
        );
        items = items.filter((f) => f.subjectId === subjectId || linkedFileIds.has(f.id));
      }
      if (q) {
        items = items.filter(
          (f) =>
            f.title.toLowerCase().includes(q) ||
            f.originalName.toLowerCase().includes(q)
        );
      }

      const total = items.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const paged = items.slice((page - 1) * limit, page * limit);
      const built = { items: paged, page, limit, total, totalPages };
      await cacheLayer.set(cacheKey, built, 60);
      return built;
    });

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(payload);
  });

  // --- Authoritative Google Auth Sync + Super Admin Verification + Invitation Claim ---
  app.post('/api/auth/sync', authRateLimiter, requireAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.serverAuth!;
      observability.recordLoginSync();
      const token = req.authToken!;
      const nowIso = new Date().toISOString();

      let currentRole: UserRole = auth.role;
      let currentPermissions: PermissionKey[] = auth.permissions;
      let currentStatus = auth.status;
      let currentAssignedSpecId = auth.assignedSpecializationId;
      let currentAssignmentId = auth.assignmentId;
      let currentScopeVersion = auth.scopeVersion;
      let claimedInviteId: string | null = null;

      // Check Firestore & server index for pending invitation matching verified Google email
      const localInvites = Object.values(loadInvitationsIndex());
      let matchedInvite: AdminInvitation | undefined = localInvites.find(
        (inv) => inv.status === 'pending' && inv.email.trim().toLowerCase() === auth.email
      );

      if (!matchedInvite) {
        const fsInvites = await queryFirestoreCollectionByFieldRest(
          'adminInvitations',
          'email',
          auth.email,
          token,
          10
        );
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
            assignedSpecializationId: fsMatch.assignedSpecializationId
              ? String(fsMatch.assignedSpecializationId)
              : undefined,
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
        currentAssignedSpecId = undefined;
        currentAssignmentId = undefined;
        currentScopeVersion = undefined;

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
        const superOnlySet = new Set<PermissionKey>(SUPER_ADMIN_ONLY_PERMISSIONS);
        const rawInvitePerms = matchedInvite.permissions.filter((p) => !superOnlySet.has(p));
        const invitePerms =
          matchedInvite.role === 'admin'
            ? sanitizeScopedAdminPermissions(
                rawInvitePerms.length > 0 ? rawInvitePerms : DEFAULT_SPECIALIZATION_ADMIN_PERMISSIONS
              )
            : rawInvitePerms;

        const adminPayload: Record<string, unknown> = {
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
        };
        if (matchedInvite.role === 'admin' && matchedInvite.assignedSpecializationId) {
          adminPayload.assignedSpecializationId = matchedInvite.assignedSpecializationId;
          currentAssignedSpecId = matchedInvite.assignedSpecializationId;
        }

        const adminResult = await patchFirestoreDocRest('admins', auth.uid, adminPayload, token);

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
            assignedSpecializationId: currentAssignedSpecId,
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
            specializationId: currentAssignedSpecId,
            result: 'success',
            createdAt: nowIso,
          });
        }
      }

      if (currentRole === 'admin' && currentStatus === 'active') {
        touchAdminLastActivity(auth.uid, currentAssignmentId);
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
        ...(currentAssignedSpecId ? { assignedSpecializationId: currentAssignedSpecId } : {}),
        ...(currentAssignmentId ? { assignmentId: currentAssignmentId } : {}),
        ...(currentScopeVersion ? { scopeVersion: currentScopeVersion } : {}),
        lastActivityAt: nowIso,
        createdAt: createdAtValue,
        lastLoginAt: nowIso,
        updatedAt: nowIso,
      };

      if (existingFsUser) {
        const fieldsToUpdate: Record<string, unknown> = {
          googleSub: auth.googleSub,
          photoURL: userPayload.photoURL || '',
          lastLoginAt: nowIso,
          lastActivityAt: nowIso,
          updatedAt: nowIso,
        };
        const mask = ['googleSub', 'photoURL', 'lastLoginAt', 'lastActivityAt', 'updatedAt'];
        if (
          existingFsUser.role !== currentRole ||
          JSON.stringify(existingFsUser.permissions || []) !== JSON.stringify(currentPermissions) ||
          (currentAssignedSpecId && existingFsUser.assignedSpecializationId !== currentAssignedSpecId)
        ) {
          fieldsToUpdate.role = currentRole;
          fieldsToUpdate.permissions = currentPermissions;
          if (currentAssignedSpecId) {
            fieldsToUpdate.assignedSpecializationId = currentAssignedSpecId;
            mask.push('assignedSpecializationId');
          }
          if (currentAssignmentId) {
            fieldsToUpdate.assignmentId = currentAssignmentId;
            mask.push('assignmentId');
          }
          if (currentScopeVersion) {
            fieldsToUpdate.scopeVersion = currentScopeVersion;
            mask.push('scopeVersion');
          }
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
            ...(currentAssignedSpecId ? { assignedSpecializationId: currentAssignedSpecId } : {}),
            ...(currentAssignmentId ? { assignmentId: currentAssignmentId } : {}),
            ...(currentScopeVersion ? { scopeVersion: currentScopeVersion } : {}),
            lastActivityAt: nowIso,
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
        isStaff:
          currentStatus === 'active' &&
          (currentRole === 'super_admin' ||
            currentRole === 'moderator' ||
            (currentRole === 'admin' && Boolean(currentAssignedSpecId))),
        claimedInviteId,
      });
    } catch (error) {
      console.error('Auth sync failure:', error);
      res.status(500).json({ error: 'تعذر مزامنة بيانات حساب Google.' });
    }
  });

  // --- Session Revocation ("Logout All Devices") & Student Privacy Controls ---
  app.post('/api/auth/logout-all', authRateLimiter, requireAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.serverAuth!;
      const revokedAtMs = revokeUserSessionsTimestamp(auth.uid);
      try {
        await adminAuth.revokeRefreshTokens(auth.uid);
      } catch {
        // Local persistent revocation timestamp still rejects existing ID tokens on UST server
      }
      appendServerAuditLog({
        id: generateSafeId('log'),
        actorUid: auth.uid,
        actorEmail: auth.email,
        actorName: auth.displayName,
        actorRole: auth.role,
        action: 'تسجيل الخروج من جميع الأجهزة وإبطال الجلسات',
        entityType: 'session',
        entityId: auth.uid,
        entityName: auth.email,
        result: 'success',
        createdAt: new Date().toISOString(),
      });
      res.json({ ok: true, revokedAtMs });
    } catch {
      res.status(500).json({ error: 'تعذر إبطال الجلسات النشطة.' });
    }
  });

  app.post('/api/admin/users/:uid/revoke-sessions', adminRateLimiter, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const targetUid = String(req.params.uid || '').trim();
      if (!targetUid) {
        return res.status(400).json({ error: 'معرف المستخدم مطلوب.' });
      }
      const revokedAtMs = revokeUserSessionsTimestamp(targetUid);
      try {
        await adminAuth.revokeRefreshTokens(targetUid);
      } catch {
        // Best-effort Firebase refresh token revocation alongside server revocation store
      }
      appendServerAuditLog({
        id: generateSafeId('log'),
        actorUid: req.serverAuth!.uid,
        actorEmail: req.serverAuth!.email,
        actorName: req.serverAuth!.displayName,
        actorRole: req.serverAuth!.role,
        action: 'إبطال جلسات مستخدم قسرياً عبر مركز الأمان',
        entityType: 'session',
        entityId: targetUid,
        entityName: targetUid,
        targetUid,
        result: 'success',
        createdAt: new Date().toISOString(),
      });
      res.json({ ok: true, targetUid, revokedAtMs });
    } catch {
      res.status(500).json({ error: 'تعذر إبطال جلسات المستخدم.' });
    }
  });

  app.get('/api/auth/me/privacy-summary', authRateLimiter, requireAuthenticated, (req: AuthenticatedRequest, res: Response) => {
    const auth = req.serverAuth!;
    const attemptsCount = listUserAttempts(auth.uid).length;
    res.json({
      uid: auth.uid,
      email: auth.email,
      role: auth.role,
      collectedData: [
        { item: 'بيانات الهوية الأساسية من Google', purpose: 'تسجيل الدخول وتوثيق البريد الجامعي ومنع انتحال الهوية.' },
        { item: 'التفضيلات الأكاديمية (التخصص والسنة)', purpose: 'تسهيل الوصول السريع لموادك الدراسية عند فتح المنصة.' },
        { item: 'المفضلة والإشعارات المقروءة', purpose: 'مزامنة المحاضرات المحفوظة والتنبيهات بين أجهزتك.' },
        { item: 'محاولات الاختبارات التدريبية', purpose: 'حفظ درجاتك وشرح الإجابات لمراجعة تقدمك الدراسي.' },
      ],
      storedExamAttempts: attemptsCount,
      canSelfDelete: !auth.isSuperAdmin,
    });
  });

  app.get('/api/auth/me/export', authRateLimiter, requireAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.serverAuth!;
      const fsUser = await fetchFirestoreDocRest('users', auth.uid, req.authToken).catch(() => null);
      const localUser = loadUsersDirectory()[auth.uid] || null;
      const attempts = listUserAttempts(auth.uid);
      const exportPayload = {
        exportedAt: new Date().toISOString(),
        platform: 'UST Lecture Platform',
        profile: fsUser || localUser || {
          uid: auth.uid,
          email: auth.email,
          displayName: auth.displayName,
          role: auth.role,
        },
        examAttempts: attempts,
      };
      appendServerAuditLog({
        id: generateSafeId('log'),
        actorUid: auth.uid,
        actorEmail: auth.email,
        actorName: auth.displayName,
        actorRole: auth.role,
        action: 'تصدير البيانات الشخصية للمستخدم',
        entityType: 'security',
        entityId: auth.uid,
        entityName: auth.email,
        result: 'success',
        createdAt: new Date().toISOString(),
      });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="ust-my-data-${sanitizePathSegment(auth.uid, 'user')}.json"`);
      res.json(exportPayload);
    } catch {
      res.status(500).json({ error: 'تعذر تصدير البيانات الشخصية.' });
    }
  });

  app.delete('/api/auth/me', authRateLimiter, requireAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.serverAuth!;
      if (auth.isSuperAdmin) {
        return res.status(403).json({ error: 'لا يمكن حذف حساب المالك الرئيسي (Super Admin) عبر الحذف الذاتي لحماية المنصة.' });
      }
      const deletedAttempts = deleteUserExamAttempts(auth.uid);
      removeUserDirectoryEntry(auth.uid);
      revokeUserSessionsTimestamp(auth.uid);
      if (req.authToken) {
        await deleteFirestoreDocRest('users', auth.uid, req.authToken).catch(() => false);
      }
      appendServerAuditLog({
        id: generateSafeId('log'),
        actorUid: auth.uid,
        actorEmail: 'deleted-user@ust.local',
        actorName: 'حساب محذوف بناءً على طلب المستخدم',
        actorRole: auth.role,
        action: 'حذف بيانات حساب الطالب ذاتياً',
        entityType: 'security',
        entityId: auth.uid,
        entityName: `Attempts removed: ${deletedAttempts}`,
        result: 'success',
        createdAt: new Date().toISOString(),
      });
      res.json({ ok: true, deletedAttempts });
    } catch {
      res.status(500).json({ error: 'تعذر حذف بيانات الحساب.' });
    }
  });

  // --- Storage Usage & Stats (Super Admin ONLY) ---
  app.get(
    '/api/storage/stats',
    requireSuperAdmin,
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
          storageMode: process.env.UST_R2_WORKER_URL ? 'cloudflare_r2_worker' : 'central_disk_storage',
          r2Configured: Boolean(process.env.UST_R2_WORKER_URL),
        });
      } catch (error) {
        console.error('Storage stats error:', error);
        res.status(500).json({ error: 'تعذر قراءة إحصائيات مساحة التخزين.' });
      }
    }
  );

  // --- Hierarchical Upload Endpoint (STRICTLY EXCLUSIVE TO SUPER ADMIN) ---
  app.post(
    '/api/files/upload',
    uploadRateLimiter,
    requireSuperAdminUploadGuard,
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
            const safety = validateUploadFilenameSafety(file.originalname);
            if (!safety.valid) {
              return cb(new Error(safety.reason || 'اسم الملف غير صالح أمنياً.'));
            }
            const ext = safety.ext;
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
            incrementRejectedUploadsCount();
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

          // Strict binary Magic-Byte header verification before accepting file
          const ext = path.extname(req.file.originalname).toLowerCase().replace(/^\./, '');
          const headerBuf = Buffer.alloc(512);
          let bytesRead = 0;
          try {
            const fd = fs.openSync(req.file.path, 'r');
            try {
              bytesRead = fs.readSync(fd, headerBuf, 0, 512, 0);
            } finally {
              fs.closeSync(fd);
            }
          } catch {
            bytesRead = 0;
          }
          const magicCheck = validateFileMagicBytes(ext, headerBuf.subarray(0, bytesRead));
          if (!magicCheck.valid) {
            try {
              if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            } catch {
              // ignore cleanup error
            }
            incrementRejectedUploadsCount();
            appendServerAuditLog({
              id: generateSafeId('log'),
              actorUid: req.serverAuth!.uid,
              actorEmail: req.serverAuth!.email,
              actorName: req.serverAuth!.displayName,
              actorRole: req.serverAuth!.role,
              action: 'رفض ملف غير مطابق للبصمة الثنائية (Magic Bytes)',
              entityType: 'security',
              entityId: 'magic_byte_guard',
              entityName: req.file.originalname,
              result: 'denied',
              details: magicCheck.reason,
              createdAt: new Date().toISOString(),
            });
            return res.status(400).json({
              error: magicCheck.reason || 'مرفوض أمنياً: محتوى الملف لا يطابق الصيغة المعلنة.',
            });
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

          const sha256 = computeFileSha256(req.file.path);
          const dest = buildCentralStorageLocation({
            sha256,
            storageName: req.file.filename,
          });

          fs.mkdirSync(dest.dirPath, { recursive: true });
          fs.renameSync(req.file.path, dest.fullPath);

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

  // Pre-Upload Smart Duplicate Check Endpoint (Super Admin ONLY)
  app.post(
    '/api/files/check-duplicate',
    requireSuperAdminUploadGuard,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const sha256 = String(req.body?.sha256 || '').trim().toLowerCase();
        const fileSize = Number(req.body?.fileSize) || 0;
        const originalName = String(req.body?.originalName || '').trim().toLowerCase();

        const fsFiles = await listFirestoreCollectionRest('lectureFiles', req.authToken).catch(() => []);
        const registryEntries = Object.values(loadFileRegistry());
        const combinedMap = new Map<string, Record<string, unknown>>();
        for (const r of registryEntries) {
          combinedMap.set(r.id, r as unknown as Record<string, unknown>);
        }
        for (const doc of fsFiles) {
          if (doc.id) combinedMap.set(String(doc.id), doc);
        }

        const activeCandidates = Array.from(combinedMap.values()).filter(
          (item) => item.lifecycleStatus !== 'trashed' && item.sourceType !== 'google_drive'
        );

        if (sha256) {
          const exactShaMatch = activeCandidates.find(
            (item) => typeof item.sha256 === 'string' && item.sha256.trim().toLowerCase() === sha256
          );
          if (exactShaMatch) {
            return res.json({
              duplicate: true,
              matchType: 'sha256_exact',
              existingFile: exactShaMatch,
            });
          }
        } else if (fileSize > 0 && originalName) {
          const legacyMatch = activeCandidates.find(
            (item) =>
              !item.sha256 &&
              Number(item.fileSize) === fileSize &&
              String(item.originalName || '').trim().toLowerCase() === originalName
          );
          if (legacyMatch) {
            return res.json({
              duplicate: true,
              matchType: 'legacy_name_size',
              existingFile: legacyMatch,
            });
          }
        }

        return res.json({ duplicate: false });
      } catch (error) {
        console.error('Duplicate check error:', error);
        res.status(500).json({ error: 'تعذر التحقق من وجود ملفات مطابقة.' });
      }
    }
  );

  // Register/Sync File Metadata in Server Index (Super Admin ONLY)
  app.post(
    '/api/files/register',
    requireSuperAdminUploadGuard,
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
      void invalidatePublicCatalogCaches(String(body.id));
      res.json({ ok: true });
    }
  );

  // Physical File Cleanup Endpoint (Super Admin ONLY)
  app.delete(
    '/api/files/storage/:storageName',
    requireSuperAdminUploadGuard,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const storageName = path.basename(req.params.storageName || '');
        const fileId = typeof req.query.fileId === 'string' ? req.query.fileId : '';
        const storagePath = typeof req.query.storagePath === 'string' ? req.query.storagePath : undefined;

        if (!storageName || storageName.includes('..')) {
          return res.status(400).json({ error: 'اسم ملف غير صالح.' });
        }

        const registry = loadFileRegistry();
        const fsFiles = await listFirestoreCollectionRest('lectureFiles', req.authToken).catch(() => []);
        const otherRegRef = Object.values(registry).some(
          (r) => r.id !== fileId && r.storageName === storageName
        );
        const otherFsRef = fsFiles.some(
          (doc) => String(doc.id || '') !== fileId && String(doc.storageName || '') === storageName
        );

        if (fileId) {
          removeFileRegistryEntry(fileId);
        }

        if (otherRegRef || otherFsRef) {
          return res.json({ ok: true, physicalFileKept: true });
        }

        const resolved = resolvePhysicalFilePath(storageName, storagePath);
        if (resolved && fs.existsSync(resolved)) {
          fs.unlinkSync(resolved);
        }
        await invalidatePublicCatalogCaches(fileId || undefined);
        res.json({ ok: true, physicalFileKept: false });
      } catch (error) {
        console.error('Delete file error:', error);
        res.status(500).json({ error: 'تعذر حذف الملف من التخزين.' });
      }
    }
  );

  // --- Admin Directory (Users, Staff, Invitations) — Super Admin ONLY ---
  app.get(
    '/api/admin/directory',
    adminRateLimiter,
    requireSuperAdmin,
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

  // --- Role & Granular Permissions Assignment (Super Admin ONLY) ---
  app.post(
    '/api/admin/users/:uid/role',
    adminRateLimiter,
    requireSuperAdmin,
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

  // --- Suspend / Reactivate Account (Super Admin ONLY) ---
  app.post(
    '/api/admin/users/:uid/status',
    adminRateLimiter,
    requireSuperAdmin,
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

  // --- Specialization-Scoped Admin Assignment Lifecycle (Super Admin ONLY) ---
  app.get(
    '/api/admin/assignments',
    adminRateLimiter,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const token = req.authToken!;
        const assignmentsMap = { ...loadAdminAssignmentsIndex() };
        const permsMap = { ...loadAdminPermissionsIndex() };
        const [fsAssignments, fsPerms] = await Promise.all([
          listFirestoreCollectionRest('adminAssignments', token).catch(() => []),
          listFirestoreCollectionRest('adminPermissions', token).catch(() => []),
        ]);
        for (const a of fsAssignments) {
          if (a.id) assignmentsMap[String(a.id)] = a as unknown as AdminAssignment;
        }
        for (const p of fsPerms) {
          if (p.id) permsMap[String(p.id)] = p as unknown as ReturnType<typeof loadAdminPermissionsIndex>[string];
        }
        res.json({
          assignments: Object.values(assignmentsMap).sort((a, b) =>
            String(b.assignedAt || '').localeCompare(String(a.assignedAt || ''))
          ),
          permissionRecords: Object.values(permsMap),
        });
      } catch (error) {
        console.error('List admin assignments error:', error);
        res.status(500).json({ error: 'تعذر تحميل قائمة مشرفي التخصصات.' });
      }
    }
  );

  app.post(
    '/api/admin/assignments',
    adminRateLimiter,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const actor = req.serverAuth!;
        const token = req.authToken!;
        const targetUid = String(req.body?.uid || '').trim();
        const specializationId = String(req.body?.specializationId || '').trim();
        const notes = req.body?.notes ? String(req.body.notes).trim().slice(0, 400) : undefined;
        const requestedRaw = parsePermissionsInput(req.body?.permissions);

        if (!targetUid || !specializationId) {
          return res.status(400).json({ error: 'يجب اختيار مستخدم مسجل وتخصص جامعي صالح.' });
        }

        // Verify Super-Admin-only permissions cannot be requested for Specialization Admin
        const superOnlySet = new Set<PermissionKey>(SUPER_ADMIN_ONLY_PERMISSIONS);
        const forbiddenPerms = requestedRaw.filter((p) => superOnlySet.has(p));
        if (forbiddenPerms.length > 0) {
          appendServerAuditLog({
            id: generateSafeId('log'),
            actorUid: actor.uid,
            actorEmail: actor.email,
            actorName: actor.displayName,
            actorRole: actor.role,
            action: 'محاولة منح صلاحيات رفع أو صلاحيات سيادية لمشرف تخصص',
            entityType: 'admin_assignment',
            entityId: targetUid,
            entityName: specializationId,
            specializationId,
            targetUid,
            result: 'denied',
            details: `Forbidden perms: ${forbiddenPerms.join(', ')}`,
            createdAt: new Date().toISOString(),
          });
          return res.status(403).json({
            error: 'لا يمكن منح صلاحية رفع الملفات أو الصلاحيات السيادية لمشرف التخصص.',
          });
        }

        // Verify target user exists in registered directory or Firestore
        const fsUserDoc = await fetchFirestoreDocRest('users', targetUid, token);
        const dirUserDoc = loadUsersDirectory()[targetUid];
        const targetUser: UserProfile | null = fsUserDoc
          ? (fsUserDoc as unknown as UserProfile)
          : dirUserDoc || null;

        if (!targetUser || !targetUser.uid || !targetUser.email) {
          return res.status(404).json({ error: 'المستخدم المحدد غير مسجل في المنصة.' });
        }
        if (targetUser.role === 'super_admin' || targetUser.email.toLowerCase() === SUPER_ADMIN_EMAIL) {
          return res.status(400).json({ error: 'لا يمكن تعيين المدير الرئيسي كمشرف تخصص مقيد.' });
        }

        // Verify specialization exists
        const fsSpec = await fetchFirestoreDocRest('specializations', specializationId, token);
        const seedSpec = getInitialCatalog().specializations.find((s) => s.id === specializationId);
        const specName = String(fsSpec?.name || seedSpec?.name || '');
        if (!fsSpec && !seedSpec) {
          return res.status(404).json({ error: 'التخصص المحدد غير موجود.' });
        }

        const sanitizedPerms = sanitizeScopedAdminPermissions(
          requestedRaw.length > 0 ? requestedRaw : DEFAULT_SPECIALIZATION_ADMIN_PERMISSIONS
        );
        const finalPerms =
          sanitizedPerms.length > 0 ? sanitizedPerms : [...DEFAULT_SPECIALIZATION_ADMIN_PERMISSIONS];

        const existingAssignments = Object.values(loadAdminAssignmentsIndex());
        const priorAssignment = existingAssignments.find((a) => a.uid === targetUid);
        const assignmentId = priorAssignment?.id || generateSafeId('asg');
        const nextScopeVersion = (priorAssignment?.scopeVersion || 0) + 1;
        const nowIso = new Date().toISOString();

        const assignment: AdminAssignment = {
          id: assignmentId,
          uid: targetUid,
          email: targetUser.email,
          displayName: targetUser.displayName,
          photoURL: targetUser.photoURL || '',
          role: 'admin',
          specializationId,
          specializationName: specName,
          status: 'active',
          permissions: finalPerms,
          scopeVersion: nextScopeVersion,
          assignedBy: actor.uid,
          assignedByEmail: actor.email,
          assignedAt: priorAssignment?.assignedAt || nowIso,
          lastActivityAt: priorAssignment?.lastActivityAt || nowIso,
          updatedAt: nowIso,
          updatedBy: actor.uid,
          ...(notes ? { notes } : {}),
        };

        const adminEntry: AdminEntry = {
          uid: targetUid,
          email: targetUser.email,
          displayName: targetUser.displayName,
          role: 'admin',
          permissions: finalPerms,
          status: 'active',
          assignedSpecializationId: specializationId,
          assignmentId,
          scopeVersion: nextScopeVersion,
          lastActivityAt: nowIso,
          addedAt: priorAssignment?.assignedAt || nowIso,
          addedBy: actor.uid,
          updatedAt: nowIso,
          updatedBy: actor.uid,
        };

        await patchFirestoreDocRest(
          'adminAssignments',
          assignmentId,
          assignment as unknown as Record<string, unknown>,
          token
        );
        await patchFirestoreDocRest(
          'admins',
          targetUid,
          adminEntry as unknown as Record<string, unknown>,
          token
        );
        await patchFirestoreDocRest(
          'users',
          targetUid,
          {
            role: 'admin',
            permissions: finalPerms,
            assignedSpecializationId: specializationId,
            assignmentId,
            scopeVersion: nextScopeVersion,
            status: 'active',
            updatedAt: nowIso,
          },
          token,
          ['role', 'permissions', 'assignedSpecializationId', 'assignmentId', 'scopeVersion', 'status', 'updatedAt']
        );

        const permRecords = replaceAssignmentPermissionsIndex({
          assignmentId,
          uid: targetUid,
          specializationId,
          permissions: finalPerms,
          grantedBy: actor.uid,
        });
        for (const rec of permRecords) {
          void patchFirestoreDocRest('adminPermissions', rec.id, rec as unknown as Record<string, unknown>, token);
        }

        upsertAdminAssignmentIndex(assignment);
        upsertAdminDirectoryEntry(adminEntry);
        upsertUserDirectoryEntry({
          ...targetUser,
          role: 'admin',
          permissions: finalPerms,
          assignedSpecializationId: specializationId,
          assignmentId,
          scopeVersion: nextScopeVersion,
          status: 'active',
          updatedAt: nowIso,
        });

        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: actor.uid,
          actorEmail: actor.email,
          actorName: actor.displayName,
          actorRole: actor.role,
          action: priorAssignment ? 'تحديث إسناد مشرف تخصص' : 'تعيين مشرف تخصص جديد',
          entityType: 'admin_assignment',
          entityId: assignmentId,
          entityName: `${targetUser.displayName} — ${specName}`,
          specializationId,
          targetUid,
          targetEmail: targetUser.email,
          oldValue: priorAssignment ? priorAssignment.specializationName || priorAssignment.specializationId : targetUser.role,
          newValue: `${specName} (${finalPerms.length} صلاحيات)`,
          result: 'success',
          details: `Permissions: ${finalPerms.join(', ')}`,
          createdAt: nowIso,
        });

        res.json({ assignment });
      } catch (error) {
        console.error('Create admin assignment error:', error);
        res.status(500).json({ error: 'تعذر حفظ تعيين مشرف التخصص.' });
      }
    }
  );

  app.patch(
    '/api/admin/assignments/:id/permissions',
    adminRateLimiter,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const actor = req.serverAuth!;
        const token = req.authToken!;
        const assignmentId = String(req.params.id || '').trim();
        const existing =
          loadAdminAssignmentsIndex()[assignmentId] ||
          ((await fetchFirestoreDocRest('adminAssignments', assignmentId, token)) as AdminAssignment | null);

        if (!existing) {
          return res.status(404).json({ error: 'سجل تعيين المشرف غير موجود.' });
        }

        const requestedRaw = parsePermissionsInput(req.body?.permissions);
        const superOnlySet = new Set<PermissionKey>(SUPER_ADMIN_ONLY_PERMISSIONS);
        const forbiddenPerms = requestedRaw.filter((p) => superOnlySet.has(p));
        if (forbiddenPerms.length > 0) {
          appendServerAuditLog({
            id: generateSafeId('log'),
            actorUid: actor.uid,
            actorEmail: actor.email,
            actorName: actor.displayName,
            actorRole: actor.role,
            action: 'محاولة منح صلاحيات رفع محظورة لمشرف تخصص',
            entityType: 'admin_assignment',
            entityId: assignmentId,
            entityName: existing.email,
            specializationId: existing.specializationId,
            targetUid: existing.uid,
            targetEmail: existing.email,
            result: 'denied',
            details: `Blocked: ${forbiddenPerms.join(', ')}`,
            createdAt: new Date().toISOString(),
          });
          return res.status(403).json({
            error: 'ممنوع: صلاحيات رفع الملفات والإدارة العامة حصرية للـ Super Admin فقط.',
          });
        }

        const sanitized = sanitizeScopedAdminPermissions(requestedRaw);
        const finalPerms = sanitized.length > 0 ? sanitized : [...DEFAULT_SPECIALIZATION_ADMIN_PERMISSIONS];
        const nextScopeVersion = (existing.scopeVersion || 1) + 1;
        const nowIso = new Date().toISOString();
        const diff = buildAssignmentChangeDiffLabel(existing.permissions || [], finalPerms);

        const updated: AdminAssignment = {
          ...existing,
          permissions: finalPerms,
          scopeVersion: nextScopeVersion,
          updatedAt: nowIso,
          updatedBy: actor.uid,
        };

        await patchFirestoreDocRest(
          'adminAssignments',
          assignmentId,
          {
            permissions: finalPerms,
            scopeVersion: nextScopeVersion,
            updatedAt: nowIso,
            updatedBy: actor.uid,
          },
          token,
          ['permissions', 'scopeVersion', 'updatedAt', 'updatedBy']
        );
        await patchFirestoreDocRest(
          'admins',
          existing.uid,
          {
            permissions: finalPerms,
            scopeVersion: nextScopeVersion,
            updatedAt: nowIso,
            updatedBy: actor.uid,
          },
          token,
          ['permissions', 'scopeVersion', 'updatedAt', 'updatedBy']
        );
        await patchFirestoreDocRest(
          'users',
          existing.uid,
          { permissions: finalPerms, scopeVersion: nextScopeVersion, updatedAt: nowIso },
          token,
          ['permissions', 'scopeVersion', 'updatedAt']
        );

        const priorRecords = Object.values(loadAdminPermissionsIndex()).filter(
          (r) => r.assignmentId === assignmentId
        );
        for (const r of priorRecords) {
          void deleteFirestoreDocRest('adminPermissions', r.id, token);
        }
        const nextRecords = replaceAssignmentPermissionsIndex({
          assignmentId,
          uid: existing.uid,
          specializationId: existing.specializationId,
          permissions: finalPerms,
          grantedBy: actor.uid,
        });
        for (const rec of nextRecords) {
          void patchFirestoreDocRest('adminPermissions', rec.id, rec as unknown as Record<string, unknown>, token);
        }

        upsertAdminAssignmentIndex(updated);
        const dirAdm = loadAdminsDirectory()[existing.uid];
        if (dirAdm) {
          upsertAdminDirectoryEntry({
            ...dirAdm,
            permissions: finalPerms,
            scopeVersion: nextScopeVersion,
            updatedAt: nowIso,
            updatedBy: actor.uid,
          });
        }
        const dirUser = loadUsersDirectory()[existing.uid];
        if (dirUser) {
          upsertUserDirectoryEntry({
            ...dirUser,
            permissions: finalPerms,
            scopeVersion: nextScopeVersion,
            updatedAt: nowIso,
          });
        }

        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: actor.uid,
          actorEmail: actor.email,
          actorName: actor.displayName,
          actorRole: actor.role,
          action: 'تعديل صلاحيات مشرف تخصص',
          entityType: 'admin_assignment',
          entityId: assignmentId,
          entityName: `${existing.displayName} (${existing.email})`,
          specializationId: existing.specializationId,
          targetUid: existing.uid,
          targetEmail: existing.email,
          oldValue: (existing.permissions || []).join(', '),
          newValue: finalPerms.join(', '),
          result: 'success',
          details: `+${diff.added.length} / -${diff.removed.length}`,
          createdAt: nowIso,
        });

        res.json({ assignment: updated });
      } catch (error) {
        console.error('Update assignment permissions error:', error);
        res.status(500).json({ error: 'تعذر تحديث صلاحيات مشرف التخصص.' });
      }
    }
  );

  app.post(
    '/api/admin/assignments/:id/transfer',
    adminRateLimiter,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const actor = req.serverAuth!;
        const token = req.authToken!;
        const assignmentId = String(req.params.id || '').trim();
        const newSpecializationId = String(req.body?.specializationId || '').trim();
        const existing =
          loadAdminAssignmentsIndex()[assignmentId] ||
          ((await fetchFirestoreDocRest('adminAssignments', assignmentId, token)) as AdminAssignment | null);

        if (!existing) {
          return res.status(404).json({ error: 'سجل تعيين المشرف غير موجود.' });
        }
        if (!newSpecializationId || newSpecializationId === existing.specializationId) {
          return res.status(400).json({ error: 'يرجى اختيار تخصص جديد مختلف للنقل إليه.' });
        }

        const fsSpec = await fetchFirestoreDocRest('specializations', newSpecializationId, token);
        const seedSpec = getInitialCatalog().specializations.find((s) => s.id === newSpecializationId);
        const newSpecName = String(fsSpec?.name || seedSpec?.name || '');
        if (!fsSpec && !seedSpec) {
          return res.status(404).json({ error: 'التخصص الجديد غير موجود.' });
        }

        const nextScopeVersion = (existing.scopeVersion || 1) + 1;
        const nowIso = new Date().toISOString();
        const oldSpecLabel = existing.specializationName || existing.specializationId;

        const updated: AdminAssignment = {
          ...existing,
          specializationId: newSpecializationId,
          specializationName: newSpecName,
          scopeVersion: nextScopeVersion,
          updatedAt: nowIso,
          updatedBy: actor.uid,
        };

        await patchFirestoreDocRest(
          'adminAssignments',
          assignmentId,
          {
            specializationId: newSpecializationId,
            specializationName: newSpecName,
            scopeVersion: nextScopeVersion,
            updatedAt: nowIso,
            updatedBy: actor.uid,
          },
          token,
          ['specializationId', 'specializationName', 'scopeVersion', 'updatedAt', 'updatedBy']
        );
        await patchFirestoreDocRest(
          'admins',
          existing.uid,
          {
            assignedSpecializationId: newSpecializationId,
            scopeVersion: nextScopeVersion,
            updatedAt: nowIso,
            updatedBy: actor.uid,
          },
          token,
          ['assignedSpecializationId', 'scopeVersion', 'updatedAt', 'updatedBy']
        );
        await patchFirestoreDocRest(
          'users',
          existing.uid,
          {
            assignedSpecializationId: newSpecializationId,
            scopeVersion: nextScopeVersion,
            updatedAt: nowIso,
          },
          token,
          ['assignedSpecializationId', 'scopeVersion', 'updatedAt']
        );

        const nextRecords = replaceAssignmentPermissionsIndex({
          assignmentId,
          uid: existing.uid,
          specializationId: newSpecializationId,
          permissions: existing.permissions,
          grantedBy: actor.uid,
        });
        for (const rec of nextRecords) {
          void patchFirestoreDocRest('adminPermissions', rec.id, rec as unknown as Record<string, unknown>, token);
        }

        upsertAdminAssignmentIndex(updated);
        const dirAdm = loadAdminsDirectory()[existing.uid];
        if (dirAdm) {
          upsertAdminDirectoryEntry({
            ...dirAdm,
            assignedSpecializationId: newSpecializationId,
            scopeVersion: nextScopeVersion,
            updatedAt: nowIso,
            updatedBy: actor.uid,
          });
        }
        const dirUser = loadUsersDirectory()[existing.uid];
        if (dirUser) {
          upsertUserDirectoryEntry({
            ...dirUser,
            assignedSpecializationId: newSpecializationId,
            scopeVersion: nextScopeVersion,
            updatedAt: nowIso,
          });
        }

        // Best-effort token revocation so stale scope tokens refresh on next call
        try {
          await adminAuth.revokeRefreshTokens(existing.uid);
        } catch {
          // Starter-tier IAM may skip server revocation; scopeVersion + live DB lookup still blocks old scope immediately
        }

        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: actor.uid,
          actorEmail: actor.email,
          actorName: actor.displayName,
          actorRole: actor.role,
          action: 'نقل مشرف تخصص إلى تخصص آخر',
          entityType: 'admin_assignment',
          entityId: assignmentId,
          entityName: `${existing.displayName} (${existing.email})`,
          specializationId: newSpecializationId,
          targetUid: existing.uid,
          targetEmail: existing.email,
          oldValue: oldSpecLabel,
          newValue: newSpecName,
          result: 'success',
          createdAt: nowIso,
        });

        res.json({ assignment: updated });
      } catch (error) {
        console.error('Transfer admin assignment error:', error);
        res.status(500).json({ error: 'تعذر نقل المشرف إلى التخصص الجديد.' });
      }
    }
  );

  app.post(
    '/api/admin/assignments/:id/status',
    adminRateLimiter,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const actor = req.serverAuth!;
        const token = req.authToken!;
        const assignmentId = String(req.params.id || '').trim();
        const nextStatus = req.body?.status === 'suspended' ? 'suspended' : 'active';
        const existing =
          loadAdminAssignmentsIndex()[assignmentId] ||
          ((await fetchFirestoreDocRest('adminAssignments', assignmentId, token)) as AdminAssignment | null);

        if (!existing) {
          return res.status(404).json({ error: 'سجل تعيين المشرف غير موجود.' });
        }

        const nextScopeVersion = (existing.scopeVersion || 1) + 1;
        const nowIso = new Date().toISOString();
        const updated: AdminAssignment = {
          ...existing,
          status: nextStatus,
          scopeVersion: nextScopeVersion,
          updatedAt: nowIso,
          updatedBy: actor.uid,
        };

        await patchFirestoreDocRest(
          'adminAssignments',
          assignmentId,
          { status: nextStatus, scopeVersion: nextScopeVersion, updatedAt: nowIso, updatedBy: actor.uid },
          token,
          ['status', 'scopeVersion', 'updatedAt', 'updatedBy']
        );
        await patchFirestoreDocRest(
          'admins',
          existing.uid,
          { status: nextStatus, scopeVersion: nextScopeVersion, updatedAt: nowIso, updatedBy: actor.uid },
          token,
          ['status', 'scopeVersion', 'updatedAt', 'updatedBy']
        );
        await patchFirestoreDocRest(
          'users',
          existing.uid,
          { status: nextStatus, scopeVersion: nextScopeVersion, updatedAt: nowIso },
          token,
          ['status', 'scopeVersion', 'updatedAt']
        );

        upsertAdminAssignmentIndex(updated);
        const dirAdm = loadAdminsDirectory()[existing.uid];
        if (dirAdm) {
          upsertAdminDirectoryEntry({ ...dirAdm, status: nextStatus, scopeVersion: nextScopeVersion });
        }
        const dirUser = loadUsersDirectory()[existing.uid];
        if (dirUser) {
          upsertUserDirectoryEntry({ ...dirUser, status: nextStatus, scopeVersion: nextScopeVersion, updatedAt: nowIso });
        }

        if (nextStatus === 'suspended') {
          try {
            await adminAuth.revokeRefreshTokens(existing.uid);
          } catch {
            // ignore on starter tier
          }
        }

        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: actor.uid,
          actorEmail: actor.email,
          actorName: actor.displayName,
          actorRole: actor.role,
          action: nextStatus === 'suspended' ? 'تعليق صلاحيات مشرف تخصص' : 'إعادة تفعيل مشرف تخصص',
          entityType: 'admin_assignment',
          entityId: assignmentId,
          entityName: `${existing.displayName} — ${existing.specializationName || existing.specializationId}`,
          specializationId: existing.specializationId,
          targetUid: existing.uid,
          targetEmail: existing.email,
          oldValue: existing.status,
          newValue: nextStatus,
          result: 'success',
          createdAt: nowIso,
        });

        res.json({ assignment: updated });
      } catch (error) {
        console.error('Update assignment status error:', error);
        res.status(500).json({ error: 'تعذر تحديث حالة مشرف التخصص.' });
      }
    }
  );

  app.delete(
    '/api/admin/assignments/:id',
    adminRateLimiter,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const actor = req.serverAuth!;
        const token = req.authToken!;
        const assignmentId = String(req.params.id || '').trim();
        const existing =
          loadAdminAssignmentsIndex()[assignmentId] ||
          ((await fetchFirestoreDocRest('adminAssignments', assignmentId, token)) as AdminAssignment | null);

        if (!existing) {
          return res.status(404).json({ error: 'سجل تعيين المشرف غير موجود.' });
        }

        const nowIso = new Date().toISOString();
        await deleteFirestoreDocRest('adminAssignments', assignmentId, token);
        await deleteFirestoreDocRest('admins', existing.uid, token);
        await patchFirestoreDocRest(
          'users',
          existing.uid,
          {
            role: 'student',
            permissions: [],
            assignedSpecializationId: '',
            assignmentId: '',
            scopeVersion: (existing.scopeVersion || 1) + 1,
            updatedAt: nowIso,
          },
          token,
          ['role', 'permissions', 'assignedSpecializationId', 'assignmentId', 'scopeVersion', 'updatedAt']
        );

        const removedPerms = removeAssignmentPermissionsForUid(existing.uid);
        for (const rec of removedPerms) {
          void deleteFirestoreDocRest('adminPermissions', rec.id, token);
        }

        removeAdminAssignmentIndex(assignmentId);
        removeAdminDirectoryEntry(existing.uid);
        const dirUser = loadUsersDirectory()[existing.uid];
        if (dirUser) {
          upsertUserDirectoryEntry({
            ...dirUser,
            role: 'student',
            permissions: [],
            assignedSpecializationId: undefined,
            assignmentId: undefined,
            updatedAt: nowIso,
          });
        }

        try {
          await adminAuth.revokeRefreshTokens(existing.uid);
        } catch {
          // ignore on starter tier
        }

        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: actor.uid,
          actorEmail: actor.email,
          actorName: actor.displayName,
          actorRole: actor.role,
          action: 'سحب صلاحيات مشرف التخصص وإعادته لحساب طالب',
          entityType: 'admin_assignment',
          entityId: assignmentId,
          entityName: `${existing.displayName} (${existing.email})`,
          specializationId: existing.specializationId,
          targetUid: existing.uid,
          targetEmail: existing.email,
          oldValue: `admin (${existing.specializationName || existing.specializationId})`,
          newValue: 'student',
          result: 'success',
          details: 'User account and academic records preserved',
          createdAt: nowIso,
        });

        res.json({ ok: true, uid: existing.uid });
      } catch (error) {
        console.error('Remove admin assignment error:', error);
        res.status(500).json({ error: 'تعذر إزالة التعيين الإداري.' });
      }
    }
  );

  // --- Specialization-Scoped Admin Operational APIs (/api/admin/scoped/*) ---
  app.get(
    '/api/admin/scoped/overview',
    adminRateLimiter,
    requireScopedAdminAccess('spec.dashboard.view'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const auth = req.serverAuth!;
        const token = req.authToken!;
        const specId = auth.isSuperAdmin
          ? String(req.query.specializationId || req.query.specId || '').trim()
          : auth.assignedSpecializationId!;

        if (!specId) {
          return res.status(400).json({ error: 'يرجى تحديد التخصص المطلوب.' });
        }

        const [
          fsSpecs,
          fsYears,
          fsSemesters,
          fsSubjects,
          fsProgramCourses,
          fsFiles,
          fsFileLinks,
          fsAnnouncements,
        ] = await Promise.all([
          listFirestoreCollectionRest('specializations', token).catch(() => []),
          listFirestoreCollectionRest('academicYears', token).catch(() => []),
          listFirestoreCollectionRest('semesters', token).catch(() => []),
          listFirestoreCollectionRest('subjects', token).catch(() => []),
          listFirestoreCollectionRest('programCourses', token).catch(() => []),
          listFirestoreCollectionRest('lectureFiles', token).catch(() => []),
          listFirestoreCollectionRest('lectureFileLinks', token).catch(() => []),
          listFirestoreCollectionRest('announcements', token).catch(() => []),
        ]);

        const seed = getInitialCatalog();
        const canViewStats = auth.isSuperAdmin || auth.permissions.includes('spec.stats.view');
        const canViewAudit = auth.isSuperAdmin || auth.permissions.includes('spec.audit.view');
        const usersDirectory = canViewStats ? Object.values(loadUsersDirectory()) : [];

        const summary = computeSpecializationDashboardSummary({
          assignedSpecializationId: specId,
          actorUid: auth.uid,
          canViewStats,
          canViewAudit,
          specializations: (fsSpecs.length ? fsSpecs : seed.specializations) as unknown as Specialization[],
          academicYears: (fsYears.length ? fsYears : seed.academicYears) as unknown as AcademicYear[],
          semesters: (fsSemesters.length ? fsSemesters : seed.semesters) as unknown as Semester[],
          subjects: (fsSubjects.length ? fsSubjects : seed.subjects) as unknown as Subject[],
          programCourses: fsProgramCourses as unknown as ProgramCourseLink[],
          lectureFiles: (fsFiles.length ? fsFiles : seed.lectureFiles) as unknown as LectureFile[],
          lectureFileLinks: fsFileLinks as unknown as LectureFileLink[],
          announcements: (fsAnnouncements.length ? fsAnnouncements : seed.announcements) as unknown as Announcement[],
          activityLogs: canViewAudit ? loadServerAuditLogs() : [],
          usersDirectory,
        });

        res.json({
          specializationId: specId,
          summary,
        });
      } catch (error) {
        console.error('Scoped overview error:', error);
        res.status(500).json({ error: 'تعذر تحميل بيانات لوحة التخصص.' });
      }
    }
  );

  app.post(
    '/api/admin/scoped/years',
    adminRateLimiter,
    requireScopedAdminAccess('academic_years.manage'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const auth = req.serverAuth!;
        const token = req.authToken!;
        const targetSpecId = auth.isSuperAdmin
          ? String(req.body?.specializationId || '').trim()
          : auth.assignedSpecializationId!;
        const name = String(req.body?.name || '').trim();
        if (!targetSpecId || name.length < 2) {
          return res.status(400).json({ error: 'اسم السنة الدراسية غير صالح.' });
        }

        const yearId = generateSafeId('yr');
        const nowIso = new Date().toISOString();
        const payload = {
          id: yearId,
          specializationId: targetSpecId,
          name: name.slice(0, 120),
          status: req.body?.status === 'draft' ? 'draft' : 'published',
          sortOrder: Number(req.body?.sortOrder) || 1,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        const restRes = await patchFirestoreDocRest(
          'academicYears',
          yearId,
          { ...payload, createdAt: '__SERVER_TIME__', updatedAt: '__SERVER_TIME__' },
          token
        );
        if (!restRes.ok) {
          return res.status(403).json({ error: 'تعذر حفظ السنة الدراسية.' });
        }
        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: auth.uid,
          actorEmail: auth.email,
          actorName: auth.displayName,
          actorRole: auth.role,
          action: 'إضافة سنة دراسية داخل التخصص',
          entityType: 'academic_year',
          entityId: yearId,
          entityName: payload.name,
          specializationId: targetSpecId,
          result: 'success',
          createdAt: nowIso,
        });
        await invalidatePublicCatalogCaches();
        res.json({ year: payload });
      } catch (error) {
        console.error('Scoped create year error:', error);
        res.status(500).json({ error: 'تعذر إضافة السنة الدراسية.' });
      }
    }
  );

  app.post(
    '/api/admin/scoped/semesters',
    adminRateLimiter,
    requireScopedAdminAccess('semesters.manage'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const auth = req.serverAuth!;
        const token = req.authToken!;
        const targetSpecId = auth.isSuperAdmin
          ? String(req.body?.specializationId || '').trim()
          : auth.assignedSpecializationId!;
        const academicYearId = String(req.body?.academicYearId || '').trim();
        const name = String(req.body?.name || '').trim();
        if (!targetSpecId || !academicYearId || name.length < 2) {
          return res.status(400).json({ error: 'بيانات الفصل الدراسي غير مكتملة.' });
        }

        const yearDoc = await fetchFirestoreDocRest('academicYears', academicYearId, token);
        if (!yearDoc || (!auth.isSuperAdmin && String(yearDoc.specializationId || '') !== targetSpecId)) {
          return res.status(403).json({ error: SCOPED_ADMIN_ACCESS_DENIED_AR });
        }

        const semesterId = generateSafeId('sem');
        const nowIso = new Date().toISOString();
        const payload = {
          id: semesterId,
          specializationId: targetSpecId,
          academicYearId,
          name: name.slice(0, 120),
          status: req.body?.status === 'draft' ? 'draft' : 'published',
          sortOrder: Number(req.body?.sortOrder) || 1,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        const restRes = await patchFirestoreDocRest(
          'semesters',
          semesterId,
          { ...payload, createdAt: '__SERVER_TIME__', updatedAt: '__SERVER_TIME__' },
          token
        );
        if (!restRes.ok) {
          return res.status(403).json({ error: 'تعذر حفظ الفصل الدراسي.' });
        }
        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: auth.uid,
          actorEmail: auth.email,
          actorName: auth.displayName,
          actorRole: auth.role,
          action: 'إضافة فصل دراسي داخل التخصص',
          entityType: 'semester',
          entityId: semesterId,
          entityName: payload.name,
          specializationId: targetSpecId,
          result: 'success',
          createdAt: nowIso,
        });
        await invalidatePublicCatalogCaches();
        res.json({ semester: payload });
      } catch (error) {
        console.error('Scoped create semester error:', error);
        res.status(500).json({ error: 'تعذر إضافة الفصل الدراسي.' });
      }
    }
  );

  app.post(
    '/api/admin/scoped/subjects',
    adminRateLimiter,
    requireScopedAdminAccess('subjects.create'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const auth = req.serverAuth!;
        const token = req.authToken!;
        const targetSpecId = auth.isSuperAdmin
          ? String(req.body?.specializationId || '').trim()
          : auth.assignedSpecializationId!;
        const academicYearId = String(req.body?.academicYearId || '').trim();
        const semesterId = String(req.body?.semesterId || '').trim();
        const name = String(req.body?.name || '').trim();
        if (!targetSpecId || !academicYearId || !semesterId || name.length < 2) {
          return res.status(400).json({ error: 'بيانات المادة الدراسية غير مكتملة.' });
        }

        const semDoc = await fetchFirestoreDocRest('semesters', semesterId, token);
        if (!semDoc || (!auth.isSuperAdmin && String(semDoc.specializationId || '') !== targetSpecId)) {
          return res.status(403).json({ error: SCOPED_ADMIN_ACCESS_DENIED_AR });
        }

        const subjectId = generateSafeId('sub');
        const nowIso = new Date().toISOString();
        const payload = {
          id: subjectId,
          specializationId: targetSpecId,
          academicYearId,
          semesterId,
          name: name.slice(0, 140),
          ...(req.body?.code ? { code: String(req.body.code).slice(0, 40) } : {}),
          ...(req.body?.description ? { description: String(req.body.description).slice(0, 500) } : {}),
          iconKey: String(req.body?.iconKey || 'book').slice(0, 60),
          status: req.body?.status === 'draft' ? 'draft' : 'published',
          sortOrder: Number(req.body?.sortOrder) || 1,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        const restRes = await patchFirestoreDocRest(
          'subjects',
          subjectId,
          { ...payload, createdAt: '__SERVER_TIME__', updatedAt: '__SERVER_TIME__' },
          token
        );
        if (!restRes.ok) {
          return res.status(403).json({ error: 'تعذر حفظ المادة الدراسية.' });
        }
        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: auth.uid,
          actorEmail: auth.email,
          actorName: auth.displayName,
          actorRole: auth.role,
          action: 'إضافة مادة دراسية داخل التخصص',
          entityType: 'subject',
          entityId: subjectId,
          entityName: payload.name,
          specializationId: targetSpecId,
          result: 'success',
          createdAt: nowIso,
        });
        await invalidatePublicCatalogCaches();
        res.json({ subject: payload });
      } catch (error) {
        console.error('Scoped create subject error:', error);
        res.status(500).json({ error: 'تعذر إضافة المادة الدراسية.' });
      }
    }
  );

  app.patch(
    '/api/admin/scoped/subjects/:subjectId',
    adminRateLimiter,
    requireScopedAdminAccess('subjects.edit'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const auth = req.serverAuth!;
        const token = req.authToken!;
        const subjectId = String(req.params.subjectId || '').trim();
        const existingSubject = (await fetchFirestoreDocRest('subjects', subjectId, token)) as Subject | null;
        if (!existingSubject) {
          return res.status(404).json({ error: 'المادة الدراسية غير موجودة.' });
        }
        const fsLinks = (await listFirestoreCollectionRest('programCourses', token).catch(() => [])) as unknown as ProgramCourseLink[];
        const check = canScopedAdminPerformAction({
          actor: {
            role: auth.role,
            status: auth.status,
            permissions: auth.permissions,
            assignedSpecializationId: auth.assignedSpecializationId,
          },
          action: 'subjects.edit',
          targetSpecializationId: existingSubject.specializationId,
          subject: existingSubject,
          programCourses: fsLinks,
          subjectId,
        });
        if (!check.allowed) {
          appendServerAuditLog({
            id: generateSafeId('log'),
            actorUid: auth.uid,
            actorEmail: auth.email,
            actorName: auth.displayName,
            actorRole: auth.role,
            action: 'محاولة مرفوضة لتعديل مادة خارج النطاق أو مادة مشتركة',
            entityType: 'subject',
            entityId: subjectId,
            entityName: existingSubject.name,
            specializationId: auth.assignedSpecializationId,
            result: 'denied',
            details: check.reason,
            createdAt: new Date().toISOString(),
          });
          return res.status(403).json({ error: check.reason || SCOPED_ADMIN_ACCESS_DENIED_AR });
        }

        const nowIso = new Date().toISOString();
        const updates: Record<string, unknown> = { updatedAt: nowIso };
        const mask = ['updatedAt'];
        if (typeof req.body?.name === 'string' && req.body.name.trim().length >= 2) {
          updates.name = req.body.name.trim().slice(0, 140);
          mask.push('name');
        }
        if (typeof req.body?.description === 'string') {
          updates.description = req.body.description.trim().slice(0, 500);
          mask.push('description');
        }
        if (typeof req.body?.code === 'string') {
          updates.code = req.body.code.trim().slice(0, 40);
          mask.push('code');
        }

        const restRes = await patchFirestoreDocRest(
          'subjects',
          subjectId,
          { ...updates, updatedAt: '__SERVER_TIME__' },
          token,
          mask
        );
        if (!restRes.ok) {
          return res.status(403).json({ error: 'تعذر تحديث بيانات المادة.' });
        }

        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: auth.uid,
          actorEmail: auth.email,
          actorName: auth.displayName,
          actorRole: auth.role,
          action: 'تعديل بيانات مادة داخل التخصص',
          entityType: 'subject',
          entityId: subjectId,
          entityName: String(updates.name || existingSubject.name),
          specializationId: existingSubject.specializationId,
          oldValue: existingSubject.name,
          newValue: String(updates.name || existingSubject.name),
          result: 'success',
          createdAt: nowIso,
        });
        await invalidatePublicCatalogCaches();
        res.json({ ok: true, updates });
      } catch (error) {
        console.error('Scoped update subject error:', error);
        res.status(500).json({ error: 'تعذر تحديث المادة الدراسية.' });
      }
    }
  );

  app.patch(
    '/api/admin/scoped/specialization',
    adminRateLimiter,
    requireScopedAdminAccess('spec.info.manage'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const auth = req.serverAuth!;
        const token = req.authToken!;
        const targetSpecId = auth.isSuperAdmin
          ? String(req.body?.specializationId || '').trim()
          : auth.assignedSpecializationId!;

        if (!targetSpecId) {
          return res.status(400).json({ error: 'معرف التخصص مطلوب.' });
        }
        const nowIso = new Date().toISOString();
        const updates: Record<string, unknown> = { updatedAt: nowIso };
        const mask = ['updatedAt'];
        if (typeof req.body?.name === 'string' && req.body.name.trim().length >= 2) {
          updates.name = req.body.name.trim().slice(0, 140);
          mask.push('name');
        }
        if (typeof req.body?.description === 'string') {
          updates.description = req.body.description.trim().slice(0, 600);
          mask.push('description');
        }
        const restRes = await patchFirestoreDocRest(
          'specializations',
          targetSpecId,
          { ...updates, updatedAt: '__SERVER_TIME__' },
          token,
          mask
        );
        if (!restRes.ok) {
          return res.status(403).json({ error: 'تعذر تحديث بيانات التخصص.' });
        }
        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: auth.uid,
          actorEmail: auth.email,
          actorName: auth.displayName,
          actorRole: auth.role,
          action: 'تحديث معلومات التخصص المسند',
          entityType: 'specialization',
          entityId: targetSpecId,
          entityName: String(updates.name || targetSpecId),
          specializationId: targetSpecId,
          result: 'success',
          createdAt: nowIso,
        });
        await invalidatePublicCatalogCaches();
        res.json({ ok: true, updates });
      } catch (error) {
        console.error('Scoped update specialization error:', error);
        res.status(500).json({ error: 'تعذر تحديث معلومات التخصص.' });
      }
    }
  );

  // --- Immutable Audit Logs (Super Admin sees all; Scoped Admin with spec.audit.view sees own spec only) ---
  app.get(
    '/api/admin/audit-logs',
    adminRateLimiter,
    requireAnyPermission(['audit_logs.view', 'spec.audit.view']),
    (req: AuthenticatedRequest, res: Response) => {
      const auth = req.serverAuth!;
      const allLogs = loadServerAuditLogs();
      if (auth.isSuperAdmin) {
        return res.json({ logs: allLogs });
      }
      const specId = auth.assignedSpecializationId;
      const scopedLogs = allLogs.filter(
        (log) =>
          (specId && log.specializationId === specId) || log.actorUid === auth.uid
      );
      res.json({ logs: scopedLogs });
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
      specializationId: body.specializationId
        ? String(body.specializationId).slice(0, 128)
        : auth.assignedSpecializationId,
      targetUid: body.targetUid ? String(body.targetUid).slice(0, 128) : undefined,
      targetEmail: body.targetEmail ? String(body.targetEmail).slice(0, 254) : undefined,
      oldValue: body.oldValue ? String(body.oldValue).slice(0, 400) : undefined,
      newValue: body.newValue ? String(body.newValue).slice(0, 400) : undefined,
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

  // --- Database & File Backups (Super Admin ONLY) ---
  app.get(
    '/api/backups',
    adminRateLimiter,
    requireSuperAdmin,
    (_req: AuthenticatedRequest, res: Response) => {
      res.json({ backups: loadBackupsIndex() });
    }
  );

  app.post(
    '/api/backups/create',
    adminRateLimiter,
    requireSuperAdmin,
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
        let integritySha256 = '';

        if (backupType === 'database' || backupType === 'full') {
          const [specs, years, sems, subs, progCourses, files, fileLinks, anns, notifs] = await Promise.all([
            listFirestoreCollectionRest('specializations', token),
            listFirestoreCollectionRest('academicYears', token),
            listFirestoreCollectionRest('semesters', token),
            listFirestoreCollectionRest('subjects', token),
            listFirestoreCollectionRest('programCourses', token),
            listFirestoreCollectionRest('lectureFiles', token),
            listFirestoreCollectionRest('lectureFileLinks', token),
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
              programCourses: progCourses,
              lectureFiles: files,
              lectureFileLinks: fileLinks,
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
            progCourses.length +
            files.length +
            fileLinks.length +
            anns.length +
            notifs.length +
            Object.keys(loadUsersDirectory()).length;
          const written = writeJsonBackupFile(backupId, dbSnapshot);
          totalBytes += written.bytes;
          integritySha256 = computeFileSha256(written.filePath);
        }

        if (backupType === 'files' || backupType === 'full') {
          const filesSnap = createPhysicalFilesBackupSnapshot(backupId);
          totalFiles = filesSnap.totalFiles;
          totalBytes += filesSnap.totalBytes;
          if (!integritySha256 && fs.existsSync(filesSnap.manifestPath)) {
            integritySha256 = computeFileSha256(filesSnap.manifestPath);
          }
        }

        const record: BackupSnapshot = {
          id: backupId,
          type: backupType,
          status: 'completed',
          totalRecords,
          totalFiles,
          totalBytes,
          ...(integritySha256 ? { integritySha256 } : {}),
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

  // Real Non-Destructive Backup Integrity & Restoration Verification Test (Super Admin ONLY)
  app.post(
    '/api/backups/:backupId/verify-restore',
    adminRateLimiter,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const auth = req.serverAuth!;
        const token = req.authToken!;
        const safeId = sanitizePathSegment(req.params.backupId, '');
        if (!safeId) return res.status(400).json({ error: 'معرف النسخة غير صالح.' });

        const existing = loadBackupsIndex().find((b) => b.id === safeId);
        if (!existing) {
          return res.status(404).json({ error: 'سجل النسخة الاحتياطية غير موجود.' });
        }

        const checks: string[] = [];
        let passed = true;

        if (existing.type === 'database' || existing.type === 'full') {
          const dbFile = path.join(DB_BACKUPS_DIR, `${safeId}.json`);
          if (!fs.existsSync(dbFile)) {
            passed = false;
            checks.push('ملف لقطة قاعدة البيانات غير موجود على الخادم.');
          } else {
            const actualHash = computeFileSha256(dbFile);
            if (existing.integritySha256 && existing.type === 'database' && actualHash !== existing.integritySha256) {
              passed = false;
              checks.push('فشل تطابق بصمة SHA-256 لملف قاعدة البيانات.');
            } else {
              const parsed = JSON.parse(fs.readFileSync(dbFile, 'utf8')) as {
                collections?: Record<string, unknown[]>;
              };
              const requiredKeys = [
                'specializations',
                'academicYears',
                'semesters',
                'subjects',
                'lectureFiles',
                'programCourses',
                'lectureFileLinks',
              ];
              const missingKeys = requiredKeys.filter((k) => !Array.isArray(parsed.collections?.[k]));
              if (missingKeys.length > 0) {
                passed = false;
                checks.push(`بنية النسخة تنقصها المجموعات: ${missingKeys.join(', ')}`);
              } else {
                checks.push(
                  `تم التحقق من سلامة JSON وبصمة SHA-256 (${parsed.collections!.lectureFiles.length} ملف، ${parsed.collections!.subjects.length} مادة).`
                );
              }
            }
          }
        }

        if (existing.type === 'files' || existing.type === 'full') {
          const snapshotDir = path.join(FILE_BACKUPS_DIR, safeId);
          const manifestPath = path.join(snapshotDir, 'manifest.json');
          if (!fs.existsSync(manifestPath)) {
            passed = false;
            checks.push('ملف بيان الملفات (manifest.json) غير موجود.');
          } else {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
              files?: Array<{ sourcePath: string; sha256: string }>;
            };
            const list = manifest.files || [];
            let verifiedFilesCount = 0;
            let mismatchedCount = 0;
            for (const entry of list) {
              const target = path.resolve(snapshotDir, entry.sourcePath);
              if (!target.startsWith(snapshotDir) || !fs.existsSync(target)) {
                mismatchedCount += 1;
                continue;
              }
              const digest = computeFileSha256(target);
              if (digest !== entry.sha256) {
                mismatchedCount += 1;
              } else {
                verifiedFilesCount += 1;
              }
            }
            if (mismatchedCount > 0) {
              passed = false;
              checks.push(`تم رصد ${mismatchedCount} ملف مفقود أو تالف من أصل ${list.length}.`);
            } else {
              checks.push(`تم التحقق من مطابقة SHA-256 لجميع الملفات المنسوخة (${verifiedFilesCount}/${list.length}).`);
            }
          }
        }

        const verifiedAt = new Date().toISOString();
        const verifiedStatus: 'verified' | 'failed' = passed ? 'verified' : 'failed';
        const verifiedNotes = checks.join(' | ').slice(0, 400);

        const updated = updateBackupIndexRecord(safeId, {
          verifiedAt,
          verifiedStatus,
          verifiedNotes,
          verifiedBy: auth.email,
        });

        await patchFirestoreDocRest(
          'backups',
          safeId,
          {
            verifiedAt,
            verifiedStatus,
            verifiedNotes,
            verifiedBy: auth.email,
          },
          token,
          ['verifiedAt', 'verifiedStatus', 'verifiedNotes', 'verifiedBy']
        );

        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: auth.uid,
          actorEmail: auth.email,
          actorName: auth.displayName,
          actorRole: auth.role,
          action: `اختبار سلامة واسترداد النسخة الاحتياطية (${verifiedStatus})`,
          entityType: 'backup',
          entityId: safeId,
          entityName: safeId,
          result: passed ? 'success' : 'failed',
          details: verifiedNotes,
          createdAt: verifiedAt,
        });

        res.json({ ok: passed, backup: updated, checks });
      } catch (error) {
        console.error('Verify backup error:', error);
        res.status(500).json({ error: 'تعذر تنفيذ اختبار الاستعادة للنسخة الاحتياطية.' });
      }
    }
  );

  app.get(
    '/api/backups/download/:backupId',
    adminRateLimiter,
    requireSuperAdmin,
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

  // --- Resolve File Metadata (Cached Single-Flight + Firestore + Server Index) ---
  async function resolveLectureFileMeta(fileId: string, token?: string, bypassCache = false) {
    if (!bypassCache) {
      const cached = await cacheLayer.get<Record<string, unknown>>(`file:meta:${fileId}`);
      if (cached) return cached;
    }

    if (!token || !bypassCache) {
      const { value } = await catalogSingleFlight.run(`file:meta:${fileId}`, async () => {
        const fsDoc = await fetchFirestoreDocRest('lectureFiles', fileId, token);
        if (fsDoc) {
          if (fsDoc.status === 'published' && fsDoc.lifecycleStatus !== 'trashed') {
            await cacheLayer.set(`file:meta:${fileId}`, fsDoc, 180);
          }
          return fsDoc;
        }
        const registry = loadFileRegistry();
        const regEntry = registry[fileId] || null;
        if (regEntry && regEntry.status === 'published') {
          await cacheLayer.set(`file:meta:${fileId}`, regEntry as unknown as Record<string, unknown>, 180);
        }
        return regEntry as unknown as Record<string, unknown> | null;
      });
      if (value) return value;
    }

    if (token) {
      const fsDoc = await fetchFirestoreDocRest('lectureFiles', fileId, token);
      if (fsDoc) return fsDoc;
    }
    const registry = loadFileRegistry();
    return registry[fileId] || null;
  }

  function hasValidSignedFileAccess(req: AuthenticatedRequest, fileId: string): {
    allowed: boolean;
    staffPreview: boolean;
  } {
    const sig = typeof req.query.sig === 'string' ? req.query.sig : '';
    if (!sig) return { allowed: false, staffPreview: false };
    const previewCheck = verifySignedUrlToken(sig, 'file_preview', fileId);
    if (previewCheck.valid) {
      return {
        allowed: true,
        staffPreview: previewCheck.payload.meta?.staff === 1,
      };
    }
    const cdnCheck = verifySignedUrlToken(sig, 'cdn_download', fileId);
    if (cdnCheck.valid) {
      return {
        allowed: true,
        staffPreview: cdnCheck.payload.meta?.staff === 1,
      };
    }
    return { allowed: false, staffPreview: false };
  }

  // Issue short-lived signed capability URLs for safe in-app preview & download without exposing Firebase Bearer tokens in URLs
  app.get(
    '/api/files/preview-token/:fileId',
    publicRateLimiter,
    attachOptionalAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const fileId = String(req.params.fileId || '').trim();
        const fileData = await resolveLectureFileMeta(fileId, req.authToken);
        if (!fileData) {
          return res.status(404).json({ error: 'الملف غير موجود.' });
        }
        const isSuperAdmin = Boolean(req.serverAuth?.isSuperAdmin);
        if (fileData.lifecycleStatus === 'trashed' && !isSuperAdmin) {
          return res.status(403).json({ error: 'تم نقل هذا الملف إلى سلة المحذوفات ولا يمكن عرضه.' });
        }
        if (fileData.status !== 'published' && !req.isAdmin) {
          return res.status(403).json({ error: 'هذا الملف غير منشور للعرض حالياً.' });
        }

        const staffFlag = req.isAdmin ? 1 : 0;
        const { token, expiresAt } = createSignedUrlToken({
          sub: fileId,
          action: 'file_preview',
          ttlSeconds: 300,
          uid: req.serverAuth?.uid,
          meta: { staff: staffFlag },
        });
        const sigParam = `sig=${encodeURIComponent(token)}`;
        res.json({
          fileId,
          expiresAt,
          viewUrl: `/api/files/view/${encodeURIComponent(fileId)}?${sigParam}`,
          downloadUrl: `/api/files/download/${encodeURIComponent(fileId)}?${sigParam}`,
          extractUrl: `/api/files/extract/${encodeURIComponent(fileId)}?${sigParam}`,
        });
      } catch (error) {
        console.error('Preview token issue error:', error);
        res.status(500).json({ error: 'تعذر إصدار رابط المعاينة المؤقت.' });
      }
    }
  );

  // Protected File Inline Preview Endpoint
  app.get('/api/files/view/:fileId', attachOptionalAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const fileId = String(req.params.fileId || '').trim();
      const signed = hasValidSignedFileAccess(req, fileId);
      const staffElevated = Boolean(req.isAdmin || signed.staffPreview);
      const isSuperAdmin = Boolean(req.serverAuth?.isSuperAdmin);
      const fileData = await resolveLectureFileMeta(fileId, req.authToken, Boolean(req.isAdmin));
      if (!fileData) {
        return res.status(404).json({ error: 'الملف غير موجود.' });
      }
      if (fileData.lifecycleStatus === 'trashed' && !isSuperAdmin) {
        return res.status(403).json({ error: 'تم نقل هذا الملف إلى سلة المحذوفات ولا يمكن عرضه.' });
      }
      if (fileData.status !== 'published' && !staffElevated) {
        return res.status(403).json({ error: 'هذا الملف غير منشور للعرض حالياً.' });
      }

      const storageName = path.basename(String(fileData.storageName || ''));
      const storagePath = fileData.storagePath ? String(fileData.storagePath) : undefined;
      let fullPath = resolvePhysicalFilePath(storageName, storagePath);
      if (!fullPath) {
        ensureSeedPdfFilesOnDisk();
        fullPath = resolvePhysicalFilePath(storageName, storagePath);
      }
      if (!fullPath) {
        return res.status(404).json({ error: 'ملف التخزين غير متوفر على الخادم.' });
      }

      let fileStat: fs.Stats;
      try {
        fileStat = await fs.promises.stat(fullPath);
      } catch {
        return res.status(404).json({ error: 'ملف التخزين غير متوفر على الخادم.' });
      }

      const ext = String(fileData.fileExt || 'pdf').toLowerCase();
      const mimeType = String(fileData.mimeType || MIME_MAP[ext] || 'application/octet-stream');
      const originalName = String(fileData.originalName || fileData.fileName || 'lecture.pdf');
      const isPublishedActive = fileData.status === 'published' && fileData.lifecycleStatus !== 'trashed';
      const fileEtag = `W/"${fileId}:${fileStat.size}:${Math.floor(fileStat.mtimeMs)}"`;

      res.setHeader('Content-Type', mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('ETag', fileEtag);
      res.setHeader(
        'Cache-Control',
        isPublishedActive ? 'private, max-age=300' : 'private, no-store'
      );
      res.setHeader(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`
      );

      if (isPublishedActive && isEtagMatch(req.headers['if-none-match'], fileEtag)) {
        return res.status(304).end();
      }

      const stream = fs.createReadStream(fullPath);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(500).json({ error: 'تعذر قراءة الملف من التخزين.' });
        } else {
          res.end();
        }
      });
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      console.error('View file error:', error);
      res.status(500).json({ error: 'تعذر عرض الملف.' });
    }
  });

  // Protected File Download Endpoint
  app.get('/api/files/download/:fileId', attachOptionalAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const fileId = String(req.params.fileId || '').trim();
      const signed = hasValidSignedFileAccess(req, fileId);
      const staffElevated = Boolean(req.isAdmin || signed.staffPreview);
      const isSuperAdmin = Boolean(req.serverAuth?.isSuperAdmin);
      const fileData = await resolveLectureFileMeta(fileId, req.authToken, Boolean(req.isAdmin));
      if (!fileData) {
        return res.status(404).json({ error: 'الملف غير موجود.' });
      }
      if (fileData.lifecycleStatus === 'trashed' && !isSuperAdmin) {
        return res.status(403).json({ error: 'تم نقل هذا الملف إلى سلة المحذوفات ولا يمكن تحميله.' });
      }
      if (fileData.status !== 'published' && !staffElevated) {
        return res.status(403).json({ error: 'هذا الملف غير متاح للتحميل.' });
      }
      if (!fileData.allowDownload && !staffElevated) {
        return res.status(403).json({ error: 'تم تعطيل تحميل هذا الملف من قبل إدارة المنصة؛ يمكنك معاينته فقط.' });
      }

      const storageName = path.basename(String(fileData.storageName || ''));
      const storagePath = fileData.storagePath ? String(fileData.storagePath) : undefined;
      let fullPath = resolvePhysicalFilePath(storageName, storagePath);
      if (!fullPath) {
        ensureSeedPdfFilesOnDisk();
        fullPath = resolvePhysicalFilePath(storageName, storagePath);
      }
      if (!fullPath) {
        return res.status(404).json({ error: 'ملف التخزين غير متوفر على الخادم.' });
      }

      let fileStat: fs.Stats;
      try {
        fileStat = await fs.promises.stat(fullPath);
      } catch {
        return res.status(404).json({ error: 'ملف التخزين غير متوفر على الخادم.' });
      }

      const ext = String(fileData.fileExt || 'pdf').toLowerCase();
      const mimeType = String(fileData.mimeType || MIME_MAP[ext] || 'application/octet-stream');
      const originalName = String(fileData.originalName || fileData.fileName || 'lecture.pdf');
      const isPublishedActive = fileData.status === 'published' && fileData.lifecycleStatus !== 'trashed';
      observability.recordFileDownload();
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', String(fileStat.size));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Cache-Control',
        isPublishedActive ? 'private, max-age=300' : 'private, no-store'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`
      );
      const stream = fs.createReadStream(fullPath);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(500).json({ error: 'تعذر تحميل الملف.' });
        } else {
          res.end();
        }
      });
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      console.error('Download file error:', error);
      res.status(500).json({ error: 'تعذر تحميل الملف.' });
    }
  });

  // --- CDN Signed URL Issue & Edge-Cacheable Download ---
  app.get('/api/cdn/signed-url/:fileId', publicRateLimiter, attachOptionalAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const fileId = String(req.params.fileId || '').trim();
      const isSuperAdmin = Boolean(req.serverAuth?.isSuperAdmin);
      const fileData = await resolveLectureFileMeta(fileId, req.authToken);
      if (!fileData) {
        return res.status(404).json({ error: 'الملف غير موجود.' });
      }
      if (fileData.lifecycleStatus === 'trashed' && !isSuperAdmin) {
        return res.status(403).json({ error: 'تم نقل هذا الملف إلى سلة المحذوفات.' });
      }
      if (fileData.status !== 'published' && !req.isAdmin) {
        return res.status(403).json({ error: 'هذا الملف غير متاح حالياً.' });
      }
      if (!fileData.allowDownload && !req.isAdmin) {
        return res.status(403).json({ error: 'تم تعطيل تحميل هذا الملف من قبل إدارة المنصة.' });
      }
      const { token, expiresAt } = createSignedUrlToken({
        sub: fileId,
        action: 'cdn_download',
        ttlSeconds: 300,
        meta: { staff: req.isAdmin ? 1 : 0 },
      });
      const signedPath = `/api/cdn/download/${encodeURIComponent(fileId)}?sig=${encodeURIComponent(token)}`;
      res.json({
        fileId,
        signedUrl: signedPath,
        expiresAt,
        cdnCacheControl: 'private, no-store',
      });
    } catch (error) {
      console.error('CDN signed URL error:', error);
      res.status(500).json({ error: 'تعذر إنشاء رابط التحميل الموقع.' });
    }
  });

  app.get('/api/cdn/download/:fileId', publicRateLimiter, async (req: Request, res: Response) => {
    try {
      const fileId = String(req.params.fileId || '').trim();
      const sig = typeof req.query.sig === 'string' ? req.query.sig : '';
      const verification = verifySignedUrlToken(sig, 'cdn_download', fileId);
      if (!verification.valid) {
        return res.status(403).json({ error: verification.reason });
      }

      const fileData = await resolveLectureFileMeta(fileId);
      if (!fileData) {
        return res.status(404).json({ error: 'الملف غير موجود.' });
      }
      const isStaffSig = verification.payload.meta?.staff === 1;
      if (fileData.lifecycleStatus === 'trashed' && !isStaffSig) {
        return res.status(403).json({ error: 'تم نقل هذا الملف إلى سلة المحذوفات.' });
      }
      if (fileData.status !== 'published' && !isStaffSig) {
        return res.status(403).json({ error: 'هذا الملف غير متاح للتحميل.' });
      }
      if (!fileData.allowDownload && !isStaffSig) {
        return res.status(403).json({ error: 'تم تعطيل تحميل هذا الملف من قبل إدارة المنصة.' });
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

      const ext = String(fileData.fileExt || 'pdf').toLowerCase();
      const mimeType = String(fileData.mimeType || MIME_MAP[ext] || 'application/octet-stream');
      const originalName = String(fileData.originalName || fileData.fileName || 'lecture.pdf');
      observability.recordFileDownload();
      res.setHeader('Content-Type', mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-CDN-Signed', 'verified');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`);
      fs.createReadStream(fullPath).pipe(res);
    } catch (error) {
      console.error('CDN download error:', error);
      res.status(500).json({ error: 'تعذر تسليم الملف عبر الرابط الموقع.' });
    }
  });

  // --- Direct-to-Storage Signed Upload URL Flow (Super Admin ONLY) ---
  app.post(
    '/api/storage/signed-upload-url',
    uploadRateLimiter,
    requireSuperAdminUploadGuard,
    (req: AuthenticatedRequest, res: Response) => {
      const originalName = String(req.body?.originalName || '').trim();
      const safety = validateUploadFilenameSafety(originalName);
      if (!safety.valid) {
        incrementRejectedUploadsCount();
        return res.status(400).json({ error: safety.reason || 'اسم أو صيغة الملف غير مدعومة لإنشاء رابط الرفع الموقع.' });
      }
      const ext = safety.ext;
      const fileId = generateSafeId('lec');
      const { token, expiresAt } = createSignedUrlToken({
        sub: fileId,
        action: 'direct_upload',
        ttlSeconds: 600,
        meta: {
          uid: req.serverAuth!.uid,
          ext,
          specId: sanitizePathSegment(req.body?.specializationId, 'unassigned'),
          yearId: sanitizePathSegment(req.body?.academicYearId, 'year'),
          semId: sanitizePathSegment(req.body?.semesterId, 'semester'),
          subId: sanitizePathSegment(req.body?.subjectId, 'subject'),
        },
      });
      res.json({
        fileId,
        uploadUrl: `/api/storage/direct-upload/${encodeURIComponent(token)}`,
        expiresAt,
        method: 'PUT',
      });
    }
  );

  app.put(
    '/api/storage/direct-upload/:uploadToken',
    uploadRateLimiter,
    express.raw({ type: '*/*', limit: '50mb' }),
    async (req: Request, res: Response) => {
      try {
        const uploadToken = String(req.params.uploadToken || '');
        const check = verifySignedUrlToken(uploadToken, 'direct_upload');
        if (!check.valid) {
          incrementRejectedUploadsCount();
          return res.status(403).json({ error: check.reason });
        }
        const bodyBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
        if (bodyBuf.length === 0) {
          incrementRejectedUploadsCount();
          return res.status(400).json({ error: 'محتوى الملف فارغ.' });
        }

        const ext = String(check.payload.meta?.ext || 'pdf').toLowerCase();
        const settingsDoc = await getCachedPlatformSettings();
        const maxFileSizeMB = Number(settingsDoc?.maxFileSizeMB) || 25;
        const allowZipUploads = settingsDoc?.allowZipUploads !== false;
        const allowedExtensions = parseExtensionsList(settingsDoc?.allowedExtensions);

        if (!allowedExtensions.includes(ext) || (ext === 'zip' && !allowZipUploads)) {
          incrementRejectedUploadsCount();
          return res.status(400).json({ error: `صيغة الملف (.${ext}) غير مسموح بها حالياً.` });
        }
        if (bodyBuf.length > maxFileSizeMB * 1024 * 1024) {
          incrementRejectedUploadsCount();
          return res.status(400).json({
            error: `حجم الملف يتجاوز الحد الأقصى المسموح (${maxFileSizeMB} ميجابايت).`,
          });
        }

        const magicCheck = validateFileMagicBytes(ext, bodyBuf.subarray(0, 512));
        if (!magicCheck.valid) {
          incrementRejectedUploadsCount();
          return res.status(400).json({
            error: magicCheck.reason || 'مرفوض أمنياً: محتوى الملف لا يطابق الصيغة المعلنة.',
          });
        }

        const disk = computeDiskStorageUsage();
        const quotaMB =
          Number(settingsDoc?.storageQuotaMB) ||
          Number(process.env.UST_STORAGE_QUOTA_MB) ||
          1024;
        const quotaCheck = evaluateStorageQuota({
          usedBytes: disk.lecturesBytes,
          incomingBytes: bodyBuf.length,
          quotaMB,
          thresholds: DEFAULT_STORAGE_THRESHOLDS,
        });
        if (!quotaCheck.canUpload) {
          return res.status(403).json({ error: quotaCheck.message || 'السعة التخزينية ممتلئة.' });
        }

        const storageName = `ust_${Date.now()}_${crypto.randomUUID()}.${ext}`;
        const sha256 = crypto.createHash('sha256').update(bodyBuf).digest('hex');
        const dest = buildCentralStorageLocation({
          sha256,
          storageName,
        });
        fs.mkdirSync(dest.dirPath, { recursive: true });
        fs.writeFileSync(dest.fullPath, bodyBuf);

        res.json({
          ok: true,
          fileId: check.payload.sub,
          storageName,
          storagePath: dest.storagePath,
          fileSize: bodyBuf.length,
          sha256,
        });
      } catch (error) {
        console.error('Direct signed upload error:', error);
        res.status(500).json({ error: 'تعذر حفظ الملف المرفوع عبر الرابط الموقع.' });
      }
    }
  );

  // Extract readable text segments from stored PDF (cached & non-blocking)
  app.get('/api/files/extract/:fileId', attachOptionalAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const fileId = String(req.params.fileId || '').trim();
      const signed = hasValidSignedFileAccess(req, fileId);
      const staffElevated = Boolean(req.isAdmin || signed.staffPreview);
      const isSuperAdmin = Boolean(req.serverAuth?.isSuperAdmin);
      const fileData = await resolveLectureFileMeta(fileId, req.authToken, Boolean(req.isAdmin));
      if (!fileData) {
        return res.status(404).json({ error: 'الملف غير موجود.' });
      }
      if (fileData.lifecycleStatus === 'trashed' && !isSuperAdmin) {
        return res.status(403).json({ error: 'تم نقل هذا الملف إلى سلة المحذوفات.' });
      }
      if (fileData.status !== 'published' && !staffElevated) {
        return res.status(403).json({ error: 'هذا الملف غير متاح للعرض.' });
      }

      const isPublishedActive = fileData.status === 'published' && fileData.lifecycleStatus !== 'trashed';
      const extractCacheKey = `file:extract:${fileId}`;
      if (isPublishedActive) {
        const cachedExtract = await cacheLayer.get<{
          fileId: string;
          originalName: string;
          lines: string[];
        }>(extractCacheKey);
        if (cachedExtract) {
          res.setHeader('X-Cache', 'HIT');
          res.setHeader('Cache-Control', 'private, max-age=300');
          return res.json(cachedExtract);
        }
      }

      const storageName = path.basename(String(fileData.storageName || ''));
      const storagePath = fileData.storagePath ? String(fileData.storagePath) : undefined;
      let fullPath = resolvePhysicalFilePath(storageName, storagePath);
      if (!fullPath) {
        ensureSeedPdfFilesOnDisk();
        fullPath = resolvePhysicalFilePath(storageName, storagePath);
      }
      if (!fullPath) {
        return res.status(404).json({ error: 'ملف التخزين غير متوفر.' });
      }

      let raw: string;
      try {
        raw = await fs.promises.readFile(fullPath, 'latin1');
      } catch {
        return res.status(404).json({ error: 'ملف التخزين غير متوفر.' });
      }

      const matches = [...raw.matchAll(/\(([^()]{2,240})\)\s*Tj/g)];
      const lines = matches
        .map((m) => m[1].replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\').trim())
        .filter((line) => line.length > 0);

      const payload = {
        fileId,
        originalName: String(fileData.originalName || fileData.fileName || ''),
        lines,
      };
      if (isPublishedActive) {
        await cacheLayer.set(extractCacheKey, payload, 300);
        res.setHeader('Cache-Control', 'private, max-age=300');
      }
      res.setHeader('X-Cache', 'MISS');
      res.json(payload);
    } catch (error) {
      console.error('Extract PDF error:', error);
      res.status(500).json({ error: 'تعذر قراءة محتوى الملف.' });
    }
  });

  // --- High-Performance Examination System ---
  app.get('/api/exams', publicRateLimiter, async (req: Request, res: Response) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const subjectId = String(req.query.subjectId || '').trim();
    const cacheKey = `exams:list:${page}:${limit}:${subjectId}`;

    const cached = await cacheLayer.get<{
      items: unknown[];
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    }>(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }

    let list = loadAllExams()
      .filter((e) => e.status === 'published')
      .map((e) => sanitizeExamForStudent(e));
    if (subjectId) {
      list = list.filter((e) => e.subjectId === subjectId);
    }
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const items = list.slice((page - 1) * limit, page * limit);
    const payload = { items, page, limit, total, totalPages };

    await cacheLayer.set(cacheKey, payload, 30);
    res.setHeader('X-Cache', 'MISS');
    res.json(payload);
  });

  app.get('/api/exams/attempts/me', examRateLimiter, requireAuthenticated, (req: AuthenticatedRequest, res: Response) => {
    const attempts = listUserAttempts(req.serverAuth!.uid);
    res.json({ attempts });
  });

  app.get('/api/exams/:examId', examRateLimiter, (req: Request, res: Response) => {
    const exam = getExamById(String(req.params.examId || ''));
    if (!exam || exam.status !== 'published') {
      return res.status(404).json({ error: 'الاختبار غير موجود.' });
    }
    res.json({ exam: sanitizeExamForStudent(exam) });
  });

  app.post('/api/exams/:examId/submit', examRateLimiter, requireAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const exam = getExamById(String(req.params.examId || ''));
      if (!exam) {
        return res.status(404).json({ error: 'الاختبار غير موجود.' });
      }
      const idempotencyKey = String(req.body?.idempotencyKey || '').trim();
      const answers =
        req.body?.answers && typeof req.body.answers === 'object'
          ? (req.body.answers as Record<string, number>)
          : {};
      const durationSeconds = Number(req.body?.durationSeconds) || 0;

      const { attempt, deduplicated } = submitExamAttempt({
        exam,
        userId: req.serverAuth!.uid,
        userEmail: req.serverAuth!.email,
        idempotencyKey,
        answers,
        durationSeconds,
      });

      if (!deduplicated && req.authToken) {
        observability.recordExamSubmission();
        // Best-effort sync to Firestore examAttempts without blocking HTTP response latency
        void patchFirestoreDocRest(
          'examAttempts',
          attempt.id,
          {
            id: attempt.id,
            examId: attempt.examId,
            examTitle: attempt.examTitle,
            subjectId: attempt.subjectId,
            userId: attempt.userId,
            idempotencyKey: attempt.idempotencyKey,
            score: attempt.score,
            totalQuestions: attempt.totalQuestions,
            percentage: attempt.percentage,
            durationSeconds: attempt.durationSeconds,
            submittedAt: attempt.submittedAt,
          },
          req.authToken
        );
      } else if (!deduplicated) {
        observability.recordExamSubmission();
      }

      res.json({ attempt, deduplicated });
    } catch (error) {
      console.error('Exam submit error:', error);
      res.status(500).json({ error: 'تعذر تصحيح وتسليم الاختبار.' });
    }
  });

  // --- Dedicated Asynchronous AI Background Queue ---
  app.post('/api/ai/jobs', aiRateLimiter, requireAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.serverAuth!;
      const topic = String(req.body?.topic || '').trim().slice(0, 200);
      if (topic.length < 2) {
        return res.status(400).json({ error: 'يرجى إدخال موضوع أو عنوان واضح للمهمة.' });
      }
      const subjectName = String(req.body?.subjectName || 'مقرر جامعي').slice(0, 140);
      const rawContextInput = String(req.body?.contextText || '').slice(0, 8000);

      // Prompt Injection Firewall Check on User Inputs
      const topicCheck = inspectPromptInjectionRisk(topic);
      const subjectCheck = inspectPromptInjectionRisk(subjectName);
      const contextCheck = inspectPromptInjectionRisk(rawContextInput);
      if (topicCheck.flagged || subjectCheck.flagged || contextCheck.flagged) {
        recordAiPromptInjectionBlock();
        appendServerAuditLog({
          id: generateSafeId('log'),
          actorUid: auth.uid,
          actorEmail: auth.email,
          actorName: auth.displayName,
          actorRole: auth.role,
          action: 'صد محاولة حقن أوامر في الذكاء الاصطناعي (Prompt Injection)',
          entityType: 'security',
          entityId: 'ai_prompt_firewall',
          entityName: topic.slice(0, 120),
          result: 'denied',
          createdAt: new Date().toISOString(),
        });
        return res.status(400).json({
          error: 'تم رفض الطلب لاحتوائه على أنماط أوامر غير مسموح بها داخل النص.',
        });
      }

      const typeRaw = String(req.body?.type || 'exam_generation');
      const type =
        typeRaw === 'pdf_summary' || typeRaw === 'explanation' || typeRaw === 'ocr_extract'
          ? typeRaw
          : 'exam_generation';
      const difficultyRaw = String(req.body?.difficulty || 'medium');
      const difficulty =
        difficultyRaw === 'easy' || difficultyRaw === 'hard' ? difficultyRaw : 'medium';
      const questionCount = Math.min(10, Math.max(3, Number(req.body?.questionCount) || 5));
      const sourceFileId = req.body?.sourceFileId ? String(req.body.sourceFileId).trim() : undefined;

      let contextText = contextCheck.sanitizedText;
      if (sourceFileId) {
        const fileData = await resolveLectureFileMeta(sourceFileId, req.authToken);
        if (!fileData) {
          return res.status(404).json({ error: 'ملف المحاضرة المرجعي غير موجود.' });
        }
        if (
          !auth.isSuperAdmin &&
          (fileData.status !== 'published' || fileData.lifecycleStatus === 'trashed')
        ) {
          appendServerAuditLog({
            id: generateSafeId('log'),
            actorUid: auth.uid,
            actorEmail: auth.email,
            actorName: auth.displayName,
            actorRole: auth.role,
            action: 'منع استخدام ملف مسودة أو محذوف في الذكاء الاصطناعي',
            entityType: 'security',
            entityId: sourceFileId,
            entityName: topic,
            result: 'denied',
            createdAt: new Date().toISOString(),
          });
          return res.status(403).json({
            error: 'غير مصرح بتوليد أسئلة أو ملخصات من ملف غير منشور أو محذوف.',
          });
        }
        if (!contextText && fileData.storageName && !String(fileData.storageName).startsWith('gdrive_')) {
          const fullPath = resolvePhysicalFilePath(
            path.basename(String(fileData.storageName)),
            fileData.storagePath ? String(fileData.storagePath) : undefined
          );
          if (fullPath && fs.existsSync(fullPath)) {
            const raw = fs.readFileSync(fullPath, 'latin1');
            const matches = [...raw.matchAll(/\(([^()]{2,240})\)\s*Tj/g)];
            const extracted = matches
              .map((m) => m[1].replace(/\\\(/g, '(').replace(/\\\)/g, ')').trim())
              .filter(Boolean)
              .join('\n')
              .slice(0, 8000);
            contextText = inspectPromptInjectionRisk(extracted).sanitizedText;
          }
        }
      }

      // Free-tier daily AI quota enforcement (per-user & global)
      const quotaCheck = consumeAiDailyQuota({
        uid: auth.uid,
        isStaff: auth.isStaff,
      });
      if (!quotaCheck.allowed) {
        return res.status(429).json({
          error: quotaCheck.reason || 'تم بلوغ الحد اليومي لاستخدام أدوات الذكاء الاصطناعي.',
        });
      }

      const job = await aiQueueWorker.enqueueJob({
        type,
        priority: req.isAdmin ? 'high' : 'normal',
        requestedBy: auth.uid,
        requestedByEmail: auth.email,
        specializationId: String(req.body?.specializationId || 'spec_general'),
        academicYearId: String(req.body?.academicYearId || 'yr_general'),
        semesterId: String(req.body?.semesterId || 'sem_general'),
        subjectId: String(req.body?.subjectId || 'sub_general'),
        subjectName: subjectCheck.sanitizedText,
        sourceFileId,
        topic: topicCheck.sanitizedText,
        difficulty,
        questionCount,
        contextText,
      });

      res.status(202).json({ job });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'تعذر جدولة مهمة الذكاء الاصطناعي.';
      res.status(503).json({ error: msg });
    }
  });

  app.get('/api/ai/jobs', examRateLimiter, requireAuthenticated, (req: AuthenticatedRequest, res: Response) => {
    const jobs = aiQueueWorker.listJobs({
      userId: req.serverAuth!.isSuperAdmin ? undefined : req.serverAuth!.uid,
      limit: 30,
    });
    res.json({ jobs, stats: aiQueueWorker.getQueueStats() });
  });

  app.get('/api/ai/jobs/:jobId', examRateLimiter, requireAuthenticated, (req: AuthenticatedRequest, res: Response) => {
    const job = aiQueueWorker.getJob(String(req.params.jobId || ''));
    if (!job) {
      return res.status(404).json({ error: 'المهمة غير موجودة.' });
    }
    if (!req.serverAuth!.isSuperAdmin && job.requestedBy !== req.serverAuth!.uid) {
      return res.status(403).json({ error: 'غير مصرح بالوصول إلى هذه المهمة.' });
    }
    res.json({ job });
  });

  app.post('/api/ai/jobs/:jobId/retry', aiRateLimiter, requireAuthenticated, (req: AuthenticatedRequest, res: Response) => {
    try {
      const job = aiQueueWorker.retryJob(
        String(req.params.jobId || ''),
        req.serverAuth!.uid,
        req.serverAuth!.isSuperAdmin
      );
      res.json({ job });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'تعذر إعادة تشغيل المهمة.';
      res.status(400).json({ error: msg });
    }
  });

  // --- Super Admin Enterprise Infrastructure Observability & Cache Controls ---
  app.get(
    '/api/admin/monitoring',
    adminRateLimiter,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const dbStart = process.hrtime.bigint();
        let dbStatus: 'healthy' | 'degraded' = 'healthy';
        try {
          await fetchFirestoreDocRest('settings', 'platform', req.authToken);
        } catch {
          dbStatus = 'degraded';
        }
        const dbLatencyMs = Math.round((Number(process.hrtime.bigint() - dbStart) / 1_000_000) * 10) / 10;

        if (cacheLayer.isRedisConfigured()) {
          await cacheLayer.pingRedis();
        }
        const cacheStats = cacheLayer.getStats();
        const disk = computeDiskStorageUsage();
        const quotaMB = Number(process.env.UST_STORAGE_QUOTA_MB) || 1024;
        const evalQuota = evaluateStorageQuota({
          usedBytes: disk.lecturesBytes,
          quotaMB,
          thresholds: DEFAULT_STORAGE_THRESHOLDS,
        });

        const snapshot = observability.buildSnapshot({
          dbStatus,
          dbLatencyMs,
          storageUsedBytes: disk.lecturesBytes,
          storageQuotaBytes: evalQuota.quotaBytes,
          storageUsedPct: evalQuota.usedPct,
          cacheStats,
          queueStats: aiQueueWorker.getQueueStats(),
          aiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
        });

        res.json({
          snapshot,
          recentAiJobs: aiQueueWorker.listJobs({ limit: 15 }),
        });
      } catch (error) {
        console.error('Monitoring endpoint error:', error);
        res.status(500).json({ error: 'تعذر قراءة قياسات البنية التحتية.' });
      }
    }
  );

  app.post('/api/admin/cache/invalidate', adminRateLimiter, requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
    const pattern = String(req.body?.pattern || '').trim();
    const removed = pattern ? cacheLayer.invalidatePattern(pattern) : (cacheLayer.clearAll(), -1);
    appendServerAuditLog({
      id: generateSafeId('log'),
      actorUid: req.serverAuth!.uid,
      actorEmail: req.serverAuth!.email,
      actorName: req.serverAuth!.displayName,
      actorRole: req.serverAuth!.role,
      action: 'مسح ذاكرة التخزين المؤقت الموزعة',
      entityType: 'cache',
      entityId: pattern || 'all',
      entityName: pattern || 'كافة المفاتيح',
      result: 'success',
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true, removed });
  });

  app.post('/api/admin/cache/warm', adminRateLimiter, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const seed = getInitialCatalog();
    await cacheLayer.set('catalog:public', seed, 120);
    await cacheLayer.del(CATALOG_SNAPSHOT_KEY);
    await getOrLoadPublishedCatalogSnapshot();
    await cacheLayer.set('exams:list:1:20:', {
      items: loadAllExams().filter((e) => e.status === 'published').map(sanitizeExamForStudent),
      page: 1,
      limit: 20,
      total: loadAllExams().length,
      totalPages: 1,
    }, 60);
    appendServerAuditLog({
      id: generateSafeId('log'),
      actorUid: req.serverAuth!.uid,
      actorEmail: req.serverAuth!.email,
      actorName: req.serverAuth!.displayName,
      actorRole: req.serverAuth!.role,
      action: 'تسخين ذاكرة التخزين المؤقت للمقررات',
      entityType: 'cache',
      entityId: 'warm',
      entityName: 'catalog:snapshot + catalog:public + exams',
      result: 'success',
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true, stats: cacheLayer.getStats() });
  });

  // --- Super Admin Comprehensive Security Center Snapshot ---
  app.get(
    '/api/admin/security-center',
    adminRateLimiter,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const settingsDoc = await fetchFirestoreDocRest('settings', 'platform', req.authToken).catch(() => null);
        const usersList = Object.values(loadUsersDirectory());
        const assignmentsList = Object.values(loadAdminAssignmentsIndex());
        const revokedMap = loadRevokedSessionsMap();
        const backupsList = loadBackupsIndex();
        const auditLogsList = loadServerAuditLogs();
        const aiQuotaStats = getAiQuotaStats();
        const queueStats = aiQueueWorker.getQueueStats();
        const counters = getSecurityCounters();

        const snapshot = buildSecurityCenterSnapshot({
          users: usersList,
          assignments: assignmentsList,
          revokedUsersCount: Object.keys(revokedMap).length,
          backups: backupsList,
          auditLogs: auditLogsList,
          maxFileSizeMB: Number(settingsDoc?.maxFileSizeMB) || 25,
          allowZipUploads: settingsDoc?.allowZipUploads !== false,
          allowedExtensions: parseExtensionsList(settingsDoc?.allowedExtensions),
          retentionDays: Number(settingsDoc?.backupRetentionDays) || 30,
          autoSchedule: String(settingsDoc?.autoBackupSchedule || 'weekly'),
          r2Configured: Boolean(process.env.UST_R2_WORKER_URL?.trim()),
          geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
          aiStats: {
            dailyUserLimit: aiQuotaStats.dailyUserLimit,
            dailyGlobalLimit: aiQuotaStats.dailyGlobalLimit,
            todayRequests: aiQuotaStats.todayRequests,
            blockedPromptInjections: aiQuotaStats.blockedPromptInjections,
            failedJobs: queueStats.failed,
          },
          rejectedUploadsCount: counters.rejectedUploadsCount,
          signingSecretConfigured: isPersistentSigningSecretConfigured(),
        });

        res.json({ snapshot });
      } catch (error) {
        console.error('Security center snapshot error:', error);
        res.status(500).json({ error: 'تعذر تحميل بيانات مركز الحماية والأمان.' });
      }
    }
  );

  // Global Safe Error Handler for malformed JSON & unhandled API exceptions (never leaks stack traces)
  app.use('/api', (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!err) return next();
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ error: 'صيغة البيانات المرسلة غير صالحة (JSON غير صحيح).' });
    }
    console.error('Unhandled API error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'حدث خطأ داخلي في الخادم. تم تسجيل الحدث دون كشف التفاصيل.' });
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
    app.use(express.static(distDir, { maxAge: '7d', etag: true }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`UST Lecture Platform (${observability.instanceId}) running on http://0.0.0.0:${PORT}`);
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 65_000;

  const gracefulShutdown = (signal: string) => {
    console.log(`[${observability.instanceId}] Received ${signal}; entering graceful drain...`);
    observability.draining = true;
    server.close(() => {
      void Promise.allSettled([
        flushServerIndexWrites(),
        flushExamWrites(),
        flushRegistryWrites(),
      ]).finally(() => {
        console.log(`[${observability.instanceId}] HTTP connections & pending writes drained cleanly.`);
        process.exit(0);
      });
    });
    setTimeout(() => process.exit(1), 15_000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
