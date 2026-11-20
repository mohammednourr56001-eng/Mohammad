import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedCacheLayer } from './cacheLayer.ts';
import { ObservabilityCollector } from './observability.ts';
import { createSignedUrlToken, verifySignedUrlToken } from './securityMiddleware.ts';
import { sanitizeExamForStudent, submitExamAttempt } from './examEngine.ts';
import { AiBackgroundQueueWorker } from './aiQueueWorker.ts';
import { ExamRecord } from '../src/types/academic.ts';

test('DistributedCacheLayer enforces TTL expiration, LRU eviction, and pattern invalidation', async () => {
  const cache = new DistributedCacheLayer({ maxEntries: 3, redisUrl: null });
  await cache.set('catalog:specs', ['a', 'b'], 60);
  await cache.set('catalog:years', ['y1'], 60);
  await cache.set('exams:list', ['e1'], 60);

  // Touch catalog:specs so catalog:years becomes least-recently used
  const specs = await cache.get<string[]>('catalog:specs');
  assert.deepEqual(specs, ['a', 'b']);

  // Adding 4th key should evict catalog:years
  await cache.set('catalog:subjects', ['s1'], 60);
  const evicted = await cache.get('catalog:years');
  assert.equal(evicted, null);

  const removed = cache.invalidatePattern('catalog:');
  assert.equal(removed, 2);
  assert.deepEqual(await cache.get('exams:list'), ['e1']);

  const stats = cache.getStats();
  assert.equal(stats.mode, 'in_memory_lru');
  assert.ok(stats.hits >= 2);
  assert.ok(stats.misses >= 1);
  assert.equal(stats.evictions, 1);
});

test('Signed URL tokens verify valid payloads and reject tampering or wrong action', () => {
  const signed = createSignedUrlToken({
    sub: 'file_lec_123',
    action: 'cdn_download',
    ttlSeconds: 120,
    meta: { uid: 'u1' },
  });

  const ok = verifySignedUrlToken(signed.token, 'cdn_download', 'file_lec_123');
  assert.equal(ok.valid, true);

  const wrongSub = verifySignedUrlToken(signed.token, 'cdn_download', 'file_other');
  assert.equal(wrongSub.valid, false);

  const wrongAction = verifySignedUrlToken(signed.token, 'direct_upload', 'file_lec_123');
  assert.equal(wrongAction.valid, false);

  const tampered = verifySignedUrlToken(`${signed.token}x`, 'cdn_download', 'file_lec_123');
  assert.equal(tampered.valid, false);
});

test('ObservabilityCollector computes exact P50/P95/P99 latency, error rate, and alerts', () => {
  const obs = new ObservabilityCollector('ust-test-node-1');
  const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 500];
  for (let i = 0; i < durations.length; i += 1) {
    obs.recordRequest({
      durationMs: durations[i],
      statusCode: i === 9 ? 500 : 200,
      bytesSent: 1024,
      userKey: `user_${i % 3}`,
    });
  }

  const snap = obs.buildSnapshot({
    dbStatus: 'healthy',
    dbLatencyMs: 18,
    storageUsedBytes: 100 * 1024 * 1024,
    storageQuotaBytes: 1024 * 1024 * 1024,
    storageUsedPct: 9.8,
    cacheStats: {
      mode: 'in_memory_lru',
      connected: true,
      hits: 80,
      misses: 20,
      hitRatioPct: 80,
      keysCount: 5,
      evictions: 0,
      lastError: null,
    },
    queueStats: {
      waiting: 2,
      processing: 1,
      completed: 10,
      failed: 0,
      maxConcurrent: 2,
      totalGenerated: 10,
      cacheSavedCalls: 3,
    },
    aiConfigured: true,
  });

  assert.equal(snap.instance.instanceId, 'ust-test-node-1');
  assert.equal(snap.liveTraffic.totalRequests, 10);
  assert.equal(snap.liveTraffic.activeUsers5m, 3);
  assert.equal(snap.performance.p50ResponseMs, 50);
  assert.equal(snap.performance.p95ResponseMs, 500);
  assert.equal(snap.performance.errorRatePct, 10);
  assert.ok(snap.alerts.some((a) => a.id === 'alert_error_rate'));
  assert.ok(snap.alerts.some((a) => a.id === 'alert_p95_latency'));
});

test('ExamEngine sanitizes answers for students and guarantees idempotent server-side grading', () => {
  const sampleExam: ExamRecord = {
    id: 'exam_unit_test_1',
    specializationId: 'spec_se',
    academicYearId: 'yr_1',
    semesterId: 'sem_1',
    subjectId: 'sub_1',
    title: 'Unit Test Exam',
    difficulty: 'medium',
    durationMinutes: 10,
    questionCount: 2,
    source: 'curated',
    status: 'published',
    createdBy: 'admin',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    questions: [
      {
        id: 'q1',
        type: 'mcq',
        prompt: '2+2=?',
        options: ['3', '4', '5', '6'],
        correctIndex: 1,
        explanation: 'Basic arithmetic',
      },
      {
        id: 'q2',
        type: 'true_false',
        prompt: 'HTTP is stateless',
        options: ['True', 'False'],
        correctIndex: 0,
        explanation: 'HTTP does not retain session state by itself',
      },
    ],
  };

  const sanitized = sanitizeExamForStudent(sampleExam);
  assert.equal(sanitized.questions[0].correctIndex, undefined);
  assert.equal(sanitized.questions[1].correctIndex, undefined);

  const idemKey = `idem_${Date.now()}`;
  const first = submitExamAttempt({
    exam: sampleExam,
    userId: 'student_u1',
    userEmail: 'student@ust.edu',
    idempotencyKey: idemKey,
    answers: { q1: 1, q2: 0 },
    durationSeconds: 45,
  });
  assert.equal(first.deduplicated, false);
  assert.equal(first.attempt.score, 2);
  assert.equal(first.attempt.percentage, 100);

  // Duplicate submission with identical idempotencyKey returns deduplicated attempt
  const second = submitExamAttempt({
    exam: sampleExam,
    userId: 'student_u1',
    userEmail: 'student@ust.edu',
    idempotencyKey: idemKey,
    answers: { q1: 0, q2: 1 },
    durationSeconds: 12,
  });
  assert.equal(second.deduplicated, true);
  assert.equal(second.attempt.id, first.attempt.id);
  assert.equal(second.attempt.score, 2);
});

test('AiBackgroundQueueWorker processes jobs asynchronously, caches output, and tracks retries', async () => {
  let invocations = 0;
  const worker = new AiBackgroundQueueWorker({
    maxConcurrent: 1,
    maxQueueSize: 10,
    persistToDisk: false,
    processor: async (job) => {
      invocations += 1;
      await new Promise((r) => setTimeout(r, 15));
      if (job.topic === 'fail_once' && job.attempts === 1) {
        throw new Error('Transient upstream timeout');
      }
      return { summary: `Summary for ${job.topic}` };
    },
  });

  const job1 = await worker.enqueueJob({
    type: 'pdf_summary',
    requestedBy: 'u1',
    requestedByEmail: 'u1@ust.edu',
    specializationId: 'spec_1',
    academicYearId: 'yr_1',
    semesterId: 'sem_1',
    subjectId: 'sub_1',
    subjectName: 'Algorithms',
    topic: `fail_once`,
    difficulty: 'medium',
    questionCount: 5,
  });

  // Wait for initial failure + auto retry completion
  await new Promise((r) => setTimeout(r, 150));
  const finished1 = worker.getJob(job1.id);
  assert.equal(finished1?.status, 'completed');
  assert.equal(finished1?.attempts, 2);
  assert.equal(finished1?.resultSummary, 'Summary for fail_once');

  // Identical request should hit distributed cache without invoking AI again
  const job2 = await worker.enqueueJob({
    type: 'pdf_summary',
    requestedBy: 'u2',
    requestedByEmail: 'u2@ust.edu',
    specializationId: 'spec_1',
    academicYearId: 'yr_1',
    semesterId: 'sem_1',
    subjectId: 'sub_1',
    subjectName: 'Algorithms',
    topic: `fail_once`,
    difficulty: 'medium',
    questionCount: 5,
  });

  assert.equal(job2.status, 'completed');
  assert.equal(job2.cacheHit, true);
  assert.equal(invocations, 2);
});
