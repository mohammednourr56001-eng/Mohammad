import http from 'node:http';
import os from 'node:os';
import { performance } from 'node:perf_hooks';

interface StageResult {
  concurrency: number;
  mode: 'simultaneous_burst' | 'sustained_session';
  durationSec: number;
  totalRequests: number;
  ok200: number;
  notModified304: number;
  rateLimited429: number;
  errors5xxOrNet: number;
  rps: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  errorRatePct: number;
  cacheHeaders: Record<string, number>;
}

const BASE_URL = process.env.UST_LOAD_TARGET || 'http://127.0.0.1:3000';
const STAGES = [50, 100, 250, 500, 750, 1000];
const STAGE_DURATION_MS = Number(process.env.UST_STAGE_MS) || 3500;
const THINK_TIME_MS = Number(process.env.UST_THINK_MS) || 200;

const agent = new http.Agent({
  keepAlive: true,
  maxSockets: 1500,
  maxFreeSockets: 512,
});

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx] * 100) / 100;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGet(
  targetUrl: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; xCache: string; etag: string; ms: number }> {
  const url = new URL(targetUrl);
  const start = performance.now();
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: Number(url.port) || 80,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        agent,
        headers,
        timeout: 15_000,
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            xCache: String(res.headers['x-cache'] || 'NONE').toUpperCase(),
            etag: String(res.headers.etag || ''),
            ms: performance.now() - start,
          });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, xCache: 'TIMEOUT', etag: '', ms: performance.now() - start });
    });
    req.on('error', () => {
      resolve({ status: 0, xCache: 'NET_ERR', etag: '', ms: performance.now() - start });
    });
    req.end();
  });
}

function pickRequest(step: number, cachedEtag: string): Promise<{ status: number; xCache: string; etag: string; ms: number }> {
  const mod = step % 10;
  if (mod < 5) {
    const headers: Record<string, string> =
      mod < 3 && cachedEtag ? { 'If-None-Match': cachedEtag } : {};
    return httpGet(`${BASE_URL}/api/catalog/snapshot`, headers);
  }
  if (mod < 8) {
    return httpGet(`${BASE_URL}/api/catalog/lectures?page=1&limit=20`);
  }
  return httpGet(`${BASE_URL}/api/exams?page=1&limit=20`);
}

function summarize(
  concurrency: number,
  mode: StageResult['mode'],
  durationSec: number,
  responses: Array<{ status: number; xCache: string; ms: number }>
): StageResult {
  const latencies = responses.map((r) => r.ms).sort((a, b) => a - b);
  const cacheHeaders: Record<string, number> = {};
  let ok200 = 0;
  let notModified304 = 0;
  let rateLimited429 = 0;
  let errors5xxOrNet = 0;

  for (const r of responses) {
    cacheHeaders[r.xCache] = (cacheHeaders[r.xCache] || 0) + 1;
    if (r.status === 200) ok200 += 1;
    else if (r.status === 304) notModified304 += 1;
    else if (r.status === 429) rateLimited429 += 1;
    else errors5xxOrNet += 1;
  }

  const totalRequests = responses.length;
  const sum = latencies.reduce((acc, v) => acc + v, 0);
  const failed = rateLimited429 + errors5xxOrNet;

  return {
    concurrency,
    mode,
    durationSec: Math.round(durationSec * 100) / 100,
    totalRequests,
    ok200,
    notModified304,
    rateLimited429,
    errors5xxOrNet,
    rps: Math.round((totalRequests / Math.max(0.001, durationSec)) * 10) / 10,
    avgMs: totalRequests ? Math.round((sum / totalRequests) * 100) / 100 : 0,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    maxMs: latencies.length ? Math.round(latencies[latencies.length - 1] * 100) / 100 : 0,
    errorRatePct: totalRequests ? Math.round((failed / totalRequests) * 10000) / 100 : 0,
    cacheHeaders,
  };
}

async function runSimultaneousBurst(concurrency: number, cachedEtag: string): Promise<StageResult> {
  const start = performance.now();
  const responses = await Promise.all(
    Array.from({ length: concurrency }, (_, idx) => pickRequest(idx, cachedEtag))
  );
  const durationSec = (performance.now() - start) / 1000;
  return summarize(concurrency, 'simultaneous_burst', durationSec, responses);
}

async function runSustainedSession(concurrency: number, cachedEtag: string): Promise<StageResult> {
  const responses: Array<{ status: number; xCache: string; ms: number }> = [];
  const stopAt = performance.now() + STAGE_DURATION_MS;
  const start = performance.now();

  const worker = async (workerId: number) => {
    // Stagger initial connection slightly like real users
    await sleep((workerId % 20) * 5);
    let step = workerId;
    while (performance.now() < stopAt) {
      step += 1;
      const res = await pickRequest(step, cachedEtag);
      responses.push(res);
      await sleep(THINK_TIME_MS);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, (_, idx) => worker(idx)));
  const durationSec = (performance.now() - start) / 1000;
  return summarize(concurrency, 'sustained_session', durationSec, responses);
}

async function main() {
  const warmup = await httpGet(`${BASE_URL}/api/catalog/snapshot`);
  if (warmup.status !== 200) {
    console.error(`Target server ${BASE_URL} returned status ${warmup.status} on warmup.`);
    process.exit(1);
  }
  const cachedEtag = warmup.etag;

  const results: StageResult[] = [];
  for (const concurrency of STAGES) {
    const burst = await runSimultaneousBurst(concurrency, cachedEtag);
    results.push(burst);
    console.log(
      `[BURST ${concurrency}] RPS=${burst.rps} | total=${burst.totalRequests} | 200=${burst.ok200} | 304=${burst.notModified304} | 429=${burst.rateLimited429} | err=${burst.errors5xxOrNet} | avg=${burst.avgMs}ms | p95=${burst.p95Ms}ms | p99=${burst.p99Ms}ms`
    );

    const sustained = await runSustainedSession(concurrency, cachedEtag);
    results.push(sustained);
    console.log(
      `[SUSTAINED ${concurrency}] RPS=${sustained.rps} | total=${sustained.totalRequests} | 200=${sustained.ok200} | 304=${sustained.notModified304} | 429=${sustained.rateLimited429} | err=${sustained.errors5xxOrNet} | avg=${sustained.avgMs}ms | p95=${sustained.p95Ms}ms | p99=${sustained.p99Ms}ms`
    );
  }

  const healthRes = await fetch(`${BASE_URL}/api/health`).then((r) => r.json()).catch(() => null);
  console.log(
    JSON.stringify(
      {
        target: BASE_URL,
        hostLoadAvg: os.loadavg(),
        freeMemMB: Math.round(os.freemem() / 1024 / 1024),
        serverHealth: healthRes,
        stages: results,
      },
      null,
      2
    )
  );
  agent.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
