# Security Specification & Red-Team Threat Model — UST Lecture Platform (RBAC & Storage Extension)

## 1. Data Invariants
1. **Default Student Registration**: Any new Google user (`users/{uid}`) who is not the designated Super Admin email MUST be created with `role == 'student'`, `status == 'active'`, and `permissions.size() == 0`.
2. **Single Super Admin Ownership**: Only the verified designated Super Admin email (`mohammednourr56000@gmail.com`) holds `super_admin` authority. No admin or moderator can promote themselves or others to `super_admin`, nor suspend/demote/delete the Super Admin account.
3. **Granular Permission Enforcement**: Every privileged write/read in Firestore (`specializations`, `academicYears`, `semesters`, `subjects`, `lectureFiles`, `announcements`, `settings`, `users`, `admins`) requires explicit permission membership (`hasPerm(...)`) or `isSuperAdmin()`, AND `status == 'active'`.
4. **Verified Invitation Claim**: Pending invitations (`adminInvitations/{inviteId}`) can ONLY be created by `isSuperAdmin()`, and can ONLY be claimed when the authenticated Google user's verified email matches `invite.email` and the created `admins/{uid}` document strictly copies `role` and `permissions` from the pending invite.
5. **Immutable Audit Trail**: `activityLogs/{logId}` entries can NEVER be updated or deleted (`allow update, delete: if false;`), and `actorUid` MUST match `request.auth.uid`.
6. **Zero `get()`/`exists()` inside `allow list`**: Every `allow list` rule evaluates only `resource.data` and `request.auth.token`, preventing O(n) read amplification.
7. **Authoritative Google Drive Links**: Any `lectureFiles/{fileId}` document with `sourceType == 'google_drive'` MUST include a validated `externalUrl` strictly matching `^https://(drive|docs)\.google\.com/.+$` (<= 1000 chars) and optional alphanumeric `driveFileId`.
8. **Immutable Exam Attempts**: `examAttempts/{attemptId}` entries are strictly scoped to `userId == request.auth.uid` (or Super Admin) and can never be modified or deleted by clients (`allow update, delete: if false;`).
9. **Normalized Shared Courses Junction**: `programCourses/{linkId}` links canonical `subjects/{courseId}` across specializations, years, and semesters without duplicating files or allowing privilege escalation (`hasPerm('subjects.create')` or `hasPerm('subjects.edit')` required for writes).
10. **Central Lecture Library & Multi-Destination Links**: `lectureFileLinks/{linkId}` links canonical `lectureFiles/{lectureFileId}` across independent `(specializationId, academicYearId, semesterId, subjectId)` tuples without duplicating binary objects; soft-delete (`lifecycleStatus: 'trashed'`) preserves physical storage until permanent purge is authorized.
11. **Super Admin Exclusive Upload Authority**: Upload, editing, replacement, publishing, central redistribution, and deletion of `lectureFiles` and `lectureFileLinks` are **exclusively restricted to `isSuperAdmin()`** across Firestore rules, backend APIs, and UI. No Specialization Admin or Moderator may hold `lectures.upload`, `lectures.edit`, `lectures.publish`, or `lectures.delete`.
12. **Specialization-Scoped Admin Isolation**: Every `admin` account (`adminAssignments/{assignmentId}` + `admins/{uid}`) is strictly bound to one `assignedSpecializationId`. Any read/write outside `assignedSpecializationId` returns `403 Forbidden` / `PERMISSION_DENIED` and writes an immutable `denied` audit log entry.
13. **Safe Default Permissions & Non-Transferable Privilege**: Newly appointed Specialization Admins receive only read-only view permissions (`spec.dashboard.view`, `spec.structure.view`, `spec.lectures.metadata.view`, `spec.shared_courses.view`), and `adminAssignments`/`adminPermissions` can only be created, modified, transferred, suspended, or removed by `isSuperAdmin()`.

## 2. Dirty Dozen+ Adversarial Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated or unverified-email user attempting `create` on `users/{uid}` with `role: 'admin'` or `role: 'super_admin'`.
2. Regular student attempting `update` on `users/{ownUid}` changing `role` to `'admin'` or `'super_admin'` or adding `permissions: ['roles.assign']`.
3. Regular student attempting `create` on `admins/{ownUid}` without a valid matching `adminInvitations/{inviteId}`.
4. Appointed `admin` attempting `update` on `admins/{superAdminUid}` or `users/{superAdminUid}` to demote/suspend Super Admin.
5. Appointed `admin` attempting `update` on `admins/{ownUid}` to set `role: 'super_admin'`, change `assignedSpecializationId`, or escalate permissions.
6. Specialization Admin or Moderator attempting `create`, `update`, or `delete` on `lectureFiles/{fileId}` or `lectureFileLinks/{linkId}` (even inside their own specialization).
7. Specialization Admin assigned to `spec_bio` attempting `create`, `update`, or `delete` on `academicYears`, `semesters`, or `subjects` with `specializationId: 'spec_civil'`.
8. Suspended `admin` or `moderator` (`admins/{uid}.status == 'suspended'`) attempting any write to `subjects`, `academicYears`, `semesters`, or `announcements`.
9. User `A@gmail.com` attempting to accept `adminInvitations/{inviteId}` addressed to `B@gmail.com`, or modifying `role` from `'moderator'` to `'admin'` during acceptance.
10. Any user or admin attempting `update` or `delete` on `activityLogs/{logId}` to erase audit history.
11. Student or Specialization Admin attempting `list` on `users` or `activityLogs` across other users/specializations.
12. Shadow-field injection on `lectureFiles/{fileId}`, `adminAssignments/{assignmentId}`, or `settings/platform` with unknown field `isVerified: true` or oversized string (> max bounds).

