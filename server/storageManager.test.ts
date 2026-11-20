import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildCentralStorageLocation,
  buildHierarchicalStorageLocation,
  computeFileSha256,
  resolvePhysicalFilePath,
  sanitizePathSegment,
  UST_STORAGE_ROOT,
} from './storageManager.ts';

test('sanitizePathSegment strips traversal sequences and unsafe characters', () => {
  assert.equal(sanitizePathSegment('../../etc/passwd'), 'etcpasswd');
  assert.equal(sanitizePathSegment('spec-med_01!@#'), 'spec-med_01');
  assert.equal(sanitizePathSegment('   ', 'fallback'), 'fallback');
});

test('buildHierarchicalStorageLocation creates deterministic academic folder layout', () => {
  const loc = buildHierarchicalStorageLocation({
    specializationId: 'spec-software',
    academicYearId: 'year-2',
    semesterId: 'sem-1',
    subjectId: 'sub-ds',
    storageName: '../evil/ust_123_abc.pdf',
  });

  assert.equal(
    loc.storagePath,
    'specializations/spec-software/year-2/sem-1/sub-ds/ust_123_abc.pdf'
  );
  assert.ok(loc.fullPath.startsWith(UST_STORAGE_ROOT));
  assert.equal(path.basename(loc.fullPath), 'ust_123_abc.pdf');
});

test('buildCentralStorageLocation stores files centrally independent of specialization', () => {
  const loc = buildCentralStorageLocation({
    sha256: 'ab12cd34ef56789012345678',
    storageName: '../evil/ust_calculus_1.pdf',
  });
  assert.equal(loc.storagePath, 'central/ab12cd34ef567890/ust_calculus_1.pdf');
  assert.ok(loc.fullPath.startsWith(UST_STORAGE_ROOT));
  assert.equal(path.basename(loc.fullPath), 'ust_calculus_1.pdf');

  const fallbackLoc = buildCentralStorageLocation({
    storageName: 'legacy_no_hash.pdf',
  });
  assert.equal(fallbackLoc.storagePath, 'central/library/legacy_no_hash.pdf');
});

test('computeFileSha256 returns stable 64-char hex digest', () => {
  const tmpFile = path.join(os.tmpdir(), `ust_sha_test_${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, 'UST Lecture Platform Integrity Test', 'utf8');
  try {
    const digestA = computeFileSha256(tmpFile);
    const digestB = computeFileSha256(tmpFile);
    assert.equal(digestA.length, 64);
    assert.equal(digestA, digestB);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('resolvePhysicalFilePath rejects path traversal strings safely', () => {
  assert.equal(resolvePhysicalFilePath('..'), null);
  assert.equal(resolvePhysicalFilePath('.', '../../package.json'), null);
  assert.equal(resolvePhysicalFilePath('missing_nonexistent_file_xyz.pdf'), null);
});
