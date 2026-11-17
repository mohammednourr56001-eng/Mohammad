import fs from 'fs';
import path from 'path';
import { getApps, initializeApp, App } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import firebaseConfig from '../firebase-applet-config.json';
import {
  AccountStatus,
  ActivityLog,
  AdminEntry,
  AdminInvitation,
  ALL_PERMISSIONS,
  BackupSnapshot,
  DEFAULT_ROLE_PERMISSIONS,
  PermissionKey,
  UserProfile,
  UserRole,
} from '../src/types/academic.ts';
import { ensureStorageDirectories, INDEX_DIR } from './storageManager.ts';

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

const FIRESTORE_REST_BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;

export async function verifyBearerToken(token: string): Promise<DecodedIdToken | null> {
  try {
    return await adminAuth.verifyIdToken(token);
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
    const res = await fetch(url, { headers });
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
    const url = `${FIRESTORE_REST_BASE}/${collectionPath}?pageSize=300&key=${encodeURIComponent(firebaseConfig.apiKey)}`;
    const headers: Record<string, string> = {};
    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      documents?: Array<{ fields?: Record<string, Record<string, unknown>> }>;
    };
    return (json.documents || [])
      .filter((d) => Boolean(d.fields))
      .map((d) => parseFirestoreFields(d.fields!));
  } catch {
    return [];
  }
}

export async function patchFirestoreDocRest(
  collectionPath: string,
  docId: string,
  data: Record<string, unknown>,
  bearerToken: string,
  updateMask?: string[]
): Promise<{ ok: boolean; status: number; errorText?: string }> {
  try {
    const maskParams = updateMask?.length
      ? updateMask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&') + '&'
      : '';
    const url = `${FIRESTORE_REST_BASE}/${collectionPath}/${encodeURIComponent(docId)}?${maskParams}key=${encodeURIComponent(firebaseConfig.apiKey)}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify(toFirestoreDocument(data)),
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
    const res = await fetch(url, {
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

function readIndexJson<T>(filename: string, fallback: T): T {
  ensureStorageDirectories();
  const fullPath = path.join(INDEX_DIR, filename);
  try {
    if (fs.existsSync(fullPath)) {
      return JSON.parse(fs.readFileSync(fullPath, 'utf8')) as T;
    }
  } catch {
    // ignore corrupt index
  }
  return fallback;
}

function writeIndexJson(filename: string, data: unknown): void {
  ensureStorageDirectories();
  const fullPath = path.join(INDEX_DIR, filename);
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf8');
}

export function loadUsersDirectory(): Record<string, UserProfile> {
  return readIndexJson<Record<string, UserProfile>>('users-directory.json', {});
}

export function upsertUserDirectoryEntry(user: UserProfile): void {
  const dir = loadUsersDirectory();
  dir[user.uid] = user;
  writeIndexJson('users-directory.json', dir);
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
  const logs = loadServerAuditLogs();
  logs.unshift(log);
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

// --- Authoritative Server-Side Role & Permission Resolution ---

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

  const statusRaw = String(
    fsAdminDoc?.status || localAdminDoc?.status || fsUserDoc?.status || localUserDoc?.status || 'active'
  );
  const status: AccountStatus = statusRaw === 'suspended' ? 'suspended' : 'active';

  const rawRole = String(fsAdminDoc?.role || localAdminDoc?.role || fsUserDoc?.role || 'student') as UserRole;

  if (fsAdminDoc || localAdminDoc) {
    const adminRole: UserRole =
      rawRole === 'super_admin' || rawRole === 'admin' || rawRole === 'moderator'
        ? rawRole
        : 'moderator';
    const permsRaw = fsAdminDoc?.permissions || localAdminDoc?.permissions;
    const permissions: PermissionKey[] = Array.isArray(permsRaw)
      ? (permsRaw.filter((p): p is PermissionKey =>
          ALL_PERMISSIONS.includes(p as PermissionKey)
        ) as PermissionKey[])
      : DEFAULT_ROLE_PERMISSIONS[adminRole];

    const isSuperAdmin = adminRole === 'super_admin' && status === 'active';
    const isStaff = status === 'active' && (adminRole === 'super_admin' || adminRole === 'admin' || adminRole === 'moderator');

    return {
      uid: decoded.uid,
      email,
      displayName: String(fsUserDoc?.displayName || displayName),
      photoURL: String(fsUserDoc?.photoURL || photoURL),
      googleSub,
      role: adminRole,
      permissions: status === 'suspended' ? [] : isSuperAdmin ? [...ALL_PERMISSIONS] : permissions,
      status,
      isSuperAdmin,
      isStaff,
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
  return resolved.permissions.includes(permission);
}
