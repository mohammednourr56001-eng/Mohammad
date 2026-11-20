import { buildRfc2822EmailRaw } from './googleEcosystemLogic.ts';

export interface GmailProfileSummary {
  emailAddress: string;
  messagesTotal?: number;
  threadsTotal?: number;
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function parseGmailError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body?.error?.message) return body.error.message;
  } catch {
    // ignore
  }
  if (res.status === 401 || res.status === 403) {
    return 'انتهت صلاحية الجلسة أو تنقصك صلاحية Gmail.';
  }
  return fallback;
}

export async function getGmailProfile(accessToken: string): Promise<GmailProfileSummary> {
  const res = await fetch(`${GMAIL_API_BASE}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(await parseGmailError(res, 'تعذر قراءة بيانات حساب Gmail.'));
  }
  return (await res.json()) as GmailProfileSummary;
}

export async function listGmailMessages(
  accessToken: string,
  queryText = '',
  maxResults = 10
): Promise<GmailMessageSummary[]> {
  const params = new URLSearchParams({
    maxResults: String(Math.min(20, Math.max(1, maxResults))),
  });
  if (queryText.trim()) {
    params.set('q', queryText.trim());
  }

  const listRes = await fetch(`${GMAIL_API_BASE}/messages?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) {
    throw new Error(await parseGmailError(listRes, 'تعذر جلب رسائل Gmail.'));
  }

  const listData = (await listRes.json()) as {
    messages?: Array<{ id: string; threadId: string }>;
  };
  const refs = (listData.messages || []).slice(0, 10);
  if (refs.length === 0) return [];

  const details = await Promise.all(
    refs.map(async (ref) => {
      const msgRes = await fetch(
        `${GMAIL_API_BASE}/messages/${encodeURIComponent(
          ref.id
        )}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (!msgRes.ok) return null;
      const msgData = (await msgRes.json()) as {
        id: string;
        threadId: string;
        snippet?: string;
        payload?: {
          headers?: Array<{ name?: string; value?: string }>;
        };
      };
      const headers = msgData.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
      return {
        id: msgData.id,
        threadId: msgData.threadId,
        subject: getHeader('Subject') || '(بدون موضوع)',
        from: getHeader('From') || 'غير معروف',
        date: getHeader('Date') || '',
        snippet: msgData.snippet || '',
      } as GmailMessageSummary;
    })
  );

  return details.filter((item): item is GmailMessageSummary => item !== null);
}

export async function sendGmailMessage(params: {
  accessToken: string;
  to: string;
  subject: string;
  body: string;
}): Promise<{ id: string; threadId?: string }> {
  const raw = buildRfc2822EmailRaw({
    to: params.to,
    subject: params.subject,
    body: params.body,
  });

  const res = await fetch(`${GMAIL_API_BASE}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    throw new Error(await parseGmailError(res, 'تعذر إرسال الرسالة عبر Gmail.'));
  }
  return (await res.json()) as { id: string; threadId?: string };
}
