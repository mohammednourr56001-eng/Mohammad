# UST Platform — Disaster Recovery & Incident Response Runbook

## 1. Recovery Objectives
- **RPO (Recovery Point Objective)**:
  - Academic Catalog & User Roles: <= 24 hours (daily automated snapshots + pre-migration exports), <= 5 minutes when Point-in-Time Recovery (PITR) is active on Postgres/Firestore.
  - Binary Lecture Files: Versioning & immutable object storage (R2 / GCS Object Versioning).
- **RTO (Recovery Time Objective)**:
  - Stateless Application / Frontend Outage: < 5 minutes (automatic Cloud Run / K8s failover or Cloudflare Pages instant rollback).
  - Database Failover / Restore: 15–45 minutes depending on dataset volume.

---

## 2. Failure Scenarios & Playbooks

### Scenario 1: Application Instance Crash or Bad Deployment
1. **Detection**: `/api/health` returns non-200 or P99 latency spikes in `InfrastructureMonitoringPanel`.
2. **Action**:
   - Roll back Cloudflare Pages deployment to previous green build (1 click).
   - For Cloud Run / K8s: `kubectl rollout undo deployment/ust-app` or route 100% traffic to the previous Cloud Run revision.
   - Verify health probe (`GET /api/health`) and `GET /api/catalog/lectures`.

### Scenario 2: Accidental Deletion of Course / Shared Course Link / Files
1. **Detection**: Missing course or lecture files reported by admin/students.
2. **Action**:
   - Check `/api/admin/audit-logs` (`activityLogs`) to identify exact entity ID, actor, and timestamp.
   - Open Admin Dashboard -> **النسخ الاحتياطي (Backup & Recovery)** and locate the latest snapshot JSON.
   - Restore the canonical `subjects` + `programCourses` + `lectureFiles` metadata cleanly.
   - If the object exists in soft-deleted/versioned bucket storage, restore the object version using matching `storagePath`.

### Scenario 3: Sudden Traffic Spike / DDoS / Exam Wave Overload
1. **Detection**: Rising `429` counts, elevated event-loop / CPU utilization, slow database probe latency in `/api/admin/monitoring`.
2. **Action**:
   - Warm catalog cache immediately via Admin panel (`تسخين الكاش` / `POST /api/admin/monitoring/cache`).
   - Verify Cloudflare Edge caching rules (`infra/cdn/cloudflare-cdn-rules.json`) and WAF rate limits (`infra/security/waf-security-policy.yaml`).
   - Temporarily tighten AI generation rate limit while keeping read/exam endpoints prioritized.

### Scenario 4: Suspected Credential or Rule Misconfiguration
1. **Action**:
   - Rotate `CDN_SIGNING_SECRET`, `UST_SIGNING_SECRET`, or `GEMINI_API_KEY` immediately in server environment / Wrangler secrets.
   - Audit `users` roles in Firestore/PostgreSQL confirming only intended `super_admin` (`mohammednourr56000@gmail.com`) holds promotion privileges.
   - Re-lint & re-deploy `firestore.rules` and `storage.rules`.
