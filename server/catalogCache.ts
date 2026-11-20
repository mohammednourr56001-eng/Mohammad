import crypto from 'crypto';
import type {
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
} from '../src/types/academic.ts';

export interface PublishedCatalogSnapshot {
  source: 'firestore_live' | 'seed_fallback';
  generatedAt: string;
  specializations: Specialization[];
  academicYears: AcademicYear[];
  semesters: Semester[];
  subjects: Subject[];
  programCourses: ProgramCourseLink[];
  lectureFileLinks: LectureFileLink[];
  lectureFiles: LectureFile[];
  announcements: Announcement[];
  notifications: NotificationItem[];
  settings: Partial<PlatformSettings>;
}

/**
 * Single-flight request coalescer (stampede / thundering-herd protection).
 * When 500 concurrent requests miss cache simultaneously, only 1 upstream
 * read executes and all 500 callers share the resolved promise.
 */
export class SingleFlightCoordinator {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  public activeDeduplications = 0;

  public async run<T>(
    key: string,
    loader: () => Promise<T>
  ): Promise<{ value: T; coalesced: boolean }> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) {
      this.activeDeduplications += 1;
      const value = await existing;
      return { value, coalesced: true };
    }

    const promise = (async () => {
      try {
        return await loader();
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    const value = await promise;
    return { value, coalesced: false };
  }

  public getInFlightCount(): number {
    return this.inFlight.size;
  }
}

export function computeWeakEtag(payload: unknown): string {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const digest = crypto.createHash('sha256').update(serialized).digest('base64url').slice(0, 20);
  return `W/"${digest}"`;
}

export function isEtagMatch(ifNoneMatchHeader: string | string[] | undefined, etag: string): boolean {
  if (!ifNoneMatchHeader) return false;
  const raw = Array.isArray(ifNoneMatchHeader) ? ifNoneMatchHeader.join(',') : ifNoneMatchHeader;
  return raw
    .split(',')
    .map((part) => part.trim())
    .some((candidate) => candidate === etag || candidate === '*');
}

function sortBySortOrder<T extends { sortOrder?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
}

function isPublishedActive<T extends { status?: string; lifecycleStatus?: string }>(item: T): boolean {
  return item?.status === 'published' && item?.lifecycleStatus !== 'trashed';
}

export function sanitizePublicFileRecord(file: LectureFile): LectureFile {
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
    uploadedBy: 'public',
  };
}

export function sanitizePublicSettings(
  settingsDoc: Record<string, unknown> | null | undefined,
  defaults: {
    allowedExtensions: string[];
    alertThresholds: typeof DEFAULT_STORAGE_THRESHOLDS;
  }
): Partial<PlatformSettings> {
  return {
    maxFileSizeMB: Number(settingsDoc?.maxFileSizeMB) || 25,
    allowZipUploads: settingsDoc?.allowZipUploads !== false,
    platformTitle:
      typeof settingsDoc?.platformTitle === 'string' && settingsDoc.platformTitle.trim()
        ? settingsDoc.platformTitle.trim()
        : 'منصة UST للمحاضرات',
    storageQuotaMB: Number(settingsDoc?.storageQuotaMB) || 1024,
    allowedExtensions:
      Array.isArray(settingsDoc?.allowedExtensions) && settingsDoc.allowedExtensions.length > 0
        ? settingsDoc.allowedExtensions.map((x) => String(x))
        : ([...defaults.allowedExtensions] as typeof SUPPORTED_FILE_EXTENSIONS[number][]),
    alertThresholds:
      (settingsDoc?.alertThresholds as typeof DEFAULT_STORAGE_THRESHOLDS | undefined) ||
      defaults.alertThresholds,
    backupRetentionDays: Number(settingsDoc?.backupRetentionDays) || 30,
    autoBackupSchedule:
      settingsDoc?.autoBackupSchedule === 'daily' ||
      settingsDoc?.autoBackupSchedule === 'manual'
        ? settingsDoc.autoBackupSchedule
        : 'weekly',
    updatedBy: 'public',
  };
}

export function mergePublishedCatalogSnapshot(params: {
  firestore: {
    specializations: Specialization[];
    academicYears: AcademicYear[];
    semesters: Semester[];
    subjects: Subject[];
    programCourses: ProgramCourseLink[];
    lectureFileLinks: LectureFileLink[];
    lectureFiles: LectureFile[];
    announcements: Announcement[];
    notifications: NotificationItem[];
  };
  seed: {
    specializations: Specialization[];
    academicYears: AcademicYear[];
    semesters: Semester[];
    subjects: Subject[];
    programCourses?: ProgramCourseLink[];
    lectureFileLinks?: LectureFileLink[];
    lectureFiles: LectureFile[];
    announcements: Announcement[];
    notifications: NotificationItem[];
  };
  fileRegistryEntries: Array<{
    id: string;
    storageName: string;
    storagePath?: string;
    sha256?: string;
    originalName: string;
    fileName: string;
    fileExt: string;
    mimeType: string;
    fileSize: number;
    allowDownload: boolean;
    status: 'published' | 'draft';
    lifecycleStatus?: 'active' | 'trashed';
    specializationId?: string;
    academicYearId?: string;
    semesterId?: string;
    subjectId?: string;
    title?: string;
  }>;
  settings?: Partial<PlatformSettings>;
  generatedAt?: string;
}): PublishedCatalogSnapshot {
  const hasLiveCatalog = params.firestore.specializations.length > 0;
  const source: PublishedCatalogSnapshot['source'] = hasLiveCatalog
    ? 'firestore_live'
    : 'seed_fallback';

  const specs = sortBySortOrder(
    (hasLiveCatalog ? params.firestore.specializations : params.seed.specializations).filter(
      isPublishedActive
    )
  );
  const years = sortBySortOrder(
    (hasLiveCatalog ? params.firestore.academicYears : params.seed.academicYears).filter(
      isPublishedActive
    )
  );
  const sems = sortBySortOrder(
    (hasLiveCatalog ? params.firestore.semesters : params.seed.semesters).filter(
      isPublishedActive
    )
  );
  const subs = sortBySortOrder(
    (hasLiveCatalog ? params.firestore.subjects : params.seed.subjects).filter(isPublishedActive)
  );
  const progCourses = sortBySortOrder(
    (hasLiveCatalog
      ? params.firestore.programCourses
      : params.seed.programCourses || []
    ).filter(isPublishedActive)
  );
  const fileLinks = sortBySortOrder(
    (hasLiveCatalog
      ? params.firestore.lectureFileLinks
      : params.seed.lectureFileLinks || []
    ).filter(isPublishedActive)
  );

  const baseFiles = hasLiveCatalog ? params.firestore.lectureFiles : params.seed.lectureFiles;
  const filesMap = new Map<string, LectureFile>();
  for (const f of baseFiles) {
    if (isPublishedActive(f)) {
      filesMap.set(f.id, sanitizePublicFileRecord(f));
    }
  }
  for (const r of params.fileRegistryEntries) {
    if (r.status === 'published' && r.lifecycleStatus !== 'trashed' && !filesMap.has(r.id)) {
      filesMap.set(
        r.id,
        sanitizePublicFileRecord({
          id: r.id,
          specializationId: r.specializationId || '',
          academicYearId: r.academicYearId || '',
          semesterId: r.semesterId || '',
          subjectId: r.subjectId || '',
          title: r.title || r.originalName,
          description: '',
          category: 'lectures_pdf',
          lectureNumber: '',
          version: '',
          fileName: r.fileName,
          originalName: r.originalName,
          fileExt: r.fileExt,
          mimeType: r.mimeType,
          fileSize: r.fileSize,
          storageName: r.storageName,
          storagePath: r.storagePath,
          sha256: r.sha256,
          allowDownload: r.allowDownload,
          status: 'published',
          lifecycleStatus: 'active',
          sortOrder: 99,
          uploadedBy: 'public',
        })
      );
    }
  }

  const anns = (
    params.firestore.announcements.length > 0
      ? params.firestore.announcements
      : hasLiveCatalog
        ? []
        : params.seed.announcements
  ).filter(isPublishedActive);

  const notifs = (
    params.firestore.notifications.length > 0
      ? params.firestore.notifications
      : hasLiveCatalog
        ? []
        : params.seed.notifications
  ).filter(isPublishedActive);

  return {
    source,
    generatedAt: params.generatedAt || new Date().toISOString(),
    specializations: specs,
    academicYears: years,
    semesters: sems,
    subjects: subs,
    programCourses: progCourses,
    lectureFileLinks: fileLinks,
    lectureFiles: sortBySortOrder(Array.from(filesMap.values())),
    announcements: anns,
    notifications: notifs,
    settings: params.settings || {},
  };
}
