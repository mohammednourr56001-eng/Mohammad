export type GoogleServiceKey =
  | 'picker'
  | 'sheets'
  | 'forms'
  | 'gmail'
  | 'calendar'
  | 'classroom';

export type GoogleServiceConnectionState =
  | 'disconnected'
  | 'checking'
  | 'connected'
  | 'permission_denied'
  | 'api_disabled'
  | 'error';

export interface GoogleServiceVerificationResult {
  serviceKey: GoogleServiceKey;
  status: GoogleServiceConnectionState;
  verifiedAt?: string;
  accountEmail?: string;
  detail?: string;
  errorMessage?: string;
  manualSetupHint?: string;
}

export interface GoogleServiceCatalogItem {
  key: GoogleServiceKey;
  nameAr: string;
  nameEn: string;
  shortDescription: string;
  permissionSummaryAr: string;
  requiredScopes: string[];
  zeroCostNote: string;
}

export interface GoogleConnectionRecord {
  id: string;
  userId: string;
  serviceKey: GoogleServiceKey;
  status: 'connected' | 'disconnected' | 'error';
  connectedEmail?: string;
  lastVerifiedAt: string;
  lastError?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AcademicFormRecord {
  id: string;
  title: string;
  description?: string;
  formId: string;
  responderUri: string;
  editUri?: string;
  specializationId: string;
  academicYearId?: string;
  subjectId?: string;
  formCategory: 'quiz' | 'survey' | 'assignment' | 'feedback';
  status: 'published' | 'draft';
  createdBy: string;
  createdByEmail?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AcademicCalendarRecord {
  id: string;
  title: string;
  description?: string;
  specializationId: string;
  academicYearId?: string;
  subjectId?: string;
  eventType: 'lecture' | 'exam' | 'deadline' | 'seminar';
  startsAt: string;
  endsAt: string;
  location?: string;
  googleCalendarId?: string;
  googleEventId?: string;
  googleHtmlLink?: string;
  status: 'published' | 'draft';
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface GooglePickedFileRecord {
  id: string;
  driveFileId: string;
  name: string;
  mimeType: string;
  url: string;
  iconUrl?: string;
  sizeBytes?: number;
  linkedLectureFileId?: string;
  specializationId?: string;
  status: 'active' | 'archived';
  createdBy: string;
  createdByEmail?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}
