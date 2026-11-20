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
  code TEXT,
  curriculum_version TEXT,
  academic_context TEXT,
  description TEXT DEFAULT '',
  icon_key TEXT NOT NULL DEFAULT 'book',
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'draft')),
  sort_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subjects_code ON subjects (code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subjects_name ON subjects (LOWER(name));

-- Many-to-many Shared Courses Junction Table (zero duplication of course or file records)
CREATE TABLE IF NOT EXISTS program_courses (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  specialization_id TEXT NOT NULL REFERENCES specializations(id) ON DELETE CASCADE,
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'draft')),
  sort_order INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_program_course_placement UNIQUE (course_id, specialization_id, academic_year_id, semester_id)
);

CREATE INDEX IF NOT EXISTS idx_program_courses_lookup
  ON program_courses (specialization_id, academic_year_id, semester_id, status);
CREATE INDEX IF NOT EXISTS idx_program_courses_course_id
  ON program_courses (course_id);

-- 5. LECTURE FILES & STORAGE METADATA (attached once to canonical course_id / subject_id)
CREATE TABLE IF NOT EXISTS lecture_files (
  id TEXT PRIMARY KEY,
  specialization_id TEXT NOT NULL REFERENCES specializations(id) ON DELETE CASCADE,
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'upload' CHECK (source_type IN ('upload', 'google_drive')),
  external_url TEXT,
  drive_file_id TEXT,
  original_name TEXT NOT NULL,
  storage_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_ext TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size >= 0),
  sha256_hash TEXT NOT NULL,
  allow_download BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'draft')),
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'trashed', 'needs_review')),
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT,
  uploaded_by_uid TEXT NOT NULL,
  uploaded_by_email TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lecture_files_hierarchy
  ON lecture_files (specialization_id, academic_year_id, semester_id, subject_id, status);
CREATE INDEX IF NOT EXISTS idx_lecture_files_course_canonical
  ON lecture_files (subject_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_lecture_files_sha256
  ON lecture_files (sha256_hash);
CREATE INDEX IF NOT EXISTS idx_lecture_files_lifecycle
  ON lecture_files (lifecycle_status, created_at DESC);

-- Many-to-many Central Lecture File Distribution Links (one physical file -> N programs/semesters/subjects)
CREATE TABLE IF NOT EXISTS lecture_file_links (
  id TEXT PRIMARY KEY,
  lecture_file_id TEXT NOT NULL REFERENCES lecture_files(id) ON DELETE CASCADE,
  specialization_id TEXT NOT NULL REFERENCES specializations(id) ON DELETE CASCADE,
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'draft')),
  sort_order INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_lecture_file_destination UNIQUE (lecture_file_id, specialization_id, academic_year_id, semester_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_lecture_file_links_dest
  ON lecture_file_links (specialization_id, academic_year_id, semester_id, subject_id, status);
CREATE INDEX IF NOT EXISTS idx_lecture_file_links_file
  ON lecture_file_links (lecture_file_id);

-- 6. SPECIALIZATION-SCOPED ADMIN ASSIGNMENTS & PERMISSIONS
CREATE TABLE IF NOT EXISTS admin_assignments (
  id TEXT PRIMARY KEY,
  user_uid TEXT NOT NULL UNIQUE REFERENCES users(firebase_uid) ON DELETE CASCADE,
  specialization_id TEXT NOT NULL REFERENCES specializations(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  scope_version INTEGER NOT NULL DEFAULT 1,
  assigned_by TEXT NOT NULL,
  assigned_by_email TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_assignments_spec
  ON admin_assignments (specialization_id, status);

CREATE TABLE IF NOT EXISTS admin_permissions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES admin_assignments(id) ON DELETE CASCADE,
  user_uid TEXT NOT NULL REFERENCES users(firebase_uid) ON DELETE CASCADE,
  specialization_id TEXT NOT NULL REFERENCES specializations(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL CHECK (
    permission_key NOT IN (
      'lectures.upload', 'lectures.edit', 'lectures.publish', 'lectures.delete',
      'roles.assign', 'settings.manage', 'storage.view', 'storage.manage',
      'users.view', 'users.manage', 'specializations.create', 'specializations.edit',
      'specializations.delete', 'subjects.delete', 'audit_logs.view'
    )
  ),
  granted BOOLEAN NOT NULL DEFAULT TRUE,
  granted_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_assignment_perm UNIQUE (assignment_id, permission_key)
);

-- 7. IMMUTABLE AUDIT LOGS & BACKUP SNAPSHOTS
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_name TEXT NOT NULL,
  specialization_id TEXT,
  target_uid TEXT,
  target_email TEXT,
  old_value TEXT,
  new_value TEXT,
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
ALTER TABLE admin_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE semesters ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE lecture_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE lecture_file_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Example helper using session variable `app.current_uid`
CREATE POLICY users_self_read ON users
  FOR SELECT USING (
    firebase_uid = current_setting('app.current_uid', TRUE)
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.firebase_uid = current_setting('app.current_uid', TRUE)
        AND u.account_status = 'active'
        AND u.is_super_admin = TRUE
    )
  );

-- Only Super Admin can manage role & admin assignments
CREATE POLICY users_role_update_guard ON users
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.firebase_uid = current_setting('app.current_uid', TRUE)
        AND actor.account_status = 'active'
        AND actor.is_super_admin = TRUE
    )
    AND users.is_super_admin = FALSE
  );

CREATE POLICY admin_assignments_super_admin_only ON admin_assignments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.firebase_uid = current_setting('app.current_uid', TRUE)
        AND actor.account_status = 'active'
        AND actor.is_super_admin = TRUE
    )
    OR user_uid = current_setting('app.current_uid', TRUE)
  );

-- Specialization-scoped academic write guard (subjects, years, semesters strictly bound to assigned specialization)
CREATE POLICY academic_years_scoped_write ON academic_years
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.firebase_uid = current_setting('app.current_uid', TRUE)
        AND actor.account_status = 'active'
        AND actor.is_super_admin = TRUE
    )
    OR EXISTS (
      SELECT 1 FROM admin_assignments aa
      JOIN admin_permissions ap ON ap.assignment_id = aa.id
      WHERE aa.user_uid = current_setting('app.current_uid', TRUE)
        AND aa.status = 'active'
        AND aa.specialization_id = academic_years.specialization_id
        AND ap.permission_key = 'academic_years.manage'
        AND ap.granted = TRUE
    )
  );

CREATE POLICY subjects_scoped_write ON subjects
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.firebase_uid = current_setting('app.current_uid', TRUE)
        AND actor.account_status = 'active'
        AND actor.is_super_admin = TRUE
    )
    OR EXISTS (
      SELECT 1 FROM admin_assignments aa
      JOIN admin_permissions ap ON ap.assignment_id = aa.id
      WHERE aa.user_uid = current_setting('app.current_uid', TRUE)
        AND aa.status = 'active'
        AND aa.specialization_id = subjects.specialization_id
        AND ap.permission_key IN ('subjects.create', 'subjects.edit')
        AND ap.granted = TRUE
    )
  );

-- Published lectures readable by anyone; specialization admin can view metadata in own specialization only
CREATE POLICY lecture_files_read ON lecture_files
  FOR SELECT USING (
    status = 'published'
    OR EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.firebase_uid = current_setting('app.current_uid', TRUE)
        AND actor.account_status = 'active'
        AND actor.is_super_admin = TRUE
    )
    OR EXISTS (
      SELECT 1 FROM admin_assignments aa
      WHERE aa.user_uid = current_setting('app.current_uid', TRUE)
        AND aa.status = 'active'
        AND aa.specialization_id = lecture_files.specialization_id
    )
  );

-- Upload, update, publish, and deletion of lecture files & links are STRICTLY EXCLUSIVE to Super Admin
CREATE POLICY lecture_files_super_admin_write_only ON lecture_files
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.firebase_uid = current_setting('app.current_uid', TRUE)
        AND actor.account_status = 'active'
        AND actor.is_super_admin = TRUE
    )
  );

CREATE POLICY lecture_files_super_admin_modify_only ON lecture_files
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.firebase_uid = current_setting('app.current_uid', TRUE)
        AND actor.account_status = 'active'
        AND actor.is_super_admin = TRUE
    )
  );

CREATE POLICY lecture_file_links_super_admin_only ON lecture_file_links
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.firebase_uid = current_setting('app.current_uid', TRUE)
        AND actor.account_status = 'active'
        AND actor.is_super_admin = TRUE
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
