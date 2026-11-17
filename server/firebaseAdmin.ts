import { getApps, initializeApp, App } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import firebaseConfig from '../firebase-applet-config.json';

let adminApp: App;
if (!getApps().length) {
  adminApp = initializeApp({
    projectId: firebaseConfig.projectId,
  });
} else {
  adminApp = getApps()[0];
}

export const adminAuth = getAuth(adminApp);
export const BOOTSTRAPPED_ADMIN_EMAIL = 'mohammednourr56000@gmail.com';

const FIRESTORE_REST_BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;

export async function verifyBearerToken(token: string): Promise<DecodedIdToken | null> {
  try {
    return await adminAuth.verifyIdToken(token);
  } catch {
    return null;
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
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const json = (await res.json()) as { fields?: Record<string, Record<string, unknown>> };
    if (!json.fields) return null;
    return parseFirestoreFields(json.fields);
  } catch {
    return null;
  }
}

function parseFirestoreFields(
  fields: Record<string, Record<string, unknown>>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if ('stringValue' in v) out[k] = v.stringValue;
    else if ('integerValue' in v) out[k] = Number(v.integerValue);
    else if ('doubleValue' in v) out[k] = Number(v.doubleValue);
    else if ('booleanValue' in v) out[k] = Boolean(v.booleanValue);
    else if ('timestampValue' in v) out[k] = v.timestampValue;
  }
  return out;
}

export async function isUserAdmin(
  decoded: DecodedIdToken | null,
  bearerToken?: string
): Promise<boolean> {
  if (!decoded) return false;
  if (decoded.email_verified && decoded.email === BOOTSTRAPPED_ADMIN_EMAIL) {
    return true;
  }
  const adminDoc = await fetchFirestoreDocRest('admins', decoded.uid, bearerToken);
  if (adminDoc) return true;
  const userDoc = await fetchFirestoreDocRest('users', decoded.uid, bearerToken);
  return userDoc?.role === 'admin';
}
