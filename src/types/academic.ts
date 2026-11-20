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
  'spec.dashboard.view',
  'spec.structure.view',
  'spec.lectures.metadata.view',
  'spec.shared_courses.view',
  'spec.info.manage',
  'spec.stats.view',
  'spec.audit.view',
] as const;

export type PermissionKey = (typeof ALL_PERMISSIONS)[number];

export const DEFAULT_SPECIALIZATION_ADMIN_PERMISSIONS: readonly PermissionKey[] = [
  'spec.dashboard.view',
  'spec.structure.view',
  'spec.lectures.metadata.view',
  'spec.shared_courses.view',
];

export const ALLOWED_SCOPED_ADMIN_PERMISSIONS: readonly PermissionKey[] = [
  'spec.dashboard.view',
  'spec.structure.view',
  'spec.lectures.metadata.view',
  'spec.shared_courses.view',
  'academic_years.manage',
  'semesters.manage',
  'subjects.create',
  'subjects.edit',
  'spec.info.manage',
  'announcements.manage',
  'spec.stats.view',
  'spec.audit.view',
];

export const SUPER_ADMIN_ONLY_PERMISSIONS: readonly PermissionKey[] = [
  'users.view',
  'users.manage',
  'roles.assign',
  'specializations.create',
  'specializations.edit',
  'specializations.delete',
  'subjects.delete',
  'lectures.upload',
  'lectures.edit',
  'lectures.publish',
  'lectures.delete',
  'storage.view',
  'storage.manage',
  'settings.manage',
  'audit_logs.view',
];

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  'users.view': 'عرض المستخدمين المسجلين',
  'users.manage': 'إدارة وتعليق حسابات المستخدمين',
  'roles.assign': 'تعيين الأدوار والصلاحيات الإدارية',
  'specializations.create': 'إضافة تخصصات جديدة',
  'specializations.edit': 'تعديل جميع التخصصات',
  'specializations.delete': 'حذف التخصصات',
  'academic_years.manage': 'إدارة السنوات الدراسية داخل التخصص',
  'semesters.manage': 'إدارة الفصول الدراسية داخل التخصص',
  'subjects.create': 'إضافة مواد دراسية داخل التخصص',
  'subjects.edit': 'تعديل بيانات المواد الدراسية داخل التخصص',
  'subjects.delete': 'حذف المواد الدراسية',
  'lectures.upload': 'رفع ملفات المحاضرات (حصري للـ Super Admin)',
  'lectures.edit': 'تعديل واستبدال الملفات (حصري للـ Super Admin)',
  'lectures.publish': 'نشر وإخفاء المحاضرات (حصري للـ Super Admin)',
  'lectures.delete': 'حذف ملفات المحاضرات (حصري للـ Super Admin)',
  'storage.view': 'عرض إحصائيات مساحة التخزين',
  'storage.manage': 'إدارة سعة وحدود التخزين',
  'announcements.manage': 'إدارة إعلانات التخصص',
  'settings.manage': 'تعديل إعدادات المنصة والنسخ الاحتياطي',
  'audit_logs.view': 'عرض سجل النشاط الشامل للمنصة',
  'spec.dashboard.view': 'عرض لوحة تحكم التخصص المسند',
  'spec.structure.view': 'عرض الهيكلة الأكاديمية للتخصص (السنوات/الفصول/المواد)',
  'spec.lectures.metadata.view': 'عرض بيانات المحاضرات للتخصص (للقراءة فقط)',
  'spec.shared_courses.view': 'عرض المواد المشتركة المرتبطة بالتخصص',
  'spec.info.manage': 'تحديث وصف ومعلومات التخصص المسند',
  'spec.stats.view': 'عرض إحصائيات الطلاب الإجمالية للتخصص',
  'spec.audit.view': 'عرض سجل النشاط الخاص بالتخصص المسند',
};

export interface PermissionGroup {
  id: string;
  label: string;
  permissions: PermissionKey[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: 'scoped_defaults',
    label: 'صلاحيات العرض الافتراضية للتخصص',
    permissions: [
      'spec.dashboard.view',
      'spec.structure.view',
      'spec.lectures.metadata.view',
      'spec.shared_courses.view',
    ],
  },
  {
    id: 'scoped_optional',
    label: 'صلاحيات الإدارة الاختيارية داخل التخصص',
    permissions: [
      'academic_years.manage',
      'semesters.manage',
      'subjects.create',
      'subjects.edit',
      'spec.info.manage',
      'announcements.manage',
      'spec.stats.view',
      'spec.audit.view',
    ],
  },
  {
    id: 'academic',
    label: 'الهيكلة السيادية (Super Admin فقط)',
    permissions: [
      'specializations.create',
      'specializations.edit',
      'specializations.delete',
      'subjects.delete',
    ],
  },
  {
    id: 'lectures',
    label: 'رفع وإدارة المحاضرات (حصري للـ Super Admin)',
    permissions: [
      'lectures.upload',
      'lectures.edit',
      'lectures.publish',
      'lectures.delete',
    ],
  },
  {
    id: 'users',
    label: 'المستخدمون والصلاحيات (Super Admin فقط)',
    permissions: ['users.view', 'users.manage', 'roles.assign'],
  },
  {
    id: 'storage_system',
    label: 'التخزين السحابي والإعدادات (Super Admin فقط)',
    permissions: [
      'storage.view',
      'storage.manage',
      'settings.manage',
      'audit_logs.view',
    ],
  },
];

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, PermissionKey[]> = {
  super_admin: [...ALL_PERMISSIONS],
  admin: [...DEFAULT_SPECIALIZATION_ADMIN_PERMISSIONS],
  moderator: [],
  student: [],
};

export const ROLE_LABELS_AR: Record<UserRole, string> = {
  super_admin: 'المدير الرئيسي / مالك المنصة',
  admin: 'مسؤول تخصص',
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
  assignedSpecializationId?: string;
  assignmentId?: string;
  scopeVersion?: number;
  lastActivityAt?: string;
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
  assignedSpecializationId?: string;
  assignmentId?: string;
  scopeVersion?: number;
  lastActivityAt?: string;
  assignedProfileName?: string;
  inviteId?: string;
  addedAt?: unknown;
  addedBy?: string;
  updatedAt?: unknown;
  updatedBy?: string;
}

export interface AdminAssignment {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: 'admin';
  specializationId: string;
  specializationName?: string;
  status: AccountStatus;
  permissions: PermissionKey[];
  scopeVersion: number;
  assignedBy: string;
  assignedByEmail: string;
  assignedAt: string;
  lastActivityAt?: string;
  updatedAt: string;
  updatedBy?: string;
  notes?: string;
}

export interface AdminPermissionRecord {
  id: string;
  assignmentId: string;
  uid: string;
  specializationId: string;
  permissionKey: PermissionKey;
  granted: boolean;
  grantedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminInvitation {
  id: string;
  email: string;
  role: 'admin' | 'moderator';
  permissions: PermissionKey[];
  assignedSpecializationId?: string;
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
  code?: string;
  curriculumVersion?: string;
  academicContext?: string;
  description?: string;
  iconKey: string;
  status: PublishStatus;
  sortOrder: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ProgramCourseLink {
  id: string;
  courseId: string;
  specializationId: string;
  academicYearId: string;
  semesterId: string;
  status: PublishStatus;
  sortOrder: number;
  createdBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type LectureSourceType = 'upload' | 'google_drive';
export type FileLifecycleStatus = 'active' | 'trashed' | 'needs_review';

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
  sourceType?: LectureSourceType;
  externalUrl?: string;
  driveFileId?: string;
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
  lifecycleStatus?: FileLifecycleStatus;
  deletedAt?: string;
  deletedBy?: string;
  sortOrder: number;
  uploadedBy: string;
  uploadedByEmail?: string;
  uploadedByName?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LectureFileLink {
  id: string;
  lectureFileId: string;
  specializationId: string;
  academicYearId: string;
  semesterId: string;
  subjectId: string;
  status: PublishStatus;
  sortOrder: number;
  createdBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface FileDestinationInput {
  specializationId: string;
  academicYearId: string;
  semesterId: string;
  subjectId: string;
  status?: PublishStatus;
}

export interface DuplicateMatchInfo {
  matchType: 'sha256_exact' | 'legacy_name_size';
  file: LectureFile;
  destinationsCount: number;
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
  specializationId?: string;
  targetUid?: string;
  targetEmail?: string;
  oldValue?: string;
  newValue?: string;
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
  integritySha256?: string;
  verifiedAt?: string;
  verifiedStatus?: 'verified' | 'failed';
  verifiedNotes?: string;
  verifiedBy?: string;
}

export type SecurityControlStatus =
  | 'verified'
  | 'partial'
  | 'not_configured'
  | 'not_verified'
  | 'unknown';

export interface SecurityControlItem {
  id: string;
  category: 'auth' | 'rbac' | 'files' | 'storage' | 'database' | 'ai' | 'backups' | 'api';
  title: string;
  status: SecurityControlStatus;
  detail: string;
  limitationNote?: string;
}

export interface SecurityAlertEvent {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'info';
  code: string;
  title: string;
  detail: string;
  count: number;
  lastSeenAt: string;
}

export interface SecurityCenterSnapshot {
  capturedAt: string;
  freeTierMode: boolean;
  overallPostureNote: string;
  controls: SecurityControlItem[];
  alerts: SecurityAlertEvent[];
  authStats: {
    totalRegisteredUsers: number;
    superAdmins: number;
    scopedAdminsActive: number;
    scopedAdminsSuspended: number;
    moderators: number;
    revokedSessionUsers: number;
  };
  fileStats: {
    maxFileSizeMB: number;
    allowZipUploads: boolean;
    allowedExtensions: string[];
    magicByteValidationEnabled: boolean;
    signedUrlTtlSeconds: number;
    r2Configured: boolean;
    malwareScannerAvailable: boolean;
    rejectedUploadsCount: number;
  };
  aiStats: {
    geminiKeyConfigured: boolean;
    serverSideOnly: boolean;
    promptFirewallEnabled: boolean;
    dailyUserLimit: number;
    dailyGlobalLimit: number;
    todayRequests: number;
    blockedPromptInjections: number;
    failedJobs: number;
  };
  backupStats: {
    totalBackups: number;
    lastBackupAt: string | null;
    lastVerifiedBackupAt: string | null;
    lastVerifiedStatus: 'verified' | 'failed' | 'never_tested';
    retentionDays: number;
    autoSchedule: string;
    freeTierLimitation: string;
  };
  recentSecurityEvents: ActivityLog[];
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

// --- High-Performance Examination System ---
export type ExamDifficulty = 'easy' | 'medium' | 'hard';
export type ExamQuestionType = 'mcq' | 'true_false';

export interface ExamQuestion {
  id: string;
  type: ExamQuestionType;
  prompt: string;
  options: string[];
  correctIndex?: number;
  explanation?: string;
}

export interface ExamRecord {
  id: string;
  specializationId: string;
  academicYearId: string;
  semesterId: string;
  subjectId: string;
  subjectName?: string;
  sourceFileId?: string;
  title: string;
  description?: string;
  difficulty: ExamDifficulty;
  durationMinutes: number;
  questionCount: number;
  questions: ExamQuestion[];
  source: 'curated' | 'ai_generated';
  status: PublishStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExamAttempt {
  id: string;
  examId: string;
  examTitle: string;
  subjectId: string;
  userId: string;
  userEmail?: string;
  idempotencyKey: string;
  answers: Record<string, number>;
  score: number;
  totalQuestions: number;
  percentage: number;
  durationSeconds: number;
  submittedAt: string;
  feedback?: Array<{
    questionId: string;
    selectedIndex: number | null;
    correctIndex: number;
    isCorrect: boolean;
    explanation?: string;
  }>;
}

// --- Dedicated AI Background Queue ---
export type AiJobType = 'exam_generation' | 'pdf_summary' | 'explanation' | 'ocr_extract';
export type AiJobStatus = 'waiting' | 'processing' | 'completed' | 'failed';

export interface AiJobRecord {
  id: string;
  type: AiJobType;
  status: AiJobStatus;
  priority: 'normal' | 'high';
  requestedBy: string;
  requestedByEmail: string;
  specializationId: string;
  academicYearId: string;
  semesterId: string;
  subjectId: string;
  subjectName: string;
  sourceFileId?: string;
  topic: string;
  difficulty: ExamDifficulty;
  questionCount: number;
  attempts: number;
  maxRetries: number;
  cacheHit: boolean;
  resultExamId?: string;
  resultSummary?: string;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

// --- Enterprise Observability & Monitoring Telemetry ---
export interface TelemetryBucket {
  minuteIso: string;
  label: string;
  requests: number;
  errors: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
}

export interface SystemAlertItem {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  metric: string;
  message: string;
  currentValue: string;
  threshold: string;
}

export interface ObservabilitySnapshot {
  capturedAt: string;
  instance: {
    instanceId: string;
    hostname: string;
    pid: number;
    nodeVersion: string;
    uptimeSeconds: number;
    draining: boolean;
    environment: string;
  };
  systemStatus: {
    overall: 'healthy' | 'degraded' | 'critical';
    appServer: 'healthy' | 'draining';
    database: { status: 'healthy' | 'degraded'; engine: string; latencyMs: number };
    storage: { status: 'healthy' | 'warning' | 'full'; usedBytes: number; quotaBytes: number; usedPct: number };
    cdn: { status: 'configured' | 'edge_ready'; signedUrlsEnabled: boolean };
    cache: {
      mode: 'redis' | 'in_memory_lru';
      connected: boolean;
      hits: number;
      misses: number;
      hitRatioPct: number;
      keysCount: number;
      evictions: number;
    };
    backgroundQueue: {
      waiting: number;
      processing: number;
      completed: number;
      failed: number;
      maxConcurrent: number;
    };
    aiService: {
      status: 'ready' | 'unconfigured' | 'saturated';
      model: string;
      totalGenerated: number;
      cacheSavedCalls: number;
    };
  };
  liveTraffic: {
    activeUsers5m: number;
    activeSessions: number;
    requestsPerSecond: number;
    concurrentConnections: number;
    totalRequests: number;
    loginSyncs: number;
    fileDownloads: number;
    examSubmissions: number;
    rateLimitedRequests: number;
  };
  performance: {
    avgResponseMs: number;
    p50ResponseMs: number;
    p95ResponseMs: number;
    p99ResponseMs: number;
    dbProbeLatencyMs: number;
    cacheHitRatioPct: number;
    errorRatePct: number;
    failedRequests: number;
    sampleCount: number;
  };
  infrastructure: {
    cpuPercent: number;
    loadAvg1m: number;
    memoryRssMB: number;
    heapUsedMB: number;
    heapTotalMB: number;
    osTotalMemMB: number;
    osFreeMemMB: number;
    serverInstancesConfigured: number;
    networkBytesSent: number;
  };
  history: TelemetryBucket[];
  alerts: SystemAlertItem[];
}

