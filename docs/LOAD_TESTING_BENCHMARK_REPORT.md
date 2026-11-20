# UST Platform — Load Testing & Benchmark Report

## 1. Real Local HTTP Benchmark (Measured Against Live Server on Port 3000)

- **Environment**: Single Node.js (`tsx server.ts`) container process, Cache-Aside In-Memory LRU active, no external CDN offload during direct origin loop, client and server co-located on `127.0.0.1`.
- **Note on Single-IP Testing**: All benchmark threads originated from `127.0.0.1`, triggering `createTieredRateLimiter`'s sliding-window per-IP burst limit cleanly after 600 API calls within the 60-second window (as designed for origin DoS protection). Distributed tests using `tests/load/k6-ust-load-test.js` or `tests/load/locustfile.py` across distinct client IPs measure horizontal cluster capacity.

### Measured Endpoint Results

| Endpoint | Concurrency | Total Requests | Duration (s) | Throughput (RPS) | HTTP 200 | HTTP 429 (Rate Limit) | HTTP 5xx | Cache HITs | P50 (ms) | P95 (ms) | P99 (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/health` | 50 | 300 | 0.25s | **1,177.3 RPS** | 300 (100%) | 0 | **0 (0%)** | N/A | 37.20 | 59.05 | 71.91 |
| `GET /api/catalog/lectures` | 50 | 300 | 0.20s | **1,515.1 RPS** | 300 (100%) | 0 | **0 (0%)** | **299 / 300 (99.7%)** | 33.01 | 43.70 | 52.28 |
| `GET /api/catalog/lectures` | 100 | 400 | 0.22s | **1,797.8 RPS** | 300 (75%) | 100 (window cap reached) | **0 (0%)** | **300 / 300 served** | 36.59 | 135.19 | 169.23 |
| `GET /api/exams` *(same-IP burst continuation)* | 50 | 200 | 0.11s | **1,893.0 RPS** | 0 | 200 (protected by 60s window) | **0 (0%)** | N/A | 24.45 | 40.41 | 47.26 |

---

## 2. Key Engineering Findings
1. **Cache-Aside Speedup**: `/api/catalog/lectures` served cached catalog responses at **1,515 RPS** with **P95 latency = 43.7 ms** on a single process and **zero 5xx failures**.
2. **Rate Limiter Resilience**: When single-IP concurrency pushed past the 600 requests/min bucket, `createTieredRateLimiter` rejected excess calls cleanly with `HTTP 429` (`0% 5xx`), preventing event-loop starvation.
3. **Campus NAT Consideration**: If hundreds of students share one university Wi-Fi NAT public IP simultaneously, configure `X-Forwarded-For` behind Cloudflare Edge AND tune per-route read burst quotas or move rate-limit keys to `(IP + User UID)` once authenticated.
4. **Honest Capacity Boundary**: A single Node.js instance handles ~1,100–1,500 cached origin RPS cleanly; scaling to 5,000–100,000 simultaneous students requires multi-replica Cloud Run / K8s HPA (`infra/k8s/hpa-deployment.yaml`), Redis cache synchronization (`infra/redis/redis.conf`), PgBouncer pooling (`infra/pgbouncer/pgbouncer.ini`), and Edge CDN asset offload (`infra/cdn/cloudflare-cdn-rules.json`), validated using `tests/load/k6-ust-load-test.js`.
