import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAssignmentChangeDiffLabel,
  canScopedAdminPerformAction,
  computeSpecializationDashboardSummary,
  getSafeDefaultScopedPermissions,
  isAssignmentActiveForActor,
  isSpecializationInAdminScope,
  isSuperAdminOnlyPermission,
  parseAdminRequestedSpecFromUrl,
  sanitizeScopedAdminPermissions,
  SCOPED_ADMIN_ACCESS_DENIED_AR,
  SUPER_ADMIN_UPLOAD_ONLY_AR,
  validateScopedAdminAssignmentInput,
} from './scopedAdminLogic';
import {
  AcademicYear,
  ActivityLog,
  AdminAssignment,
  Announcement,
  DEFAULT_SPECIALIZATION_ADMIN_PERMISSIONS,
  LectureFile,
  LectureFileLink,
  ProgramCourseLink,
  Semester,
  Specialization,
  Subject,
  UserProfile,
} from '../types/academic';

const superAdmin: UserProfile = {
  uid: 'sa_1',
  email: 'mohammednourr56000@gmail.com',
  displayName: 'Super Admin',
  role: 'super_admin',
  status: 'active',
};

const studentBio: UserProfile = {
  uid: 'stu_bio',
  email: 'bio.student@ust.edu',
  displayName: 'طالب حيوي',
  role: 'student',
  specializationId: 'spec_bio',
  status: 'active',
};

const studentCivil: UserProfile = {
  uid: 'stu_civil',
  email: 'civil.student@ust.edu',
  displayName: 'طالب مدني',
  role: 'student',
  specializationId: 'spec_civil',
  status: 'active',
};

const bioAdmin: UserProfile = {
  uid: 'adm_bio',
  email: 'bio.admin@ust.edu',
  displayName: 'مشرف الهندسة الطبية',
  role: 'admin',
  assignedSpecializationId: 'spec_bio',
  permissions: [...DEFAULT_SPECIALIZATION_ADMIN_PERMISSIONS, 'subjects.create', 'subjects.edit'],
  status: 'active',
};

const specs: Specialization[] = [
  { id: 'spec_bio', name: 'الهندسة الطبية الحيوية', iconKey: 'stethoscope', status: 'published', sortOrder: 1 },
  { id: 'spec_civil', name: 'الهندسة المدنية', iconKey: 'building', status: 'published', sortOrder: 2 },
  { id: 'spec_telecom', name: 'هندسة الاتصالات', iconKey: 'wifi', status: 'published', sortOrder: 3 },
];

const years: AcademicYear[] = [
  { id: 'y_bio_1', specializationId: 'spec_bio', name: 'السنة الأولى', status: 'published', sortOrder: 1 },
  { id: 'y_civil_1', specializationId: 'spec_civil', name: 'السنة الأولى', status: 'published', sortOrder: 1 },
];

const semesters: Semester[] = [
  { id: 'sem_bio_1', specializationId: 'spec_bio', academicYearId: 'y_bio_1', name: 'الفصل الأول', status: 'published', sortOrder: 1 },
  { id: 'sem_civil_1', specializationId: 'spec_civil', academicYearId: 'y_civil_1', name: 'الفصل الأول', status: 'published', sortOrder: 1 },
];

const subjects: Subject[] = [
  { id: 'sub_bio_only', specializationId: 'spec_bio', academicYearId: 'y_bio_1', semesterId: 'sem_bio_1', name: 'أجهزة طبية 1', iconKey: 'cpu', status: 'published', sortOrder: 1 },
  { id: 'sub_shared_calc', specializationId: 'spec_civil', academicYearId: 'y_civil_1', semesterId: 'sem_civil_1', name: 'تفاضل وتكامل 1', code: 'MATH101', iconKey: 'calculator', status: 'published', sortOrder: 1 },
  { id: 'sub_civil_only', specializationId: 'spec_civil', academicYearId: 'y_civil_1', semesterId: 'sem_civil_1', name: 'ميكانيكا التربة', iconKey: 'layers', status: 'published', sortOrder: 2 },
];

const programCourses: ProgramCourseLink[] = [
  {
    id: 'pc_1',
    courseId: 'sub_shared_calc',
    specializationId: 'spec_bio',
    academicYearId: 'y_bio_1',
    semesterId: 'sem_bio_1',
    status: 'published',
    sortOrder: 2,
  },
];

const files: LectureFile[] = [
  {
    id: 'file_bio_1',
    specializationId: 'spec_bio',
    academicYearId: 'y_bio_1',
    semesterId: 'sem_bio_1',
    subjectId: 'sub_bio_only',
    title: 'محاضرة الأجهزة 1',
    category: 'lectures_pdf',
    fileName: 'med1.pdf',
    originalName: 'med1.pdf',
    fileExt: 'pdf',
    mimeType: 'application/pdf',
    fileSize: 1024,
    storageName: 'med1.pdf',
    allowDownload: true,
    status: 'published',
    sortOrder: 1,
    uploadedBy: 'sa_1',
  },
  {
    id: 'file_shared_calc',
    specializationId: 'spec_civil',
    academicYearId: 'y_civil_1',
    semesterId: 'sem_civil_1',
    subjectId: 'sub_shared_calc',
    title: 'محاضرة حسبان مشتركة',
    category: 'lectures_pdf',
    fileName: 'calc.pdf',
    originalName: 'calc.pdf',
    fileExt: 'pdf',
    mimeType: 'application/pdf',
    fileSize: 2048,
    storageName: 'calc.pdf',
    allowDownload: true,
    status: 'published',
    sortOrder: 1,
    uploadedBy: 'sa_1',
  },
  {
    id: 'file_civil_only',
    specializationId: 'spec_civil',
    academicYearId: 'y_civil_1',
    semesterId: 'sem_civil_1',
    subjectId: 'sub_civil_only',
    title: 'محاضرة التربة',
    category: 'lectures_pdf',
    fileName: 'soil.pdf',
    originalName: 'soil.pdf',
    fileExt: 'pdf',
    mimeType: 'application/pdf',
    fileSize: 4096,
    storageName: 'soil.pdf',
    allowDownload: true,
    status: 'published',
    sortOrder: 1,
    uploadedBy: 'sa_1',
  },
];

const fileLinks: LectureFileLink[] = [
  {
    id: 'link_shared_bio',
    lectureFileId: 'file_shared_calc',
    specializationId: 'spec_bio',
    academicYearId: 'y_bio_1',
    semesterId: 'sem_bio_1',
    subjectId: 'sub_shared_calc',
    status: 'published',
    sortOrder: 1,
  },
];

const announcements: Announcement[] = [
  { id: 'ann_bio', title: 'إعلان طبي', body: 'نص', category: 'academic', priority: 'normal', specializationId: 'spec_bio', status: 'published', createdBy: 'sa_1' },
  { id: 'ann_civil', title: 'إعلان مدني', body: 'نص', category: 'academic', priority: 'normal', specializationId: 'spec_civil', status: 'published', createdBy: 'sa_1' },
];

const logs: ActivityLog[] = [
  { id: 'log_1', actorUid: 'sa_1', actorEmail: 'sa@ust.edu', action: 'assign', entityType: 'admin_assignment', entityId: 'asg_1', entityName: 'تعيين', specializationId: 'spec_bio' },
  { id: 'log_2', actorUid: 'adm_civil', actorEmail: 'civil@ust.edu', action: 'edit', entityType: 'subject', entityId: 'sub_civil_only', entityName: 'تعديل', specializationId: 'spec_civil' },
];

test('Scenario 1, 2, 12, 13, 14: Super Admin creates scoped admin only for registered users, rejects fake users and upload perms, defaults to safe view-only', () => {
  const safeDefaults = getSafeDefaultScopedPermissions();
  assert.deepEqual(safeDefaults, [
    'spec.dashboard.view',
    'spec.structure.view',
    'spec.lectures.metadata.view',
    'spec.shared_courses.view',
  ]);
  assert.equal(safeDefaults.includes('lectures.upload'), false);
  assert.equal(safeDefaults.includes('specializations.delete'), false);

  // Reject non-Super-Admin trying to appoint an admin
  const nonSuperAttempt = validateScopedAdminAssignmentInput({
    actor: bioAdmin,
    targetUser: studentBio,
    specialization: specs[0],
  });
  assert.equal(nonSuperAttempt.valid, false);

  // Reject nonexistent / unregistered user
  const fakeUserAttempt = validateScopedAdminAssignmentInput({
    actor: superAdmin,
    targetUser: null,
    specialization: specs[0],
  });
  assert.equal(fakeUserAttempt.valid, false);

  // Reject granting lectures.upload or sovereign perms to Specialization Admin
  const withUploadAttempt = validateScopedAdminAssignmentInput({
    actor: superAdmin,
    targetUser: studentBio,
    specialization: specs[0],
    requestedPermissions: ['spec.dashboard.view', 'lectures.upload', 'roles.assign'],
  });
  assert.equal(withUploadAttempt.valid, false);
  assert.equal(withUploadAttempt.sanitizedPermissions.includes('lectures.upload'), false);
  assert.equal(withUploadAttempt.sanitizedPermissions.includes('roles.assign'), false);

  // Valid appointment defaults safely
  const validAppoint = validateScopedAdminAssignmentInput({
    actor: superAdmin,
    targetUser: studentBio,
    specialization: specs[0],
  });
  assert.equal(validAppoint.valid, true);
  assert.deepEqual(validAppoint.sanitizedPermissions, safeDefaults);
  assert.equal(isSuperAdminOnlyPermission('lectures.upload'), true);
});

test('Scenario 3, 4, 5, 6, 7: Cross-specialization navigation, direct URL/API access, and non-Super-Admin upload attempts are strictly denied', () => {
  assert.equal(isSpecializationInAdminScope(bioAdmin, 'spec_bio'), true);
  assert.equal(isSpecializationInAdminScope(bioAdmin, 'spec_civil'), false);
  assert.equal(isSpecializationInAdminScope(superAdmin, 'spec_civil'), true);

  // Direct URL parsing catches /admin/specializations/:specId and ?spec=
  assert.equal(parseAdminRequestedSpecFromUrl('/admin/specializations/spec_civil', ''), 'spec_civil');
  assert.equal(parseAdminRequestedSpecFromUrl('/admin', '?spec=spec_telecom'), 'spec_telecom');
  assert.equal(parseAdminRequestedSpecFromUrl('/admin', ''), null);

  // Cross-specialization write denied with exact Arabic message
  const crossSpecCreate = canScopedAdminPerformAction({
    actor: bioAdmin,
    action: 'subjects.create',
    targetSpecializationId: 'spec_civil',
  });
  assert.equal(crossSpecCreate.allowed, false);
  assert.equal(crossSpecCreate.reason, SCOPED_ADMIN_ACCESS_DENIED_AR);

  // Upload denied even inside own specialization (even if someone tampered with permissions array)
  const tamperedBioAdmin: UserProfile = {
    ...bioAdmin,
    permissions: [...bioAdmin.permissions!, 'lectures.upload', 'lectures.delete', 'users.manage'],
  };
  assert.deepEqual(
    sanitizeScopedAdminPermissions(tamperedBioAdmin.permissions).includes('lectures.upload'),
    false
  );
  const uploadAttempt = canScopedAdminPerformAction({
    actor: tamperedBioAdmin,
    action: 'lectures.upload',
    targetSpecializationId: 'spec_bio',
  });
  assert.equal(uploadAttempt.allowed, false);
  assert.equal(uploadAttempt.reason, SUPER_ADMIN_UPLOAD_ONLY_AR);

  const deleteFileAttempt = canScopedAdminPerformAction({
    actor: tamperedBioAdmin,
    action: 'lectures.delete',
    targetSpecializationId: 'spec_bio',
  });
  assert.equal(deleteFileAttempt.allowed, false);

  // Own specialization permitted subject create is allowed
  const ownSpecCreate = canScopedAdminPerformAction({
    actor: bioAdmin,
    action: 'subjects.create',
    targetSpecializationId: 'spec_bio',
  });
  assert.equal(ownSpecCreate.allowed, true);
});

test('Scenario 8, 9, 10, 11, 15, 16: Suspended admin, shared course cross-spec protection, dashboard isolation, and permission diff', () => {
  // Suspended admin cannot perform ANY action
  const suspended: UserProfile = { ...bioAdmin, status: 'suspended' };
  assert.equal(
    canScopedAdminPerformAction({
      actor: suspended,
      action: 'dashboard.view',
      targetSpecializationId: 'spec_bio',
    }).allowed,
    false
  );

  // Shared course anchored in spec_civil cannot be edited by spec_bio admin
  const sharedEditAttempt = canScopedAdminPerformAction({
    actor: bioAdmin,
    action: 'subjects.edit',
    targetSpecializationId: 'spec_bio',
    subject: subjects[1], // canonical specializationId is spec_civil
    programCourses,
    subjectId: 'sub_shared_calc',
  });
  assert.equal(sharedEditAttempt.allowed, false);

  // Own non-shared subject edit is allowed
  const ownEditAllowed = canScopedAdminPerformAction({
    actor: bioAdmin,
    action: 'subjects.edit',
    targetSpecializationId: 'spec_bio',
    subject: subjects[0],
    programCourses,
    subjectId: 'sub_bio_only',
  });
  assert.equal(ownEditAllowed.allowed, true);

  // Dashboard summary strictly filters out spec_civil records
  const summary = computeSpecializationDashboardSummary({
    assignedSpecializationId: 'spec_bio',
    actorUid: 'adm_bio',
    canViewStats: true,
    canViewAudit: true,
    specializations: specs,
    academicYears: years,
    semesters,
    subjects,
    programCourses,
    lectureFiles: files,
    lectureFileLinks: fileLinks,
    announcements,
    activityLogs: logs,
    usersDirectory: [studentBio, studentCivil],
  });

  assert.equal(summary.specialization?.id, 'spec_bio');
  assert.equal(summary.years.length, 1);
  assert.equal(summary.subjects.length, 2); // sub_bio_only + linked sub_shared_calc
  assert.equal(summary.subjects.some((s) => s.id === 'sub_civil_only'), false);
  assert.equal(summary.sharedSubjects.length, 1);
  assert.equal(summary.lectureMetadata.length, 2); // file_bio_1 + linked file_shared_calc
  assert.equal(summary.lectureMetadata.some((f) => f.id === 'file_civil_only'), false);
  assert.equal(summary.announcements.length, 1);
  assert.equal(summary.aggregateStudentCount, 1);
  assert.equal(summary.auditLogs.length, 1);

  const assignment: AdminAssignment = {
    id: 'asg_1',
    uid: 'adm_bio',
    email: 'bio.admin@ust.edu',
    displayName: 'مشرف الحيوي',
    role: 'admin',
    specializationId: 'spec_bio',
    status: 'active',
    permissions: ['spec.dashboard.view'],
    scopeVersion: 1,
    assignedBy: 'sa_1',
    assignedByEmail: 'mohammednourr56000@gmail.com',
    assignedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  assert.equal(isAssignmentActiveForActor(assignment, 'adm_bio'), true);
  assert.equal(isAssignmentActiveForActor({ ...assignment, status: 'suspended' }, 'adm_bio'), false);

  const diff = buildAssignmentChangeDiffLabel(
    ['spec.dashboard.view', 'subjects.create'],
    ['spec.dashboard.view', 'spec.stats.view']
  );
  assert.deepEqual(diff.added, ['spec.stats.view']);
  assert.deepEqual(diff.removed, ['subjects.create']);
});
