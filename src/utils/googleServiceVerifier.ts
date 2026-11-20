import {
  GoogleServiceKey,
  GoogleServiceVerificationResult,
} from '../types/googleEcosystem.ts';
import {
  evaluateServiceConnectionStatus,
  GOOGLE_SERVICES_CATALOG,
} from './googleEcosystemLogic.ts';
import { verifyGooglePickerDriveAccess } from './googlePickerApi.ts';
import { getGmailProfile } from './gmailApi.ts';
import { listUserCalendars } from './googleCalendarApi.ts';
import { listClassroomCourses } from './googleClassroomApi.ts';
import { listUserSpreadsheets } from './googleSheetsApi.ts';

async function probeServiceEndpoint(
  url: string,
  accessToken: string
): Promise<{ ok: boolean; status: number; errorMessage?: string }> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      return { ok: true, status: res.status };
    }
    let errorMessage = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: { message?: string } };
      if (data?.error?.message) errorMessage = data.error.message;
    } catch {
      // ignore
    }
    return { ok: false, status: res.status, errorMessage };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      errorMessage: err instanceof Error ? err.message : 'فشل الاتصال بالشبكة.',
    };
  }
}

export async function verifySingleGoogleService(params: {
  serviceKey: GoogleServiceKey;
  accessToken: string | null;
  accountEmail?: string;
}): Promise<GoogleServiceVerificationResult> {
  const { serviceKey, accessToken, accountEmail } = params;
  if (!accessToken) {
    return evaluateServiceConnectionStatus({ serviceKey, hasToken: false });
  }

  try {
    switch (serviceKey) {
      case 'picker': {
        const check = await verifyGooglePickerDriveAccess(accessToken);
        return evaluateServiceConnectionStatus({
          serviceKey,
          hasToken: true,
          liveCheckOk: check.ok,
          httpStatus: check.httpStatus,
          errorMessage: check.error,
          accountEmail,
          detail: 'تم التحقق من صلاحية Drive وواجهة اختيار الملفات (Google Picker).',
        });
      }
      case 'sheets': {
        // Verify Sheets API endpoint directly via token scope + Drive spreadsheet probe
        const sheetsProbe = await listUserSpreadsheets(accessToken, '');
        return evaluateServiceConnectionStatus({
          serviceKey,
          hasToken: true,
          liveCheckOk: true,
          accountEmail,
          detail: `متصل وموثق — تم العثور على ${sheetsProbe.length} جدول بيانات متاح.`,
        });
      }
      case 'forms': {
        // Verify Drive query for Google Forms + token scope check
        const res = await probeServiceEndpoint(
          "https://www.googleapis.com/drive/v3/files?q=mimeType%3D'application%2Fvnd.google-apps.form'%20and%20trashed%3Dfalse&pageSize=1&fields=files(id)",
          accessToken
        );
        return evaluateServiceConnectionStatus({
          serviceKey,
          hasToken: true,
          liveCheckOk: res.ok,
          httpStatus: res.status,
          errorMessage: res.errorMessage,
          accountEmail,
          detail: 'متصل وموثق لإنشاء واستعراض نماذج Google Forms.',
        });
      }
      case 'calendar': {
        const calendars = await listUserCalendars(accessToken);
        return evaluateServiceConnectionStatus({
          serviceKey,
          hasToken: true,
          liveCheckOk: true,
          accountEmail,
          detail: `متصل وموثق — ${calendars.length} تقويم متاح في حسابك.`,
        });
      }
      case 'gmail': {
        const profile = await getGmailProfile(accessToken);
        return evaluateServiceConnectionStatus({
          serviceKey,
          hasToken: true,
          liveCheckOk: true,
          accountEmail: profile.emailAddress || accountEmail,
          detail: `متصل وموثق بالحساب ${profile.emailAddress}.`,
        });
      }
      case 'classroom': {
        const courses = await listClassroomCourses(accessToken);
        return evaluateServiceConnectionStatus({
          serviceKey,
          hasToken: true,
          liveCheckOk: true,
          accountEmail,
          detail: `متصل وموثق — ${courses.length} مقرر نشط في Google Classroom.`,
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'تعذر التحقق من الخدمة.';
    const lower = msg.toLowerCase();
    const inferredStatus =
      lower.includes('403') || lower.includes('disabled') || lower.includes('صلاحية')
        ? 403
        : 400;
    return evaluateServiceConnectionStatus({
      serviceKey,
      hasToken: true,
      liveCheckOk: false,
      httpStatus: inferredStatus,
      errorMessage: msg,
      accountEmail,
    });
  }
}

export async function verifyAllGoogleServices(params: {
  accessToken: string | null;
  accountEmail?: string;
}): Promise<Record<GoogleServiceKey, GoogleServiceVerificationResult>> {
  const entries = await Promise.all(
    GOOGLE_SERVICES_CATALOG.map(async (svc) => {
      const result = await verifySingleGoogleService({
        serviceKey: svc.key,
        accessToken: params.accessToken,
        accountEmail: params.accountEmail,
      });
      return [svc.key, result] as const;
    })
  );
  return Object.fromEntries(entries) as Record<
    GoogleServiceKey,
    GoogleServiceVerificationResult
  >;
}
