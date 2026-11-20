import {
  GoogleServiceCatalogItem,
  GoogleServiceConnectionState,
  GoogleServiceKey,
  GoogleServiceVerificationResult,
} from '../types/googleEcosystem.ts';
import { UserRole } from '../types/academic.ts';

export const GOOGLE_SERVICES_CATALOG: GoogleServiceCatalogItem[] = [
  {
    key: 'picker',
    nameAr: 'Google Picker',
    nameEn: 'Google Picker',
    shortDescription: 'تصفح واختيار الملفات والمستندات مباشرة من Google Drive بدون نسخ غير ضروري.',
    permissionSummaryAr: 'الوصول للملفات المختارة وقراءة بيانات الملفات الوصفية فقط.',
    requiredScopes: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
    ],
    zeroCostNote: 'مجاني 100% عبر واجهة العميل الرسمية دون رسوم فوترية.',
  },
  {
    key: 'sheets',
    nameAr: 'Google Sheets',
    nameEn: 'Google Sheets',
    shortDescription: 'عرض جداول البيانات الأكاديمية ودرجات الطلاب وإضافة الصفوف بتأكيد صريح.',
    permissionSummaryAr: 'قراءة وتحديث جداول البيانات المصرح بها بعد موافقة المستخدم.',
    requiredScopes: ['https://www.googleapis.com/auth/spreadsheets'],
    zeroCostNote: 'مجاني ضمن حصص Google Sheets API القياسية.',
  },
  {
    key: 'forms',
    nameAr: 'Google Forms',
    nameEn: 'Google Forms',
    shortDescription: 'إنشاء وربط نماذج الاختبارات والاستبيانات وتنظيمها حسب التخصص والسنة.',
    permissionSummaryAr: 'إنشاء وعرض النماذج التعليمية المرتبطة بحسابك.',
    requiredScopes: ['https://www.googleapis.com/auth/forms.body'],
    zeroCostNote: 'مجاني بالكامل بدون أي خدمات مدفوعة.',
  },
  {
    key: 'calendar',
    nameAr: 'Google Calendar',
    nameEn: 'Google Calendar',
    shortDescription: 'عرض مواعيد المحاضرات والاختبارات القادمة وإضافة أحداث التقويم الأكاديمي.',
    permissionSummaryAr: 'قراءة قوائم التقويم وعرض وإنشاء المواعيد بتأكيد مسبق.',
    requiredScopes: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    ],
    zeroCostNote: 'مجاني بالكامل ضمن الحصص اليومية للـ API.',
  },
  {
    key: 'gmail',
    nameAr: 'Gmail',
    nameEn: 'Gmail',
    shortDescription: 'عرض الرسائل والإشعارات المصرح بها وإرسال الرسائل بعد تأكيد صريح فقط.',
    permissionSummaryAr: 'قراءة الرسائل والإرسال عند التأكيد المباشر (دون صلاحية الحذف الدائم).',
    requiredScopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
    ],
    zeroCostNote: 'مجاني بالكامل لحسابات Gmail ضمن حدود الإرسال اليومية.',
  },
  {
    key: 'classroom',
    nameAr: 'Google Classroom',
    nameEn: 'Google Classroom',
    shortDescription: 'استعراض المقررات الدراسية، التكليفات، المواعيد النهائية، والمواد التعليمية.',
    permissionSummaryAr: 'عرض الفصول والمواد وإدارة التكليفات المصرح بها للمحاضرين.',
    requiredScopes: [
      'https://www.googleapis.com/auth/classroom.courses.readonly',
      'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
      'https://www.googleapis.com/auth/classroom.coursework.students',
      'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
      'https://www.googleapis.com/auth/classroom.announcements.readonly',
    ],
    zeroCostNote: 'مجاني بالكامل (قد تتطلب بعض الميزات حساب Google Workspace تعليمي).',
  },
];

export function evaluateServiceConnectionStatus(params: {
  serviceKey: GoogleServiceKey;
  hasToken: boolean;
  liveCheckOk?: boolean;
  httpStatus?: number;
  errorMessage?: string;
  accountEmail?: string;
  detail?: string;
  manualSetupHint?: string;
}): GoogleServiceVerificationResult {
  if (!params.hasToken) {
    return {
      serviceKey: params.serviceKey,
      status: 'disconnected',
      detail: 'غير متصل بعد — اضغط ربط لتسجيل الدخول ومنح الصلاحيات.',
    };
  }

  if (params.liveCheckOk) {
    return {
      serviceKey: params.serviceKey,
      status: 'connected',
      verifiedAt: new Date().toISOString(),
      accountEmail: params.accountEmail,
      detail: params.detail || 'متصل وموثق عبر فحص فعلي للخدمة.',
    };
  }

  const msg = params.errorMessage || '';
  const lower = msg.toLowerCase();
  let status: GoogleServiceConnectionState = 'error';
  let hint = params.manualSetupHint;

  if (
    params.httpStatus === 403 &&
    (lower.includes('has not been used in project') ||
      lower.includes('api has not been enabled') ||
      lower.includes('disabled'))
  ) {
    status = 'api_disabled';
    hint =
      hint ||
      'يجب تفعيل واجهة API لهذه الخدمة مجاناً من Google Cloud Console لهذا المشروع.';
  } else if (
    params.httpStatus === 401 ||
    params.httpStatus === 403 ||
    lower.includes('insufficient') ||
    lower.includes('permission') ||
    lower.includes('unauthorized')
  ) {
    status = 'permission_denied';
  }

  return {
    serviceKey: params.serviceKey,
    status,
    verifiedAt: new Date().toISOString(),
    accountEmail: params.accountEmail,
    errorMessage: msg || 'تعذر التحقق من اتصال الخدمة.',
    manualSetupHint: hint,
  };
}

export function extractGoogleFormIdFromInput(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  // Match full Google Forms URL
  const urlMatch = trimmed.match(
    /^https?:\/\/docs\.google\.com\/forms\/d\/(?:e\/)?([a-zA-Z0-9_-]{12,180})(?:\/|$|\?)/
  );
  if (urlMatch?.[1]) {
    // Reject public responder "/d/e/1FAIpQL..." IDs when expecting Form API ID only? Keep distinguishable:
    if (trimmed.includes('/forms/d/e/')) {
      return null;
    }
    return urlMatch[1];
  }

  // Match raw Form ID
  if (/^[a-zA-Z0-9_-]{12,180}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export function extractSpreadsheetIdFromInput(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(
    /^https?:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{12,180})(?:\/|$|\?)/
  );
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  if (/^[a-zA-Z0-9_-]{12,180}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export function sanitizeSheetRange(sheetTitle: string, a1Range = 'A1:Z100'): string {
  const cleanTitle = sheetTitle.trim().replace(/'/g, "''");
  const cleanRange = (a1Range.trim() || 'A1:Z100').replace(/[^a-zA-Z0-9:]/g, '');
  if (!cleanTitle) {
    return cleanRange || 'A1:Z100';
  }
  return `'${cleanTitle}'!${cleanRange || 'A1:Z100'}`;
}

export function validateEmailAddress(email: string): boolean {
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  if (/[\r\n]/.test(trimmed)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function parseAndValidateRecipients(rawTo: string): {
  valid: boolean;
  recipients: string[];
  error?: string;
} {
  const parts = rawTo
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return { valid: false, recipients: [], error: 'يرجى إدخال بريد إلكتروني واحد على الأقل.' };
  }
  if (parts.length > 10) {
    return {
      valid: false,
      recipients: [],
      error: 'الحد الأقصى للمستلمين في الرسالة الواحدة هو 10 مستلمين.',
    };
  }
  for (const addr of parts) {
    if (!validateEmailAddress(addr)) {
      return {
        valid: false,
        recipients: [],
        error: `البريد الإلكتروني غير صالح: ${addr}`,
      };
    }
  }
  return { valid: true, recipients: parts };
}

function toBase64Utf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function toBase64UrlUtf8(input: string): string {
  return toBase64Utf8(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function buildRfc2822EmailRaw(params: {
  to: string;
  subject: string;
  body: string;
}): string {
  const recipientCheck = parseAndValidateRecipients(params.to);
  if (!recipientCheck.valid) {
    throw new Error(recipientCheck.error || 'عنوان المستلم غير صالح.');
  }
  const safeSubject = params.subject.replace(/[\r\n]+/g, ' ').trim();
  if (safeSubject.length < 1 || safeSubject.length > 200) {
    throw new Error('يرجى إدخال موضوع للرسالة (1 إلى 200 حرف).');
  }
  const safeBody = params.body.trim();
  if (safeBody.length < 1 || safeBody.length > 20000) {
    throw new Error('محتوى الرسالة مطلوب ولا يتجاوز 20000 حرف.');
  }

  const encodedSubject = `=?UTF-8?B?${toBase64Utf8(safeSubject)}?=`;
  const messageLines = [
    `To: ${recipientCheck.recipients.join(', ')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    `Subject: ${encodedSubject}`,
    '',
    toBase64Utf8(safeBody),
  ];

  return toBase64UrlUtf8(messageLines.join('\r\n'));
}

export function validateCalendarEventDraft(params: {
  title: string;
  startsAtIso: string;
  endsAtIso: string;
}): { valid: boolean; error?: string } {
  const cleanTitle = params.title.trim();
  if (cleanTitle.length < 2 || cleanTitle.length > 180) {
    return { valid: false, error: 'عنوان الحدث يجب أن يكون بين حرفين و180 حرفاً.' };
  }
  const startMs = Date.parse(params.startsAtIso);
  const endMs = Date.parse(params.endsAtIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return { valid: false, error: 'صيغة تاريخ ووقت البدء أو الانتهاء غير صالحة.' };
  }
  if (endMs <= startMs) {
    return { valid: false, error: 'يجب أن يكون وقت الانتهاء بعد وقت البدء.' };
  }
  return { valid: true };
}

export function deduplicatePickedDriveFiles<T extends { id: string }>(
  existing: T[],
  incoming: T[]
): { merged: T[]; addedCount: number; skippedCount: number } {
  const seen = new Set(existing.map((f) => f.id));
  const merged = [...existing];
  let addedCount = 0;
  let skippedCount = 0;

  for (const item of incoming) {
    if (!item?.id || seen.has(item.id)) {
      skippedCount += 1;
      continue;
    }
    seen.add(item.id);
    merged.push(item);
    addedCount += 1;
  }

  return { merged, addedCount, skippedCount };
}

export function canPublishFileToCourseRepository(
  role: UserRole,
  isSuperAdmin: boolean
): boolean {
  return isSuperAdmin && role === 'super_admin';
}
