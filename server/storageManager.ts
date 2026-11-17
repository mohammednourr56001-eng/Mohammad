import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { UPLOAD_DIR } from './seedPlatform.ts';

export const UST_STORAGE_ROOT = path.resolve(process.cwd(), 'uploads', 'ust-storage');
export const SPECIALIZATIONS_STORAGE_DIR = path.join(UST_STORAGE_ROOT, 'specializations');
export const TMP_STORAGE_DIR = path.join(UST_STORAGE_ROOT, 'tmp');
export const BACKUPS_ROOT = path.join(UST_STORAGE_ROOT, 'backups');
export const DB_BACKUPS_DIR = path.join(BACKUPS_ROOT, 'db');
export const FILE_BACKUPS_DIR = path.join(BACKUPS_ROOT, 'files');
export const INDEX_DIR = path.join(UST_STORAGE_ROOT, 'index');

export function ensureStorageDirectories(): void {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(SPECIALIZATIONS_STORAGE_DIR, { recursive: true });
  fs.mkdirSync(TMP_STORAGE_DIR, { recursive: true });
  fs.mkdirSync(DB_BACKUPS_DIR, { recursive: true });
  fs.mkdirSync(FILE_BACKUPS_DIR, { recursive: true });
  fs.mkdirSync(INDEX_DIR, { recursive: true });
}

export function sanitizePathSegment(value: string | undefined, fallback = 'general'): string {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
  return cleaned.slice(0, 64) || fallback;
}

export function buildHierarchicalStorageLocation(params: {
  specializationId?: string;
  academicYearId?: string;
  semesterId?: string;
  subjectId?: string;
  storageName: string;
}): {
  dirPath: string;
  fullPath: string;
  storagePath: string;
} {
  const spec = sanitizePathSegment(params.specializationId, 'unassigned');
  const year = sanitizePathSegment(params.academicYearId, 'year');
  const sem = sanitizePathSegment(params.semesterId, 'semester');
  const sub = sanitizePathSegment(params.subjectId, 'subject');
  const safeName = path.basename(params.storageName);

  const relDir = path.join('specializations', spec, year, sem, sub);
  const dirPath = path.join(UST_STORAGE_ROOT, relDir);
  const fullPath = path.join(dirPath, safeName);
  const storagePath = `${relDir.split(path.sep).join('/')}/${safeName}`;
  return { dirPath, fullPath, storagePath };
}

function findFileRecursively(rootDir: string, targetBasename: string): string | null {
  if (!fs.existsSync(rootDir)) return null;
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursively(candidate, targetBasename);
      if (found) return found;
    } else if (entry.isFile() && entry.name === targetBasename) {
      return candidate;
    }
  }
  return null;
}

export function resolvePhysicalFilePath(storageName: string, storagePath?: string): string | null {
  const safeName = path.basename(String(storageName || ''));
  if (!safeName || safeName === '.' || safeName === '..') return null;

  if (storagePath && typeof storagePath === 'string' && !storagePath.includes('..')) {
    const candidate = path.resolve(UST_STORAGE_ROOT, storagePath);
    if (candidate.startsWith(UST_STORAGE_ROOT) && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const foundInHierarchy = findFileRecursively(SPECIALIZATIONS_STORAGE_DIR, safeName);
  if (foundInHierarchy) return foundInHierarchy;

  const legacyPath = path.join(UPLOAD_DIR, safeName);
  if (fs.existsSync(legacyPath)) return legacyPath;

  return null;
}

export function computeFileSha256(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

function sumDirectoryBytes(dirPath: string): { totalBytes: number; fileCount: number } {
  if (!fs.existsSync(dirPath)) return { totalBytes: 0, fileCount: 0 };
  let totalBytes = 0;
  let fileCount = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const sub = sumDirectoryBytes(full);
      totalBytes += sub.totalBytes;
      fileCount += sub.fileCount;
    } else if (entry.isFile()) {
      totalBytes += fs.statSync(full).size;
      fileCount += 1;
    }
  }
  return { totalBytes, fileCount };
}

export function computeDiskStorageUsage(): {
  lecturesBytes: number;
  lecturesFileCount: number;
  backupsBytes: number;
} {
  ensureStorageDirectories();
  const legacyStats = sumDirectoryBytes(UPLOAD_DIR);
  const hierarchicalStats = sumDirectoryBytes(SPECIALIZATIONS_STORAGE_DIR);
  const backupStats = sumDirectoryBytes(BACKUPS_ROOT);

  return {
    lecturesBytes: legacyStats.totalBytes + hierarchicalStats.totalBytes,
    lecturesFileCount: legacyStats.fileCount + hierarchicalStats.fileCount,
    backupsBytes: backupStats.totalBytes,
  };
}

export function listAllStoredLectureFiles(): Array<{
  storageName: string;
  storagePath: string;
  fullPath: string;
  size: number;
}> {
  ensureStorageDirectories();
  const results: Array<{
    storageName: string;
    storagePath: string;
    fullPath: string;
    size: number;
  }> = [];

  const walk = (dir: string, relBase: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile()) {
        results.push({
          storageName: entry.name,
          storagePath: rel,
          fullPath: full,
          size: fs.statSync(full).size,
        });
      }
    }
  };

  walk(SPECIALIZATIONS_STORAGE_DIR, 'specializations');
  walk(UPLOAD_DIR, 'legacy-lectures');
  return results;
}

export function writeJsonBackupFile(backupId: string, payload: unknown): {
  filePath: string;
  bytes: number;
} {
  ensureStorageDirectories();
  const filePath = path.join(DB_BACKUPS_DIR, `${sanitizePathSegment(backupId, 'db_backup')}.json`);
  const serialized = JSON.stringify(payload, null, 2);
  fs.writeFileSync(filePath, serialized, 'utf8');
  return {
    filePath,
    bytes: Buffer.byteLength(serialized, 'utf8'),
  };
}

export function createPhysicalFilesBackupSnapshot(backupId: string): {
  snapshotDir: string;
  manifestPath: string;
  totalFiles: number;
  totalBytes: number;
} {
  ensureStorageDirectories();
  const safeId = sanitizePathSegment(backupId, 'files_backup');
  const snapshotDir = path.join(FILE_BACKUPS_DIR, safeId);
  fs.mkdirSync(snapshotDir, { recursive: true });

  const files = listAllStoredLectureFiles();
  let totalBytes = 0;
  const manifest: Array<{
    storageName: string;
    sourcePath: string;
    size: number;
    sha256: string;
  }> = [];

  for (const item of files) {
    const dest = path.join(snapshotDir, item.storagePath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(item.fullPath, dest);
    totalBytes += item.size;
    manifest.push({
      storageName: item.storageName,
      sourcePath: item.storagePath,
      size: item.size,
      sha256: computeFileSha256(item.fullPath),
    });
  }

  const manifestPath = path.join(snapshotDir, 'manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        backupId: safeId,
        createdAt: new Date().toISOString(),
        totalFiles: files.length,
        totalBytes,
        files: manifest,
      },
      null,
      2
    ),
    'utf8'
  );

  return {
    snapshotDir,
    manifestPath,
    totalFiles: files.length,
    totalBytes,
  };
}
