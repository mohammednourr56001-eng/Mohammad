import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCentralLibraryRows,
  buildDistributionLinkPlan,
  buildUnlinkDestinationPlan,
  CENTRAL_UNLINKED_MARKER,
  computeBrowserFileSha256,
  computeCentralLibraryKpis,
  countFilesForDestination,
  detectLibraryDuplicateGroups,
  exportLibraryMetadataCsv,
  filterCentralLibraryRows,
  findDuplicateMatchForFile,
  getFileDestinations,
  getFilesForDestination,
  suggestSubjectForSpecialization,
} from './centralLibraryLogic.ts';
import {
  getFilesForSubject,
  searchLecturesAndSubjects,
} from './academicLogic.ts';
import {
  LectureFile,
  LectureFileLink,
  ProgramCourseLink,
  Specialization,
  Subject,
} from '../types/academic.ts';

const specs: Specialization[] = [
  { id: 'spec_bme', name: 'الهندسة الطبية الحيوية', iconKey: 'stethoscope', status: 'published', sortOrder: 1 },
  { id: 'spec_civil', name: 'الهندسة المدنية', iconKey: 'building', status: 'published', sortOrder: 2 },
  { id: 'spec_telecom', name: 'هندسة الاتصالات', iconKey: 'radio', status: 'published', sortOrder: 3 },
  { id: 'spec_ee', name: 'الهندسة الكهربائية', iconKey: 'cpu', status: 'published', sortOrder: 4 },
];

const subjects: Subject[] = [
  {
    id: 'sub_calc_bme',
    specializationId: 'spec_bme',
    academicYearId: 'yr_1',
    semesterId: 'sem_1',
    name: 'Calculus 1',
    code: 'MATH101',
    iconKey: 'calc',
    status: 'published',
    sortOrder: 1,
  },
  {
    id: 'sub_calc_civil',
    specializationId: 'spec_civil',
    academicYearId: 'yr_1',
    semesterId: 'sem_1',
    name: 'Calculus 1',
    code: 'MATH101',
    iconKey: 'calc',
    status: 'published',
    sortOrder: 1,
  },
  {
    id: 'sub_calc_telecom',
    specializationId: 'spec_telecom',
    academicYearId: 'yr_1',
    semesterId: 'sem_2',
    name: 'Calculus',
    code: 'MATH101',
    iconKey: 'calc',
    status: 'published',
    sortOrder: 1,
  },
  {
    id: 'sub_calc_ee',
    specializationId: 'spec_ee',
    academicYearId: 'yr_2',
    semesterId: 'sem_1',
    name: 'Engineering Calculus',
    code: 'MATH101',
    iconKey: 'calc',
    status: 'published',
    sortOrder: 1,
  },
];

const calculusFile: LectureFile = {
  id: 'file_calc_1',
  specializationId: 'spec_bme',
  academicYearId: 'yr_1',
  semesterId: 'sem_1',
  subjectId: 'sub_calc_bme',
  title: 'Calculus - Limits & Derivatives',
  category: 'lectures_pdf',
  sourceType: 'upload',
  fileName: 'calculus_lec1.pdf',
  originalName: 'calculus_lec1.pdf',
  fileExt: 'pdf',
  mimeType: 'application/pdf',
  fileSize: 1_500_000,
  storageName: 'ust_calc_1.pdf',
  storagePath: 'central/aa/ust_calc_1.pdf',
  sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  allowDownload: true,
  status: 'published',
  lifecycleStatus: 'active',
  sortOrder: 1,
  uploadedBy: 'admin_1',
  uploadedByEmail: 'admin@ust.edu',
  createdAt: 1700000000000,
};

test('Multi-specialization distribution links 1 Calculus file across 4 specializations with independent Year/Semester', () => {
  const plan = buildDistributionLinkPlan({
    lectureFileId: calculusFile.id,
    destinations: [
      { specializationId: 'spec_bme', academicYearId: 'yr_1', semesterId: 'sem_1', subjectId: 'sub_calc_bme' },
      { specializationId: 'spec_civil', academicYearId: 'yr_1', semesterId: 'sem_1', subjectId: 'sub_calc_civil' },
      { specializationId: 'spec_telecom', academicYearId: 'yr_1', semesterId: 'sem_2', subjectId: 'sub_calc_telecom' },
      { specializationId: 'spec_ee', academicYearId: 'yr_2', semesterId: 'sem_1', subjectId: 'sub_calc_ee' },
      // Accidental duplicate destination should be deduplicated automatically
      { specializationId: 'spec_civil', academicYearId: 'yr_1', semesterId: 'sem_1', subjectId: 'sub_calc_civil' },
    ],
    existingLinks: [],
    defaultStatus: 'published',
    createdBy: 'admin_1',
  });

  assert.equal(plan.toCreate.length, 4);
  assert.equal(plan.skippedDuplicates, 1);

  const links: LectureFileLink[] = plan.toCreate;

  // Each of the 4 destinations shows the exact same canonical file without duplication
  assert.equal(
    getFilesForDestination({
      files: [calculusFile],
      links,
      specializationId: 'spec_bme',
      academicYearId: 'yr_1',
      semesterId: 'sem_1',
      subjectId: 'sub_calc_bme',
    }).length,
    1
  );
  assert.equal(
    getFilesForDestination({
      files: [calculusFile],
      links,
      specializationId: 'spec_telecom',
      academicYearId: 'yr_1',
      semesterId: 'sem_2',
      subjectId: 'sub_calc_telecom',
    }).length,
    1
  );
  assert.equal(
    getFilesForDestination({
      files: [calculusFile],
      links,
      specializationId: 'spec_ee',
      academicYearId: 'yr_2',
      semesterId: 'sem_1',
      subjectId: 'sub_calc_ee',
    }).length,
    1
  );
  // Different semester in Telecom must NOT show the file
  assert.equal(
    getFilesForDestination({
      files: [calculusFile],
      links,
      specializationId: 'spec_telecom',
      academicYearId: 'yr_1',
      semesterId: 'sem_1',
      subjectId: 'sub_calc_telecom',
    }).length,
    0
  );

  // KPIs count storage only once (1.5 MB) despite 4 active links
  const rows = buildCentralLibraryRows({ files: [calculusFile], links, subjects });
  const kpis = computeCentralLibraryKpis(rows, [calculusFile]);
  assert.equal(kpis.totalFiles, 1);
  assert.equal(kpis.linkedFiles, 1);
  assert.equal(kpis.totalLinks, 4);
  assert.equal(kpis.totalStorageBytes, 1_500_000);
});

test('Unlinking a single specialization removes ONLY that destination while preserving all others', () => {
  const links: LectureFileLink[] = [
    { id: 'l1', lectureFileId: 'file_calc_1', specializationId: 'spec_bme', academicYearId: 'yr_1', semesterId: 'sem_1', subjectId: 'sub_calc_bme', status: 'published', sortOrder: 1 },
    { id: 'l2', lectureFileId: 'file_calc_1', specializationId: 'spec_civil', academicYearId: 'yr_1', semesterId: 'sem_1', subjectId: 'sub_calc_civil', status: 'published', sortOrder: 2 },
    { id: 'l3', lectureFileId: 'file_calc_1', specializationId: 'spec_telecom', academicYearId: 'yr_1', semesterId: 'sem_2', subjectId: 'sub_calc_telecom', status: 'published', sortOrder: 3 },
  ];

  const allDests = getFileDestinations({ file: calculusFile, links, subjects });
  const civilDest = allDests.find((d) => d.specializationId === 'spec_civil')!;

  const unlinkPlan = buildUnlinkDestinationPlan({
    file: calculusFile,
    targetDestination: civilDest,
    allCurrentDestinations: allDests,
    actorUid: 'admin_1',
  });

  assert.deepEqual(unlinkPlan.deleteLinkIds, ['l2']);
  assert.equal(unlinkPlan.createLinks.length, 0);
  assert.equal(unlinkPlan.markFileUnlinked, false);

  const afterLinks = links.filter((l) => !unlinkPlan.deleteLinkIds.includes(l.id));
  assert.equal(
    countFilesForDestination({
      files: [calculusFile],
      links: afterLinks,
      specializationId: 'spec_civil',
      academicYearId: 'yr_1',
      semesterId: 'sem_1',
      subjectId: 'sub_calc_civil',
    }),
    0
  );
  assert.equal(
    countFilesForDestination({
      files: [calculusFile],
      links: afterLinks,
      specializationId: 'spec_bme',
      academicYearId: 'yr_1',
      semesterId: 'sem_1',
      subjectId: 'sub_calc_bme',
    }),
    1
  );
  assert.equal(
    countFilesForDestination({
      files: [calculusFile],
      links: afterLinks,
      specializationId: 'spec_telecom',
      academicYearId: 'yr_1',
      semesterId: 'sem_2',
      subjectId: 'sub_calc_telecom',
    }),
    1
  );
});

test('Legacy shared-course single-spec unlink materializes explicit links for remaining programs safely', () => {
  const legacyProgramCourses: ProgramCourseLink[] = [
    { id: 'pc_1', courseId: 'sub_calc_bme', specializationId: 'spec_civil', academicYearId: 'yr_1', semesterId: 'sem_1', status: 'published', sortOrder: 1 },
    { id: 'pc_2', courseId: 'sub_calc_bme', specializationId: 'spec_ee', academicYearId: 'yr_2', semesterId: 'sem_1', status: 'published', sortOrder: 2 },
  ];

  const allDests = getFileDestinations({
    file: calculusFile,
    links: [],
    subjects,
    programCourses: legacyProgramCourses,
  });
  assert.equal(allDests.length, 3);

  const civilDest = allDests.find((d) => d.specializationId === 'spec_civil')!;
  const unlinkPlan = buildUnlinkDestinationPlan({
    file: calculusFile,
    targetDestination: civilDest,
    allCurrentDestinations: allDests,
    actorUid: 'admin_1',
  });

  assert.equal(unlinkPlan.deleteLinkIds.length, 0);
  assert.equal(unlinkPlan.createLinks.length, 2);
  assert.equal(unlinkPlan.markFileUnlinked, false);

  const materializedLinks: LectureFileLink[] = unlinkPlan.createLinks;
  assert.equal(
    getFilesForDestination({
      files: [calculusFile],
      links: materializedLinks,
      specializationId: 'spec_civil',
      academicYearId: 'yr_1',
      semesterId: 'sem_1',
      subjectId: 'sub_calc_bme',
    }).length,
    0
  );
  assert.equal(
    getFilesForDestination({
      files: [calculusFile],
      links: materializedLinks,
      specializationId: 'spec_ee',
      academicYearId: 'yr_2',
      semesterId: 'sem_1',
      subjectId: 'sub_calc_bme',
    }).length,
    1
  );
});

test('Smart duplicate detection matches identical SHA-256 even when renamed, and avoids false-positive on same filename with different SHA-256', async () => {
  const sameContentMatch = findDuplicateMatchForFile({
    sha256: calculusFile.sha256,
    fileSize: 1_500_000,
    fileName: 'renamed_math_sheet.pdf',
    existingFiles: [calculusFile],
    links: [],
  });
  assert.ok(sameContentMatch);
  assert.equal(sameContentMatch.matchType, 'sha256_exact');
  assert.equal(sameContentMatch.file.id, 'file_calc_1');

  const differentContentSameName = findDuplicateMatchForFile({
    sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    fileSize: 1_500_000,
    fileName: 'calculus_lec1.pdf',
    existingFiles: [calculusFile],
    links: [],
  });
  assert.equal(differentContentSameName, null);

  // Verify browser SHA-256 helper works reliably
  const blob = new Blob(['UST Central Library Hash Check'], { type: 'text/plain' });
  const digest = await computeBrowserFileSha256(blob);
  assert.equal(digest.length, 64);

  // Verify duplicate group builder skips files with different sha256 even if same originalName
  const diffFileSameName: LectureFile = {
    ...calculusFile,
    id: 'file_calc_2',
    sha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    storageName: 'ust_calc_2.pdf',
  };
  assert.equal(detectLibraryDuplicateGroups([calculusFile, diffFileSameName]).length, 0);

  // Verify duplicate group builder catches true SHA-256 duplicates
  const exactCopyFile: LectureFile = {
    ...calculusFile,
    id: 'file_calc_dup',
    originalName: 'calc_copy_from_tablet.pdf',
    storageName: 'ust_calc_dup.pdf',
    createdAt: 1700000900000,
  };
  const groups = detectLibraryDuplicateGroups([exactCopyFile, calculusFile]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].canonicalFile.id, 'file_calc_1');
  assert.equal(groups[0].duplicates[0].id, 'file_calc_dup');
  assert.equal(groups[0].recoverableBytes, 1_500_000);
});

test('Soft delete & central_unlinked exclude files from student views, search, and subject lookup', () => {
  const trashedFile: LectureFile = {
    ...calculusFile,
    id: 'file_trashed',
    lifecycleStatus: 'trashed',
    deletedAt: '2026-01-01T00:00:00Z',
  };
  const unlinkedFile: LectureFile = {
    ...calculusFile,
    id: 'file_unlinked',
    specializationId: CENTRAL_UNLINKED_MARKER,
  };

  const links: LectureFileLink[] = [
    { id: 'lt', lectureFileId: 'file_trashed', specializationId: 'spec_bme', academicYearId: 'yr_1', semesterId: 'sem_1', subjectId: 'sub_calc_bme', status: 'published', sortOrder: 1 },
    { id: 'la', lectureFileId: 'file_calc_1', specializationId: 'spec_bme', academicYearId: 'yr_1', semesterId: 'sem_1', subjectId: 'sub_calc_bme', status: 'published', sortOrder: 2 },
  ];

  const studentFiles = getFilesForSubject(
    [calculusFile, trashedFile, unlinkedFile],
    'spec_bme',
    'yr_1',
    'sem_1',
    'sub_calc_bme',
    false,
    links
  );
  assert.equal(studentFiles.length, 1);
  assert.equal(studentFiles[0].id, 'file_calc_1');

  const searchRes = searchLecturesAndSubjects(
    {
      specializations: specs,
      subjects,
      files: [calculusFile, trashedFile, unlinkedFile],
      lectureFileLinks: links,
    },
    {
      query: 'Calculus',
      specializationId: 'spec_bme',
      academicYearId: '',
      semesterId: '',
      subjectId: '',
      category: 'all',
    }
  );
  assert.equal(searchRes.files.length, 1);
  assert.equal(searchRes.files[0].id, 'file_calc_1');
});

test('Central Library filters, smart subject suggestion, and CSV export behave accurately', () => {
  const unlinkedFile: LectureFile = {
    ...calculusFile,
    id: 'file_unlinked',
    title: 'Orphaned Reference PDF',
    specializationId: CENTRAL_UNLINKED_MARKER,
    status: 'draft',
  };
  const links: LectureFileLink[] = [
    { id: 'l1', lectureFileId: 'file_calc_1', specializationId: 'spec_bme', academicYearId: 'yr_1', semesterId: 'sem_1', subjectId: 'sub_calc_bme', status: 'published', sortOrder: 1 },
  ];

  const rows = buildCentralLibraryRows({
    files: [calculusFile, unlinkedFile],
    links,
    subjects,
  });

  const unlinkedOnly = filterCentralLibraryRows(rows, {
    query: '',
    specializationId: '',
    academicYearId: '',
    semesterId: '',
    subjectId: '',
    category: 'all',
    fileExt: '',
    uploaderUid: '',
    lifecycleFilter: 'unlinked',
    dateFrom: '',
    dateTo: '',
  });
  assert.equal(unlinkedOnly.length, 1);
  assert.equal(unlinkedOnly[0].file.id, 'file_unlinked');

  const suggested = suggestSubjectForSpecialization({
    sourceSubjectName: 'Calculus 1',
    sourceSubjectCode: 'MATH101',
    targetSubjects: subjects.filter((s) => s.specializationId === 'spec_ee'),
  });
  assert.equal(suggested?.id, 'sub_calc_ee');

  const csv = exportLibraryMetadataCsv(rows, specs, subjects);
  assert.ok(csv.includes('Calculus - Limits & Derivatives'));
  assert.ok(csv.includes('Orphaned Reference PDF'));
});
