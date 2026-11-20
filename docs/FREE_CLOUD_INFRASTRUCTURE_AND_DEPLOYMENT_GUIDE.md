# UST Platform — 100% Free Cloud Infrastructure & Deployment Guide

> **Policy**: Zero credit card required, zero paid upgrades, Free Tier boundaries strictly respected.

---

## 1. Free-Tier Architecture Overview

| Layer | Service | Free Tier Allowance | Guardrails in UST |
| --- | --- | --- | --- |
| **Frontend Hosting & Edge TLS** | **Cloudflare Pages** | Unlimited static bandwidth, global Anycast CDN, auto-HTTPS | Built from `npm run build` (`dist/`), Arabic RTL (`dir="rtl"`) & responsive layout preserved |
| **Database & Identity (Primary)** | **Firebase Spark Plan** (Firestore + Auth) | 50k reads/day, 20k writes/day, 1 GiB storage | Metadata only (zero Base64 files in Firestore), normalized `programCourses` junction avoids duplicate reads |
| **Relational Option (SQL / RLS)** | **Supabase Free** (PostgreSQL + Auth + RLS) | 500 MB DB, 5 GB egress, 50k MAU, Google OAuth | Reference schema & strict RBAC RLS policies in `docs/reference_postgresql_rls_schema.sql` |
| **Object Storage & Signed URLs** | **Cloudflare R2 Free** + **Cloudflare Workers** | 10 GB storage/month, 10M Class B reads, 1M Class A writes, **$0 egress** | `workers/r2-signed-storage.ts` signs upload/download URLs via HMAC-SHA256 without exposing R2 keys in frontend |
| **Secondary Storage Option** | **Firebase Cloud Storage / Drive Links** | 5 GB / unlimited Drive references | Hardened `storage.rules` + Google Drive metadata linking (`sourceType: 'gdrive'`) |
| **AI Generation** | **Google Gemini API (Free Tier)** | Server-side only via `@google/genai` | Queued async jobs (`/api/ai/jobs`), response caching in LRU/Redis to cut duplicate calls |

---

## 2. Step-by-Step Deployment (Zero Paid Billing)

### A. Cloudflare Pages (Frontend)
1. Push repository to GitHub/GitLab.
2. In Cloudflare Dashboard -> **Workers & Pages** -> **Create Application** -> **Pages**.
3. Configure build settings:
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Node version**: `20`
4. Configure public environment variables (never put private secrets in `VITE_*`):
   - `VITE_FIREBASE_API_KEY` (only if overriding `firebase-applet-config.json`)
   - `VITE_STORAGE_WORKER_URL` (URL of the deployed Cloudflare Worker for R2)
5. Cloudflare automatically provisions TLS 1.3 HTTPS and edge compression (Brotli/Gzip).

### B. Cloudflare R2 Free + Worker Signed Storage (`workers/r2-signed-storage.ts`)
1. Create an R2 bucket named `ust-lectures` inside Cloudflare R2 (Free Tier: 10 GB, zero egress fees).
2. Install Wrangler CLI and bind the bucket + signing secret:
   ```bash
   npx wrangler secret put UST_SIGNING_SECRET
   ```
3. Configure `wrangler.toml`:
   ```toml
   name = "ust-r2-signed-storage"
   main = "workers/r2-signed-storage.ts"
   compatibility_date = "2025-01-01"

   [[r2_buckets]]
   binding = "UST_BUCKET"
   bucket_name = "ust-lectures"
   ```
4. Deploy Worker:
   ```bash
   npx wrangler deploy
   ```
5. Security guarantees enforced inside `workers/r2-signed-storage.ts`:
   - Rejects unauthenticated uploads (`PUT` requires `Authorization` bearer or valid HMAC upload ticket).
   - Validates extension & MIME type (`pdf`, `doc`, `docx`, `ppt`, `pptx`, `jpg`, `png`, `webp`).
   - Enforces single-file max size (`MAX_FILE_SIZE_BYTES`, default 25 MB – 50 MB) and rejects oversized `Content-Length`.
   - Issues short-lived HMAC-SHA256 signed download URLs (`?exp=...&sig=...`) using constant-time verification.

### C. Supabase Free (PostgreSQL + Google OAuth + RLS)
1. Create a free Supabase project (no credit card).
2. Enable **Authentication -> Providers -> Google** with OAuth client ID/secret.
3. Open **SQL Editor** and execute `docs/reference_postgresql_rls_schema.sql`.
4. Verify RBAC roles (`super_admin`, `admin`, `moderator`, `student`):
   - Only `super_admin` (`mohammednourr56000@gmail.com`) can promote or demote users.
   - Public students can only `SELECT` published records.

### D. Firebase Free Spark Setup
1. Deploy Firestore rules (`firestore.rules`) and Storage rules (`storage.rules`):
   ```bash
   npm run lint:rules
   ```
2. Keep `Base64` payloads disabled: all binary files go to R2 / Storage / Google Drive, while Firestore holds lightweight JSON metadata only.

---

## 3. Free-Tier Usage Protection Checklist
- [ ] **No auto-upgrade**: Never attach a billing account if strict $0 operation is required; monitor Firestore daily read/write counters and Storage quota inside `StorageCapacityPanel`.
- [ ] **Cache before Database**: Cache catalog snapshots in client memory + CDN `Cache-Control` headers (`infra/cdn/cloudflare-cdn-rules.json`) + server cache-aside (`server/cacheService.ts`).
- [ ] **Duplicate File Detection**: Block re-uploading identical files (`size + SHA/signature`) and use **Shared Courses** (`programCourses`) so one course's files serve multiple specializations with 0 additional storage bytes.
- [ ] **No client-side secrets**: `GEMINI_API_KEY`, `R2_SECRET_ACCESS_KEY`, `CDN_SIGNING_SECRET`, and `UST_SIGNING_SECRET` stay strictly on server/worker environments.
