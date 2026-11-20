import {
  AcademicYear,
  ALL_PERMISSIONS,
  BreadcrumbSegment,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_SPECIALIZATION_ADMIN_PERMISSIONS,
  DEFAULT_STORAGE_THRESHOLDS,
  LectureCategory,
  LectureFile,
  LectureFileLink,
  LECTURE_CATEGORY_LABELS,
  PermissionKey,
  ProgramCourseLink,
  PublishStatus,
  SearchFilterState,
  Semester,
  Specialization,
  StorageAlertThresholds,
  Subject,
  SUPER_ADMIN_ONLY_PERMISSIONS,
  SUPPORTED_FILE_EXTENSIONS,
  UserProfile,
  UserRole,
} from '../types/academic.ts';

export function sortByOrder<T extends { sortOrder: number; name?: string; title?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder;
    }
    const labelA = a.name || a.title || '';
    const labelB = b.name || b.title || '';
    return labelA.localeCompare(labelB, 'ar');
  });
}

export function getPublishedSpecializations(specializations: Specialization[]): Specialization[] {
  return sortByOrder(specializations.filter((s) => s.status === 'published'));
}

export function getYearsForSpecialization(
  years: AcademicYear[],
  specializationId: string,
  includeDrafts = false
): AcademicYear[] {
  return sortByOrder(
    years.filter(
      (y) =>
        y.specializationId === specializationId &&
        (includeDrafts || y.status === 'published')
    )
  );
}

export function getSemestersForYear(
  semesters: Semester[],
  specializationId: string,
  academicYearId: string,
  includeDrafts = false
): Semester[] {
  return sortByOrder(
    semesters.filter(
      (s) =>
        s.specializationId === specializationId &&
        s.academicYearId === academicYearId &&
        (includeDrafts || s.status === 'published')
    )
  );
}

export interface CoursePlacement {
  linkId?: string;
  isCanonical: boolean;
  specializationId: string;
  academicYearId: string;
  semesterId: string;
  status: PublishStatus;
  sortOrder: number;
}

export function getEffectiveCoursePlacements(
  course: Subject,
  programCourses: ProgramCourseLink[] = [],
  includeDrafts = true
): CoursePlacement[] {
  const byKey = new Map<string, CoursePlacement>();
  const canonicalKey = `${course.specializationId}::${course.academicYearId}::${course.semesterId}`;

  if (includeDrafts || course.status === 'published') {
    byKey.set(canonicalKey, {
      isCanonical: true,
      specializationId: course.specializationId,
      academicYearId: course.academicYearId,
      semesterId: course.semesterId,
      status: course.status,
      sortOrder: course.sortOrder,
    });
  }

  for (const link of programCourses) {
    if (link.courseId !== course.id) continue;
    if (!includeDrafts && link.status !== 'published') continue;
    const key = `${link.specializationId}::${link.academicYearId}::${link.semesterId}`;
    const existing = byKey.get(key);
    byKey.set(key, {
      linkId: link.id,
      isCanonical: existing?.isCanonical || key === canonicalKey,
      specializationId: link.specializationId,
      academicYearId: link.academicYearId,
      semesterId: link.semesterId,
      status: link.status,
      sortOrder: link.sortOrder,
    });
  }

  return Array.from(byKey.values());
}

export function hasDuplicateProgramLink(
  course: Subject,
  programCourses: ProgramCourseLink[],
  specializationId: string,
  academicYearId: string,
  semesterId: string
): boolean {
  if (
    course.specializationId === specializationId &&
    course.academicYearId === academicYearId &&
    course.semesterId === semesterId
  ) {
    return true;
  }
  return programCourses.some(
    (link) =>
      link.courseId === course.id &&
      link.specializationId === specializationId &&
      link.academicYearId === academicYearId &&
      link.semesterId === semesterId
  );
}

export function findPotentialDuplicateCourseGroups(
  subjects: Subject[]
): Array<{ normalizedName: string; courses: Subject[] }> {
  const groups = new Map<string, Subject[]>();
  for (const sub of subjects) {
    const normalized = sub.name.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!normalized) continue;
    const list = groups.get(normalized) || [];
    list.push(sub);
    groups.set(normalized, list);
  }
  return Array.from(groups.entries())
    .filter(([, list]) => list.length > 1)
    .map(([normalizedName, courses]) => ({ normalizedName, courses }));
}

export function getSubjectsForSemester(
  subjects: Subject[],
  specializationId: string,
  academicYearId: string,
  semesterId: string,
  includeDrafts = false,
  programCourses: ProgramCourseLink[] = []
): Subject[] {
  const linkSortByCourseId = new Map<string, number>();
  for (const link of programCourses) {
    if (
      link.specializationId === specializationId &&
      link.academicYearId === academicYearId &&
      link.semesterId === semesterId &&
      (includeDrafts || link.status === 'published')
    ) {
      linkSortByCourseId.set(link.courseId, link.sortOrder);
    }
  }

  const matched = subjects.filter((sub) => {
    if (!includeDrafts && sub.status !== 'published') return false;
    const isCanonicalPlacement =
      sub.specializationId === specializationId &&
      sub.academicYearId === academicYearId &&
      sub.semesterId === semesterId;
    return isCanonicalPlacement || linkSortByCourseId.has(sub.id);
  });

  return [...matched].sort((a, b) => {
    const orderA = linkSortByCourseId.get(a.id) ?? a.sortOrder;
    const orderB = linkSortByCourseId.get(b.id) ?? b.sortOrder;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name, 'ar');
  });
}

export function getFilesForSubject(
  files: LectureFile[],
  specializationId: string,
  academicYearId: string,
  semesterId: string,
  subjectId: string,
  includeDrafts = false,
  lectureFileLinks: LectureFileLink[] = []
): LectureFile[] {
  const fileIdsWithExplicitLinks = new Set(lectureFileLinks.map((l) => l.lectureFileId));
  const linkSortByFileId = new Map<string, number>();

  for (const link of lectureFileLinks) {
    if (
      link.specializationId === specializationId &&
      link.academicYearId === academicYearId &&
      link.semesterId === semesterId &&
      link.subjectId === subjectId &&
      (includeDrafts || link.status === 'published')
    ) {
      const prev = linkSortByFileId.get(link.lectureFileId);
      if (prev === undefined || link.sortOrder < prev) {
        linkSortByFileId.set(link.lectureFileId, link.sortOrder);
      }
    }
  }

  return sortByOrder(
    files
      .filter((f) => {
        if (f.lifecycleStatus === 'trashed') return false;
        if (!includeDrafts && f.status !== 'published') return false;
        if (fileIdsWithExplicitLinks.has(f.id)) {
          return linkSortByFileId.has(f.id);
        }
        return f.specializationId !== 'central_unlinked' && f.subjectId === subjectId;
      })
      .map((f) =>
        linkSortByFileId.has(f.id)
          ? { ...f, sortOrder: linkSortByFileId.get(f.id) ?? f.sortOrder }
          : f
      )
  );
}

export function countFilesForSubject(
  files: LectureFile[],
  subjectId: string,
  includeDrafts = false,
  lectureFileLinks: LectureFileLink[] = [],
  placement?: { specializationId: string; academicYearId: string; semesterId: string }
): number {
  if (placement) {
    return getFilesForSubject(
      files,
      placement.specializationId,
      placement.academicYearId,
      placement.semesterId,
      subjectId,
      includeDrafts,
      lectureFileLinks
    ).length;
  }

  const fileIdsWithExplicitLinks = new Set(lectureFileLinks.map((l) => l.lectureFileId));
  const linkedFileIds = new Set(
    lectureFileLinks
      .filter((l) => l.subjectId === subjectId && (includeDrafts || l.status === 'published'))
      .map((l) => l.lectureFileId)
  );

  return files.filter((f) => {
    if (f.lifecycleStatus === 'trashed') return false;
    if (!includeDrafts && f.status !== 'published') return false;
    if (fileIdsWithExplicitLinks.has(f.id)) {
      return linkedFileIds.has(f.id);
    }
    return f.specializationId !== 'central_unlinked' && f.subjectId === subjectId;
  }).length;
}

export function buildAcademicBreadcrumb(params: {
  specialization?: Specialization | null;
  year?: AcademicYear | null;
  semester?: Semester | null;
  subject?: Subject | null;
  inLecturesSection?: boolean;
}): BreadcrumbSegment[] {
  const segments: BreadcrumbSegment[] = [{ label: 'الرئيسية', step: 'home' }];
  if (params.inLecturesSection || params.specialization) {
    segments.push({ label: 'المحاضرات', step: 'specializations' });
  }
  if (params.specialization) {
    segments.push({ label: params.specialization.name, step: 'years' });
  }
  if (params.year) {
    segments.push({ label: params.year.name, step: 'semesters' });
  }
  if (params.semester) {
    segments.push({ label: params.semester.name, step: 'subjects' });
  }
  if (params.subject) {
    segments.push({ label: params.subject.name, step: 'files' });
  }
  return segments;
}

export function formatFileSizeArabic(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 بايت';
  const units = ['بايت', 'كيلوبايت', 'ميجابايت', 'جيجابايت'];
  let value = bytes;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx += 1;
  }
  const formatted = unitIdx === 0 ? Math.round(value).toString() : value.toFixed(1);
  return `${formatted} ${units[unitIdx]}`;
}

export function getCategoryLabel(category: LectureCategory): string {
  return LECTURE_CATEGORY_LABELS[category] || 'ملفات إضافية';
}

export interface GoogleDriveUrlParseResult {
  valid: boolean;
  normalizedUrl: string;
  driveFileId?: string;
  kind?: 'file' | 'document' | 'presentation' | 'spreadsheet' | 'form' | 'folder' | 'drive';
  inferredExt: string;
  inferredMimeType: string;
  embedUrl: string;
  downloadUrl: string;
  error?: string;
}

const DRIVE_ALLOWED_HOSTS = new Set(['drive.google.com', 'docs.google.com']);
const DRIVE_ID_REGEX = /^[a-zA-Z0-9_-]{8,180}$/;

export function isGoogleDriveFile(file?: Partial<LectureFile> | null): boolean {
  if (!file) return false;
  return file.sourceType === 'google_drive' || (typeof file.externalUrl === 'string' && file.externalUrl.startsWith('https://'));
}

export function validateAndParseGoogleDriveUrl(rawUrl: string): GoogleDriveUrlParseResult {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return {
      valid: false,
      normalizedUrl: '',
      inferredExt: 'pdf',
      inferredMimeType: 'application/pdf',
      embedUrl: '',
      downloadUrl: '',
      error: 'يرجى إدخال رابط Google Drive أو Google Docs.',
    };
  }
  if (trimmed.length > 1000) {
    return {
      valid: false,
      normalizedUrl: trimmed,
      inferredExt: 'pdf',
      inferredMimeType: 'application/pdf',
      embedUrl: '',
      downloadUrl: '',
      error: 'الرابط أطول من الحد المسموح (1000 حرف).',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      normalizedUrl: trimmed,
      inferredExt: 'pdf',
      inferredMimeType: 'application/pdf',
      embedUrl: '',
      downloadUrl: '',
      error: 'صيغة الرابط غير صالحة. يجب أن يبدأ بـ https://drive.google.com أو https://docs.google.com.',
    };
  }

  if (parsed.protocol !== 'https:' || !DRIVE_ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    return {
      valid: false,
      normalizedUrl: trimmed,
      inferredExt: 'pdf',
      inferredMimeType: 'application/pdf',
      embedUrl: '',
      downloadUrl: '',
      error: 'يجب أن يكون الرابط رسمياً من drive.google.com أو docs.google.com عبر HTTPS.',
    };
  }

  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname;

  let kind: GoogleDriveUrlParseResult['kind'] = 'drive';
  let inferredExt = 'pdf';
  let inferredMimeType = 'application/pdf';
  let driveFileId: string | undefined;

  if (host === 'docs.google.com') {
    if (pathname.includes('/document/')) {
      kind = 'document';
      inferredExt = 'gdoc';
      inferredMimeType = 'application/vnd.google-apps.document';
    } else if (pathname.includes('/presentation/')) {
      kind = 'presentation';
      inferredExt = 'gslides';
      inferredMimeType = 'application/vnd.google-apps.presentation';
    } else if (pathname.includes('/spreadsheets/')) {
      kind = 'spreadsheet';
      inferredExt = 'gsheet';
      inferredMimeType = 'application/vnd.google-apps.spreadsheet';
    } else if (pathname.includes('/forms/')) {
      kind = 'form';
      inferredExt = 'gform';
      inferredMimeType = 'application/vnd.google-apps.form';
    }
  } else if (pathname.includes('/folders/')) {
    kind = 'folder';
    inferredExt = 'gdrive';
    inferredMimeType = 'application/vnd.google-apps.folder';
  } else {
    kind = 'file';
    inferredExt = 'gdrive';
    inferredMimeType = 'application/octet-stream';
  }

  // Extract ID from /d/<ID>/ or /folders/<ID> or ?id=<ID>
  const pathMatch =
    pathname.match(/\/(?:d|folders)\/([a-zA-Z0-9_-]+)/) ||
    pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  const queryId = parsed.searchParams.get('id');
  const candidateId = pathMatch?.[1] || (queryId ? queryId.trim() : '');

  if (candidateId && DRIVE_ID_REGEX.test(candidateId)) {
    driveFileId = candidateId;
  }

  let embedUrl = trimmed;
  let downloadUrl = trimmed;

  if (driveFileId) {
    if (kind === 'document') {
      embedUrl = `https://docs.google.com/document/d/${driveFileId}/preview`;
      downloadUrl = `https://docs.google.com/document/d/${driveFileId}/export?format=pdf`;
    } else if (kind === 'presentation') {
      embedUrl = `https://docs.google.com/presentation/d/${driveFileId}/preview`;
      downloadUrl = `https://docs.google.com/presentation/d/${driveFileId}/export/pdf`;
    } else if (kind === 'spreadsheet') {
      embedUrl = `https://docs.google.com/spreadsheets/d/${driveFileId}/preview`;
      downloadUrl = `https://docs.google.com/spreadsheets/d/${driveFileId}/export?format=pdf`;
    } else if (kind === 'form') {
      embedUrl = `https://docs.google.com/forms/d/${driveFileId}/viewform?embedded=true`;
      downloadUrl = trimmed;
    } else if (kind === 'folder') {
      embedUrl = `https://drive.google.com/embeddedfolderview?id=${driveFileId}#list`;
      downloadUrl = trimmed;
    } else {
      embedUrl = `https://drive.google.com/file/d/${driveFileId}/preview`;
      downloadUrl = `https://drive.google.com/uc?export=download&id=${driveFileId}`;
    }
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString(),
    driveFileId,
    kind,
    inferredExt,
    inferredMimeType,
    embedUrl,
    downloadUrl,
  };
}

export function getGoogleDriveEmbedUrl(file: LectureFile): string {
  if (file.externalUrl) {
    const parsed = validateAndParseGoogleDriveUrl(file.externalUrl);
    if (parsed.valid && parsed.embedUrl) {
      return parsed.embedUrl;
    }
    return file.externalUrl;
  }
  if (file.driveFileId && DRIVE_ID_REGEX.test(file.driveFileId)) {
    return `https://drive.google.com/file/d/${file.driveFileId}/preview`;
  }
  return '';
}

export function getGoogleDriveDownloadUrl(file: LectureFile): string {
  if (file.externalUrl) {
    const parsed = validateAndParseGoogleDriveUrl(file.externalUrl);
    if (parsed.valid && parsed.downloadUrl) {
      return parsed.downloadUrl;
    }
    return file.externalUrl;
  }
  if (file.driveFileId && DRIVE_ID_REGEX.test(file.driveFileId)) {
    return `https://drive.google.com/uc?export=download&id=${file.driveFileId}`;
  }
  return '';
}

export function canPreviewInApp(
  fileExt: string,
  mimeType?: string,
  file?: Partial<LectureFile> | null
): boolean {
  if (isGoogleDriveFile(file)) return true;
  const ext = fileExt.toLowerCase().replace(/^\./, '');
  if (ext === 'pdf' || mimeType === 'application/pdf') return true;
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return true;
  if (['gdoc', 'gslides', 'gsheet', 'gform', 'gdrive'].includes(ext)) return true;
  return false;
}

export function validateUploadFile(params: {
  fileName: string;
  fileSizeBytes: number;
  maxFileSizeMB: number;
  allowZipUploads: boolean;
  allowedExtensions?: string[];
}): { valid: boolean; error?: string; extension?: string } {
  const parts = params.fileName.trim().split('.');
  if (parts.length < 2) {
    return { valid: false, error: 'اسم الملف لا يحتوي على امتداد صالح.' };
  }
  const ext = parts[parts.length - 1].toLowerCase();
  if (!SUPPORTED_FILE_EXTENSIONS.includes(ext as (typeof SUPPORTED_FILE_EXTENSIONS)[number])) {
    return { valid: false, error: `صيغة الملف (.${ext}) غير مدعومة.` };
  }
  if (params.allowedExtensions && params.allowedExtensions.length > 0 && !params.allowedExtensions.includes(ext)) {
    return { valid: false, error: `صيغة الملف (.${ext}) معطّلة حالياً من إعدادات التخزين.` };
  }
  if (ext === 'zip' && !params.allowZipUploads) {
    return { valid: false, error: 'رفع ملفات ZIP معطّل حالياً من إعدادات المنصة.' };
  }
  const maxBytes = params.maxFileSizeMB * 1024 * 1024;
  if (params.fileSizeBytes <= 0) {
    return { valid: false, error: 'الملف المحدد فارغ.' };
  }
  if (params.fileSizeBytes > maxBytes) {
    return {
      valid: false,
      error: `حجم الملف يتجاوز الحد الأقصى المسموح (${params.maxFileSizeMB} ميجابايت).`,
    };
  }
  return { valid: true, extension: ext };
}

// --- RBAC & Super Admin Protection Helpers ---

const SUPER_ADMIN_ONLY_SET = new Set<PermissionKey>(SUPER_ADMIN_ONLY_PERMISSIONS);

export function resolveEffectivePermissions(user: UserProfile | null): PermissionKey[] {
  if (!user || user.status === 'suspended') return [];
  if (user.role === 'super_admin') return [...ALL_PERMISSIONS];
  if (user.role === 'student') return [];
  const raw =
    Array.isArray(user.permissions) && user.permissions.length > 0
      ? user.permissions
      : DEFAULT_ROLE_PERMISSIONS[user.role] || [];
  // Strictly strip upload & Super-Admin-only permissions for any non-Super-Admin
  const sanitized = raw.filter((perm) => !SUPER_ADMIN_ONLY_SET.has(perm));
  if (user.role === 'admin' && sanitized.length === 0) {
    return [...DEFAULT_SPECIALIZATION_ADMIN_PERMISSIONS];
  }
  return sanitized;
}

export function hasPermission(user: UserProfile | null, permission: PermissionKey): boolean {
  if (!user || user.status === 'suspended') return false;
  if (user.role === 'super_admin') return true;
  if (user.role === 'student') return false;
  if (SUPER_ADMIN_ONLY_SET.has(permission)) return false;
  return resolveEffectivePermissions(user).includes(permission);
}

export function isStaffRole(role: UserRole | undefined | null): boolean {
  return role === 'super_admin' || role === 'admin' || role === 'moderator';
}

export function canAccessAdminDashboard(user: UserProfile | null, isVerifiedStaff: boolean): boolean {
  if (!user) return false;
  if (user.status === 'suspended') return false;
  return isStaffRole(user.role) || (isVerifiedStaff && user.role !== 'student');
}

export function canAssignRoleChange(params: {
  actor: UserProfile | null;
  target: UserProfile;
  nextRole: UserRole;
  nextPermissions?: PermissionKey[];
}): { allowed: boolean; reason?: string } {
  const { actor, target, nextRole, nextPermissions = [] } = params;
  if (!actor || actor.status === 'suspended') {
    return { allowed: false, reason: 'حسابك غير مخول لإجراء تعديلات على الصلاحيات.' };
  }
  if (target.role === 'super_admin') {
    return { allowed: false, reason: 'لا يمكن تعديل أو سحب صلاحيات المدير الرئيسي / مالك المنصة.' };
  }
  if (nextRole === 'super_admin') {
    return { allowed: false, reason: 'لا يمكن ترقية أي حساب إلى دور المدير الرئيسي عبر إدارة المستخدمين.' };
  }
  if (actor.role !== 'super_admin') {
    return { allowed: false, reason: 'إدارة وتعيين المشرفين والأدوار حصرية للمدير الرئيسي (Super Admin) فقط.' };
  }
  if (nextPermissions.some((p) => SUPER_ADMIN_ONLY_SET.has(p))) {
    return {
      allowed: false,
      reason: 'لا يمكن منح صلاحية رفع الملفات أو الصلاحيات السيادية لأي مستخدم غير المدير الرئيسي.',
    };
  }
  return { allowed: true };
}

export function canDownloadFile(file: LectureFile, isStaff: boolean): boolean {
  if (isStaff) return true;
  return file.status === 'published' && file.allowDownload === true;
}

// --- Storage Quota & Analytics ---

export type StorageAlertLevel = 'normal' | 'info' | 'warning' | 'critical' | 'blocked';

export interface StorageQuotaEvaluation {
  usedBytes: number;
  quotaBytes: number;
  remainingBytes: number;
  usedPct: number;
  alertLevel: StorageAlertLevel;
  canUpload: boolean;
  message?: string;
}

export function evaluateStorageQuota(params: {
  usedBytes: number;
  incomingBytes?: number;
  quotaMB: number;
  thresholds?: StorageAlertThresholds;
}): StorageQuotaEvaluation {
  const safeQuotaMB = Math.max(1, Number(params.quotaMB) || 1024);
  const quotaBytes = safeQuotaMB * 1024 * 1024;
  const usedBytes = Math.max(0, Number(params.usedBytes) || 0);
  const incomingBytes = Math.max(0, Number(params.incomingBytes) || 0);
  const thresholds = params.thresholds || DEFAULT_STORAGE_THRESHOLDS;

  const remainingBytes = Math.max(0, quotaBytes - usedBytes);
  const usedPct = Math.min(100, Math.round((usedBytes / quotaBytes) * 1000) / 10);
  const projectedPct = ((usedBytes + incomingBytes) / quotaBytes) * 100;

  let alertLevel: StorageAlertLevel = 'normal';
  if (usedPct >= thresholds.blockPct || usedBytes >= quotaBytes) {
    alertLevel = 'blocked';
  } else if (usedPct >= thresholds.criticalPct) {
    alertLevel = 'critical';
  } else if (usedPct >= thresholds.warningPct) {
    alertLevel = 'warning';
  } else if (usedPct >= thresholds.infoPct) {
    alertLevel = 'info';
  }

  const exceedsIncoming = usedBytes + incomingBytes > quotaBytes || usedPct >= thresholds.blockPct;
  if (exceedsIncoming && (incomingBytes > 0 || alertLevel === 'blocked' || projectedPct >= thresholds.blockPct)) {
    return {
      usedBytes,
      quotaBytes,
      remainingBytes,
      usedPct,
      alertLevel: 'blocked',
      canUpload: false,
      message: 'عذراً، مساحة التخزين المتاحة غير كافية. يرجى مراجعة مسؤول المنصة.',
    };
  }

  return {
    usedBytes,
    quotaBytes,
    remainingBytes,
    usedPct,
    alertLevel,
    canUpload: true,
  };
}

export interface StorageAnalyticsSummary {
  totalFiles: number;
  totalBytes: number;
  byFormat: {
    pdf: { count: number; bytes: number };
    powerpoint: { count: number; bytes: number };
    word: { count: number; bytes: number };
    other: { count: number; bytes: number };
  };
  bySpecialization: Array<{ id: string; name: string; count: number; bytes: number }>;
  byAcademicYear: Array<{ id: string; name: string; specName: string; count: number; bytes: number }>;
  bySubject: Array<{ id: string; name: string; count: number; bytes: number }>;
  byUploader: Array<{ uid: string; email: string; count: number; bytes: number }>;
  largeFiles: LectureFile[];
  duplicateGroups: Array<{ signature: string; files: LectureFile[]; wastedBytes: number }>;
}

export function computeStorageAnalytics(params: {
  files: LectureFile[];
  specializations: Specialization[];
  academicYears: AcademicYear[];
  subjects: Subject[];
}): StorageAnalyticsSummary {
  const { files, specializations, academicYears, subjects } = params;
  const specMap = new Map(specializations.map((s) => [s.id, s.name]));
  const yearMap = new Map(academicYears.map((y) => [y.id, y]));
  const subMap = new Map(subjects.map((s) => [s.id, s.name]));

  const byFormat = {
    pdf: { count: 0, bytes: 0 },
    powerpoint: { count: 0, bytes: 0 },
    word: { count: 0, bytes: 0 },
    other: { count: 0, bytes: 0 },
  };

  const specTotals = new Map<string, { id: string; name: string; count: number; bytes: number }>();
  const yearTotals = new Map<string, { id: string; name: string; specName: string; count: number; bytes: number }>();
  const subTotals = new Map<string, { id: string; name: string; count: number; bytes: number }>();
  const uploaderTotals = new Map<string, { uid: string; email: string; count: number; bytes: number }>();
  const dupBuckets = new Map<string, LectureFile[]>();

  let totalBytes = 0;

  for (const f of files) {
    const isDrive = isGoogleDriveFile(f);
    const size = isDrive ? 0 : Number(f.fileSize) || 0;
    totalBytes += size;
    const ext = (f.fileExt || '').toLowerCase();

    if (ext === 'pdf') {
      byFormat.pdf.count += 1;
      byFormat.pdf.bytes += size;
    } else if (ext === 'ppt' || ext === 'pptx' || ext === 'gslides') {
      byFormat.powerpoint.count += 1;
      byFormat.powerpoint.bytes += size;
    } else if (ext === 'doc' || ext === 'docx' || ext === 'gdoc') {
      byFormat.word.count += 1;
      byFormat.word.bytes += size;
    } else {
      byFormat.other.count += 1;
      byFormat.other.bytes += size;
    }

    const specName = specMap.get(f.specializationId) || 'غير مصنف';
    const specAgg = specTotals.get(f.specializationId) || { id: f.specializationId, name: specName, count: 0, bytes: 0 };
    specAgg.count += 1;
    specAgg.bytes += size;
    specTotals.set(f.specializationId, specAgg);

    const yearObj = yearMap.get(f.academicYearId);
    const yearAgg = yearTotals.get(f.academicYearId) || {
      id: f.academicYearId,
      name: yearObj?.name || 'سنة دراسية',
      specName,
      count: 0,
      bytes: 0,
    };
    yearAgg.count += 1;
    yearAgg.bytes += size;
    yearTotals.set(f.academicYearId, yearAgg);

    const subName = subMap.get(f.subjectId) || 'مادة دراسية';
    const subAgg = subTotals.get(f.subjectId) || { id: f.subjectId, name: subName, count: 0, bytes: 0 };
    subAgg.count += 1;
    subAgg.bytes += size;
    subTotals.set(f.subjectId, subAgg);

    const uploaderKey = f.uploadedBy || 'system';
    const uploaderAgg = uploaderTotals.get(uploaderKey) || {
      uid: uploaderKey,
      email: f.uploadedByEmail || uploaderKey,
      count: 0,
      bytes: 0,
    };
    uploaderAgg.count += 1;
    uploaderAgg.bytes += size;
    uploaderTotals.set(uploaderKey, uploaderAgg);

    if (!isDrive) {
      const dupSig = f.sha256 ? `sha256:${f.sha256}` : `name:${f.originalName.toLowerCase()}:${size}`;
      const bucket = dupBuckets.get(dupSig) || [];
      bucket.push(f);
      dupBuckets.set(dupSig, bucket);
    }
  }

  const duplicateGroups = Array.from(dupBuckets.entries())
    .filter(([, group]) => group.length > 1)
    .map(([signature, group]) => ({
      signature,
      files: group,
      wastedBytes: group.slice(1).reduce((sum, item) => sum + (Number(item.fileSize) || 0), 0),
    }));

  return {
    totalFiles: files.length,
    totalBytes,
    byFormat,
    bySpecialization: Array.from(specTotals.values()).sort((a, b) => b.bytes - a.bytes),
    byAcademicYear: Array.from(yearTotals.values()).sort((a, b) => b.bytes - a.bytes),
    bySubject: Array.from(subTotals.values()).sort((a, b) => b.bytes - a.bytes),
    byUploader: Array.from(uploaderTotals.values()).sort((a, b) => b.bytes - a.bytes),
    largeFiles: files
      .filter((f) => !isGoogleDriveFile(f))
      .sort((a, b) => (b.fileSize || 0) - (a.fileSize || 0))
      .slice(0, 8),
    duplicateGroups,
  };
}

export interface SearchResultBundle {
  specializations: Specialization[];
  subjects: Subject[];
  files: LectureFile[];
}

export function searchLecturesAndSubjects(
  data: {
    specializations: Specialization[];
    subjects: Subject[];
    files: LectureFile[];
    programCourses?: ProgramCourseLink[];
    lectureFileLinks?: LectureFileLink[];
  },
  filters: SearchFilterState,
  includeDrafts = false
): SearchResultBundle {
  const normalizedQuery = filters.query.trim().toLowerCase();
  const programCourses = data.programCourses || [];
  const lectureFileLinks = data.lectureFileLinks || [];
  const fileIdsWithExplicitLinks = new Set(lectureFileLinks.map((l) => l.lectureFileId));

  const publishedSpecIds = new Set(
    data.specializations
      .filter((s) => includeDrafts || s.status === 'published')
      .map((s) => s.id)
  );

  const matchedSpecializations = sortByOrder(
    data.specializations.filter((spec) => {
      if (!includeDrafts && spec.status !== 'published') return false;
      if (filters.specializationId && spec.id !== filters.specializationId) return false;
      if (!normalizedQuery) return true;
      return (
        spec.name.toLowerCase().includes(normalizedQuery) ||
        (spec.description || '').toLowerCase().includes(normalizedQuery)
      );
    })
  );

  const courseMatchesContextFilters = (sub: Subject) => {
    const placements = getEffectiveCoursePlacements(sub, programCourses, includeDrafts);
    const hasPublishedPlacement = placements.some(
      (p) => includeDrafts || publishedSpecIds.has(p.specializationId)
    );
    if (!includeDrafts && (sub.status !== 'published' || !hasPublishedPlacement)) {
      return false;
    }
    return placements.some((p) => {
      if (!includeDrafts && !publishedSpecIds.has(p.specializationId)) return false;
      if (filters.specializationId && p.specializationId !== filters.specializationId) return false;
      if (filters.academicYearId && p.academicYearId !== filters.academicYearId) return false;
      if (filters.semesterId && p.semesterId !== filters.semesterId) return false;
      return true;
    });
  };

  const matchedSubjects = sortByOrder(
    data.subjects.filter((sub) => {
      if (!courseMatchesContextFilters(sub)) return false;
      if (filters.subjectId && sub.id !== filters.subjectId) return false;
      if (!normalizedQuery) return true;
      return (
        sub.name.toLowerCase().includes(normalizedQuery) ||
        (sub.code || '').toLowerCase().includes(normalizedQuery) ||
        (sub.description || '').toLowerCase().includes(normalizedQuery)
      );
    })
  );

  const contextMatchedCourseIds = new Set(
    data.subjects.filter(courseMatchesContextFilters).map((s) => s.id)
  );

  const hasHierarchyFilter = Boolean(
    filters.specializationId || filters.academicYearId || filters.semesterId || filters.subjectId
  );

  const matchedFiles = sortByOrder(
    data.files.filter((file) => {
      if (file.lifecycleStatus === 'trashed') return false;
      if (!includeDrafts && file.status !== 'published') {
        return false;
      }

      if (fileIdsWithExplicitLinks.has(file.id)) {
        const linksForFile = lectureFileLinks.filter(
          (l) => l.lectureFileId === file.id && (includeDrafts || l.status === 'published')
        );
        const matchesLink = linksForFile.some((l) => {
          if (!includeDrafts && !publishedSpecIds.has(l.specializationId)) return false;
          if (filters.specializationId && l.specializationId !== filters.specializationId) return false;
          if (filters.academicYearId && l.academicYearId !== filters.academicYearId) return false;
          if (filters.semesterId && l.semesterId !== filters.semesterId) return false;
          if (filters.subjectId && l.subjectId !== filters.subjectId) return false;
          return true;
        });
        if (!matchesLink) return false;
      } else {
        if (file.specializationId === 'central_unlinked') return false;
        if (hasHierarchyFilter) {
          if (filters.specializationId || filters.academicYearId || filters.semesterId) {
            if (!contextMatchedCourseIds.has(file.subjectId)) {
              return false;
            }
          }
          if (filters.subjectId && file.subjectId !== filters.subjectId) return false;
        } else if (
          !includeDrafts &&
          !publishedSpecIds.has(file.specializationId) &&
          !contextMatchedCourseIds.has(file.subjectId)
        ) {
          return false;
        }
      }

      if (filters.category !== 'all' && file.category !== filters.category) return false;
      if (!normalizedQuery) return true;
      return (
        file.title.toLowerCase().includes(normalizedQuery) ||
        file.originalName.toLowerCase().includes(normalizedQuery) ||
        (file.description || '').toLowerCase().includes(normalizedQuery)
      );
    })
  );

  return {
    specializations: matchedSpecializations,
    subjects: matchedSubjects,
    files: matchedFiles,
  };
}

export function generateSafeId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2, 8);
  const timePart = Date.now().toString(36);
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'item';
  return `${cleanPrefix}_${timePart}_${randomPart}`;
}

export function computeNextSortOrder(items: Array<{ sortOrder: number }>): number {
  if (items.length === 0) return 1;
  return Math.max(...items.map((item) => item.sortOrder || 0)) + 1;
}
