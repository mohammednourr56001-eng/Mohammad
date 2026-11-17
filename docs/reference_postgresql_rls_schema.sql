-- =============================================================================
-- منصة UST للمحاضرات — Reference PostgreSQL + Row-Level Security (RLS) Schema
-- =============================================================================
-- NOTE: In the live AI Studio environment, Cloud SQL provisioning hit project
-- quota limits, so live runtime persistence uses Firebase Firestore + Express
-- structured file storage. Use this schema when migrating to PostgreSQL/Supabase.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. ROLES & PERMISSIONS
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY, -- 'super_admin' | 'admin' | 'moderator' | 'student'
  hierarchy_level INTEGER NOT NULL,
  label_ar TEXT NOT NULL
);

INSERT INTO roles (id, hierarchy_level, label_ar) VALUES
  ('super_admin', 1, 'المدير الرئيسي / مالك المنصة'),
  ('admin', 2, 'مسؤول إداري'),
  ('moderator', 3, 'مشرف رفع محتوى'),
  ('student', 4, 'طالب')
ON CONFLICT (id) DO NOTHING;

-- 2. USERS
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid TEXT UNIQUE NOT NULL,
  google_sub TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  photo_url TEXT,
  role_id TEXT NOT NULL DEFAULT 'student' REFERENCES roles(id),
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended')),
  is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce single Super Admin invariant at DB level
CREATE UNIQUE INDEX IF NOT EXISTS uniq_single_super_admin
  ON users ((is_super_admin))
  WHERE is_super_admin = TRUE;

-- 3. ADMIN INVITATIONS
CREATE TABLE IF NOT EXISTS admin_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  role_id TEXT NOT NULL CHECK (role_id IN ('admin', 'moderator')),
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  invited_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ
);

-- 4. ACADEMIC HIERARCHY
CREATE TABLE IF NOT EXISTS specializations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  icon_key TEXT NOT NULL DEFAULT 'stethoscope',
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'draft')),
  sort_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS academic_years (
  id TEXT PRIMARY KEY,
  specialization_id TEXT NOT NULL REFERENCES specializations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'draft')),
  sort_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS semesters (
  id TEXT PRIMARY KEY,
  specialization_id TEXT NOT NULL REFERENCES specializations(id) ON DELETE CASCADE,
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'draft')),
  sort_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  specialization_id TEXT NOT NULL REFERENCES specializations(id) ON DELETE CASCADE,
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  icon_key TEXT NOT NULL DEFAULT 'book',
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'draft')),
  sort_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. LECTURE FILES & STORAGE METADATA
CREATE TABLE IF NOT EXISTS lecture_files (
  id TEXT PRIMARY KEY,
  specialization_id TEXT NOT NULL REFERENCES specializations(id) ON DELETE CASCADE,
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT NOT NULL,
  original_name TEXT NOT NULL,
  storage_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_ext TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size >= 0),
  sha256_hash TEXT NOT NULL,
  allow_download BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'draft')),
  uploaded_by_uid TEXT NOT NULL,
  uploaded_by_email TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lecture_files_hierarchy
  ON lecture_files (specialization_id, academic_year_id, semester_id, subject_id, status);
CREATE INDEX IF NOT EXISTS idx_lecture_files_sha256
  ON lecture_files (sha256_hash);

-- 6. IMMUTABLE AUDIT LOGS & BACKUP SNAPSHOTS
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_name TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('success', 'denied', 'failed')),
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS backup_snapshots (
  id TEXT PRIMARY KEY,
  backup_type TEXT NOT NULL CHECK (backup_type IN ('db', 'files', 'full')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  file_path TEXT NOT NULL,
  total_bytes BIGINT NOT NULL DEFAULT 0,
  total_items INTEGER NOT NULL DEFAULT 0,
  created_by_uid TEXT NOT NULL,
  created_by_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- ROW-LEVEL SECURITY (RLS) POLICIES EXAMPLE
-- =============================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE lecture_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Example helper using session variable `app.current_uid`
CREATE POLICY users_self_read ON users
  FOR SELECT USING (
    firebase_uid = current_setting('app.current_uid', TRUE)
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.firebase_uid = current_setting('app.current_uid', TRUE)
        AND u.account_status = 'active'
        AND (u.is_super_admin OR u.permissions ? 'users.view' OR u.permissions ? 'users.manage')
    )
  );

-- Prevent non-super-admin privilege escalation on users updates
CREATE POLICY users_role_update_guard ON users
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.firebase_uid = current_setting('app.current_uid', TRUE)
        AND actor.account_status = 'active'
        AND (actor.is_super_admin OR actor.permissions ? 'roles.assign')
    )
    AND users.is_super_admin = FALSE
  );

-- Published lectures readable by anyone; drafts readable by owner or staff
CREATE POLICY lecture_files_read ON lecture_files
  FOR SELECT USING (
    status = 'published'
    OR uploaded_by_uid = current_setting('app.current_uid', TRUE)
    OR EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.firebase_uid = current_setting('app.current_uid', TRUE)
        AND actor.account_status = 'active'
        AND actor.role_id IN ('super_admin', 'admin')
    )
  );

-- Immutable audit logs (insert only, never updated or deleted by application role)
CREATE POLICY audit_logs_insert_staff ON audit_logs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.firebase_uid = current_setting('app.current_uid', TRUE)
        AND actor.account_status = 'active'
        AND actor.role_id IN ('super_admin', 'admin', 'moderator')
    )
  );
