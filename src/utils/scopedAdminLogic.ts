import {
  AcademicYear,
  ActivityLog,
  AdminAssignment,
  ALLOWED_SCOPED_ADMIN_PERMISSIONS,
  Announcement,
  DEFAULT_SPECIALIZATION_ADMIN_PERMISSIONS,
  LectureFile,
  LectureFileLink,
  PermissionKey,
  ProgramCourseLink,
  Semester,
  Specialization,
  Subject,
  SUPER_ADMIN_ONLY_PERMISSIONS,
  UserProfile,
} from '../types/academic.ts';

export const SCOPED_ADMIN_ACCESS_DENIED_AR =
  'ليس لديك صلاحية الوصول إلى هذه الصفحة. نطاق إدارتك يقتصر على التخصص المسند إليك.';

export const SUPER_ADMIN_UPLOAD_ONLY_AR =
  'صلاحية رفع المحاضرات والملفات حصرية للمدير الرئيسي (Super Admin) فقط.';

export type ScopedAdminAction =
  | 'dashboard.view'
  | 'structure.view'
  | 'lectures.metadata.view'
  | 'lectures.upload'
  | 'lectures.edit'
  | 'lectures.publish'
  | 'lectures.delete'
  | 'shared_courses.view'
  | 'shared_courses.edit_cross_spec'
  | 'academic_years.manage'
  | 'semesters.manage'
  | 'subjects.create'
  | 'subjects.edit'
  | 'subjects.delete'
  | 'spec.info.manage'
  | 'announcements.manage'
  | 'spec.stats.view'
  | 'spec.audit.view'
  | 'users.manage'
  | 'roles.assign'
  | 'settings.manage'
  | 'storage.manage';

const ALLOWED_SCOPED_SET = new Set<PermissionKey>(ALLOWED_SCOPED_ADMIN_PERMISSIONS);
const SUPER_ONLY_SET = new Set<PermissionKey>(SUPER_ADMIN_ONLY_PERMISSIONS);

export function sanitizeScopedAdminPermissions(
  requestedPermissions: readonly PermissionKey[] = []
): PermissionKey[] {
  const unique = new Set<PermissionKey>();
  for (const key of requestedPermissions) {
    if (ALLOWED_SCOPED_SET.has(key) && !SUPER_ONLY_SET.has(key)) {
      unique.add(key);
    }
  }
  return Array.from(unique);
}

export function getSafeDefaultScopedPermissions(): PermissionKey[] {
  return [...DEFAULT_SPECIALIZATION_ADMIN_PERMISSIONS];
}

export function isSuperAdminOnlyPermission(permission: PermissionKey): boolean {
  return SUPER_ONLY_SET.has(permission);
}

export function validateScopedAdminAssignmentInput(params: {
  actor: UserProfile | null;
  targetUser: UserProfile | null;
  specialization: Specialization | null;
  requestedPermissions?: readonly PermissionKey[];
}): { valid: boolean; sanitizedPermissions: PermissionKey[]; reason?: string } {
  const { actor, targetUser, specialization, requestedPermissions } = params;

  if (!actor || actor.status === 'suspended' || actor.role !== 'super_admin') {
    return {
      valid: false,
      sanitizedPermissions: [],
      reason: 'تعيين مشرفي التخصصات حصري للمدير الرئيسي (Super Admin) فقط.',
    };
  }

  if (!targetUser || !targetUser.uid || !targetUser.email) {
    return {
      valid: false,
      sanitizedPermissions: [],
      reason: 'يجب اختيار مستخدم مسجل فعلياً في المنصة قبل تعيينه كمشرف تخصص.',
    };
  }

  if (targetUser.role === 'super_admin') {
    return {
      valid: false,
      sanitizedPermissions: [],
      reason: 'لا يمكن تحويل حساب المدير الرئيسي إلى مشرف تخصص.',
    };
  }

  if (targetUser.status === 'suspended') {
    return {
      valid: false,
      sanitizedPermissions: [],
      reason: 'الحساب المختار معلق حالياً. يرجى تفعيله أولاً قبل تعيينه.',
    };
  }

  if (!specialization || !specialization.id) {
    return {
      valid: false,
      sanitizedPermissions: [],
      reason: 'يجب تحديد التخصص الجامعي المسند لهذا المشرف.',
    };
  }

  const rawPerms = requestedPermissions ?? DEFAULT_SPECIALIZATION_ADMIN_PERMISSIONS;
  const forbidden = rawPerms.filter((p) => SUPER_ONLY_SET.has(p) || !ALLOWED_SCOPED_SET.has(p));
  if (forbidden.length > 0) {
    return {
      valid: false,
      sanitizedPermissions: sanitizeScopedAdminPermissions(rawPerms),
      reason: `لا يمكن منح صلاحيات حصرية للمدير الرئيسي لمشرف التخصص: ${forbidden.join(', ')}`,
    };
  }

  const sanitized = sanitizeScopedAdminPermissions(rawPerms);
  return {
    valid: true,
    sanitizedPermissions: sanitized.length > 0 ? sanitized : [...DEFAULT_SPECIALIZATION_ADMIN_PERMISSIONS],
  };
}

export function isSpecializationInAdminScope(
  actor: Pick<UserProfile, 'role' | 'status' | 'assignedSpecializationId'> | null,
  targetSpecializationId: string | null | undefined
): boolean {
  if (!actor || actor.status === 'suspended') return false;
  if (actor.role === 'super_admin') return true;
  if (actor.role !== 'admin') return false;
  if (!actor.assignedSpecializationId || !targetSpecializationId) return false;
  return actor.assignedSpecializationId === targetSpecializationId;
}

export function canScopedAdminPerformAction(params: {
  actor: Pick<UserProfile, 'role' | 'status' | 'permissions' | 'assignedSpecializationId'> | null;
  action: ScopedAdminAction;
  targetSpecializationId?: string | null;
  subject?: Pick<Subject, 'specializationId'> | null;
  programCourses?: ProgramCourseLink[];
  subjectId?: string;
}): { allowed: boolean; reason?: string } {
  const { actor, action, targetSpecializationId, subject, programCourses = [], subjectId } = params;

  if (!actor || actor.status === 'suspended') {
    return { allowed: false, reason: 'الحساب معلق أو غير مخول.' };
  }

  if (actor.role === 'super_admin') {
    return { allowed: true };
  }

  // Strictly block upload, file modification/deletion, and system-wide sovereign actions for all non-Super-Admins
  if (
    action === 'lectures.upload' ||
    action === 'lectures.edit' ||
    action === 'lectures.publish' ||
    action === 'lectures.delete'
  ) {
    return { allowed: false, reason: SUPER_ADMIN_UPLOAD_ONLY_AR };
  }

  if (
    action === 'subjects.delete' ||
    action === 'users.manage' ||
    action === 'roles.assign' ||
    action === 'settings.manage' ||
    action === 'storage.manage' ||
    action === 'shared_courses.edit_cross_spec'
  ) {
    return { allowed: false, reason: 'هذا الإجراء حصري للمدير الرئيسي (Super Admin) فقط.' };
  }

  if (actor.role !== 'admin') {
    return { allowed: false, reason: SCOPED_ADMIN_ACCESS_DENIED_AR };
  }

  const assignedSpecId = actor.assignedSpecializationId;
  if (!assignedSpecId) {
    return { allowed: false, reason: 'حسابك غير مرتبط بتخصص جامعي محدد حالياً.' };
  }

  const effectiveTargetSpecId = targetSpecializationId || subject?.specializationId || assignedSpecId;
  if (effectiveTargetSpecId !== assignedSpecId) {
    return { allowed: false, reason: SCOPED_ADMIN_ACCESS_DENIED_AR };
  }

  // If editing an existing subject, make sure canonical specializationId matches the admin's assigned specialization.
  // Shared courses anchored in another specialization cannot be structurally altered by a different specialization admin.
  if (action === 'subjects.edit' && subject && subject.specializationId !== assignedSpecId) {
    return {
      allowed: false,
      reason: 'هذه المادة مشتركة ومرتبطة بتخصصات أخرى. تعديل المادة المشتركة أو روابطها حصري للمدير الرئيسي.',
    };
  }

  if (action === 'subjects.edit' && subjectId) {
    const hasCrossSpecLinks = programCourses.some(
      (link) => link.courseId === subjectId && link.specializationId !== assignedSpecId
    );
    if (hasCrossSpecLinks) {
      return {
        allowed: false,
        reason: 'هذه المادة مشتركة مع تخصصات أخرى، ولا يمكن تعديل بياناتها المشتركة إلا عبر المدير الرئيسي.',
      };
    }
  }

  const perms = new Set<PermissionKey>(sanitizeScopedAdminPermissions(actor.permissions || []));
  const actionToPerm: Record<string, PermissionKey> = {
    'dashboard.view': 'spec.dashboard.view',
    'structure.view': 'spec.structure.view',
    'lectures.metadata.view': 'spec.lectures.metadata.view',
    'shared_courses.view': 'spec.shared_courses.view',
    'academic_years.manage': 'academic_years.manage',
    'semesters.manage': 'semesters.manage',
    'subjects.create': 'subjects.create',
    'subjects.edit': 'subjects.edit',
    'spec.info.manage': 'spec.info.manage',
    'announcements.manage': 'announcements.manage',
    'spec.stats.view': 'spec.stats.view',
    'spec.audit.view': 'spec.audit.view',
  };

  const neededPerm = actionToPerm[action];
  if (!neededPerm || !perms.has(neededPerm)) {
    return { allowed: false, reason: 'لا تملك الصلاحية المطلوبة داخل هذا التخصص.' };
  }

  return { allowed: true };
}

export function parseAdminRequestedSpecFromUrl(pathname: string, search: string): string | null {
  const pathMatch = (pathname || '').match(/^\/admin\/specializations\/([a-zA-Z0-9_-]+)/);
  if (pathMatch && pathMatch[1]) {
    return pathMatch[1];
  }
  const params = new URLSearchParams(search || '');
  const specParam = params.get('spec') || params.get('specializationId');
  if (specParam && /^[a-zA-Z0-9_-]+$/.test(specParam)) {
    return specParam;
  }
  return null;
}

export interface SpecializationDashboardSummary {
  specialization: Specialization | null;
  years: AcademicYear[];
  semesters: Semester[];
  subjects: Subject[];
  sharedSubjects: Array<{ subject: Subject; linkedSpecIds: string[]; isCanonicalHere: boolean }>;
  lectureMetadata: LectureFile[];
  announcements: Announcement[];
  auditLogs: ActivityLog[];
  aggregateStudentCount: number | null;
  publishedLectureCount: number;
  draftLectureCount: number;
}

export function computeSpecializationDashboardSummary(params: {
  assignedSpecializationId: string;
  actorUid: string;
  canViewStats: boolean;
  canViewAudit: boolean;
  specializations: Specialization[];
  academicYears: AcademicYear[];
  semesters: Semester[];
  subjects: Subject[];
  programCourses: ProgramCourseLink[];
  lectureFiles: LectureFile[];
  lectureFileLinks: LectureFileLink[];
  announcements: Announcement[];
  activityLogs: ActivityLog[];
  usersDirectory: UserProfile[];
}): SpecializationDashboardSummary {
  const {
    assignedSpecializationId,
    actorUid,
    canViewStats,
    canViewAudit,
    specializations,
    academicYears,
    semesters,
    subjects,
    programCourses,
    lectureFiles,
    lectureFileLinks,
    announcements,
    activityLogs,
    usersDirectory,
  } = params;

  const specialization = specializations.find((s) => s.id === assignedSpecializationId) || null;
  const years = academicYears.filter((y) => y.specializationId === assignedSpecializationId);
  const specSemesters = semesters.filter((s) => s.specializationId === assignedSpecializationId);

  const linkedCourseIdsHere = new Set(
    programCourses
      .filter((link) => link.specializationId === assignedSpecializationId)
      .map((link) => link.courseId)
  );

  const specSubjects = subjects.filter(
    (sub) => sub.specializationId === assignedSpecializationId || linkedCourseIdsHere.has(sub.id)
  );

  const sharedSubjects = specSubjects
    .map((sub) => {
      const otherSpecIds = new Set<string>();
      if (sub.specializationId !== assignedSpecializationId) {
        otherSpecIds.add(sub.specializationId);
      }
      for (const link of programCourses) {
        if (link.courseId === sub.id && link.specializationId !== assignedSpecializationId) {
          otherSpecIds.add(link.specializationId);
        }
      }
      return {
        subject: sub,
        linkedSpecIds: Array.from(otherSpecIds),
        isCanonicalHere: sub.specializationId === assignedSpecializationId,
      };
    })
    .filter((entry) => entry.linkedSpecIds.length > 0);

  const linkedFileIdsHere = new Set(
    lectureFileLinks
      .filter((link) => link.specializationId === assignedSpecializationId)
      .map((link) => link.lectureFileId)
  );

  const lectureMetadata = lectureFiles.filter(
    (f) =>
      f.lifecycleStatus !== 'trashed' &&
      (f.specializationId === assignedSpecializationId || linkedFileIdsHere.has(f.id))
  );

  const publishedLectureCount = lectureMetadata.filter((f) => f.status === 'published').length;
  const draftLectureCount = lectureMetadata.filter((f) => f.status === 'draft').length;

  const specAnnouncements = announcements.filter(
    (a) => a.specializationId === assignedSpecializationId
  );

  const specAuditLogs = canViewAudit
    ? activityLogs.filter(
        (log) =>
          log.specializationId === assignedSpecializationId ||
          log.actorUid === actorUid
      )
    : [];

  const aggregateStudentCount = canViewStats
    ? usersDirectory.filter(
        (u) => u.role === 'student' && u.specializationId === assignedSpecializationId
      ).length
    : null;

  return {
    specialization,
    years,
    semesters: specSemesters,
    subjects: specSubjects,
    sharedSubjects,
    lectureMetadata,
    announcements: specAnnouncements,
    auditLogs: specAuditLogs,
    aggregateStudentCount,
    publishedLectureCount,
    draftLectureCount,
  };
}

export function buildAssignmentChangeDiffLabel(
  oldPerms: readonly PermissionKey[],
  newPerms: readonly PermissionKey[]
): { added: PermissionKey[]; removed: PermissionKey[] } {
  const oldSet = new Set(oldPerms);
  const newSet = new Set(newPerms);
  return {
    added: newPerms.filter((p) => !oldSet.has(p)),
    removed: oldPerms.filter((p) => !newSet.has(p)),
  };
}

export function isAssignmentActiveForActor(
  assignment: AdminAssignment | null | undefined,
  actorUid: string
): boolean {
  if (!assignment) return false;
  return assignment.uid === actorUid && assignment.status === 'active';
}
