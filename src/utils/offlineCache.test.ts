import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearOfflineCatalog,
  clearOfflineUserSettings,
  getOfflineCacheSummary,
  OFFLINE_CATALOG_STORAGE_KEY,
  OFFLINE_USER_SETTINGS_STORAGE_KEY,
  readOfflineCatalog,
  readOfflineUserSettings,
  StorageLike,
  writeOfflineCatalog,
  writeOfflineUserSettings,
} from './offlineCache.ts';
import { LectureFile, Specialization, Subject } from '../types/academic.ts';

function createMemoryStorage(quotaChars?: number): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem(key) {
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      if (quotaChars && value.length > quotaChars) {
        throw new Error('QuotaExceededError');
      }
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

const sampleSpecs: Specialization[] = [
  {
    id: 'spec_cs',
    name: 'علوم الحاسوب',
    description: 'تخصص الحوسبة',
    iconKey: 'Cpu',
    status: 'published',
    sortOrder: 1,
  },
  {
    id: 'spec_draft',
    name: 'تخصص مسودة',
    description: 'غير منشور',
    iconKey: 'BookOpen',
    status: 'draft',
    sortOrder: 2,
  },
];

const sampleSubjects: Subject[] = [
  {
    id: 'sub_calc',
    specializationId: 'spec_cs',
    academicYearId: 'yr_1',
    semesterId: 'sem_1',
    name: 'التفاضل والتكامل',
    code: 'MATH101',
    iconKey: 'BookOpen',
    description: '',
    status: 'published',
    sortOrder: 1,
  },
  {
    id: 'sub_hidden',
    specializationId: 'spec_cs',
    academicYearId: 'yr_1',
    semesterId: 'sem_1',
    name: 'مادة مسودة',
    code: 'HID101',
    iconKey: 'BookOpen',
    description: '',
    status: 'draft',
    sortOrder: 2,
  },
];

const sampleFiles: LectureFile[] = [
  {
    id: 'lec_1',
    specializationId: 'spec_cs',
    academicYearId: 'yr_1',
    semesterId: 'sem_1',
    subjectId: 'sub_calc',
    title: 'المحاضرة الأولى',
    description: 'مقدمة في النهايات',
    category: 'lectures_pdf',
    fileName: 'lec1.pdf',
    originalName: 'lec1.pdf',
    fileExt: 'pdf',
    mimeType: 'application/pdf',
    fileSize: 102400,
    storageName: 'lec1.pdf',
    allowDownload: true,
    status: 'published',
    lifecycleStatus: 'active',
    sortOrder: 1,
    uploadedBy: 'admin_secret_uid',
  },
  {
    id: 'lec_trashed',
    specializationId: 'spec_cs',
    academicYearId: 'yr_1',
    semesterId: 'sem_1',
    subjectId: 'sub_calc',
    title: 'محاضرة محذوفة',
    description: '',
    category: 'lectures_pdf',
    fileName: 'old.pdf',
    originalName: 'old.pdf',
    fileExt: 'pdf',
    mimeType: 'application/pdf',
    fileSize: 1024,
    storageName: 'old.pdf',
    allowDownload: false,
    status: 'published',
    lifecycleStatus: 'trashed',
    sortOrder: 2,
    uploadedBy: 'admin_secret_uid',
  },
  {
    id: 'lec_central_only',
    specializationId: 'central_unlinked',
    academicYearId: 'yr_1',
    semesterId: 'sem_1',
    subjectId: 'sub_calc',
    title: 'ملف غير مربوط',
    description: '',
    category: 'lectures_pdf',
    fileName: 'unlinked.pdf',
    originalName: 'unlinked.pdf',
    fileExt: 'pdf',
    mimeType: 'application/pdf',
    fileSize: 1024,
    storageName: 'unlinked.pdf',
    allowDownload: false,
    status: 'published',
    lifecycleStatus: 'active',
    sortOrder: 3,
    uploadedBy: 'admin_secret_uid',
  },
];

test('writeOfflineCatalog filters out drafts, trashed, and central_unlinked items and sanitizes uploadedBy', () => {
  const storage = createMemoryStorage();
  const written = writeOfflineCatalog(
    {
      specializations: sampleSpecs,
      academicYears: [],
      semesters: [],
      subjects: sampleSubjects,
      programCourses: [],
      lectureFileLinks: [],
      lectureFiles: sampleFiles,
      announcements: [],
      notifications: [],
      settings: { platformTitle: 'منصة UST', maxFileSizeMB: 20 },
    },
    storage
  );

  assert.ok(written);
  assert.equal(written.specializations.length, 1);
  assert.equal(written.specializations[0].id, 'spec_cs');
  assert.equal(written.subjects.length, 1);
  assert.equal(written.subjects[0].id, 'sub_calc');
  assert.equal(written.lectureFiles.length, 1);
  assert.equal(written.lectureFiles[0].id, 'lec_1');
  assert.equal(written.lectureFiles[0].uploadedBy, 'cached');

  const restored = readOfflineCatalog(storage);
  assert.ok(restored);
  assert.equal(restored.lectureFiles.length, 1);
  assert.equal(restored.settings.maxFileSizeMB, 20);
});

test('readOfflineCatalog handles corrupted JSON and schema mismatch safely', () => {
  const storage = createMemoryStorage();
  storage.setItem(OFFLINE_CATALOG_STORAGE_KEY, '{corrupt json');
  assert.equal(readOfflineCatalog(storage), null);

  storage.setItem(
    OFFLINE_CATALOG_STORAGE_KEY,
    JSON.stringify({ schemaVersion: 999, specializations: [], subjects: [] })
  );
  assert.equal(readOfflineCatalog(storage), null);
});

test('writeOfflineUserSettings isolates by uid and supports clearing', () => {
  const storage = createMemoryStorage();
  writeOfflineUserSettings(
    {
      uid: 'user_123',
      displayName: 'أحمد علي',
      specializationId: 'spec_cs',
      academicYearId: 'yr_1',
      favoriteIds: ['lec_1', 'lec_1'],
      readNotificationIds: ['notif_1'],
      pendingProfileSync: true,
    },
    storage
  );

  const own = readOfflineUserSettings('user_123', storage);
  assert.ok(own);
  assert.equal(own.specializationId, 'spec_cs');
  assert.deepEqual(own.favoriteIds, ['lec_1']);
  assert.equal(own.pendingProfileSync, true);

  // Different user must NOT read another user's cached settings
  assert.equal(readOfflineUserSettings('user_other', storage), null);

  clearOfflineUserSettings(storage);
  assert.equal(storage.getItem(OFFLINE_USER_SETTINGS_STORAGE_KEY), null);
});

test('getOfflineCacheSummary reports accurate counts and clearOfflineCatalog removes catalog', () => {
  const storage = createMemoryStorage();
  writeOfflineCatalog(
    {
      specializations: sampleSpecs,
      academicYears: [],
      semesters: [],
      subjects: sampleSubjects,
      programCourses: [],
      lectureFileLinks: [],
      lectureFiles: sampleFiles,
      announcements: [],
      notifications: [],
    },
    storage
  );
  writeOfflineUserSettings({ uid: 'u1', specializationId: 'spec_cs' }, storage);

  const summary = getOfflineCacheSummary('u1', storage);
  assert.equal(summary.hasCatalog, true);
  assert.equal(summary.specializationsCount, 1);
  assert.equal(summary.subjectsCount, 1);
  assert.equal(summary.lectureFilesCount, 1);
  assert.equal(summary.hasUserSettings, true);
  assert.ok(summary.approximateBytes > 0);

  clearOfflineCatalog(storage);
  const afterClear = getOfflineCacheSummary('u1', storage);
  assert.equal(afterClear.hasCatalog, false);
  assert.equal(afterClear.lectureFilesCount, 0);
});
