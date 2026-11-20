# Shared Courses System — Database Migration & Rollback Plan

## 1. Objective
Transition from a rigid 1-to-many course placement model (where a course belonged exclusively to one `specializationId` / `academicYearId` / `semesterId`) to a **Many-to-Many Shared Courses Architecture** without breaking any existing courses, files, student favorites, or permissions.

---

## 2. Backward-Compatible Schema Design

### Canonical Entities
1. **`subjects` (Canonical Course Record)**
   - Retains existing `id`, `specializationId`, `academicYearId`, `semesterId` (representing the primary/origin placement for 100% backward compatibility with legacy clients and deep links).
   - Adds optional distinguishing fields:
     - `code?: string` (e.g., `PHYS101`)
     - `curriculumVersion?: string` (e.g., `2025-A`)
     - `academicContext?: string` (curriculum notes)
2. **`lectureFiles` (Canonical Content Metadata)**
   - Attached strictly to the canonical course via `subjectId` (`course_id`).
   - Binary files are stored **once** in Object Storage / Drive; sharing the course across 5 specializations creates **0 extra binary copies**.
3. **`programCourses` (Junction Table / Collection)**
   - Composite document ID (`link_<courseId>_<specId>_<yearId>_<semId>`) + unique constraint prevents duplicate program assignments:
     - `id`, `courseId`, `specializationId`, `academicYearId`, `semesterId`, `order`, `status`, `isPrimary`, `curriculumNotes`, `createdAt`, `updatedAt`.

---

## 3. Non-Destructive Migration Steps

### Step 1: Backup Before Schema Evolution
- Export Firestore collections (`specializations`, `academicYears`, `semesters`, `subjects`, `lectureFiles`) using the Admin Dashboard **Backup & Recovery** panel or `gcloud firestore export`.
- For PostgreSQL (`docs/reference_postgresql_rls_schema.sql`), run `pg_dump --format=custom --file=ust_pre_shared_courses.dump`.

### Step 2: Deploy Schema & Security Rules (Additive Only)
1. Apply `firestore.rules` adding `/programCourses/{linkId}` and optional `code`, `curriculumVersion`, `academicContext` validation on `subjects`.
2. Apply SQL additive migrations (`ALTER TABLE subjects ADD COLUMN IF NOT EXISTS ...`, `CREATE TABLE IF NOT EXISTS program_courses ...`, unique index on `(course_id, specialization_id, academic_year_id, semester_id)`).
3. **Zero destructive drops**: Existing `subjects` rows remain valid immediately.

### Step 3: Optional Backfill of Existing Courses into `program_courses`
- Every existing `subjects` document automatically resolves through `getEffectiveCoursePlacements(subject, programCourses)` even before any `programCourses` row is written.
- When an administrator links an existing course to a second specialization via Admin UI (`Action B: ربط مقرر موجود بتخصص آخر`), the platform checks `hasDuplicateProgramLink(...)` and creates the junction record cleanly.

### Step 4: Duplicate-Name Consolidation (Human-Reviewed Only)
- **Strict Rule**: Never auto-merge two courses solely because their `name` strings match! Different faculties (e.g., *Calculus 1* for Engineering vs *Applied Math* for Medicine) may have different codes, syllabi, or versions.
- Use the Admin Dashboard **فاحص المقررات المتطابقة الاسم (Duplicate Course Name Inspector)** to inspect normalized titles side-by-side (`code`, `curriculumVersion`, file counts, current specializations) before manually unlinking/re-linking if truly identical.

### Step 5: Safe Unlink vs. Permanent Delete
- **Unlink from a specialization (`فك الربط هنا`)**:
  - Deletes only that specialization's placement.
  - If the unlinked placement was the canonical `subject.specializationId`, the system promotes the next remaining `programCourses` placement onto `subject` cleanly before removing the link so all remaining specializations retain seamless access to the canonical course and its files.
- **Permanent Delete (`حذف نهائي`)**:
  - Shows a clear multi-specialization impact warning (`مربوط في N تخصصات`) before deleting the canonical course and its files.

---

## 4. Rollback Plan
1. If any regression occurs in shared-course UI resolution, revert the client bundle to the prior build while keeping Firestore `subjects` and `lectureFiles` completely untouched (because primary placement fields on `subjects` are always kept updated!).
2. If reverting PostgreSQL, drop only the additive `program_courses` table (`DROP TABLE IF EXISTS program_courses;`) — no canonical `subjects` or `lecture_files` rows are lost.

---

## 5. Central Lecture Library & Multi-Specialization File Distribution (`lectureFileLinks`)

### Additive Schema Additions
1. **`lecture_file_links` / `/lectureFileLinks/{linkId}`**:
   - Links one physical `lecture_files` record to multiple independent `(specialization_id, academic_year_id, semester_id, subject_id)` destinations.
   - Unique index on `(lecture_file_id, specialization_id, academic_year_id, semester_id, subject_id)` prevents duplicate links to the same destination.
2. **`lecture_files` Lifecycle Columns**:
   - `lifecycle_status` (`'active' | 'trashed' | 'needs_review'`, defaults to `'active'`)
   - `deleted_at`, `deleted_by` for reversible soft deletion from the Central Library without harming historical audit logs.
3. **Specialization-Independent Central Storage**:
   - Physical objects are stored under `central/<sha256_prefix>/<storageName>` (`uploads/ust-storage/central/...` or Cloudflare R2 `central/...`) while legacy paths remain readable seamlessly via `resolvePhysicalFilePath(...)`.
   - Storage deletion (`DELETE /api/files/storage/:storageName`) is reference-counted so shared binaries are never unlinked while any `lectureFiles` document still references `storageName`.

### Safe Unlink & Historical Duplicate Consolidation
- Removing a link from one specialization (e.g., Civil Engineering) deletes **only** that `lectureFileLinks` record; if the file was an unmigrated legacy shared-course file, `buildUnlinkDestinationPlan` automatically materializes explicit `lectureFileLinks` for all remaining specializations first.
- Historical SHA-256 duplicate consolidation merges all destination links onto the oldest canonical `lectureFile` before moving duplicate copies to `trashed`, preserving 100% of student-facing links.

