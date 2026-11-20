import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStorageAnalytics,
  countFilesForSubject,
  findPotentialDuplicateCourseGroups,
  getEffectiveCoursePlacements,
  getFilesForSubject,
  getSubjectsForSemester,
  hasDuplicateProgramLink,
  searchLecturesAndSubjects,
} from './academicLogic.ts';
import {
  AcademicYear,
  LectureFile,
  ProgramCourseLink,
  Semester,
  Specialization,
  Subject,
} from '../types/academic.ts';

const specializations: Specialization[] = [
  { id: 'spec_bme', name: 'الهندسة الطبية الحيوية', iconKey: 'stethoscope', status: 'published', sortOrder: 1 },
  { id: 'spec_civil', name: 'الهندسة المدنية', iconKey: 'building', status: 'published', sortOrder: 2 },
  { id: 'spec_ee', name: 'الهندسة الكهربائية', iconKey: 'cpu', status: 'published', sortOrder: 3 },
];

const years: AcademicYear[] = [
  { id: 'yr_bme_1', specializationId: 'spec_bme', name: 'السنة الأولى', status: 'published', sortOrder: 1 },
  { id: 'yr_civil_1', specializationId: 'spec_civil', name: 'السنة الأولى', status: 'published', sortOrder: 1 },
  { id: 'yr_ee_1', specializationId: 'spec_ee', name: 'السنة الأولى', status: 'published', sortOrder: 1 },
];

const semesters: Semester[] = [
  { id: 'sem_bme_1', specializationId: 'spec_bme', academicYearId: 'yr_bme_1', name: 'الفصل الأول', status: 'published', sortOrder: 1 },
  { id: 'sem_civil_1', specializationId: 'spec_civil', academicYearId: 'yr_civil_1', name: 'الفصل الأول', status: 'published', sortOrder: 1 },
  { id: 'sem_ee_1', specializationId: 'spec_ee', academicYearId: 'yr_ee_1', name: 'الفصل الأول', status: 'published', sortOrder: 1 },
];

const physicsCourse: Subject = {
  id: 'sub_phys101',
  specializationId: 'spec_bme',
  academicYearId: 'yr_bme_1',
  semesterId: 'sem_bme_1',
  name: 'Physics 1',
  code: 'PHYS101',
  curriculumVersion: 'Engineering Core 2026',
  iconKey: 'atom',
  status: 'published',
  sortOrder: 1,
};

const physicsFiles: LectureFile[] = [
  {
    id: 'file_p1',
    specializationId: 'spec_bme',
    academicYearId: 'yr_bme_1',
    semesterId: 'sem_bme_1',
    subjectId: 'sub_phys101',
    title: 'Lecture 1 - Mechanics',
    category: 'lectures_pdf',
    fileName: 'lec1.pdf',
    originalName: 'lec1.pdf',
    fileExt: 'pdf',
    mimeType: 'application/pdf',
    fileSize: 1024 * 1024,
    storageName: 'lec1.pdf',
    allowDownload: true,
    status: 'published',
    sortOrder: 1,
    uploadedBy: 'admin_1',
  },
  {
    id: 'file_p2',
    specializationId: 'spec_bme',
    academicYearId: 'yr_bme_1',
    semesterId: 'sem_bme_1',
    subjectId: 'sub_phys101',
    title: 'Lecture 2 - Kinematics',
    category: 'lectures_pdf',
    fileName: 'lec2.pdf',
    originalName: 'lec2.pdf',
    fileExt: 'pdf',
    mimeType: 'application/pdf',
    fileSize: 2048 * 1024,
    storageName: 'lec2.pdf',
    allowDownload: true,
    status: 'published',
    sortOrder: 2,
    uploadedBy: 'admin_1',
  },
  {
    id: 'file_p3',
    specializationId: 'spec_bme',
    academicYearId: 'yr_bme_1',
    semesterId: 'sem_bme_1',
    subjectId: 'sub_phys101',
    title: 'Physics Formula Sheet',
    category: 'summaries',
    fileName: 'sheet.pdf',
    originalName: 'sheet.pdf',
    fileExt: 'pdf',
    mimeType: 'application/pdf',
    fileSize: 512 * 1024,
    storageName: 'sheet.pdf',
    allowDownload: true,
    status: 'published',
    sortOrder: 3,
    uploadedBy: 'admin_1',
  },
];

const initialLinks: ProgramCourseLink[] = [
  {
    id: 'lnk_civil_phys1',
    courseId: 'sub_phys101',
    specializationId: 'spec_civil',
    academicYearId: 'yr_civil_1',
    semesterId: 'sem_civil_1',
    status: 'published',
    sortOrder: 1,
  },
  {
    id: 'lnk_ee_phys1',
    courseId: 'sub_phys101',
    specializationId: 'spec_ee',
    academicYearId: 'yr_ee_1',
    semesterId: 'sem_ee_1',
    status: 'published',
    sortOrder: 1,
  },
];

test('Shared Courses: Physics 1 linked across 3 specializations exposes exact 3 canonical files without duplication', () => {
  const bmeSubjects = getSubjectsForSemester(
    [physicsCourse],
    'spec_bme',
    'yr_bme_1',
    'sem_bme_1',
    false,
    initialLinks
  );
  const civilSubjects = getSubjectsForSemester(
    [physicsCourse],
    'spec_civil',
    'yr_civil_1',
    'sem_civil_1',
    false,
    initialLinks
  );
  const eeSubjects = getSubjectsForSemester(
    [physicsCourse],
    'spec_ee',
    'yr_ee_1',
    'sem_ee_1',
    false,
    initialLinks
  );

  assert.equal(bmeSubjects.length, 1);
  assert.equal(civilSubjects.length, 1);
  assert.equal(eeSubjects.length, 1);
  assert.equal(civilSubjects[0].id, 'sub_phys101');
  assert.equal(eeSubjects[0].id, 'sub_phys101');

  // Verify students in all 3 specializations see exact 3 canonical files
  const bmeFiles = getFilesForSubject(physicsFiles, 'spec_bme', 'yr_bme_1', 'sem_bme_1', 'sub_phys101');
  const civilFiles = getFilesForSubject(physicsFiles, 'spec_civil', 'yr_civil_1', 'sem_civil_1', 'sub_phys101');
  const eeFiles = getFilesForSubject(physicsFiles, 'spec_ee', 'yr_ee_1', 'sem_ee_1', 'sub_phys101');

  assert.equal(bmeFiles.length, 3);
  assert.equal(civilFiles.length, 3);
  assert.equal(eeFiles.length, 3);
  assert.equal(countFilesForSubject(physicsFiles, 'sub_phys101'), 3);

  // Storage analytics counts bytes once (3.5 MB total, 0 duplicate groups)
  const storage = computeStorageAnalytics({
    files: physicsFiles,
    specializations,
    academicYears: years,
    subjects: [physicsCourse],
  });
  assert.equal(storage.totalFiles, 3);
  assert.equal(storage.totalBytes, (1024 + 2048 + 512) * 1024);
  assert.equal(storage.duplicateGroups.length, 0);

  // Search filtering by linked specialization finds shared course and files
  const civilSearch = searchLecturesAndSubjects(
    { specializations, subjects: [physicsCourse], files: physicsFiles, programCourses: initialLinks },
    {
      query: 'Kinematics',
      specializationId: 'spec_civil',
      academicYearId: 'yr_civil_1',
      semesterId: 'sem_civil_1',
      subjectId: '',
      category: 'all',
    }
  );
  assert.equal(civilSearch.files.length, 1);
  assert.equal(civilSearch.files[0].id, 'file_p2');
});

test('Shared Courses: Unlinking Civil Engineering preserves Physics 1 and all 3 files for BME and EE', () => {
  const afterUnlink = initialLinks.filter((l) => l.specializationId !== 'spec_civil');

  const civilSubjects = getSubjectsForSemester(
    [physicsCourse],
    'spec_civil',
    'yr_civil_1',
    'sem_civil_1',
    false,
    afterUnlink
  );
  assert.equal(civilSubjects.length, 0);

  const bmeSubjects = getSubjectsForSemester(
    [physicsCourse],
    'spec_bme',
    'yr_bme_1',
    'sem_bme_1',
    false,
    afterUnlink
  );
  const eeSubjects = getSubjectsForSemester(
    [physicsCourse],
    'spec_ee',
    'yr_ee_1',
    'sem_ee_1',
    false,
    afterUnlink
  );
  assert.equal(bmeSubjects.length, 1);
  assert.equal(eeSubjects.length, 1);

  const eeFiles = getFilesForSubject(physicsFiles, 'spec_ee', 'yr_ee_1', 'sem_ee_1', 'sub_phys101');
  assert.equal(eeFiles.length, 3);
});

test('Shared Courses: Duplicate link prevention and safe same-name inspection', () => {
  assert.equal(
    hasDuplicateProgramLink(physicsCourse, initialLinks, 'spec_civil', 'yr_civil_1', 'sem_civil_1'),
    true
  );
  assert.equal(
    hasDuplicateProgramLink(physicsCourse, initialLinks, 'spec_bme', 'yr_bme_1', 'sem_bme_1'),
    true
  );
  assert.equal(
    hasDuplicateProgramLink(physicsCourse, initialLinks, 'spec_civil', 'yr_civil_1', 'sem_other'),
    false
  );

  const placements = getEffectiveCoursePlacements(physicsCourse, initialLinks);
  assert.equal(placements.length, 3);

  const anotherPhysicsDifferentCurriculum: Subject = {
    ...physicsCourse,
    id: 'sub_phys_med',
    code: 'MED-PHYS101',
    curriculumVersion: 'Medical Track 2026',
  };
  const dupGroups = findPotentialDuplicateCourseGroups([
    physicsCourse,
    anotherPhysicsDifferentCurriculum,
  ]);
  assert.equal(dupGroups.length, 1);
  assert.equal(dupGroups[0].courses.length, 2);
});
