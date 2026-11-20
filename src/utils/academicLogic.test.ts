import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAcademicBreadcrumb,
  canAccessAdminDashboard,
  canAssignRoleChange,
  canDownloadFile,
  canPreviewInApp,
  computeNextSortOrder,
  computeStorageAnalytics,
  evaluateStorageQuota,
  formatFileSizeArabic,
  getFilesForSubject,
  getGoogleDriveDownloadUrl,
  getGoogleDriveEmbedUrl,
  getPublishedSpecializations,
  getSemestersForYear,
  getSubjectsForSemester,
  getYearsForSpecialization,
  hasPermission,
  isGoogleDriveFile,
  searchLecturesAndSubjects,
  validateAndParseGoogleDriveUrl,
  validateUploadFile,
} from './academicLogic';
import {
  AcademicYear,
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  LectureFile,
  Semester,
  Specialization,
  Subject,
  UserProfile,
} from '../types/academic';

const specs: Specialization[] = [
  { id: 'spec_bio', name: 'الهندسة الطبية الحيوية', iconKey: 'stethoscope', status: 'published', sortOrder: 1 },
  { id: 'spec_civil', name: 'الهندسة المدنية', iconKey: 'building', status: 'published', sortOrder: 2 },
  { id: 'spec_draft', name: 'تخصص مسودة', iconKey: 'book', status: 'draft', sortOrder: 3 },
];

const years: AcademicYear[] = [
  { id: 'y1', specializationId: 'spec_bio', name: 'السنة الأولى', status: 'published', sortOrder: 1 },
  { id: 'y2', specializationId: 'spec_bio', name: 'السنة الثانية', status: 'published', sortOrder: 2 },
  { id: 'y_civil_1', specializationId: 'spec_civil', name: 'السنة الأولى', status: 'published', sortOrder: 1 },
  { id: 'y_draft', specializationId: 'spec_bio', name: 'السنة السادسة', status: 'draft', sortOrder: 6 },
];

const semesters: Semester[] = [
  { id: 'sem1', specializationId: 'spec_bio', academicYearId: 'y1', name: 'الفصل الدراسي الأول', status: 'published', sortOrder: 1 },
  { id: 'sem2', specializationId: 'spec_bio', academicYearId: 'y1', name: 'الفصل الدراسي الثاني', status: 'published', sortOrder: 2 },
];

const subjects: Subject[] = [
  { id: 'sub_phys', specializationId: 'spec_bio', academicYearId: 'y1', semesterId: 'sem1', name: 'الفيزياء', iconKey: 'atom', status: 'published', sortOrder: 1 },
  { id: 'sub_calc', specializationId: 'spec_bio', academicYearId: 'y1', semesterId: 'sem1', name: 'الحسبان', iconKey: 'calculator', status: 'published', sortOrder: 2 },
  { id: 'sub_civil_phys', specializationId: 'spec_civil', academicYearId: 'y_civil_1', semesterId: 'sem_civil_1', name: 'الفيزياء المدنية', iconKey: 'atom', status: 'published', sortOrder: 1 },
];

const files: LectureFile[] = [
  {
    id: 'f1',
    specializationId: 'spec_bio',
    academicYearId: 'y1',
    semesterId: 'sem1',
    subjectId: 'sub_phys',
    title: 'محاضرة الميكانيكا الطبية الأولى',
    category: 'lectures_pdf',
    fileName: 'lecture-1.pdf',
    originalName: 'lecture-1.pdf',
    fileExt: 'pdf',
    mimeType: 'application/pdf',
    fileSize: 2048000,
    storageName: 'seed-lecture-1.pdf',
    sha256: 'hash_abc',
    allowDownload: true,
    status: 'published',
    sortOrder: 1,
    uploadedBy: 'admin1',
    uploadedByEmail: 'admin@ust.edu',
  },
  {
    id: 'f2',
    specializationId: 'spec_bio',
    academicYearId: 'y1',
    semesterId: 'sem1',
    subjectId: 'sub_phys',
    title: 'ملف مسودة غير منشور',
    category: 'notes',
    fileName: 'draft.pdf',
    originalName: 'draft.pdf',
    fileExt: 'pdf',
    mimeType: 'application/pdf',
    fileSize: 1024,
    storageName: 'seed-draft.pdf',
    sha256: 'hash_def',
    allowDownload: false,
    status: 'draft',
    sortOrder: 2,
    uploadedBy: 'mod1',
    uploadedByEmail: 'mod@ust.edu',
  },
  {
    id: 'f3',
    specializationId: 'spec_civil',
    academicYearId: 'y_civil_1',
    semesterId: 'sem_civil_1',
    subjectId: 'sub_civil_phys',
    title: 'فيزياء مدنية',
    category: 'lectures_pdf',
    fileName: 'civil.pdf',
    originalName: 'civil.pdf',
    fileExt: 'pdf',
    mimeType: 'application/pdf',
    fileSize: 150000,
    storageName: 'seed-civil.pdf',
    sha256: 'hash_abc',
    allowDownload: false,
    status: 'published',
    sortOrder: 1,
    uploadedBy: 'admin1',
    uploadedByEmail: 'admin@ust.edu',
  },
];

test('student hierarchy only returns published items isolated to exact academic path', () => {
  const pubSpecs = getPublishedSpecializations(specs);
  assert.equal(pubSpecs.length, 2);
  assert.equal(pubSpecs[0].name, 'الهندسة الطبية الحيوية');

  const bioYears = getYearsForSpecialization(years, 'spec_bio');
  assert.equal(bioYears.length, 2);

  const y1Semesters = getSemestersForYear(semesters, 'spec_bio', 'y1');
  assert.equal(y1Semesters.length, 2);

  const sem1Subjects = getSubjectsForSemester(subjects, 'spec_bio', 'y1', 'sem1');
  assert.equal(sem1Subjects.length, 2);

  const bioPhysFiles = getFilesForSubject(files, 'spec_bio', 'y1', 'sem1', 'sub_phys');
  assert.equal(bioPhysFiles.length, 1);
  assert.equal(bioPhysFiles[0].id, 'f1');

  const civilFiles = getFilesForSubject(files, 'spec_civil', 'y_civil_1', 'sem_civil_1', 'sub_civil_phys');
  assert.equal(civilFiles.length, 1);
  assert.equal(civilFiles[0].id, 'f3');
});

test('breadcrumb builds complete RTL academic hierarchy path', () => {
  const crumbs = buildAcademicBreadcrumb({
    specialization: specs[0],
    year: years[0],
    semester: semesters[0],
    subject: subjects[0],
    inLecturesSection: true,
  });
  assert.deepEqual(
    crumbs.map((c) => c.label),
    ['الرئيسية', 'المحاضرات', 'الهندسة الطبية الحيوية', 'السنة الأولى', 'الفصل الدراسي الأول', 'الفيزياء']
  );
});

test('file upload validation enforces allowed extensions, zip toggle, and max size', () => {
  const okPdf = validateUploadFile({
    fileName: 'anatomy_ch1.pdf',
    fileSizeBytes: 5 * 1024 * 1024,
    maxFileSizeMB: 25,
    allowZipUploads: false,
    allowedExtensions: ['pdf', 'docx'],
  });
  assert.equal(okPdf.valid, true);
  assert.equal(okPdf.extension, 'pdf');

  const disabledExt = validateUploadFile({
    fileName: 'slides.pptx',
    fileSizeBytes: 1024,
    maxFileSizeMB: 25,
    allowZipUploads: true,
    allowedExtensions: ['pdf', 'docx'],
  });
  assert.equal(disabledExt.valid, false);

  const blockedZip = validateUploadFile({
    fileName: 'bundle.zip',
    fileSizeBytes: 1024,
    maxFileSizeMB: 25,
    allowZipUploads: false,
  });
  assert.equal(blockedZip.valid, false);

  const oversized = validateUploadFile({
    fileName: 'big.pptx',
    fileSizeBytes: 30 * 1024 * 1024,
    maxFileSizeMB: 25,
    allowZipUploads: true,
  });
  assert.equal(oversized.valid, false);

  const badExt = validateUploadFile({
    fileName: 'malware.exe',
    fileSizeBytes: 512,
    maxFileSizeMB: 25,
    allowZipUploads: true,
  });
  assert.equal(badExt.valid, false);
});

test('RBAC hierarchy, Super Admin protection, and Moderator restrictions work strictly', () => {
  const superAdmin: UserProfile = {
    uid: 'sa1',
    email: 'mohammednourr56000@gmail.com',
    displayName: 'مالك المنصة',
    role: 'super_admin',
    status: 'active',
  };
  const admin: UserProfile = {
    uid: 'a1',
    email: 'admin@ust.edu',
    displayName: 'مسؤول النظام',
    role: 'admin',
    permissions: DEFAULT_ROLE_PERMISSIONS.admin,
    status: 'active',
  };
  const moderatorRestricted: UserProfile = {
    uid: 'm1',
    email: 'mod@ust.edu',
    displayName: 'مشرف المحاضرات',
    role: 'moderator',
    permissions: ['lectures.upload', 'lectures.edit', 'announcements.manage'],
    status: 'active',
  };
  const student: UserProfile = {
    uid: 'u1',
    email: 'student@ust.edu',
    displayName: 'أحمد الطالب',
    role: 'student',
    status: 'active',
  };
  const suspendedAdmin: UserProfile = {
    ...admin,
    uid: 'a2',
    status: 'suspended',
  };

  // TEST 1, 2, 3: Dashboard access
  assert.equal(canAccessAdminDashboard(null, false), false);
  assert.equal(canAccessAdminDashboard(student, false), false);
  assert.equal(canAccessAdminDashboard(suspendedAdmin, true), false);
  assert.equal(canAccessAdminDashboard(moderatorRestricted, true), true);
  assert.equal(canAccessAdminDashboard(admin, true), true);
  assert.equal(canAccessAdminDashboard(superAdmin, true), true);

  // TEST 2: Super Admin has all permissions including upload
  for (const perm of ALL_PERMISSIONS) {
    assert.equal(hasPermission(superAdmin, perm), true);
  }

  // Non-Super-Admin is ALWAYS denied lectures.upload / lectures.edit / roles.assign / storage.manage even if injected in profile
  assert.equal(hasPermission(moderatorRestricted, 'lectures.upload'), false);
  assert.equal(hasPermission(moderatorRestricted, 'lectures.edit'), false);
  assert.equal(hasPermission(moderatorRestricted, 'announcements.manage'), true);
  assert.equal(hasPermission(moderatorRestricted, 'users.view'), false);
  assert.equal(hasPermission(moderatorRestricted, 'roles.assign'), false);
  assert.equal(hasPermission(moderatorRestricted, 'specializations.delete'), false);
  assert.equal(hasPermission(moderatorRestricted, 'storage.manage'), false);

  // Only Super Admin can assign non-upload permissions; granting lectures.upload to non-Super-Admin is rejected
  assert.equal(
    canAssignRoleChange({ actor: superAdmin, target: student, nextRole: 'admin' }).allowed,
    true
  );
  assert.equal(
    canAssignRoleChange({ actor: superAdmin, target: student, nextRole: 'moderator' }).allowed,
    true
  );
  assert.equal(
    canAssignRoleChange({
      actor: superAdmin,
      target: student,
      nextRole: 'admin',
      nextPermissions: ['lectures.upload'],
    }).allowed,
    false
  );
  assert.equal(
    canAssignRoleChange({ actor: admin, target: admin, nextRole: 'super_admin' }).allowed,
    false
  );
  assert.equal(
    canAssignRoleChange({ actor: admin, target: superAdmin, nextRole: 'student' }).allowed,
    false
  );
  assert.equal(
    canAssignRoleChange({ actor: moderatorRestricted, target: student, nextRole: 'moderator' }).allowed,
    false
  );

  // Download toggle
  assert.equal(canDownloadFile(files[0], false), true);
  assert.equal(canDownloadFile(files[2], false), false);
  assert.equal(canDownloadFile(files[2], true), true);
});

test('storage quota thresholds and analytics compute accurately and block at 100%', () => {
  const tenMB = 10 * 1024 * 1024;
  const eval75 = evaluateStorageQuota({
    usedBytes: 7.5 * 1024 * 1024,
    incomingBytes: 1024 * 1024,
    quotaMB: 10,
  });
  assert.equal(eval75.alertLevel, 'info');
  assert.equal(eval75.canUpload, true);

  const eval96 = evaluateStorageQuota({
    usedBytes: 9.6 * 1024 * 1024,
    incomingBytes: 0,
    quotaMB: 10,
  });
  assert.equal(eval96.alertLevel, 'critical');
  assert.equal(eval96.canUpload, true);

  // TEST 11: Exceeding quota prevents upload with exact message
  const evalExceeded = evaluateStorageQuota({
    usedBytes: tenMB - 512,
    incomingBytes: 2048,
    quotaMB: 10,
  });
  assert.equal(evalExceeded.canUpload, false);
  assert.equal(evalExceeded.alertLevel, 'blocked');
  assert.match(evalExceeded.message || '', /مساحة التخزين المتاحة غير كافية/);

  // TEST 10: Analytics breakdown + duplicate detection
  const analytics = computeStorageAnalytics({
    files,
    specializations: specs,
    academicYears: years,
    subjects,
  });
  assert.equal(analytics.totalFiles, 3);
  assert.equal(analytics.byFormat.pdf.count, 3);
  assert.equal(analytics.duplicateGroups.length, 1);
  assert.equal(analytics.duplicateGroups[0].wastedBytes, 150000);
});

test('search and formatting helpers behave deterministically', () => {
  assert.equal(canPreviewInApp('pdf'), true);
  assert.equal(canPreviewInApp('docx'), false);
  assert.equal(formatFileSizeArabic(2048), '2.0 كيلوبايت');
  assert.equal(computeNextSortOrder(specs), 4);

  const searchRes = searchLecturesAndSubjects(
    { specializations: specs, subjects, files },
    {
      query: 'الميكانيكا',
      specializationId: 'spec_bio',
      academicYearId: '',
      semesterId: '',
      subjectId: '',
      category: 'all',
    }
  );
  assert.equal(searchRes.files.length, 1);
  assert.equal(searchRes.files[0].id, 'f1');
});

test('Google Drive URL validation, parsing, embed/download resolution, and storage exclusion work securely', () => {
  // Valid Drive file /file/d/<id>/view
  const driveFile = validateAndParseGoogleDriveUrl(
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_12345/view?usp=sharing'
  );
  assert.equal(driveFile.valid, true);
  assert.equal(driveFile.driveFileId, '1AbCdEfGhIjKlMnOpQrStUvWxYz_12345');
  assert.equal(
    driveFile.embedUrl,
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_12345/preview'
  );
  assert.equal(
    driveFile.downloadUrl,
    'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUvWxYz_12345'
  );

  // Valid Drive ?id= link
  const driveOpen = validateAndParseGoogleDriveUrl(
    'https://drive.google.com/open?id=9XyZ_0123456789abcDEF'
  );
  assert.equal(driveOpen.valid, true);
  assert.equal(driveOpen.driveFileId, '9XyZ_0123456789abcDEF');

  // Valid Google Docs / Slides / Sheets links
  const gdoc = validateAndParseGoogleDriveUrl(
    'https://docs.google.com/document/d/doc_id_12345678/edit'
  );
  assert.equal(gdoc.valid, true);
  assert.equal(gdoc.kind, 'document');
  assert.equal(gdoc.inferredExt, 'gdoc');
  assert.equal(gdoc.embedUrl, 'https://docs.google.com/document/d/doc_id_12345678/preview');
  assert.equal(
    gdoc.downloadUrl,
    'https://docs.google.com/document/d/doc_id_12345678/export?format=pdf'
  );

  const gslides = validateAndParseGoogleDriveUrl(
    'https://docs.google.com/presentation/d/slides_id_123456/edit'
  );
  assert.equal(gslides.valid, true);
  assert.equal(gslides.inferredExt, 'gslides');

  // Reject insecure/non-Google/empty URLs
  assert.equal(validateAndParseGoogleDriveUrl('').valid, false);
  assert.equal(
    validateAndParseGoogleDriveUrl('http://drive.google.com/file/d/1AbCdEfGhIjKlMn/view').valid,
    false
  );
  assert.equal(
    validateAndParseGoogleDriveUrl('https://evil.example.com/file/d/1AbCdEfGhIjKlMn/view').valid,
    false
  );
  assert.equal(validateAndParseGoogleDriveUrl('javascript:alert(1)').valid, false);

  const driveLecture: LectureFile = {
    id: 'f_drive_1',
    specializationId: 'spec_bio',
    academicYearId: 'y1',
    semesterId: 'sem1',
    subjectId: 'sub_phys',
    title: 'محاضرة مرتبطة بـ Google Drive',
    category: 'lectures_pdf',
    sourceType: 'google_drive',
    externalUrl: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_12345/view',
    driveFileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz_12345',
    fileName: 'drive_lecture.pdf',
    originalName: 'drive_lecture.pdf',
    fileExt: 'pdf',
    mimeType: 'application/pdf',
    fileSize: 5_000_000,
    storageName: 'gdrive_1AbCdEfGhIjKlMnOpQrStUvWxYz_12345',
    allowDownload: true,
    status: 'published',
    sortOrder: 4,
    uploadedBy: 'admin1',
  };

  assert.equal(isGoogleDriveFile(driveLecture), true);
  assert.equal(isGoogleDriveFile(files[0]), false);
  assert.equal(canPreviewInApp(driveLecture.fileExt, driveLecture.mimeType, driveLecture), true);
  assert.equal(
    getGoogleDriveEmbedUrl(driveLecture),
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_12345/preview'
  );
  assert.equal(
    getGoogleDriveDownloadUrl(driveLecture),
    'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUvWxYz_12345'
  );

  // Storage analytics must NOT count Drive-linked file toward local storage quota bytes
  const analyticsWithoutDrive = computeStorageAnalytics({
    files,
    specializations: specs,
    academicYears: years,
    subjects,
  });
  const analyticsWithDrive = computeStorageAnalytics({
    files: [...files, driveLecture],
    specializations: specs,
    academicYears: years,
    subjects,
  });
  assert.equal(analyticsWithDrive.totalFiles, analyticsWithoutDrive.totalFiles + 1);
  assert.equal(analyticsWithDrive.totalBytes, analyticsWithoutDrive.totalBytes);
});
