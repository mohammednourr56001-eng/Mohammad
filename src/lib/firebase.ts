import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = [
  // Existing Google Docs & Drive scopes (preserved)
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  // Google Picker
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  // Google Sheets
  'https://www.googleapis.com/auth/spreadsheets',
  // Google Forms
  'https://www.googleapis.com/auth/forms.body',
  // Google Calendar
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  // Gmail (least-privilege read + explicit send)
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  // Google Classroom
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
] as const;

export const OAUTH_CLIENT_ID =
  (firebaseConfig as { oAuthClientId?: string }).oAuthClientId || '';

const app = initializeApp(firebaseConfig);
const firestoreDatabaseId =
  (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId ||
  'ai-studio-44a15c97-d39e-4ee8-b8b4-f5de41f4907b';
export const db = getFirestore(app, firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const workspaceGoogleProvider = new GoogleAuthProvider();
SCOPES.forEach((scope) => workspaceGoogleProvider.addScope(scope));
workspaceGoogleProvider.setCustomParameters({ prompt: 'consent select_account' });
