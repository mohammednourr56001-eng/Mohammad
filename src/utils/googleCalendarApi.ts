export interface GoogleCalendarListItem {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
}

export interface GoogleCalendarEventItem {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  startIso: string;
  endIso: string;
  isAllDay: boolean;
}

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

async function parseCalendarError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body?.error?.message) return body.error.message;
  } catch {
    // ignore
  }
  if (res.status === 401 || res.status === 403) {
    return 'انتهت صلاحية الجلسة أو تنقصك صلاحية Google Calendar.';
  }
  return fallback;
}

export async function listUserCalendars(
  accessToken: string
): Promise<GoogleCalendarListItem[]> {
  const res = await fetch(`${CALENDAR_API_BASE}/users/me/calendarList?minAccessRole=reader`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(await parseCalendarError(res, 'تعذر جلب قائمة التقاويم من Google Calendar.'));
  }
  const data = (await res.json()) as { items?: GoogleCalendarListItem[] };
  return Array.isArray(data.items) ? data.items : [];
}

export async function listCalendarEvents(
  accessToken: string,
  calendarId = 'primary',
  maxResults = 25
): Promise<GoogleCalendarEventItem[]> {
  const safeCal = encodeURIComponent(calendarId);
  const nowIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin: nowIso,
    maxResults: String(maxResults),
  });
  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${safeCal}/events?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    throw new Error(await parseCalendarError(res, 'تعذر جلب المواعيد من Google Calendar.'));
  }
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      description?: string;
      location?: string;
      htmlLink?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }>;
  };

  return (data.items || []).map((ev) => ({
    id: ev.id,
    summary: ev.summary || 'حدث بدون عنوان',
    description: ev.description,
    location: ev.location,
    htmlLink: ev.htmlLink,
    startIso: ev.start?.dateTime || ev.start?.date || '',
    endIso: ev.end?.dateTime || ev.end?.date || '',
    isAllDay: Boolean(ev.start?.date && !ev.start?.dateTime),
  }));
}

export async function createCalendarEvent(params: {
  accessToken: string;
  calendarId?: string;
  summary: string;
  description?: string;
  location?: string;
  startsAtIso: string;
  endsAtIso: string;
}): Promise<GoogleCalendarEventItem> {
  const safeCal = encodeURIComponent(params.calendarId || 'primary');
  const res = await fetch(`${CALENDAR_API_BASE}/calendars/${safeCal}/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary: params.summary.trim(),
      description: params.description?.trim() || undefined,
      location: params.location?.trim() || undefined,
      start: { dateTime: params.startsAtIso },
      end: { dateTime: params.endsAtIso },
    }),
  });
  if (!res.ok) {
    throw new Error(await parseCalendarError(res, 'تعذر إنشاء الحدث في Google Calendar.'));
  }
  const ev = (await res.json()) as {
    id: string;
    summary?: string;
    description?: string;
    location?: string;
    htmlLink?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
  };

  return {
    id: ev.id,
    summary: ev.summary || params.summary,
    description: ev.description,
    location: ev.location,
    htmlLink: ev.htmlLink,
    startIso: ev.start?.dateTime || ev.start?.date || params.startsAtIso,
    endIso: ev.end?.dateTime || ev.end?.date || params.endsAtIso,
    isAllDay: false,
  };
}
