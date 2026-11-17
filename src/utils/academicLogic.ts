import {
  AcademicYear,
  BreadcrumbSegment,
  LectureCategory,
  LectureFile,
  LECTURE_CATEGORY_LABELS,
  SearchFilterState,
  Semester,
  Specialization,
  Subject,
  SUPPORTED_FILE_EXTENSIONS,
  UserProfile,
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
}): { valid: boolean; error?: string; extension?: string } {
  const parts = params.fileName.trim().split('.');
  if (parts.length < 2) {
    return { valid: false, error: 'اسم الملف لا يحتوي على امتداد صالح.' };
  }
  const ext = parts[parts.length - 1].toLowerCase();
  if (!SUPPORTED_FILE_EXTENSIONS.includes(ext as (typeof SUPPORTED_FILE_EXTENSIONS)[number])) {
    return { valid: false, error: `صيغة الملف (.${ext}) غير مدعومة.` };
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

export function canAccessAdminDashboard(user: UserProfile | null, isVerifiedAdmin: boolean): boolean {
  if (!user) return false;
  return user.role === 'admin' || isVerifiedAdmin;
}

export function canDownloadFile(file: LectureFile, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return file.status === 'published' && file.allowDownload === true;
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
