export type PublishStatus = 'published' | 'draft';
export type UserRole = 'student' | 'admin';

export type LectureCategory =
  | 'lectures_pdf'
  | 'powerpoint'
  | 'word'
  | 'notes'
  | 'summaries'
  | 'books'
  | 'assignments'
  | 'past_exams'
  | 'extra';

export type AnnouncementCategory = 'general' | 'exams' | 'lectures' | 'academic';
export type AnnouncementPriority = 'normal' | 'important';
export type NotificationType = 'lecture' | 'announcement' | 'system';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: UserRole;
  specializationId?: string;
  academicYearId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Specialization {
  id: string;
  name: string;
  description?: string;
  iconKey: string;
  status: PublishStatus;
  sortOrder: number;
  createdBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AcademicYear {
  id: string;
  specializationId: string;
  name: string;
  status: PublishStatus;
  sortOrder: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Semester {
  id: string;
  specializationId: string;
  academicYearId: string;
  name: string;
  status: PublishStatus;
  sortOrder: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Subject {
  id: string;
  specializationId: string;
  academicYearId: string;
  semesterId: string;
  name: string;
  description?: string;
  iconKey: string;
  status: PublishStatus;
  sortOrder: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LectureFile {
  id: string;
  specializationId: string;
  academicYearId: string;
  semesterId: string;
  subjectId: string;
  title: string;
  description?: string;
  category: LectureCategory;
  lectureNumber?: string;
  version?: string;
  fileName: string;
  originalName: string;
  fileExt: string;
  mimeType: string;
  fileSize: number;
  storageName: string;
  allowDownload: boolean;
  status: PublishStatus;
  sortOrder: number;
  uploadedBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  category: AnnouncementCategory;
  priority: AnnouncementPriority;
  specializationId?: string;
  status: PublishStatus;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  specializationId?: string;
  subjectId?: string;
  fileId?: string;
  status: PublishStatus;
  createdAt?: unknown;
}

export interface ActivityLog {
  id: string;
  actorUid: string;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  entityName: string;
  createdAt?: unknown;
}

export interface PlatformSettings {
  maxFileSizeMB: number;
  allowZipUploads: boolean;
  platformTitle: string;
  updatedBy: string;
  updatedAt?: unknown;
}

export interface SearchFilterState {
  query: string;
  specializationId: string;
  academicYearId: string;
  semesterId: string;
  subjectId: string;
  category: LectureCategory | 'all';
}

export interface BreadcrumbSegment {
  label: string;
  step: 'home' | 'specializations' | 'years' | 'semesters' | 'subjects' | 'files';
}

export const LECTURE_CATEGORY_LABELS: Record<LectureCategory, string> = {
  lectures_pdf: 'المحاضرات PDF',
  powerpoint: 'ملفات PowerPoint',
  word: 'ملفات Word',
  notes: 'المذكرات الدراسية',
  summaries: 'الملخصات',
  books: 'الكتب والمراجع',
  assignments: 'الواجبات والتكليفات',
  past_exams: 'الاختبارات السابقة',
  extra: 'ملفات إضافية',
};

export const ANNOUNCEMENT_CATEGORY_LABELS: Record<AnnouncementCategory, string> = {
  general: 'إعلان عام',
  exams: 'جداول الاختبارات',
  lectures: 'محاضرات جديدة',
  academic: 'تحديثات أكاديمية',
};

export const SUPPORTED_FILE_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'jpg',
  'jpeg',
  'png',
  'zip',
] as const;

export const VALIDATION_LIMITS = {
  NAME_MIN: 2,
  NAME_MAX: 140,
  TITLE_MAX: 200,
  DESCRIPTION_MAX: 800,
  BODY_MAX: 2000,
  ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
} as const;
