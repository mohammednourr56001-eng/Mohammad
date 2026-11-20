import { SafeJsonStore } from './safeJsonStore.ts';
import { INDEX_DIR } from './storageManager.ts';
import type {
  AcademicCalendarRecord,
  AcademicFormRecord,
  GooglePickedFileRecord,
} from '../src/types/googleEcosystem.ts';

const googleStore = new SafeJsonStore(INDEX_DIR);

const FORMS_INDEX_FILE = 'google-academic-forms.json';
const CALENDARS_INDEX_FILE = 'google-academic-calendars.json';
const PICKED_FILES_INDEX_FILE = 'google-picked-files.json';

export function loadAcademicFormsIndex(): AcademicFormRecord[] {
  const list = googleStore.readSync<AcademicFormRecord[]>(FORMS_INDEX_FILE, []);
  return Array.isArray(list) ? list : [];
}

export function upsertAcademicFormIndex(record: AcademicFormRecord): AcademicFormRecord[] {
  const list = loadAcademicFormsIndex();
  const next = [record, ...list.filter((item) => item.id !== record.id)];
  void googleStore.enqueueWrite(FORMS_INDEX_FILE, next);
  return next;
}

export function removeAcademicFormIndex(formDocId: string): boolean {
  const list = loadAcademicFormsIndex();
  const next = list.filter((item) => item.id !== formDocId);
  if (next.length === list.length) return false;
  void googleStore.enqueueWrite(FORMS_INDEX_FILE, next);
  return true;
}

export function loadAcademicCalendarsIndex(): AcademicCalendarRecord[] {
  const list = googleStore.readSync<AcademicCalendarRecord[]>(CALENDARS_INDEX_FILE, []);
  return Array.isArray(list) ? list : [];
}

export function upsertAcademicCalendarIndex(
  record: AcademicCalendarRecord
): AcademicCalendarRecord[] {
  const list = loadAcademicCalendarsIndex();
  const next = [record, ...list.filter((item) => item.id !== record.id)];
  void googleStore.enqueueWrite(CALENDARS_INDEX_FILE, next);
  return next;
}

export function removeAcademicCalendarIndex(calendarDocId: string): boolean {
  const list = loadAcademicCalendarsIndex();
  const next = list.filter((item) => item.id !== calendarDocId);
  if (next.length === list.length) return false;
  void googleStore.enqueueWrite(CALENDARS_INDEX_FILE, next);
  return true;
}

export function loadGooglePickedFilesIndex(): GooglePickedFileRecord[] {
  const list = googleStore.readSync<GooglePickedFileRecord[]>(PICKED_FILES_INDEX_FILE, []);
  return Array.isArray(list) ? list : [];
}

export function upsertGooglePickedFileIndex(
  record: GooglePickedFileRecord
): { existing?: GooglePickedFileRecord; inserted: boolean; items: GooglePickedFileRecord[] } {
  const list = loadGooglePickedFilesIndex();
  const existing = list.find((item) => item.driveFileId === record.driveFileId);
  if (existing) {
    return { existing, inserted: false, items: list };
  }
  const next = [record, ...list].slice(0, 500);
  void googleStore.enqueueWrite(PICKED_FILES_INDEX_FILE, next);
  return { inserted: true, items: next };
}

export async function flushGoogleEcosystemWrites(): Promise<void> {
  await googleStore.flushAll();
}
