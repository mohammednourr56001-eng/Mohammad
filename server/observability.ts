import crypto from 'crypto';
import os from 'os';
import { NextFunction, Request, Response } from 'express';
import {
  ObservabilitySnapshot,
  SystemAlertItem,
  TelemetryBucket,
} from '../src/types/academic.ts';
import { CacheStats } from './cacheLayer.ts';

interface LatencySample {
  ts: number;
  durationMs: number;
  statusCode: number;
}

interface MinuteAggregate {
  minuteKey: string;
  label: string;
  requests: number;
  errors: number;
  latencies: number[];
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1)
  );
  return Math.round(sortedAsc[idx] * 100) / 100;
}

export class ObservabilityCollector {
  public readonly instanceId: string;
  public readonly startedAt: number;
  public draining = false;

  private concurrentConnections = 0;
  private totalRequests = 0;
  private failedRequests = 0;
  private loginSyncs = 0;
  private fileDownloads = 0;
  private examSubmissions = 0;
  private rateLimitedRequests = 0;
  private networkBytesSent = 0;

  private readonly samples: LatencySample[] = [];
  private readonly maxSamples = 5000;
  private readonly activeUsers = new Map<string, number>();
  private readonly activeSessions = new Map<string, number>();
  private readonly minuteBuckets = new Map<string, MinuteAggregate>();

  private lastCpuUsage = process.cpuUsage();
  private lastCpuSampleTime = Date.now();
  private lastCpuPercent = 0;

  constructor(instanceId?: string) {
    this.instanceId =
      instanceId ||
      process.env.K_REVISION ||
      process.env.HOSTNAME ||
      `ust-node-${crypto.randomBytes(3).toString('hex')}`;
    this.startedAt = Date.now();
  }

  public recordConnectionStart(): void {
    this.concurrentConnections += 1;
  }

  public recordConnectionEnd(): void {
    this.concurrentConnections = Math.max(0, this.concurrentConnections - 1);
  }

  public recordActivityUser(uidOrKey: string, sessionId?: string): void {
    const now = Date.now();
    if (uidOrKey) {
      this.activeUsers.set(uidOrKey, now);
    }
    if (sessionId) {
      this.activeSessions.set(sessionId, now);
    }
    if (this.activeUsers.size > 50000) {
      this.pruneActiveUsers(now);
    }
  }

  public recordLoginSync(): void {
    this.loginSyncs += 1;
  }

  public recordFileDownload(): void {
    this.fileDownloads += 1;
  }

  public recordExamSubmission(): void {
    this.examSubmissions += 1;
  }

  public recordRateLimitBlock(): void {
    this.rateLimitedRequests += 1;
  }

  public recordRequest(params: {
    durationMs: number;
    statusCode: number;
    bytesSent?: number;
    userKey?: string;
    sessionKey?: string;
  }): void {
    const now = Date.now();
    this.totalRequests += 1;
    const isError = params.statusCode >= 500;
    if (isError) {
      this.failedRequests += 1;
    }
    if (params.bytesSent && params.bytesSent > 0) {
      this.networkBytesSent += params.bytesSent;
    }
    if (params.userKey) {
      this.activeUsers.set(params.userKey, now);
    }
    if (params.sessionKey) {
      this.activeSessions.set(params.sessionKey, now);
    }

    this.samples.push({
      ts: now,
      durationMs: Math.max(0, params.durationMs),
      statusCode: params.statusCode,
    });
    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples);
    }

    const d = new Date(now);
    const minuteKey = d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
    const label = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    let bucket = this.minuteBuckets.get(minuteKey);
    if (!bucket) {
      bucket = {
        minuteKey,
        label,
        requests: 0,
        errors: 0,
        latencies: [],
      };
      this.minuteBuckets.set(minuteKey, bucket);
      if (this.minuteBuckets.size > 60) {
        const oldestKey = this.minuteBuckets.keys().next().value;
        if (oldestKey) this.minuteBuckets.delete(oldestKey);
      }
    }
    bucket.requests += 1;
    if (isError) bucket.errors += 1;
    if (bucket.latencies.length < 2000) {
      bucket.latencies.push(params.durationMs);
    }
  }

  private pruneActiveUsers(now = Date.now()): void {
    const cutoff = now - 5 * 60 * 1000;
    for (const [k, ts] of this.activeUsers.entries()) {
      if (ts < cutoff) this.activeUsers.delete(k);
    }
    for (const [k, ts] of this.activeSessions.entries()) {
      if (ts < cutoff) this.activeSessions.delete(k);
    }
  }

  private sampleCpuPercent(): number {
    const now = Date.now();
    const elapsedMs = now - this.lastCpuSampleTime;
    if (elapsedMs >= 500) {
      const diff = process.cpuUsage(this.lastCpuUsage);
      const totalCpuMs = (diff.user + diff.system) / 1000;
      const cpuCores = Math.max(1, os.cpus().length);
      this.lastCpuPercent = Math.min(
        100,
        Math.round(((totalCpuMs / (elapsedMs * cpuCores)) * 100) * 10) / 10
      );
      this.lastCpuUsage = process.cpuUsage();
      this.lastCpuSampleTime = now;
    }
    return this.lastCpuPercent;
  }

  public getPerformanceMetrics(): {
    avgResponseMs: number;
    p50ResponseMs: number;
    p95ResponseMs: number;
    p99ResponseMs: number;
    requestsPerSecond: number;
    errorRatePct: number;
    sampleCount: number;
  } {
    const now = Date.now();
    const recent1m = this.samples.filter((s) => now - s.ts <= 60_000);
    const rps = Math.round((recent1m.length / 60) * 100) / 100;

    const durations = this.samples.map((s) => s.durationMs).sort((a, b) => a - b);
    const avg =
      durations.length > 0
        ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 100) / 100
        : 0;
    const errorRatePct =
      this.totalRequests > 0
        ? Math.round((this.failedRequests / this.totalRequests) * 10000) / 100
        : 0;

    return {
      avgResponseMs: avg,
      p50ResponseMs: percentile(durations, 50),
      p95ResponseMs: percentile(durations, 95),
      p99ResponseMs: percentile(durations, 99),
      requestsPerSecond: rps,
      errorRatePct,
      sampleCount: durations.length,
    };
  }

  public getHistoryBuckets(): TelemetryBucket[] {
    return Array.from(this.minuteBuckets.values()).map((b) => {
      const sorted = [...b.latencies].sort((a, c) => a - c);
      const avg =
        sorted.length > 0
          ? Math.round((sorted.reduce((sum, v) => sum + v, 0) / sorted.length) * 100) / 100
          : 0;
      return {
        minuteIso: b.minuteKey,
        label: b.label,
        requests: b.requests,
        errors: b.errors,
        avgLatencyMs: avg,
        p95LatencyMs: percentile(sorted, 95),
      };
    });
  }

  public buildSnapshot(deps: {
    dbStatus: 'healthy' | 'degraded';
    dbLatencyMs: number;
    storageUsedBytes: number;
    storageQuotaBytes: number;
    storageUsedPct: number;
    cacheStats: CacheStats;
    queueStats: {
      waiting: number;
      processing: number;
      completed: number;
      failed: number;
      maxConcurrent: number;
      totalGenerated: number;
      cacheSavedCalls: number;
    };
    aiConfigured: boolean;
  }): ObservabilitySnapshot {
    const now = Date.now();
    this.pruneActiveUsers(now);

    const perf = this.getPerformanceMetrics();
    const cpuPercent = this.sampleCpuPercent();
    const mem = process.memoryUsage();
    const memoryRssMB = Math.round((mem.rss / (1024 * 1024)) * 10) / 10;
    const heapUsedMB = Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10;
    const heapTotalMB = Math.round((mem.heapTotal / (1024 * 1024)) * 10) / 10;
    const osTotalMemMB = Math.round(os.totalmem() / (1024 * 1024));
    const osFreeMemMB = Math.round(os.freemem() / (1024 * 1024));
    const loadAvg1m = Math.round((os.loadavg()[0] || 0) * 100) / 100;

    const alerts: SystemAlertItem[] = [];
    if (perf.p95ResponseMs > 400) {
      alerts.push({
        id: 'alert_p95_latency',
        severity: perf.p95ResponseMs > 1000 ? 'critical' : 'warning',
        metric: 'P95 Latency',
        message: 'ارتفاع زمن الاستجابة (P95) عن الحد المستهدف — يُوصى بتوسيع الخادم أفقياً.',
        currentValue: `${perf.p95ResponseMs} ms`,
        threshold: '400 ms',
      });
    }
    if (perf.errorRatePct > 2) {
      alerts.push({
        id: 'alert_error_rate',
        severity: perf.errorRatePct > 5 ? 'critical' : 'warning',
        metric: 'HTTP 5xx Error Rate',
        message: 'نسبة أخطاء الخادم (5xx) تجاوزت الحد المسموح.',
        currentValue: `${perf.errorRatePct}%`,
        threshold: '2%',
      });
    }
    if (cpuPercent >= 70) {
      alerts.push({
        id: 'alert_cpu',
        severity: cpuPercent >= 85 ? 'critical' : 'warning',
        metric: 'CPU Utilization',
        message: 'استهلاك المعالج بلغ عتبة التوسع التلقائي (Auto-Scaling >= 70%).',
        currentValue: `${cpuPercent}%`,
        threshold: '70%',
      });
    }
    if (deps.storageUsedPct >= 85) {
      alerts.push({
        id: 'alert_storage',
        severity: deps.storageUsedPct >= 95 ? 'critical' : 'warning',
        metric: 'Storage Quota',
        message: 'استهلاك مساحة تخزين المحاضرات اقترب من الحد الأقصى.',
        currentValue: `${deps.storageUsedPct}%`,
        threshold: '85%',
      });
    }
    if (deps.queueStats.waiting > 20) {
      alerts.push({
        id: 'alert_ai_queue',
        severity: 'warning',
        metric: 'AI Queue Depth',
        message: 'طابور مهام الذكاء الاصطناعي يشهد ضغطاً مرتفعاً.',
        currentValue: `${deps.queueStats.waiting} مهمة`,
        threshold: '20 مهمة',
      });
    }

    const overall: 'healthy' | 'degraded' | 'critical' =
      this.draining || deps.dbStatus === 'degraded' || perf.errorRatePct > 5
        ? 'critical'
        : alerts.some((a) => a.severity === 'critical' || a.severity === 'warning')
          ? 'degraded'
          : 'healthy';

    const storageStatus: 'healthy' | 'warning' | 'full' =
      deps.storageUsedPct >= 100 ? 'full' : deps.storageUsedPct >= 85 ? 'warning' : 'healthy';

    const aiServiceStatus: 'ready' | 'unconfigured' | 'saturated' = !deps.aiConfigured
      ? 'unconfigured'
      : deps.queueStats.waiting >= 25
        ? 'saturated'
        : 'ready';

    return {
      capturedAt: new Date(now).toISOString(),
      instance: {
        instanceId: this.instanceId,
        hostname: os.hostname(),
        pid: process.pid,
        nodeVersion: process.version,
        uptimeSeconds: Math.floor((now - this.startedAt) / 1000),
        draining: this.draining,
        environment: process.env.NODE_ENV || 'development',
      },
      systemStatus: {
        overall,
        appServer: this.draining ? 'draining' : 'healthy',
        database: {
          status: deps.dbStatus,
          engine: 'Firestore Enterprise + PostgreSQL RLS Blueprint',
          latencyMs: deps.dbLatencyMs,
        },
        storage: {
          status: storageStatus,
          usedBytes: deps.storageUsedBytes,
          quotaBytes: deps.storageQuotaBytes,
          usedPct: deps.storageUsedPct,
        },
        cdn: {
          status: 'edge_ready',
          signedUrlsEnabled: true,
        },
        cache: {
          mode: deps.cacheStats.mode,
          connected: deps.cacheStats.connected,
          hits: deps.cacheStats.hits,
          misses: deps.cacheStats.misses,
          hitRatioPct: deps.cacheStats.hitRatioPct,
          keysCount: deps.cacheStats.keysCount,
          evictions: deps.cacheStats.evictions,
        },
        backgroundQueue: {
          waiting: deps.queueStats.waiting,
          processing: deps.queueStats.processing,
          completed: deps.queueStats.completed,
          failed: deps.queueStats.failed,
          maxConcurrent: deps.queueStats.maxConcurrent,
        },
        aiService: {
          status: aiServiceStatus,
          model: 'gemini-4-hydrogen',
          totalGenerated: deps.queueStats.totalGenerated,
          cacheSavedCalls: deps.queueStats.cacheSavedCalls,
        },
      },
      liveTraffic: {
        activeUsers5m: this.activeUsers.size,
        activeSessions: this.activeSessions.size,
        requestsPerSecond: perf.requestsPerSecond,
        concurrentConnections: this.concurrentConnections,
        totalRequests: this.totalRequests,
        loginSyncs: this.loginSyncs,
        fileDownloads: this.fileDownloads,
        examSubmissions: this.examSubmissions,
        rateLimitedRequests: this.rateLimitedRequests,
      },
      performance: {
        avgResponseMs: perf.avgResponseMs,
        p50ResponseMs: perf.p50ResponseMs,
        p95ResponseMs: perf.p95ResponseMs,
        p99ResponseMs: perf.p99ResponseMs,
        dbProbeLatencyMs: deps.dbLatencyMs,
        cacheHitRatioPct: deps.cacheStats.hitRatioPct,
        errorRatePct: perf.errorRatePct,
        failedRequests: this.failedRequests,
        sampleCount: perf.sampleCount,
      },
      infrastructure: {
        cpuPercent,
        loadAvg1m,
        memoryRssMB,
        heapUsedMB,
        heapTotalMB,
        osTotalMemMB,
        osFreeMemMB,
        serverInstancesConfigured: Math.max(1, Number(process.env.UST_CLUSTER_INSTANCES) || 1),
        networkBytesSent: this.networkBytesSent,
      },
      history: this.getHistoryBuckets(),
      alerts,
    };
  }
}

export const observability = new ObservabilityCollector();

export function createObservabilityMiddleware(collector: ObservabilityCollector = observability) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startNs = process.hrtime.bigint();
    collector.recordConnectionStart();

    const requestId =
      (typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id'].slice(0, 64)) ||
      crypto.randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Instance-Id', collector.instanceId);

    const sessionHeader =
      typeof req.headers['x-session-id'] === 'string' ? req.headers['x-session-id'].slice(0, 64) : undefined;
    const ipKey = req.ip || req.socket.remoteAddress || 'anon';

    res.on('finish', () => {
      collector.recordConnectionEnd();
      const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      const contentLenHeader = res.getHeader('Content-Length');
      const bytesSent = contentLenHeader ? Number(contentLenHeader) || 0 : 0;

      // Only meter API & page requests (skip Vite HMR/asset chatter in dev)
      if (req.path.startsWith('/api/') || req.path === '/') {
        const authReq = req as Request & { serverAuth?: { uid?: string } | null };
        collector.recordRequest({
          durationMs,
          statusCode: res.statusCode,
          bytesSent,
          userKey: authReq.serverAuth?.uid || ipKey,
          sessionKey: sessionHeader || ipKey,
        });
      }
    });

    next();
  };
}
