import {
  AcademicYear,
  Announcement,
  DEFAULT_STORAGE_THRESHOLDS,
  LectureFile,
  LectureFileLink,
  NotificationItem,
  PlatformSettings,
  ProgramCourseLink,
  Semester,
  Specialization,
  Subject,
  SUPPORTED_FILE_EXTENSIONS,
} from '../types/academic.ts';

export const OFFLINE_CATALOG_STORAGE_KEY = 'ust_offline_catalog_v1';
export const OFFLINE_USER_SETTINGS_STORAGE_KEY = 'ust_offline_user_settings_v1';
export const OFFLINE_CACHE_SCHEMA_VERSION = 1;
export const MAX_OFFLINE_CATALOG_ITEMS = 2500;

export interface OfflineCatalogSnapshot {
  schemaVersion: number;
  cachedAt: string;
  specializations: Specialization[];
  academicYears: AcademicYear[];
  semesters: Semester[];
  subjects: Subject[];
  programCourses: ProgramCourseLink[];
  lectureFileLinks: LectureFileLink[];
  lectureFiles: LectureFile[];
  announcements: Announcement[];
  notifications: NotificationItem[];
  settings: PlatformSettings;
}

export interface OfflineUserSettings {
  schemaVersion: number;
  uid: string;
  displayName?: string;
  specializationId?: string;
  academicYearId?: string;
  favoriteIds: string[];
  readNotificationIds: string[];
  pendingProfileSync?: boolean;
  updatedAt: string;
}

export interface OfflineCacheSummary {
  hasCatalog: boolean;
  cachedAt: string | null;
  specializationsCount: number;
  subjectsCount: number;
  lectureFilesCount: number;
  approximateBytes: number;
  hasUserSettings: boolean;
  pendingProfileSync: boolean;
}

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function resolveStorage(customStorage?: StorageLike | null): StorageLike | null {
  if (customStorage !== undefined) return customStorage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

const DEFAULT_PUBLIC_SETTINGS: PlatformSettings = {
  maxFileSizeMB: 25,
  allowZipUploads: true,
  platformTitle: 'منصة UST للمحاضرات',
  storageQuotaMB: 1024,
  allowedExtensions: [...SUPPORTED_FILE_EXTENSIONS],
  alertThresholds: DEFAULT_STORAGE_THRESHOLDS,
  backupRetentionDays: 30,
  autoBackupSchedule: 'weekly',
  updatedBy: 'system',
};

function isPublishedActive<T extends { status?: string; lifecycleStatus?: string }>(item: T): boolean {
  return item?.status === 'published' && item?.lifecycleStatus !== 'trashed';
}

function sanitizePublicSettings(settings?: Partial<PlatformSettings> | null): PlatformSettings {
  const customExts = settings?.allowedExtensions;
  return {
    maxFileSizeMB: Number(settings?.maxFileSizeMB) || DEFAULT_PUBLIC_SETTINGS.maxFileSizeMB,
    allowZipUploads: settings?.allowZipUploads !== false,
    platformTitle:
      typeof settings?.platformTitle === 'string' && settings.platformTitle.trim()
        ? settings.platformTitle.trim()
        : DEFAULT_PUBLIC_SETTINGS.platformTitle,
    storageQuotaMB: Number(settings?.storageQuotaMB) || DEFAULT_PUBLIC_SETTINGS.storageQuotaMB,
    allowedExtensions:
      Array.isArray(customExts) && customExts.length > 0
        ? [...customExts]
        : [...SUPPORTED_FILE_EXTENSIONS],
    alertThresholds: settings?.alertThresholds || DEFAULT_PUBLIC_SETTINGS.alertThresholds,
    backupRetentionDays:
      Number(settings?.backupRetentionDays) || DEFAULT_PUBLIC_SETTINGS.backupRetentionDays,
    autoBackupSchedule: settings?.autoBackupSchedule || DEFAULT_PUBLIC_SETTINGS.autoBackupSchedule,
    updatedBy: 'cached',
  };
}

function sanitizeLectureFileForCache(file: LectureFile): LectureFile {
  return {
    id: file.id,
    specializationId: file.specializationId,
    academicYearId: file.academicYearId,
    semesterId: file.semesterId,
    subjectId: file.subjectId,
    title: file.title,
    description: file.description || '',
    category: file.category,
    lectureNumber: file.lectureNumber || '',
    version: file.version || '',
    fileName: file.fileName,
    originalName: file.originalName,
    fileExt: file.fileExt,
    mimeType: file.mimeType,
    fileSize: file.fileSize,
    storageName: file.storageName,
    storagePath: file.storagePath,
    sourceType: file.sourceType,
    externalUrl: file.externalUrl,
    driveFileId: file.driveFileId,
    sha256: file.sha256,
    allowDownload: Boolean(file.allowDownload),
    status: 'published',
    lifecycleStatus: 'active',
    sortOrder: Number(file.sortOrder) || 0,
    uploadedBy: 'cached',
  };
}

export function buildSafeOfflineCatalogSnapshot(input: {
  specializations: Specialization[];
  academicYears: AcademicYear[];
  semesters: Semester[];
  subjects: Subject[];
  programCourses: ProgramCourseLink[];
  lectureFileLinks: LectureFileLink[];
  lectureFiles: LectureFile[];
  announcements: Announcement[];
  notifications: NotificationItem[];
  settings?: Partial<PlatformSettings>;
  cachedAt?: string;
}): OfflineCatalogSnapshot {
  return {
    schemaVersion: OFFLINE_CACHE_SCHEMA_VERSION,
    cachedAt: input.cachedAt || new Date().toISOString(),
    specializations: (input.specializations || []).filter(isPublishedActive).slice(0, MAX_OFFLINE_CATALOG_ITEMS),
    academicYears: (input.academicYears || []).filter(isPublishedActive).slice(0, MAX_OFFLINE_CATALOG_ITEMS),
    semesters: (input.semesters || []).filter(isPublishedActive).slice(0, MAX_OFFLINE_CATALOG_ITEMS),
    subjects: (input.subjects || []).filter(isPublishedActive).slice(0, MAX_OFFLINE_CATALOG_ITEMS),
    programCourses: (input.programCourses || []).filter(isPublishedActive).slice(0, MAX_OFFLINE_CATALOG_ITEMS),
    lectureFileLinks: (input.lectureFileLinks || []).filter(isPublishedActive).slice(0, MAX_OFFLINE_CATALOG_ITEMS),
    lectureFiles: (input.lectureFiles || [])
      .filter((f) => isPublishedActive(f) && f.specializationId !== 'central_unlinked')
      .slice(0, MAX_OFFLINE_CATALOG_ITEMS)
      .map(sanitizeLectureFileForCache),
    announcements: (input.announcements || []).filter(isPublishedActive).slice(0, 100),
    notifications: (input.notifications || []).filter(isPublishedActive).slice(0, 150),
    settings: sanitizePublicSettings(input.settings),
  };
}

export function writeOfflineCatalog(
  input: Parameters<typeof buildSafeOfflineCatalogSnapshot>[0],
  customStorage?: StorageLike | null
): OfflineCatalogSnapshot | null {
  const storage = resolveStorage(customStorage);
  if (!storage) return null;

  const snapshot = buildSafeOfflineCatalogSnapshot(input);
  if (snapshot.specializations.length === 0 && snapshot.subjects.length === 0) {
    return null;
  }

  try {
    storage.setItem(OFFLINE_CATALOG_STORAGE_KEY, JSON.stringify(snapshot));
    return snapshot;
  } catch {
    // QuotaExceededError fallback: store lighter catalog (trim descriptions and non-essential lists)
    try {
      const compact: OfflineCatalogSnapshot = {
        ...snapshot,
        announcements: snapshot.announcements.slice(0, 10),
        notifications: snapshot.notifications.slice(0, 20),
        lectureFiles: snapshot.lectureFiles.slice(0, 500).map((f) => ({
          ...f,
          description: '',
        })),
      };
      storage.setItem(OFFLINE_CATALOG_STORAGE_KEY, JSON.stringify(compact));
      return compact;
    } catch {
      return null;
    }
  }
}

export function readOfflineCatalog(customStorage?: StorageLike | null): OfflineCatalogSnapshot | null {
  const storage = resolveStorage(customStorage);
  if (!storage) return null;

  try {
    const raw = storage.getItem(OFFLINE_CATALOG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OfflineCatalogSnapshot> | null;
    if (!parsed || parsed.schemaVersion !== OFFLINE_CACHE_SCHEMA_VERSION) {
      return null;
    }
    if (!Array.isArray(parsed.specializations) || !Array.isArray(parsed.subjects)) {
      return null;
    }

    return {
      schemaVersion: OFFLINE_CACHE_SCHEMA_VERSION,
      cachedAt: typeof parsed.cachedAt === 'string' ? parsed.cachedAt : new Date(0).toISOString(),
      specializations: parsed.specializations.filter(isPublishedActive),
      academicYears: Array.isArray(parsed.academicYears) ? parsed.academicYears.filter(isPublishedActive) : [],
      semesters: Array.isArray(parsed.semesters) ? parsed.semesters.filter(isPublishedActive) : [],
      subjects: parsed.subjects.filter(isPublishedActive),
      programCourses: Array.isArray(parsed.programCourses) ? parsed.programCourses.filter(isPublishedActive) : [],
      lectureFileLinks: Array.isArray(parsed.lectureFileLinks) ? parsed.lectureFileLinks.filter(isPublishedActive) : [],
      lectureFiles: Array.isArray(parsed.lectureFiles) ? parsed.lectureFiles.filter(isPublishedActive) : [],
      announcements: Array.isArray(parsed.announcements) ? parsed.announcements.filter(isPublishedActive) : [],
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications.filter(isPublishedActive) : [],
      settings: sanitizePublicSettings(parsed.settings),
    };
  } catch {
    return null;
  }
}

export function writeOfflineUserSettings(
  settings: {
    uid: string;
    displayName?: string;
    specializationId?: string;
    academicYearId?: string;
    favoriteIds?: string[];
    readNotificationIds?: string[];
    pendingProfileSync?: boolean;
    updatedAt?: string;
  },
  customStorage?: StorageLike | null
): OfflineUserSettings | null {
  const storage = resolveStorage(customStorage);
  if (!storage || !settings.uid) return null;

  const payload: OfflineUserSettings = {
    schemaVersion: OFFLINE_CACHE_SCHEMA_VERSION,
    uid: settings.uid,
    displayName: typeof settings.displayName === 'string' ? settings.displayName.trim().slice(0, 120) : undefined,
    specializationId: settings.specializationId || undefined,
    academicYearId: settings.academicYearId || undefined,
    favoriteIds: Array.from(new Set((settings.favoriteIds || []).filter((id) => typeof id === 'string' && id.length > 0))).slice(0, 1000),
    readNotificationIds: Array.from(new Set((settings.readNotificationIds || []).filter((id) => typeof id === 'string' && id.length > 0))).slice(0, 1000),
    pendingProfileSync: Boolean(settings.pendingProfileSync),
    updatedAt: settings.updatedAt || new Date().toISOString(),
  };

  try {
    storage.setItem(OFFLINE_USER_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
    return payload;
  } catch {
    return null;
  }
}

export function readOfflineUserSettings(
  uid: string | null | undefined,
  customStorage?: StorageLike | null
): OfflineUserSettings | null {
  if (!uid) return null;
  const storage = resolveStorage(customStorage);
  if (!storage) return null;

  try {
    const raw = storage.getItem(OFFLINE_USER_SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OfflineUserSettings> | null;
    if (
      !parsed ||
      parsed.schemaVersion !== OFFLINE_CACHE_SCHEMA_VERSION ||
      parsed.uid !== uid
    ) {
      return null;
    }

    return {
      schemaVersion: OFFLINE_CACHE_SCHEMA_VERSION,
      uid: parsed.uid,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : undefined,
      specializationId: typeof parsed.specializationId === 'string' ? parsed.specializationId : undefined,
      academicYearId: typeof parsed.academicYearId === 'string' ? parsed.academicYearId : undefined,
      favoriteIds: Array.isArray(parsed.favoriteIds) ? parsed.favoriteIds.filter((x) => typeof x === 'string') : [],
      readNotificationIds: Array.isArray(parsed.readNotificationIds) ? parsed.readNotificationIds.filter((x) => typeof x === 'string') : [],
      pendingProfileSync: Boolean(parsed.pendingProfileSync),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function clearOfflineUserSettings(customStorage?: StorageLike | null): void {
  const storage = resolveStorage(customStorage);
  if (!storage) return;
  try {
    storage.removeItem(OFFLINE_USER_SETTINGS_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export function clearOfflineCatalog(customStorage?: StorageLike | null): void {
  const storage = resolveStorage(customStorage);
  if (!storage) return;
  try {
    storage.removeItem(OFFLINE_CATALOG_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export function getOfflineCacheSummary(
  uid?: string | null,
  customStorage?: StorageLike | null
): OfflineCacheSummary {
  const storage = resolveStorage(customStorage);
  const catalog = readOfflineCatalog(storage);
  const userSettings = readOfflineUserSettings(uid, storage);
  let approximateBytes = 0;

  if (storage) {
    try {
      const catRaw = storage.getItem(OFFLINE_CATALOG_STORAGE_KEY) || '';
      const userRaw = storage.getItem(OFFLINE_USER_SETTINGS_STORAGE_KEY) || '';
      approximateBytes = (catRaw.length + userRaw.length) * 2;
    } catch {
      approximateBytes = 0;
    }
  }

  return {
    hasCatalog: Boolean(catalog),
    cachedAt: catalog?.cachedAt || null,
    specializationsCount: catalog?.specializations.length || 0,
    subjectsCount: catalog?.subjects.length || 0,
    lectureFilesCount: catalog?.lectureFiles.length || 0,
    approximateBytes,
    hasUserSettings: Boolean(userSettings),
    pendingProfileSync: Boolean(userSettings?.pendingProfileSync),
  };
}
