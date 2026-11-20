import path from 'path';
import { getApps, initializeApp, App } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import firebaseConfig from '../firebase-applet-config.json';
import {
  AccountStatus,
  ActivityLog,
  AdminAssignment,
  AdminEntry,
  AdminInvitation,
  AdminPermissionRecord,
  ALL_PERMISSIONS,
  BackupSnapshot,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_SPECIALIZATION_ADMIN_PERMISSIONS,
  PermissionKey,
  SUPER_ADMIN_ONLY_PERMISSIONS,
  UserProfile,
  UserRole,
} from '../src/types/academic.ts';
import { SafeJsonStore } from './safeJsonStore.ts';
import { INDEX_DIR } from './storageManager.ts';
import {
  AiQuotaState,
  checkAiDailyQuota,
  isTokenIssuedBeforeRevocation,
  redactSensitiveLogText,
} from '../src/utils/securityProtection.ts';

let adminApp: App;
if (!getApps().length) {
  adminApp = initializeApp({
    projectId: firebaseConfig.projectId,
  });
} else {
  adminApp = getApps()[0];
}

export const adminAuth = getAuth(adminApp);
export const SUPER_ADMIN_EMAIL = (
  process.env.SUPER_ADMIN_EMAIL || 'mohammednourr56000@gmail.com'
)
  .trim()
  .toLowerCase();

const FIRESTORE_DATABASE_ID =
  (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId ||
  'ai-studio-44a15c97-d39e-4ee8-b8b4-f5de41f4907b';
const FIRESTORE_REST_BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${FIRESTORE_DATABASE_ID}/documents`;

export async function verifyBearerToken(token: string): Promise<DecodedIdToken | null> {
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    if (!decoded || !decoded.uid) return null;
    const revokedMap = loadRevokedSessionsMap();
    const revokedBeforeMs = revokedMap[decoded.uid];
    if (isTokenIssuedBeforeRevocation(decoded.auth_time, revokedBeforeMs)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function isBootstrappedSuperAdminToken(decoded: DecodedIdToken | null): boolean {
  if (!decoded || !decoded.email_verified || !decoded.email) return false;
  return decoded.email.trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}

// --- Firestore REST Encoding / Decoding ---

function parseFirestoreValue(v: Record<string, unknown>): unknown {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) {
    const arr = (v.arrayValue as { values?: Array<Record<string, unknown>> })?.values || [];
    return arr.map(parseFirestoreValue);
  }
  if ('mapValue' in v) {
    const fields = (v.mapValue as { fields?: Record<string, Record<string, unknown>> })?.fields || {};
    return parseFirestoreFields(fields);
  }
  return undefined;
}

export function parseFirestoreFields(
  fields: Record<string, Record<string, unknown>>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    const parsed = parseFirestoreValue(v);
    if (parsed !== undefined) out[k] = parsed;
  }
  return out;
}

export function toFirestoreValue(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val) && val.endsWith('Z')) {
      return { timestampValue: val };
    }
    return { stringValue: val };
  }
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => toFirestoreValue(item)) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function toFirestoreDocument(data: Record<string, unknown>): {
  fields: Record<string, Record<string, unknown>>;
} {
  const fields: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) {
      fields[k] = toFirestoreValue(v);
    }
  }
  return { fields };
}

const FIRESTORE_REST_TIMEOUT_MS = 8000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = FIRESTORE_REST_TIMEOUT_MS
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer === 'object' && 'unref' in timer) {
    timer.unref();
  }
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchFirestoreDocRest(
  collectionPath: string,
  docId: string,
  bearerToken?: string
): Promise<Record<string, unknown> | null> {
  try {
    const url = `${FIRESTORE_REST_BASE}/${collectionPath}/${encodeURIComponent(docId)}?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
    const headers: Record<string, string> = {};
    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }
    const res = await fetchWithTimeout(url, { headers });
    if (!res.ok) return null;
    const json = (await res.json()) as { fields?: Record<string, Record<string, unknown>> };
    if (!json.fields) return null;
    return parseFirestoreFields(json.fields);
  } catch {
    return null;
  }
}

export async function listFirestoreCollectionRest(
  collectionPath: string,
  bearerToken?: string
): Promise<Array<Record<string, unknown>>> {
  try {
    const results: Array<Record<string, unknown>> = [];
    let pageToken = '';
    const headers: Record<string, string> = {};
    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }

    for (let page = 0; page < 50; page++) {
      const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
      const url = `${FIRESTORE_REST_BASE}/${collectionPath}?pageSize=300${tokenParam}&key=${encodeURIComponent(firebaseConfig.apiKey)}`;
      const res = await fetchWithTimeout(url, { headers });
      if (!res.ok) break;
      const json = (await res.json()) as {
        documents?: Array<{ fields?: Record<string, Record<string, unknown>> }>;
        nextPageToken?: string;
      };
      for (const doc of json.documents || []) {
        if (doc.fields) {
          results.push(parseFirestoreFields(doc.fields));
        }
      }
      if (!json.nextPageToken) break;
      pageToken = json.nextPageToken;
    }

    return results;
  } catch {
    return [];
  }
}

export async function queryFirestoreCollectionByFieldRest(
  collectionPath: string,
  fieldPath: string,
  value: string,
  bearerToken?: string,
  limit = 5000
): Promise<Array<Record<string, unknown>>> {
  try {
    const url = `${FIRESTORE_REST_BASE}:runQuery?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }
    const body = {
      structuredQuery: {
        from: [{ collectionId: collectionPath }],
        where: {
          fieldFilter: {
            field: { fieldPath },
            op: 'EQUAL',
            value: { stringValue: value },
          },
        },
        limit,
      },
    };
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{
      document?: { fields?: Record<string, Record<string, unknown>> };
    }>;
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row) => Boolean(row.document?.fields))
      .map((row) => parseFirestoreFields(row.document!.fields!));
  } catch {
    return [];
  }
}

export async function queryPublishedFirestoreCollectionRest(
  collectionPath: string,
  bearerToken?: string
): Promise<Array<Record<string, unknown>>> {
  return queryFirestoreCollectionByFieldRest(
    collectionPath,
    'status',
    'published',
    bearerToken,
    5000
  );
}

export async function patchFirestoreDocRest(
  collectionPath: string,
  docId: string,
  data: Record<string, unknown>,
  bearerToken: string,
  updateMask?: string[]
): Promise<{ ok: boolean; status: number; errorText?: string }> {
  try {
    const serverTimeFields: string[] = [];
    const filteredData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v === '__SERVER_TIME__') {
        serverTimeFields.push(k);
      } else if (v !== undefined) {
        filteredData[k] = v;
      }
    }

    if (serverTimeFields.length > 0) {
      const docPath = `projects/${firebaseConfig.projectId}/databases/${FIRESTORE_DATABASE_ID}/documents/${collectionPath}/${docId}`;
      const commitUrl = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${FIRESTORE_DATABASE_ID}/documents:commit?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
      const writes: Array<Record<string, unknown>> = [
        {
          update: {
            name: docPath,
            ...toFirestoreDocument(filteredData),
          },
          ...(updateMask?.length ? { updateMask: { fieldPaths: updateMask } } : {}),
        },
        {
          transform: {
            document: docPath,
            fieldTransforms: serverTimeFields.map((fieldPath) => ({
              fieldPath,
              setToServerValue: 'REQUEST_TIME',
            })),
          },
        },
      ];
      const commitRes = await fetchWithTimeout(commitUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify({ writes }),
      });
      if (!commitRes.ok) {
        return { ok: false, status: commitRes.status, errorText: await commitRes.text() };
      }
      return { ok: true, status: commitRes.status };
    }

    const maskParams = updateMask?.length
      ? updateMask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&') + '&'
      : '';
    const url = `${FIRESTORE_REST_BASE}/${collectionPath}/${encodeURIComponent(docId)}?${maskParams}key=${encodeURIComponent(firebaseConfig.apiKey)}`;
    const res = await fetchWithTimeout(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify(toFirestoreDocument(filteredData)),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, errorText: await res.text() };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, status: 500, errorText: String(err) };
  }
}

export async function deleteFirestoreDocRest(
  collectionPath: string,
  docId: string,
  bearerToken: string
): Promise<boolean> {
  try {
    const url = `${FIRESTORE_REST_BASE}/${collectionPath}/${encodeURIComponent(docId)}?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
    const res = await fetchWithTimeout(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}

// --- Server Persistent Directory / Invitations / Audit / Backup Index ---

const indexJsonStore = new SafeJsonStore(INDEX_DIR);

export function flushServerIndexWrites(): Promise<void> {
  return indexJsonStore.flushAll();
}

function readIndexJson<T>(filename: string, fallback: T): T {
  return indexJsonStore.readSync<T>(filename, fallback);
}

function writeIndexJson(filename: string, data: unknown): void {
  void indexJsonStore.enqueueWrite(filename, data);
}

export function loadUsersDirectory(): Record<string, UserProfile> {
  return readIndexJson<Record<string, UserProfile>>('users-directory.json', {});
}

export function upsertUserDirectoryEntry(user: UserProfile): void {
  const dir = loadUsersDirectory();
  dir[user.uid] = user;
  writeIndexJson('users-directory.json', dir);
}

export function removeUserDirectoryEntry(uid: string): boolean {
  const dir = loadUsersDirectory();
  if (!(uid in dir)) return false;
  delete dir[uid];
  writeIndexJson('users-directory.json', dir);
  return true;
}

export function loadRevokedSessionsMap(): Record<string, number> {
  return readIndexJson<Record<string, number>>('revoked-sessions.json', {});
}

export function revokeUserSessionsTimestamp(uid: string): number {
  const map = loadRevokedSessionsMap();
  const cutoffMs = Date.now();
  map[uid] = cutoffMs;
  writeIndexJson('revoked-sessions.json', map);
  return cutoffMs;
}

export function loadAiQuotaState(): AiQuotaState {
  const todayKey = new Date().toISOString().slice(0, 10);
  const raw = readIndexJson<AiQuotaState>('ai-quota.json', {
    dayKey: todayKey,
    globalCount: 0,
    byUser: {},
    blockedInjections: 0,
  });
  if (raw.dayKey !== todayKey) {
    return {
      dayKey: todayKey,
      globalCount: 0,
      byUser: {},
      blockedInjections: raw.blockedInjections || 0,
    };
  }
  return raw;
}

export function consumeAiDailyQuota(params: { uid: string; isStaff: boolean }): {
  allowed: boolean;
  reason?: string;
  userCount: number;
  userLimit: number;
  globalCount: number;
  globalLimit: number;
} {
  const state = loadAiQuotaState();
  const result = checkAiDailyQuota({
    state,
    uid: params.uid,
    isStaff: params.isStaff,
  });
  if (!result.allowed) {
    return result;
  }
  state.globalCount += 1;
  state.byUser[params.uid] = (state.byUser[params.uid] || 0) + 1;
  writeIndexJson('ai-quota.json', state);
  return {
    ...result,
    userCount: state.byUser[params.uid],
    globalCount: state.globalCount,
  };
}

export function recordAiPromptInjectionBlock(): number {
  const state = loadAiQuotaState();
  state.blockedInjections = (state.blockedInjections || 0) + 1;
  writeIndexJson('ai-quota.json', state);
  return state.blockedInjections;
}

export function getAiQuotaStats(): {
  todayRequests: number;
  blockedPromptInjections: number;
  dailyUserLimit: number;
  dailyGlobalLimit: number;
} {
  const state = loadAiQuotaState();
  return {
    todayRequests: state.globalCount,
    blockedPromptInjections: state.blockedInjections || 0,
    dailyUserLimit: 15,
    dailyGlobalLimit: 400,
  };
}

export function getSecurityCounters(): { rejectedUploadsCount: number } {
  return readIndexJson<{ rejectedUploadsCount: number }>('security-counters.json', {
    rejectedUploadsCount: 0,
  });
}

export function incrementRejectedUploadsCount(): number {
  const counters = getSecurityCounters();
  counters.rejectedUploadsCount = (counters.rejectedUploadsCount || 0) + 1;
  writeIndexJson('security-counters.json', counters);
  return counters.rejectedUploadsCount;
}

export function loadAdminsDirectory(): Record<string, AdminEntry> {
  return readIndexJson<Record<string, AdminEntry>>('admins-directory.json', {});
}

export function upsertAdminDirectoryEntry(entry: AdminEntry): void {
  const dir = loadAdminsDirectory();
  dir[entry.uid] = entry;
  writeIndexJson('admins-directory.json', dir);
}

export function removeAdminDirectoryEntry(uid: string): void {
  const dir = loadAdminsDirectory();
  delete dir[uid];
  writeIndexJson('admins-directory.json', dir);
}

export function loadInvitationsIndex(): Record<string, AdminInvitation> {
  return readIndexJson<Record<string, AdminInvitation>>('invitations-index.json', {});
}

export function upsertInvitationIndex(invite: AdminInvitation): void {
  const dir = loadInvitationsIndex();
  dir[invite.id] = invite;
  writeIndexJson('invitations-index.json', dir);
}

export function removeInvitationIndex(inviteId: string): void {
  const dir = loadInvitationsIndex();
  delete dir[inviteId];
  writeIndexJson('invitations-index.json', dir);
}

export function loadServerAuditLogs(): ActivityLog[] {
  return readIndexJson<ActivityLog[]>('audit-logs.json', []);
}

export function appendServerAuditLog(log: ActivityLog): void {
  const redacted: ActivityLog = {
    ...log,
    action: redactSensitiveLogText(log.action).slice(0, 120),
    entityName: redactSensitiveLogText(log.entityName).slice(0, 200),
    ...(log.oldValue ? { oldValue: redactSensitiveLogText(log.oldValue) } : {}),
    ...(log.newValue ? { newValue: redactSensitiveLogText(log.newValue) } : {}),
    ...(log.details ? { details: redactSensitiveLogText(log.details) } : {}),
  };
  const logs = loadServerAuditLogs();
  logs.unshift(redacted);
  if (logs.length > 2000) {
    logs.length = 2000;
  }
  writeIndexJson('audit-logs.json', logs);
}

export function loadBackupsIndex(): BackupSnapshot[] {
  return readIndexJson<BackupSnapshot[]>('backups-index.json', []);
}

export function appendBackupIndex(record: BackupSnapshot): void {
  const list = loadBackupsIndex();
  list.unshift(record);
  writeIndexJson('backups-index.json', list);
}

export function updateBackupIndexRecord(
  backupId: string,
  patch: Partial<BackupSnapshot>
): BackupSnapshot | null {
  const list = loadBackupsIndex();
  const idx = list.findIndex((b) => b.id === backupId);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], ...patch };
  writeIndexJson('backups-index.json', list);
  return list[idx];
}

export function loadAdminAssignmentsIndex(): Record<string, AdminAssignment> {
  return readIndexJson<Record<string, AdminAssignment>>('admin-assignments.json', {});
}

export function upsertAdminAssignmentIndex(assignment: AdminAssignment): void {
  const dir = loadAdminAssignmentsIndex();
  dir[assignment.id] = assignment;
  writeIndexJson('admin-assignments.json', dir);
}

export function removeAdminAssignmentIndex(assignmentId: string): void {
  const dir = loadAdminAssignmentsIndex();
  delete dir[assignmentId];
  writeIndexJson('admin-assignments.json', dir);
}

export function loadAdminPermissionsIndex(): Record<string, AdminPermissionRecord> {
  return readIndexJson<Record<string, AdminPermissionRecord>>('admin-permissions.json', {});
}

export function replaceAssignmentPermissionsIndex(params: {
  assignmentId: string;
  uid: string;
  specializationId: string;
  permissions: PermissionKey[];
  grantedBy: string;
}): AdminPermissionRecord[] {
  const dir = loadAdminPermissionsIndex();
  for (const [key, rec] of Object.entries(dir)) {
    if (rec.assignmentId === params.assignmentId || rec.uid === params.uid) {
      delete dir[key];
    }
  }
  const nowIso = new Date().toISOString();
  const created: AdminPermissionRecord[] = [];
  for (const permKey of params.permissions) {
    const id = `${params.assignmentId}_${permKey}`;
    const record: AdminPermissionRecord = {
      id,
      assignmentId: params.assignmentId,
      uid: params.uid,
      specializationId: params.specializationId,
      permissionKey: permKey,
      granted: true,
      grantedBy: params.grantedBy,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    dir[id] = record;
    created.push(record);
  }
  writeIndexJson('admin-permissions.json', dir);
  return created;
}

export function removeAssignmentPermissionsForUid(uid: string): AdminPermissionRecord[] {
  const dir = loadAdminPermissionsIndex();
  const removed: AdminPermissionRecord[] = [];
  for (const [key, rec] of Object.entries(dir)) {
    if (rec.uid === uid) {
      removed.push(rec);
      delete dir[key];
    }
  }
  writeIndexJson('admin-permissions.json', dir);
  return removed;
}

export function touchAdminLastActivity(uid: string, assignmentId?: string): void {
  const nowIso = new Date().toISOString();
  const admins = loadAdminsDirectory();
  if (admins[uid]) {
    admins[uid] = { ...admins[uid], lastActivityAt: nowIso };
    writeIndexJson('admins-directory.json', admins);
  }
  const assignments = loadAdminAssignmentsIndex();
  const targetAsg = assignmentId
    ? assignments[assignmentId]
    : Object.values(assignments).find((a) => a.uid === uid);
  if (targetAsg) {
    assignments[targetAsg.id] = { ...targetAsg, lastActivityAt: nowIso };
    writeIndexJson('admin-assignments.json', assignments);
  }
}

// --- Authoritative Server-Side Role & Permission Resolution ---

const SUPER_ADMIN_ONLY_SET = new Set<PermissionKey>(SUPER_ADMIN_ONLY_PERMISSIONS);

export interface ResolvedServerAuth {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  googleSub: string;
  role: UserRole;
  permissions: PermissionKey[];
  status: AccountStatus;
  isSuperAdmin: boolean;
  isStaff: boolean;
  assignedSpecializationId?: string;
  assignmentId?: string;
  scopeVersion?: number;
  lastActivityAt?: string;
}

export async function resolveServerAuth(
  decoded: DecodedIdToken | null,
  bearerToken?: string
): Promise<ResolvedServerAuth | null> {
  if (!decoded || !decoded.uid) return null;

  const email = (decoded.email || '').trim().toLowerCase();
  const displayName = String(decoded.name || email.split('@')[0] || 'مستخدم UST');
  const photoURL = String(decoded.picture || '');
  const googleSub = String(decoded.firebase?.identities?.['google.com']?.[0] || decoded.sub || decoded.uid);

  if (isBootstrappedSuperAdminToken(decoded)) {
    return {
      uid: decoded.uid,
      email,
      displayName,
      photoURL,
      googleSub,
      role: 'super_admin',
      permissions: [...ALL_PERMISSIONS],
      status: 'active',
      isSuperAdmin: true,
      isStaff: true,
    };
  }

  // Check Firestore admins/{uid} first (authoritative trusted lookup), fallback to server admin directory
  const fsAdminDoc = await fetchFirestoreDocRest('admins', decoded.uid, bearerToken);
  const localAdminDoc = loadAdminsDirectory()[decoded.uid];
  const fsUserDoc = await fetchFirestoreDocRest('users', decoded.uid, bearerToken);
  const localUserDoc = loadUsersDirectory()[decoded.uid];
  const localAssignments = Object.values(loadAdminAssignmentsIndex());
  const localAssignment = localAssignments.find((a) => a.uid === decoded.uid);

  const assignmentId = String(
    fsAdminDoc?.assignmentId || localAdminDoc?.assignmentId || localAssignment?.id || ''
  ) || undefined;
  const fsAssignmentDoc = assignmentId
    ? await fetchFirestoreDocRest('adminAssignments', assignmentId, bearerToken)
    : null;

  const statusRaw = String(
    fsAssignmentDoc?.status ||
      fsAdminDoc?.status ||
      localAssignment?.status ||
      localAdminDoc?.status ||
      fsUserDoc?.status ||
      localUserDoc?.status ||
      'active'
  );
  const status: AccountStatus = statusRaw === 'suspended' ? 'suspended' : 'active';

  const rawRole = String(fsAdminDoc?.role || localAdminDoc?.role || fsUserDoc?.role || 'student') as UserRole;

  if (fsAdminDoc || localAdminDoc || fsAssignmentDoc || localAssignment) {
    const adminRole: UserRole =
      rawRole === 'super_admin' || rawRole === 'admin' || rawRole === 'moderator'
        ? rawRole
        : localAssignment
          ? 'admin'
          : 'moderator';
    const permsRaw =
      fsAssignmentDoc?.permissions ||
      fsAdminDoc?.permissions ||
      localAssignment?.permissions ||
      localAdminDoc?.permissions;
    const rawPerms: PermissionKey[] = Array.isArray(permsRaw)
      ? (permsRaw.filter((p): p is PermissionKey =>
          ALL_PERMISSIONS.includes(p as PermissionKey)
        ) as PermissionKey[])
      : DEFAULT_ROLE_PERMISSIONS[adminRole];

    const isSuperAdmin = adminRole === 'super_admin' && status === 'active';
    // Strictly strip Super-Admin-only & upload permissions for non-Super-Admins
    const sanitizedPerms = isSuperAdmin
      ? [...ALL_PERMISSIONS]
      : rawPerms.filter((p) => !SUPER_ADMIN_ONLY_SET.has(p));

    const finalPerms =
      status === 'suspended'
        ? []
        : isSuperAdmin
          ? [...ALL_PERMISSIONS]
          : adminRole === 'admin' && sanitizedPerms.length === 0
            ? [...DEFAULT_SPECIALIZATION_ADMIN_PERMISSIONS]
            : sanitizedPerms;

    const assignedSpecializationId =
      adminRole === 'admin'
        ? String(
            fsAssignmentDoc?.specializationId ||
              fsAdminDoc?.assignedSpecializationId ||
              localAssignment?.specializationId ||
              localAdminDoc?.assignedSpecializationId ||
              ''
          ) || undefined
        : undefined;

    const scopeVersion = Number(
      fsAssignmentDoc?.scopeVersion ||
        fsAdminDoc?.scopeVersion ||
        localAssignment?.scopeVersion ||
        localAdminDoc?.scopeVersion ||
        1
    );

    const lastActivityAt = String(
      fsAssignmentDoc?.lastActivityAt ||
        localAssignment?.lastActivityAt ||
        fsAdminDoc?.lastActivityAt ||
        localAdminDoc?.lastActivityAt ||
        ''
    ) || undefined;

    const isStaff =
      status === 'active' &&
      (isSuperAdmin ||
        adminRole === 'moderator' ||
        (adminRole === 'admin' && Boolean(assignedSpecializationId)));

    return {
      uid: decoded.uid,
      email,
      displayName: String(fsUserDoc?.displayName || displayName),
      photoURL: String(fsUserDoc?.photoURL || photoURL),
      googleSub,
      role: adminRole,
      permissions: finalPerms,
      status,
      isSuperAdmin,
      isStaff,
      assignedSpecializationId,
      assignmentId,
      scopeVersion,
      lastActivityAt,
    };
  }

  return {
    uid: decoded.uid,
    email,
    displayName: String(fsUserDoc?.displayName || displayName),
    photoURL: String(fsUserDoc?.photoURL || photoURL),
    googleSub,
    role: 'student',
    permissions: [],
    status,
    isSuperAdmin: false,
    isStaff: false,
  };
}

export function serverAuthHasPermission(
  resolved: ResolvedServerAuth | null,
  permission: PermissionKey
): boolean {
  if (!resolved || resolved.status !== 'active') return false;
  if (resolved.isSuperAdmin) return true;
  if (!resolved.isStaff) return false;
  if (SUPER_ADMIN_ONLY_SET.has(permission)) return false;
  return resolved.permissions.includes(permission);
}
