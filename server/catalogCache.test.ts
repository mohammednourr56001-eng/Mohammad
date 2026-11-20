import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeWeakEtag,
  isEtagMatch,
  mergePublishedCatalogSnapshot,
  SingleFlightCoordinator,
} from './catalogCache.ts';

test('SingleFlightCoordinator executes loader only once for concurrent requests and allows subsequent runs', async () => {
  const coordinator = new SingleFlightCoordinator();
  let calls = 0;

  const loader = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 25));
    return { count: calls };
  };

  const results = await Promise.all(
    Array.from({ length: 50 }, () => coordinator.run('catalog:snapshot', loader))
  );

  assert.equal(calls, 1);
  assert.equal(coordinator.getInFlightCount(), 0);
  assert.equal(coordinator.activeDeduplications, 49);
  assert.equal(results.filter((r) => r.coalesced).length, 49);
  assert.ok(results.every((r) => r.value.count === 1));

  // Next request after completion triggers a fresh load
  const next = await coordinator.run('catalog:snapshot', loader);
  assert.equal(calls, 2);
  assert.equal(next.coalesced, false);
  assert.equal(next.value.count, 2);
});

test('computeWeakEtag and isEtagMatch validate HTTP conditional caching', () => {
  const tag1 = computeWeakEtag({ a: 1, b: 'ust' });
  const tag2 = computeWeakEtag({ a: 1, b: 'ust' });
  const tag3 = computeWeakEtag({ a: 2, b: 'ust' });

  assert.equal(tag1, tag2);
  assert.notEqual(tag1, tag3);
  assert.equal(isEtagMatch(tag1, tag1), true);
  assert.equal(isEtagMatch(`W/"other", ${tag1}`, tag1), true);
  assert.equal(isEtagMatch(tag3, tag1), false);
});

test('mergePublishedCatalogSnapshot prefers live Firestore data, filters drafts/trashed, and strips uploadedBy', () => {
  const snapshot = mergePublishedCatalogSnapshot({
    firestore: {
      specializations: [
        { id: 's1', name: 'Live Spec', description: '', iconKey: 'code', status: 'published', sortOrder: 2 },
        { id: 's2', name: 'Draft Spec', description: '', iconKey: 'code', status: 'draft', sortOrder: 1 },
      ],
      academicYears: [],
      semesters: [],
      subjects: [],
      programCourses: [],
      lectureFileLinks: [],
      lectureFiles: [
        {
          id: 'f1',
          specializationId: 's1',
          academicYearId: 'y1',
          semesterId: 'sem1',
          subjectId: 'sub1',
          title: 'Published File',
          description: '',
          category: 'lectures_pdf',
          fileName: 'f1.pdf',
          originalName: 'f1.pdf',
          fileExt: 'pdf',
          mimeType: 'application/pdf',
          fileSize: 1000,
          storageName: 'f1.pdf',
          allowDownload: true,
          status: 'published',
          lifecycleStatus: 'active',
          sortOrder: 1,
          uploadedBy: 'secret_uid_123',
        },
        {
          id: 'f2',
          specializationId: 's1',
          academicYearId: 'y1',
          semesterId: 'sem1',
          subjectId: 'sub1',
          title: 'Trashed File',
          description: '',
          category: 'lectures_pdf',
          fileName: 'f2.pdf',
          originalName: 'f2.pdf',
          fileExt: 'pdf',
          mimeType: 'application/pdf',
          fileSize: 1000,
          storageName: 'f2.pdf',
          allowDownload: true,
          status: 'published',
          lifecycleStatus: 'trashed',
          sortOrder: 2,
          uploadedBy: 'secret_uid_123',
        },
      ],
      announcements: [],
      notifications: [],
    },
    seed: {
      specializations: [
        { id: 'seed_1', name: 'Seed Spec', description: '', iconKey: 'code', status: 'published', sortOrder: 1 },
      ],
      academicYears: [],
      semesters: [],
      subjects: [],
      lectureFiles: [],
      announcements: [],
      notifications: [],
    },
    fileRegistryEntries: [],
  });

  assert.equal(snapshot.source, 'firestore_live');
  assert.equal(snapshot.specializations.length, 1);
  assert.equal(snapshot.specializations[0].id, 's1');
  assert.equal(snapshot.lectureFiles.length, 1);
  assert.equal(snapshot.lectureFiles[0].id, 'f1');
  assert.equal(snapshot.lectureFiles[0].uploadedBy, 'public');
});
