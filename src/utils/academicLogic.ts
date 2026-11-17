import {
  AcademicYear,
  ALL_PERMISSIONS,
  BreadcrumbSegment,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_STORAGE_THRESHOLDS,
  LectureCategory,
  LectureFile,
  LECTURE_CATEGORY_LABELS,
  PermissionKey,
  SearchFilterState,
  Semester,
  Specialization,
  StorageAlertThresholds,
  Subject,
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

export function getSubjectsForSemester(
  subjects: Subject[],
  specializationId: string,
  academicYearId: string,
  semesterId: string,
  includeDrafts = false
): Subject[] {
  return sortByOrder(
    subjects.filter(
      (sub) =>
        sub.specializationId === specializationId &&
        sub.academicYearId === academicYearId &&
        sub.semesterId === semesterId &&
        (includeDrafts || sub.status === 'published')
    )
  );
}

export function getFilesForSubject(
  files: LectureFile[],
  specializationId: string,
  academicYearId: string,
  semesterId: string,
  subjectId: string,
  includeDrafts = false
): LectureFile[] {
  return sortByOrder(
    files.filter(
      (f) =>
        f.specializationId === specializationId &&
        f.academicYearId === academicYearId &&
        f.semesterId === semesterId &&
        f.subjectId === subjectId &&
        (includeDrafts || f.status === 'published')
    )
  );
}

export function countFilesForSubject(files: LectureFile[], subjectId: string, includeDrafts = false): number {
  return files.filter((f) => f.subjectId === subjectId && (includeDrafts || f.status === 'published')).length;
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

export function canPreviewInApp(fileExt: string, mimeType?: string): boolean {
  const ext = fileExt.toLowerCase().replace(/^\./, '');
  if (ext === 'pdf' || mimeType === 'application/pdf') return true;
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return true;
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

export function resolveEffectivePermissions(user: UserProfile | null): PermissionKey[] {
  if (!user || user.status === 'suspended') return [];
  if (user.role === 'super_admin') return [...ALL_PERMISSIONS];
  if (user.role === 'student') return [];
  if (Array.isArray(user.permissions) && user.permissions.length > 0) {
    return user.permissions;
  }
  return DEFAULT_ROLE_PERMISSIONS[user.role] || [];
}

export function hasPermission(user: UserProfile | null, permission: PermissionKey): boolean {
  if (!user || user.status === 'suspended') return false;
  if (user.role === 'super_admin') return true;
  if (user.role === 'student') return false;
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
  if (actor.uid === target.uid && actor.role !== 'super_admin') {
    return { allowed: false, reason: 'لا يمكنك تعديل صلاحياتك أو ترقية نفسك ذاتياً.' };
  }
  if (actor.role === 'super_admin') {
    return { allowed: true };
  }
  if (!hasPermission(actor, 'roles.assign')) {
    return { allowed: false, reason: 'ليس لديك صلاحية تعيين الأدوار أو تعديل الصلاحيات.' };
  }
  if (nextRole === 'admin' || target.role === 'admin') {
    return { allowed: false, reason: 'تعيين أو تعديل مسؤولي النظام حصري للمدير الرئيسي فقط.' };
  }
  const privilegedKeys: PermissionKey[] = ['roles.assign', 'settings.manage', 'storage.manage'];
  if (nextPermissions.some((p) => privilegedKeys.includes(p))) {
    return { allowed: false, reason: 'منح الصلاحيات السيادية حصري للمدير الرئيسي فقط.' };
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
    const size = Number(f.fileSize) || 0;
    totalBytes += size;
    const ext = (f.fileExt || '').toLowerCase();

    if (ext === 'pdf') {
      byFormat.pdf.count += 1;
      byFormat.pdf.bytes += size;
    } else if (ext === 'ppt' || ext === 'pptx') {
      byFormat.powerpoint.count += 1;
      byFormat.powerpoint.bytes += size;
    } else if (ext === 'doc' || ext === 'docx') {
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

    const dupSig = f.sha256 ? `sha256:${f.sha256}` : `name:${f.originalName.toLowerCase()}:${size}`;
    const bucket = dupBuckets.get(dupSig) || [];
    bucket.push(f);
    dupBuckets.set(dupSig, bucket);
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
    largeFiles: [...files].sort((a, b) => (b.fileSize || 0) - (a.fileSize || 0)).slice(0, 8),
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
  },
  filters: SearchFilterState,
  includeDrafts = false
): SearchResultBundle {
  const normalizedQuery = filters.query.trim().toLowerCase();

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

  const matchedSubjects = sortByOrder(
    data.subjects.filter((sub) => {
      if (!includeDrafts && (sub.status !== 'published' || !publishedSpecIds.has(sub.specializationId))) {
        return false;
      }
      if (filters.specializationId && sub.specializationId !== filters.specializationId) return false;
      if (filters.academicYearId && sub.academicYearId !== filters.academicYearId) return false;
      if (filters.semesterId && sub.semesterId !== filters.semesterId) return false;
      if (filters.subjectId && sub.id !== filters.subjectId) return false;
      if (!normalizedQuery) return true;
      return (
        sub.name.toLowerCase().includes(normalizedQuery) ||
        (sub.description || '').toLowerCase().includes(normalizedQuery)
      );
    })
  );

  const matchedFiles = sortByOrder(
    data.files.filter((file) => {
      if (!includeDrafts && (file.status !== 'published' || !publishedSpecIds.has(file.specializationId))) {
        return false;
      }
      if (filters.specializationId && file.specializationId !== filters.specializationId) return false;
      if (filters.academicYearId && file.academicYearId !== filters.academicYearId) return false;
      if (filters.semesterId && file.semesterId !== filters.semesterId) return false;
      if (filters.subjectId && file.subjectId !== filters.subjectId) return false;
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
