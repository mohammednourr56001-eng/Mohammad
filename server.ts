import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { DecodedIdToken } from 'firebase-admin/auth';
import firebaseConfig from './firebase-applet-config.json';
import {
  fetchFirestoreDocRest,
  isUserAdmin,
  verifyBearerToken,
} from './server/firebaseAdmin.ts';
import {
  ensureSeedPdfFilesOnDisk,
  getInitialCatalog,
  loadFileRegistry,
  removeFileRegistryEntry,
  UPLOAD_DIR,
  upsertFileRegistryEntry,
} from './server/seedPlatform.ts';
import { SUPPORTED_FILE_EXTENSIONS } from './src/types/academic.ts';

interface AuthenticatedRequest extends Request {
  authUser?: DecodedIdToken | null;
  authToken?: string;
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
    req.isAdmin = await isUserAdmin(decoded, token);
  } else {
    req.authUser = null;
    req.authToken = undefined;
    req.isAdmin = false;
  }
  next();
}

async function requireAdminMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح: يجب تسجيل الدخول أولاً.' });
  }
  const token = authHeader.slice(7).trim();
  const decoded = await verifyBearerToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'جلسة الدخول غير صالحة أو منتهية.' });
  }
  const adminFlag = await isUserAdmin(decoded, token);
  if (!adminFlag) {
    return res.status(403).json({ error: 'ممنوع: هذه العملية مخصصة لمشرفي المنصة فقط.' });
  }
  req.authUser = decoded;
  req.authToken = token;
  req.isAdmin = true;
  next();
}

async function startServer() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  ensureSeedPdfFilesOnDisk();

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      cb(null, UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
      const { storageName } = sanitizeStorageFileName(file.originalname);
      cb(null, storageName);
    },
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'ust-lecture-platform' });
  });

  // Public deterministic seed catalog for first-run visitors before admin persists to Firestore
  app.get('/api/catalog/seed', (_req, res) => {
    res.json(getInitialCatalog());
  });

  // Real Admin-Only File Upload Endpoint
  app.post('/api/files/upload', requireAdminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const settingsDoc = await fetchFirestoreDocRest('settings', 'platform', req.authToken);
      const maxFileSizeMB = Number(settingsDoc?.maxFileSizeMB) || 25;
      const allowZipUploads = settingsDoc?.allowZipUploads !== false;

      const upload = multer({
        storage,
        limits: {
          fileSize: maxFileSizeMB * 1024 * 1024,
        },
        fileFilter: (_req, file, cb) => {
          const ext = path.extname(file.originalname).toLowerCase().replace(/^\./, '');
          if (!SUPPORTED_FILE_EXTENSIONS.includes(ext as (typeof SUPPORTED_FILE_EXTENSIONS)[number])) {
            return cb(new Error(`صيغة الملف (.${ext}) غير مدعومة.`));
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

        const ext = path.extname(req.file.originalname).toLowerCase().replace(/^\./, '');
        const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

        return res.json({
          fileName: originalName,
          originalName,
          fileExt: ext,
          mimeType: MIME_MAP[ext] || req.file.mimetype || 'application/octet-stream',
          fileSize: req.file.size,
          storageName: req.file.filename,
        });
      });
    } catch (error) {
      console.error('Upload handler failed:', error);
      res.status(500).json({ error: 'حدث خطأ أثناء معالجة رفع الملف.' });
    }
  });

  // Admin-Only Register/Sync File Metadata in Server Storage Index
  app.post('/api/files/register', requireAdminMiddleware, (req, res) => {
    const body = req.body || {};
    if (!body.id || !body.storageName) {
      return res.status(400).json({ error: 'بيانات الملف ناقصة.' });
    }
    upsertFileRegistryEntry({
      id: String(body.id),
      storageName: path.basename(String(body.storageName)),
      originalName: String(body.originalName || body.fileName || 'lecture.pdf'),
      fileName: String(body.fileName || body.originalName || 'lecture.pdf'),
      fileExt: String(body.fileExt || 'pdf'),
      mimeType: String(body.mimeType || 'application/pdf'),
      fileSize: Number(body.fileSize || 0),
      allowDownload: Boolean(body.allowDownload),
      status: body.status === 'draft' ? 'draft' : 'published',
    });
    res.json({ ok: true });
  });

  // Admin-Only Physical File Cleanup Endpoint
  app.delete('/api/files/storage/:storageName', requireAdminMiddleware, (req, res) => {
    try {
      const storageName = path.basename(req.params.storageName || '');
      const fileId = typeof req.query.fileId === 'string' ? req.query.fileId : '';
      if (!storageName || storageName.includes('..')) {
        return res.status(400).json({ error: 'اسم ملف غير صالح.' });
      }
      const targetPath = path.join(UPLOAD_DIR, storageName);
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
      if (fileId) {
        removeFileRegistryEntry(fileId);
      }
      res.json({ ok: true });
    } catch (error) {
      console.error('Delete file error:', error);
      res.status(500).json({ error: 'تعذر حذف الملف من التخزين.' });
    }
  });

  // Admin-Only Role Promotion Endpoint via Firestore REST API using admin's Bearer token
  app.post('/api/admin/users/:uid/role', requireAdminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const targetUid = String(req.params.uid || '').trim();
      const role = req.body?.role === 'admin' ? 'admin' : 'student';
      if (!targetUid || !req.authToken) {
        return res.status(400).json({ error: 'معرف المستخدم غير صالح.' });
      }
      const restBase = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;
      const userDoc = await fetchFirestoreDocRest('users', targetUid, req.authToken);
      if (!userDoc) {
        return res.status(404).json({ error: 'المستخدم غير موجود.' });
      }
      const nowIso = new Date().toISOString();
      await fetch(
        `${restBase}/users/${encodeURIComponent(targetUid)}?updateMask.fieldPaths=role&updateMask.fieldPaths=updatedAt&key=${encodeURIComponent(firebaseConfig.apiKey)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${req.authToken}`,
          },
          body: JSON.stringify({
            fields: {
              role: { stringValue: role },
              updatedAt: { timestampValue: nowIso },
            },
          }),
        }
      );

      if (role === 'admin') {
        await fetch(
          `${restBase}/admins/${encodeURIComponent(targetUid)}?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${req.authToken}`,
            },
            body: JSON.stringify({
              fields: {
                uid: { stringValue: targetUid },
                email: { stringValue: String(userDoc.email || '') },
                addedAt: { timestampValue: nowIso },
                addedBy: { stringValue: req.authUser?.uid || 'admin' },
              },
            }),
          }
        );
      } else {
        await fetch(
          `${restBase}/admins/${encodeURIComponent(targetUid)}?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
          {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${req.authToken}`,
            },
          }
        );
      }
      res.json({ ok: true, uid: targetUid, role });
    } catch (error) {
      console.error('Update user role error:', error);
      res.status(500).json({ error: 'تعذر تحديث صلاحية المستخدم.' });
    }
  });

  async function resolveLectureFileMeta(fileId: string, token?: string) {
    const fsDoc = await fetchFirestoreDocRest('lectureFiles', fileId, token);
    if (fsDoc) {
      return fsDoc;
    }
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
      const fullPath = path.join(UPLOAD_DIR, storageName);
      if (!fs.existsSync(fullPath)) {
        ensureSeedPdfFilesOnDisk();
      }
      if (!fs.existsSync(fullPath)) {
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

  // Protected File Download Endpoint (enforces allowDownload toggle on server!)
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
      const fullPath = path.join(UPLOAD_DIR, storageName);
      if (!fs.existsSync(fullPath)) {
        ensureSeedPdfFilesOnDisk();
      }
      if (!fs.existsSync(fullPath)) {
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

  // Extract readable text segments from stored PDF for browsers without native PDF plugin
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
      const fullPath = path.join(UPLOAD_DIR, storageName);
      if (!fs.existsSync(fullPath)) {
        ensureSeedPdfFilesOnDisk();
      }
      if (!fs.existsSync(fullPath)) {
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
