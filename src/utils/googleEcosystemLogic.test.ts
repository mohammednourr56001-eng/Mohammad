import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRfc2822EmailRaw,
  canPublishFileToCourseRepository,
  deduplicatePickedDriveFiles,
  evaluateServiceConnectionStatus,
  extractGoogleFormIdFromInput,
  extractSpreadsheetIdFromInput,
  GOOGLE_SERVICES_CATALOG,
  parseAndValidateRecipients,
  sanitizeSheetRange,
  validateCalendarEventDraft,
} from './googleEcosystemLogic';

test('GOOGLE_SERVICES_CATALOG exposes all 6 required Google Workspace services', () => {
  const keys = GOOGLE_SERVICES_CATALOG.map((s) => s.key);
  assert.deepEqual(keys, ['picker', 'sheets', 'forms', 'calendar', 'gmail', 'classroom']);
});

test('evaluateServiceConnectionStatus never reports connected without live check success', () => {
  const noToken = evaluateServiceConnectionStatus({
    serviceKey: 'gmail',
    hasToken: false,
    liveCheckOk: true,
  });
  assert.equal(noToken.status, 'disconnected');

  const failedLive = evaluateServiceConnectionStatus({
    serviceKey: 'classroom',
    hasToken: true,
    liveCheckOk: false,
    httpStatus: 403,
    errorMessage: 'Google Classroom API has not been used in project before or it is disabled.',
  });
  assert.equal(failedLive.status, 'api_disabled');
  assert.ok(failedLive.manualSetupHint && failedLive.manualSetupHint.length > 0);

  const okLive = evaluateServiceConnectionStatus({
    serviceKey: 'sheets',
    hasToken: true,
    liveCheckOk: true,
    accountEmail: 'student@ust.edu',
  });
  assert.equal(okLive.status, 'connected');
  assert.equal(okLive.accountEmail, 'student@ust.edu');
});

test('extractGoogleFormIdFromInput parses Form URLs and raw IDs while rejecting public /e/ form response IDs', () => {
  assert.equal(
    extractGoogleFormIdFromInput('https://docs.google.com/forms/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_123/edit'),
    '1AbCdEfGhIjKlMnOpQrStUvWxYz_123'
  );
  assert.equal(
    extractGoogleFormIdFromInput('1AbCdEfGhIjKlMnOpQrStUvWxYz_123'),
    '1AbCdEfGhIjKlMnOpQrStUvWxYz_123'
  );
  assert.equal(
    extractGoogleFormIdFromInput('https://docs.google.com/forms/d/e/1FAIpQLSdExamplePublicForm/viewform'),
    null
  );
  assert.equal(extractGoogleFormIdFromInput('bad id!'), null);
});

test('extractSpreadsheetIdFromInput and sanitizeSheetRange handle spaces and quotes safely', () => {
  assert.equal(
    extractSpreadsheetIdFromInput('https://docs.google.com/spreadsheets/d/1SheetIdExample_987654321/edit#gid=0'),
    '1SheetIdExample_987654321'
  );
  assert.equal(sanitizeSheetRange("Student Grades '2026'", 'A1:F50'), "'Student Grades ''2026'''!A1:F50");
});

test('parseAndValidateRecipients and buildRfc2822EmailRaw block header injection and invalid emails', () => {
  assert.equal(parseAndValidateRecipients('a@ust.edu, b@ust.edu').valid, true);
  assert.equal(parseAndValidateRecipients('not-an-email').valid, false);
  assert.equal(parseAndValidateRecipients('victim@ust.edu\r\nBcc: attacker@evil.com').valid, false);

  const encoded = buildRfc2822EmailRaw({
    to: 'student@ust.edu',
    subject: 'تنبيه موعد محاضرة',
    body: 'تم تحديث موعد المحاضرة إلى الساعة العاشرة.',
  });
  assert.ok(encoded.length > 20);
  assert.equal(encoded.includes('+'), false);
  assert.equal(encoded.includes('/'), false);
  assert.equal(encoded.includes('='), false);
});

test('validateCalendarEventDraft ensures valid time ordering', () => {
  assert.equal(
    validateCalendarEventDraft({
      title: 'اختبار الفيزياء الطبية',
      startsAtIso: '2026-11-21T09:00:00Z',
      endsAtIso: '2026-11-21T11:00:00Z',
    }).valid,
    true
  );
  assert.equal(
    validateCalendarEventDraft({
      title: 'اختبار الفيزياء الطبية',
      startsAtIso: '2026-11-21T12:00:00Z',
      endsAtIso: '2026-11-21T11:00:00Z',
    }).valid,
    false
  );
});

test('deduplicatePickedDriveFiles skips already selected Drive IDs', () => {
  const result = deduplicatePickedDriveFiles(
    [{ id: 'drive_1', name: 'Lecture 1' }],
    [
      { id: 'drive_1', name: 'Lecture 1 Duplicate' },
      { id: 'drive_2', name: 'Lecture 2' },
    ]
  );
  assert.equal(result.addedCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.merged.length, 2);
});

test('canPublishFileToCourseRepository enforces Super Admin exclusivity', () => {
  assert.equal(canPublishFileToCourseRepository('super_admin', true), true);
  assert.equal(canPublishFileToCourseRepository('admin', false), false);
  assert.equal(canPublishFileToCourseRepository('moderator', false), false);
  assert.equal(canPublishFileToCourseRepository('student', false), false);
});
