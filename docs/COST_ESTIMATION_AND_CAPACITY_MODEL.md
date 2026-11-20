# UST Platform — Cost Estimation & Capacity Planning Model

> **Engineering Notice**: Concurrent user limits are never "unlimited". Every capacity tier below defines concrete compute replicas, cache sizing, database throughput, and CDN offload assumptions that **must be validated via load testing (`tests/load/k6-ust-load-test.js`)** before certifying production SLAs.

---

## 1. Traffic & Resource Assumptions
- **CDN Offload Target**: 85%–92% of static SPA bundles and lecture PDF/PPT downloads served directly from Edge CDN / R2 without hitting origin Node.js compute.
- **Cache Hit Ratio Target**: >= 85% for catalog reads (`/api/catalog/lectures`) via Redis / LRU cache-aside.
- **Active Concurrency Ratio**: Typically 5%–10% of daily active students are simultaneously issuing requests within the same 1-minute window; during exam opening minutes, burst factor rises 3x–4x.

---

## 2. Capacity Scenarios (A – F)

| Scenario | Simultaneous Users | Target Peak RPS (Origin) | App Replicas (Stateless) | Cache Tier (Redis) | Database Tier | Storage & CDN | Est. Monthly Infrastructure Cost (USD) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **A (Free Tier / Launch)** | Up to ~500 – 1,000 | 30 – 80 RPS | 1–2 small containers / Cloud Pages + Spark | In-Memory LRU + Edge Cache | Firebase Spark / Supabase Free | Cloudflare R2 Free (10 GB) + Google Drive | **$0 / month** |
| **B (Department / Campus)** | 2,500 – 5,000 | 150 – 350 RPS | 3–4 replicas (1 vCPU, 1 GB RAM each) | Redis 1 GB | Managed Postgres (2 vCPU, 4 GB RAM) + PgBouncer | R2 / Cloud Storage (~100 GB) + CDN | **$45 – $120 / month** |
| **C (Mid-Size University)** | 10,000 | 400 – 800 RPS | 6–10 replicas (HPA 2–12) | Redis 2–4 GB HA | Postgres Primary + 1 Read Replica (4 vCPU, 16 GB) | 500 GB Storage + 2 TB CDN Egress | **$250 – $550 / month** |
| **D (Peak Exam Wave)** | 25,000 | 1,200 – 2,200 RPS | 14–22 replicas (2 vCPU, 2 GB RAM) | Redis 6 GB Cluster | Postgres 8 vCPU + 2 Read Replicas + PgBouncer | 1 TB Storage + 5 TB CDN Egress | **$750 – $1,400 / month** |
| **E (Multi-Campus Scale)** | 50,000 | 2,500 – 4,500 RPS | 28–45 replicas across 2 AZs | Redis Cluster 12 GB | Postgres 16 vCPU Primary + 3 Read Replicas | Multi-region Bucket + 15 TB CDN | **$1,800 – $3,200 / month** |
| **F (National / Massive Peak)** | 100,000 | 5,000 – 9,000 RPS | 50–90 replicas + Cloud Run / GKE Regional | Sharded Redis Cluster (24 GB+) | Distributed Read Replicas + Partitioned Exam Submissions | 3 TB Storage + 35 TB CDN + Dedicated WAF | **$4,200 – $7,800 / month** |

---

## 3. Known Bottlenecks & Mitigations at Each Boundary
1. **Single-Process Memory Store** (Scenario A): When running on 1 instance without Redis, cache & rate-limit windows are process-local. Beyond Scenario A, attach Redis (`REDIS_URL`) so all replicas share rate-limit counters, AI deduplication, and cache invalidations.
2. **Exam Submission Bursts** (Scenarios C–F): Simultaneous end-of-timer exam submissions spike DB writes. Mitigate with client jitter (`0–5s` randomized retry backoff), **Idempotency-Key deduplication**, and queue-buffered grading.
3. **Database Connections**: Never open raw per-request Postgres connections from 40+ replicas; always route through `infra/pgbouncer/pgbouncer.ini` in transaction pooling mode.
4. **AI Quota Exhaustion**: Strict rate limiting + prompt/topic hash caching ensures 1,000 students reviewing the same lecture quiz reuse cached questions instead of firing 1,000 Gemini requests.
