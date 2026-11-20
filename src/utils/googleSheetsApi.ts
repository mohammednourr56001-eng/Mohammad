import { sanitizeSheetRange } from './googleEcosystemLogic.ts';

export interface GoogleSpreadsheetListItem {
  id: string;
  name: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export interface GoogleSpreadsheetTab {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
}

export interface GoogleSpreadsheetMetadata {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  sheets: GoogleSpreadsheetTab[];
}

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';

async function parseSheetsError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body?.error?.message) return body.error.message;
  } catch {
    // ignore
  }
  if (res.status === 401 || res.status === 403) {
    return 'انتهت صلاحية الجلسة أو تنقصك صلاحية Google Sheets.';
  }
  return fallback;
}

export async function listUserSpreadsheets(
  accessToken: string,
  searchTerm = ''
): Promise<GoogleSpreadsheetListItem[]> {
  const safeSearch = searchTerm.trim().replace(/'/g, "\\'");
  const qParts = [
    "mimeType='application/vnd.google-apps.spreadsheet'",
    'trashed=false',
  ];
  if (safeSearch) {
    qParts.push(`name contains '${safeSearch}'`);
  }

  const params = new URLSearchParams({
    q: qParts.join(' and '),
    orderBy: 'modifiedTime desc',
    pageSize: '25',
    fields: 'files(id,name,modifiedTime,webViewLink)',
  });

  const res = await fetch(`${DRIVE_FILES_API}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(await parseSheetsError(res, 'تعذر جلب جداول Google Sheets.'));
  }
  const data = (await res.json()) as { files?: GoogleSpreadsheetListItem[] };
  return Array.isArray(data.files) ? data.files : [];
}

export async function getSpreadsheetMetadata(
  accessToken: string,
  spreadsheetId: string
): Promise<GoogleSpreadsheetMetadata> {
  const safeId = encodeURIComponent(spreadsheetId.trim());
  const params = new URLSearchParams({
    fields: 'spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))',
  });
  const res = await fetch(`${SHEETS_API_BASE}/${safeId}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(await parseSheetsError(res, 'تعذر قراءة بيانات الجدول من Google Sheets.'));
  }
  const raw = (await res.json()) as {
    spreadsheetId: string;
    spreadsheetUrl?: string;
    properties?: { title?: string };
    sheets?: Array<{
      properties?: {
        sheetId?: number;
        title?: string;
        gridProperties?: { rowCount?: number; columnCount?: number };
      };
    }>;
  };

  return {
    spreadsheetId: raw.spreadsheetId,
    title: raw.properties?.title || 'جدول بيانات Google Sheets',
    spreadsheetUrl:
      raw.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${safeId}/edit`,
    sheets: (raw.sheets || []).map((s, idx) => ({
      sheetId: s.properties?.sheetId ?? idx,
      title: s.properties?.title || `ورقة ${idx + 1}`,
      rowCount: s.properties?.gridProperties?.rowCount ?? 100,
      columnCount: s.properties?.gridProperties?.columnCount ?? 26,
    })),
  };
}

export async function readSpreadsheetValues(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  a1Range = 'A1:Z100'
): Promise<string[][]> {
  const safeId = encodeURIComponent(spreadsheetId.trim());
  const fullRange = encodeURIComponent(sanitizeSheetRange(sheetTitle, a1Range));
  const res = await fetch(`${SHEETS_API_BASE}/${safeId}/values/${fullRange}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(await parseSheetsError(res, 'تعذر قراءة صفوف الجدول.'));
  }
  const data = (await res.json()) as { values?: unknown[][] };
  if (!Array.isArray(data.values)) return [];
  return data.values.map((row) =>
    Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []
  );
}

export async function createSpreadsheet(
  accessToken: string,
  title: string,
  firstSheetTitle = 'بيانات UST',
  headers?: string[]
): Promise<GoogleSpreadsheetMetadata> {
  const cleanTitle = title.trim() || 'جدول أكاديمي UST';
  const cleanTab = firstSheetTitle.trim() || 'بيانات UST';
  const res = await fetch(SHEETS_API_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title: cleanTitle },
      sheets: [{ properties: { title: cleanTab } }],
    }),
  });
  if (!res.ok) {
    throw new Error(await parseSheetsError(res, 'تعذر إنشاء جدول Google Sheets جديد.'));
  }
  const created = (await res.json()) as {
    spreadsheetId: string;
    spreadsheetUrl?: string;
    properties?: { title?: string };
    sheets?: Array<{
      properties?: {
        sheetId?: number;
        title?: string;
        gridProperties?: { rowCount?: number; columnCount?: number };
      };
    }>;
  };

  if (headers && headers.length > 0) {
    await appendSpreadsheetRows(accessToken, created.spreadsheetId, cleanTab, [headers]);
  }

  return {
    spreadsheetId: created.spreadsheetId,
    title: created.properties?.title || cleanTitle,
    spreadsheetUrl:
      created.spreadsheetUrl ||
      `https://docs.google.com/spreadsheets/d/${encodeURIComponent(created.spreadsheetId)}/edit`,
    sheets: (created.sheets || []).map((s, idx) => ({
      sheetId: s.properties?.sheetId ?? idx,
      title: s.properties?.title || cleanTab,
      rowCount: s.properties?.gridProperties?.rowCount ?? 1000,
      columnCount: s.properties?.gridProperties?.columnCount ?? 26,
    })),
  };
}

export async function appendSpreadsheetRows(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  rows: string[][]
): Promise<{ updatedRange?: string; updatedRows?: number }> {
  const safeId = encodeURIComponent(spreadsheetId.trim());
  const range = encodeURIComponent(sanitizeSheetRange(sheetTitle, 'A1:Z1'));
  const res = await fetch(
    `${SHEETS_API_BASE}/${safeId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: rows }),
    }
  );
  if (!res.ok) {
    throw new Error(await parseSheetsError(res, 'تعذر إضافة الصفوف إلى الجدول.'));
  }
  const data = (await res.json()) as {
    updates?: { updatedRange?: string; updatedRows?: number };
  };
  return data.updates || {};
}
