# Security Specification & Red-Team Threat Model — UST Lecture Platform (RBAC & Storage Extension)

## 1. Data Invariants
1. **Default Student Registration**: Any new Google user (`users/{uid}`) who is not the designated Super Admin email MUST be created with `role == 'student'`, `status == 'active'`, and `permissions.size() == 0`.
2. **Single Super Admin Ownership**: Only the verified designated Super Admin email (`mohammednourr56000@gmail.com`) holds `super_admin` authority. No admin or moderator can promote themselves or others to `super_admin`, nor suspend/demote/delete the Super Admin account.
3. **Granular Permission Enforcement**: Every privileged write/read in Firestore (`specializations`, `academicYears`, `semesters`, `subjects`, `lectureFiles`, `announcements`, `settings`, `users`, `admins`) requires explicit permission membership (`hasPerm(...)`) or `isSuperAdmin()`, AND `status == 'active'`.
4. **Verified Invitation Claim**: Pending invitations (`adminInvitations/{inviteId}`) can ONLY be created by `isSuperAdmin()`, and can ONLY be claimed when the authenticated Google user's verified email matches `invite.email` and the created `admins/{uid}` document strictly copies `role` and `permissions` from the pending invite.
5. **Immutable Audit Trail**: `activityLogs/{logId}` entries can NEVER be updated or deleted (`allow update, delete: if false;`), and `actorUid` MUST match `request.auth.uid`.
6. **Zero `get()`/`exists()` inside `allow list`**: Every `allow list` rule evaluates only `resource.data` and `request.auth.token`, preventing O(n) read amplification.

## 2. Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated or unverified-email user attempting `create` on `users/{uid}` with `role: 'admin'` or `role: 'super_admin'`.
2. Regular student attempting `update` on `users/{ownUid}` changing `role` to `'admin'` or `'super_admin'` or adding `permissions: ['roles.assign']`.
3. Regular student attempting `create` on `admins/{ownUid}` without a valid matching `adminInvitations/{inviteId}`.
4. Appointed `admin` attempting `update` on `admins/{superAdminUid}` or `users/{superAdminUid}` to demote/suspend Super Admin.
5. Appointed `admin` attempting `update` on `admins/{ownUid}` to set `role: 'super_admin'` or escalate permissions.
6. Upload-only `moderator` attempting `delete` on `specializations/{specId}` without `specializations.delete`.
7. Upload-only `moderator` attempting `create` on `lectureFiles/{fileId}` with `status: 'published'` when lacking `lectures.publish`.
8. Suspended `admin` or `moderator` (`admins/{uid}.status == 'suspended'`) attempting any write to `lectureFiles`, `subjects`, or `specializations`.
9. User `A@gmail.com` attempting to accept `adminInvitations/{inviteId}` addressed to `B@gmail.com`, or modifying `role` from `'moderator'` to `'admin'` during acceptance.
10. Any user or admin attempting `update` or `delete` on `activityLogs/{logId}` to erase audit history.
11. Student attempting `list` on `users` or `activityLogs` to scrape PII or admin actions.
12. Shadow-field injection on `lectureFiles/{fileId}` or `settings/platform` with unknown field `isVerified: true` or oversized string (> max bounds).
