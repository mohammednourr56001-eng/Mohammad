# Security Specification — منصة UST للمحاضرات

## 1. Data Invariants
1. **Strict RBAC Role Integrity**: A student user (`users/{userId}`) can only create their profile with `role == 'student'` and `uid == request.auth.uid`, and can never mutate their own `role` to `'admin'`.
2. **Email Verification Gate**: All authenticated write operations require `request.auth.token.email_verified == true`.
3. **Referential Hierarchy Integrity**:
   - An `AcademicYear` cannot be created unless its parent `Specialization` exists.
   - A `Semester` cannot be created unless its parent `AcademicYear` exists.
   - A `Subject` cannot be created unless its parent `Semester` exists.
   - A `LectureFile` cannot be created unless its parent `Subject` exists.
4. **Published-Only Student Reads**: Non-admin users (`!isAdmin()`) can only read (`get` / `list`) catalog records where `resource.data.status == 'published'`. Drafts remain invisible to students.
5. **PII Isolation**: `users/{userId}` contains `email` and personal profile info; `get` is restricted to `isOwner(userId) || isAdmin()`, and `list` is restricted strictly to `isAdmin()`.
6. **Immutable Audit & Ownership Fields**: `createdAt` and `uid` / `id` / `uploadedBy` are immutable after creation; `createdAt` and `updatedAt` are strictly validated against `request.time`.
7. **No Unbounded Arrays**: Favorites and notification read receipts are stored in dedicated user subcollections (`/users/{uid}/favorites/{fileId}`, `/users/{uid}/readNotifications/{notificationId}`), never in document arrays.

## 2. The "Dirty Dozen" Attack Payloads (Expected: `PERMISSION_DENIED`)
1. **Privilege Escalation on Signup**: Student sends `POST users/{myUid}` with `{ role: "admin" }`.
2. **Privilege Escalation via Profile Update**: Student sends `PATCH users/{myUid}` with `{ role: "admin" }`.
3. **Shadow Field Injection**: Student updates profile with extra field `{ isVerified: true, credits: 999 }`.
4. **Unverified Email Spoofing**: Attacker with `email_verified: false` and `email: "mohammednourr56000@gmail.com"` attempts admin write.
5. **Cross-User PII Read**: Student A attempts `GET users/{studentB_Uid}`.
6. **Blanket User List Scraping**: Student attempts `LIST users`.
7. **ID Poisoning / 1.5KB Document ID**: Attacker creates document at `users/{1500_char_string}` or invalid regex `../admin`.
8. **Orphaned Lecture File**: Admin/Attacker creates `lectureFiles/{id}` referencing non-existent `subjectId`.
9. **Student Content Tampering**: Student attempts to create/update/delete `specializations`, `subjects`, or `lectureFiles`.
10. **Draft Leak via Query**: Student runs `LIST lectureFiles` without `where('status', '==', 'published')`.
11. **Timestamp Forgery**: User submits `createdAt: "2020-01-01T00:00:00Z"` instead of server `request.time`.
12. **Resource Exhaustion (Denial of Wallet)**: Attacker writes 500KB string into `title` or `description` exceeding `maxLength`.
