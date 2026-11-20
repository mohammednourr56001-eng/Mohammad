# UST Platform — Enterprise Scalability & High Availability Architecture

## 1. Architectural Principles

UST separates **stateless compute**, **hierarchical academic metadata**, **immutable binary storage**, **edge CDN delivery**, and **asynchronous AI/heavy jobs** so each tier scales independently without becoming a single point of failure.

```
[Students & Faculty (RTL Web/Mobile)]
            │ HTTPS / TLS 1.3
            ▼
 [Cloudflare Edge / Cloud CDN + WAF]
    ├── Static SPA & Cached Lecture Assets (Signed URLs)
    └── /api/* ──► [Nginx / Cloud Load Balancer]
                        │ (Least-Conn, Keep-Alive, Rate Limits)
                        ▼
         [Stateless App Replicas (Express + Vite)]
          ├── Auth Middleware (Firebase ID Token + RBAC)
          ├── Cache-Aside Layer (Redis 7 / In-Memory LRU)
          ├── Timed Exams Engine (Idempotency Key + Concurrency)
          ├── Async AI Queue Worker (@google/genai)
          └── Live Observability (/api/admin/monitoring)
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
   [Firestore /     [Redis /     [Cloud Storage /
   Postgres+PgBouncer] Cluster]   Cloudflare R2]
```

---

## 2. Independent Scaling Tiers

### A. Compute Tier (Horizontal Stateless Replicas)
- **Container**: Multi-stage production `Dockerfile` running `node server.ts`.
- **Kubernetes HPA** (`infra/k8s/hpa-deployment.yaml`): Auto-scales replicas (`minReplicas: 2` to `maxReplicas: 50`) on CPU (65%), Memory (75%), and custom HTTP RPS targets.
- **Google Cloud Run** (`infra/cloudrun/service.yaml`): Scales dynamically from minimum warm instances up to `maxScale` with `concurrency: 80` per container and graceful `SIGTERM` connection draining.
- **Multi-Instance Local/VM Compose** (`docker-compose.scale.yml`): Nginx load balancer fronting multiple stateless `ust-app` nodes + Redis 7 + PgBouncer.

### B. Caching & Rate-Limiting Tier (`server/cacheService.ts`, `infra/redis/redis.conf`)
- **Pattern**: Cache-Aside with TTL + explicit prefix invalidation (`invalidatePrefix`) upon admin writes.
- **Keys**:
  - `catalog:published:*` (hierarchical published specializations, years, semesters, shared `programCourses`, courses)
  - `storage:stats` (cached aggregation to avoid full collection scans)
  - `ai:exam:*` / `ai:summary:*` (deduplicates repeated Gemini calls for the same topic/file)
- **Sliding-Window Rate Limiter** (`server/rateLimiter.ts`): Protects login, search, download, AI generation, and exam submission endpoints from abusive bursts (`HTTP 429` with `Retry-After`).

### C. Database & Connection Pooling (`infra/pgbouncer/pgbouncer.ini`)
- **PgBouncer (`pool_mode = transaction`)**: Multiplexes thousands of concurrent app requests onto a bounded number of PostgreSQL backend connections (`default_pool_size = 50`, `max_client_conn = 5000`) preventing connection exhaustion during exam spikes.
- **Normalized Shared Courses (`programCourses`)**: Eliminates duplicated course documents and lecture file rows across multiple specializations.

### D. Storage & CDN Tier (`server/cdnSigner.ts`, `infra/cdn/cloudflare-cdn-rules.json`)
- **Direct Upload Pipeline** (`server/directUploadService.ts`): Validates extension, MIME type, size bounds, and storage quota **before** binary transfer; streams directly without inflating Firestore documents with Base64 strings.
- **Signed Download URLs**: Short-lived HMAC-SHA256 signatures verified at the Edge/Worker before serving lecture PDFs/PPTs, tracking download telemetry asynchronously without blocking file delivery.

### E. Background Queue & High-Concurrency Exams
- **Timed Exam Engine** (`server/examEngine.ts`):
  - Server-authoritative deadlines (`expiresAt`) prevent client clock manipulation.
  - **Idempotency Keys** prevent duplicate grading or database writes when 1,000+ students submit simultaneously or retry on flaky mobile networks.
- **AI Job Queue** (`server/aiJobQueue.ts`):
  - Decouples slow `@google/genai` LLM inference from the HTTP request thread.
  - Supports bounded concurrency, exponential backoff retries, dead-letter reporting, and Super Admin retry controls in `InfrastructureMonitoringPanel`.

---

## 3. Security Controls Summary
- **WAF & Edge Rules**: Configured in `infra/security/waf-security-policy.yaml` (SQLi/XSS mitigation, geo/rate rules, strict CSP & HSTS headers).
- **Least Privilege RBAC**: Enforced simultaneously on React UI, Express middleware (`server/authMiddleware.ts`), Firestore (`firestore.rules`), Storage (`storage.rules`), and PostgreSQL RLS (`docs/reference_postgresql_rls_schema.sql`).
- **Super Admin Exclusive Controls**: Only `super_admin` can promote/demote admins/moderators, change storage quotas, restore backups, and view `/api/admin/monitoring`.
