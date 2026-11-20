# UST Platform — Phased Scaling Roadmap

## Phase 1: Hardened Free-Tier Launch (Current Ready State)
- **Target**: 0 monthly fixed cost, hundreds of concurrent users.
- **Stack**:
  - Cloudflare Pages (static RTL frontend + global HTTPS).
  - Firebase Spark (Firestore metadata + Google Auth) or Supabase Free (PostgreSQL + RLS).
  - Cloudflare R2 Free Worker (`workers/r2-signed-storage.ts`) + Google Drive linked documents.
  - Shared Courses system (`programCourses`) preventing duplicate courses & binary uploads.
  - Hardened `firestore.rules`, `storage.rules`, RBAC UI/API checks, and responsive mobile Admin Drawer.

## Phase 2: University-Wide Multi-Replica Growth (2,500 – 10,000 Concurrent)
- Deploy containerized backend (`Dockerfile`) across 3–8 stateless replicas behind Nginx / Cloud Run.
- Attach managed **Redis** (`infra/redis/redis.conf`) so caching, rate limits, and AI job states synchronize across all replicas.
- Move primary relational analytics & exam submission tables to PostgreSQL behind **PgBouncer** (`infra/pgbouncer/pgbouncer.ini`).
- Enforce automated CI/CD checks (`.github/workflows/ci-cd.yml`) + scheduled `k6` load benchmarks.

## Phase 3: High-Concurrency Exam & Multi-Campus Enterprise (25,000 – 50,000 Concurrent)
- Enable PostgreSQL Read Replicas (route catalog reads to replicas, writes to primary).
- Scale Kubernetes HPA (`infra/k8s/hpa-deployment.yaml`) across multiple availability zones with WAF edge rules (`infra/security/waf-security-policy.yaml`).
- Offload AI exam generation and PDF summarization exclusively to dedicated background worker pods draining the Redis-backed AI queue.

## Phase 4: National / Massive Scale (100,000+ Concurrent Peaks)
- Partition high-volume append-only tables (`exam_submissions`, `audit_logs`, `download_events`) by semester/month.
- Deploy multi-region Edge CDN origin shielding and active-active object storage replication.
- Establish continuous Chaos Testing & quarterly Disaster Recovery failover drills.
