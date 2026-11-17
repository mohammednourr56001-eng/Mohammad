import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAcademicBreadcrumb,
  canAccessAdminDashboard,
  canDownloadFile,
  canPreviewInApp,
  computeNextSortOrder,
  formatFileSizeArabic,
  getFilesForSubject,
  getPublishedSpecializations,
  getSemestersForYear,
  getSubjectsForSemester,
  getYearsForSpecialization,
  searchLecturesAndSubjects,
  validateUploadFile,
} from './academicLogic';
import { AcademicYear, LectureFile, Semester, Specialization, Subject, UserProfile } from '../types/academic';

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
    allowDownload: true,
    status: 'published',
    sortOrder: 1,
    uploadedBy: 'admin1',
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
    allowDownload: false,
    status: 'draft',
    sortOrder: 2,
    uploadedBy: 'admin1',
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
    allowDownload: false,
    status: 'published',
    sortOrder: 1,
    uploadedBy: 'admin1',
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

  // Strict isolation check: Biomedical Physics files must NOT leak into Civil Engineering
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
  });
  assert.equal(okPdf.valid, true);
  assert.equal(okPdf.extension, 'pdf');

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

test('RBAC guards deny students from Admin Dashboard and enforce download toggle', () => {
  const student: UserProfile = {
    uid: 'u1',
    email: 'student@ust.edu',
    displayName: 'أحمد الطالب',
    role: 'student',
  };
  const admin: UserProfile = {
    uid: 'a1',
    email: 'admin@ust.edu',
    displayName: 'مدير المنصة',
    role: 'admin',
  };

  assert.equal(canAccessAdminDashboard(null, false), false);
  assert.equal(canAccessAdminDashboard(student, false), false);
  assert.equal(canAccessAdminDashboard(admin, true), true);

  assert.equal(canDownloadFile(files[0], false), true);
  assert.equal(canDownloadFile(files[2], false), false); // allowDownload = false
  assert.equal(canDownloadFile(files[2], true), true); // admin override
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
