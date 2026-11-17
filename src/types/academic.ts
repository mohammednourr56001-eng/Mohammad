export type PublishStatus = 'published' | 'draft';
export type UserRole = 'student' | 'moderator' | 'admin' | 'super_admin';
export type AccountStatus = 'active' | 'suspended';

export const ALL_PERMISSIONS = [
  'users.view',
  'users.manage',
  'roles.assign',
  'specializations.create',
  'specializations.edit',
  'specializations.delete',
  'academic_years.manage',
  'semesters.manage',
  'subjects.create',
  'subjects.edit',
  'subjects.delete',
  'lectures.upload',
  'lectures.edit',
  'lectures.publish',
  'lectures.delete',
  'storage.view',
  'storage.manage',
  'announcements.manage',
  'settings.manage',
  'audit_logs.view',
] as const;

export type PermissionKey = (typeof ALL_PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  'users.view': 'عرض المستخدمين المسجلين',
  'users.manage': 'إدارة وتعليق حسابات المستخدمين',
  'roles.assign': 'تعيين الأدوار والصلاحيات الإدارية',
  'specializations.create': 'إضافة تخصصات جديدة',
  'specializations.edit': 'تعديل التخصصات',
  'specializations.delete': 'حذف التخصصات',
  'academic_years.manage': 'إدارة السنوات الدراسية',
  'semesters.manage': 'إدارة الفصول الدراسية',
  'subjects.create': 'إضافة مواد دراسية',
  'subjects.edit': 'تعديل المواد الدراسية',
  'subjects.delete': 'حذف المواد الدراسية',
  'lectures.upload': 'رفع ملفات المحاضرات',
  'lectures.edit': 'تعديل واستبدال الملفات',
  'lectures.publish': 'نشر وإخفاء المحاضرات',
  'lectures.delete': 'حذف ملفات المحاضرات',
  'storage.view': 'عرض إحصائيات مساحة التخزين',
  'storage.manage': 'إدارة سعة وحدود التخزين',
  'announcements.manage': 'إدارة الإعلانات والإشعارات',
  'settings.manage': 'تعديل إعدادات المنصة والنسخ الاحتياطي',
  'audit_logs.view': 'عرض سجل النشاط الإداري',
};

export interface PermissionGroup {
  id: string;
  label: string;
  permissions: PermissionKey[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: 'academic',
    label: 'الهيكلة الأكاديمية',
    permissions: [
      'specializations.create',
      'specializations.edit',
      'specializations.delete',
      'academic_years.manage',
      'semesters.manage',
      'subjects.create',
      'subjects.edit',
      'subjects.delete',
    ],
  },
  {
    id: 'lectures',
    label: 'إدارة المحاضرات والملفات',
    permissions: [
      'lectures.upload',
      'lectures.edit',
      'lectures.publish',
      'lectures.delete',
    ],
  },
  {
    id: 'users',
    label: 'المستخدمون والصلاحيات',
    permissions: ['users.view', 'users.manage', 'roles.assign'],
  },
  {
    id: 'storage_system',
    label: 'التخزين السحابي والإعدادات',
    permissions: [
      'storage.view',
      'storage.manage',
      'announcements.manage',
      'settings.manage',
      'audit_logs.view',
    ],
  },
];

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, PermissionKey[]> = {
  super_admin: [...ALL_PERMISSIONS],
  admin: [
    'users.view',
    'specializations.create',
    'specializations.edit',
    'academic_years.manage',
    'semesters.manage',
    'subjects.create',
    'subjects.edit',
    'lectures.upload',
    'lectures.edit',
    'lectures.publish',
    'lectures.delete',
    'storage.view',
    'announcements.manage',
    'audit_logs.view',
  ],
  moderator: ['lectures.upload', 'lectures.edit'],
  student: [],
};

export const ROLE_LABELS_AR: Record<UserRole, string> = {
  super_admin: 'المدير الرئيسي / مالك المنصة',
  admin: 'مسؤول النظام',
  moderator: 'مشرف محتوى',
  student: 'طالب',
};

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
  googleSub?: string;
  role: UserRole;
  permissions?: PermissionKey[];
  status?: AccountStatus;
  specializationId?: string;
  academicYearId?: string;
  createdAt?: unknown;
  lastLoginAt?: unknown;
  updatedAt?: unknown;
}

export interface AdminEntry {
  uid: string;
  email: string;
  displayName?: string;
  role: 'super_admin' | 'admin' | 'moderator';
  permissions: PermissionKey[];
  status: AccountStatus;
  assignedProfileName?: string;
  inviteId?: string;
  addedAt?: unknown;
  addedBy?: string;
}

export interface AdminInvitation {
  id: string;
  email: string;
  role: 'admin' | 'moderator';
  permissions: PermissionKey[];
  profileName?: string;
  status: 'pending' | 'accepted' | 'revoked';
  invitedBy: string;
  invitedByEmail: string;
  createdAt?: unknown;
  acceptedAt?: unknown;
  acceptedByUid?: string;
}

export interface PermissionProfile {
  id: string;
  name: string;
  description?: string;
  baseRole: 'admin' | 'moderator';
  permissions: PermissionKey[];
  createdBy: string;
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
  storagePath?: string;
  sha256?: string;
  allowDownload: boolean;
  status: PublishStatus;
  sortOrder: number;
  uploadedBy: string;
  uploadedByEmail?: string;
  uploadedByName?: string;
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
  actorName?: string;
  actorRole?: UserRole;
  action: string;
  entityType: string;
  entityId: string;
  entityName: string;
  result?: 'success' | 'denied' | 'failed';
  details?: string;
  createdAt?: unknown;
}

export interface StorageAlertThresholds {
  infoPct: number;
  warningPct: number;
  criticalPct: number;
  blockPct: number;
}

export interface PlatformSettings {
  maxFileSizeMB: number;
  allowZipUploads: boolean;
  platformTitle: string;
  storageQuotaMB?: number;
  allowedExtensions?: string[];
  alertThresholds?: StorageAlertThresholds;
  backupRetentionDays?: number;
  autoBackupSchedule?: 'daily' | 'weekly' | 'manual';
  updatedBy: string;
  updatedAt?: unknown;
}

export interface BackupSnapshot {
  id: string;
  type: 'database' | 'files' | 'full';
  status: 'completed' | 'failed';
  totalRecords: number;
  totalFiles: number;
  totalBytes: number;
  createdBy: string;
  createdByEmail: string;
  notes?: string;
  createdAt: string;
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

export const DEFAULT_STORAGE_THRESHOLDS: StorageAlertThresholds = {
  infoPct: 70,
  warningPct: 85,
  criticalPct: 95,
  blockPct: 100,
};

export const VALIDATION_LIMITS = {
  NAME_MIN: 2,
  NAME_MAX: 140,
  TITLE_MAX: 200,
  DESCRIPTION_MAX: 800,
  BODY_MAX: 2000,
  ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
} as const;
