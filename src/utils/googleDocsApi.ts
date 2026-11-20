import { LectureCategory } from '../types/academic.ts';

export interface GoogleDriveDocSummary {
  id: string;
  name: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export interface GoogleDriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  iconLink?: string;
}

export interface DriveMimeMapping {
  fileExt: string;
  mimeType: string;
  suggestedCategory: LectureCategory;
  typeLabelAr: string;
}

export interface GoogleDocContent {
  documentId: string;
  title: string;
  revisionId?: string;
  endIndex: number;
  paragraphs: Array<{
    text: string;
    heading?: string;
  }>;
}

const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const DOCS_API_BASE = 'https://docs.googleapis.com/v1/documents';

export function mapDriveMimeToMeta(mimeType: string, fileName = ''): DriveMimeMapping {
  const lowerMime = (mimeType || '').toLowerCase();
  const extMatch = fileName.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  const nameExt = extMatch?.[1] || '';

  if (lowerMime === 'application/vnd.google-apps.document') {
    return {
      fileExt: 'gdoc',
      mimeType: lowerMime,
      suggestedCategory: 'word',
      typeLabelAr: 'مستند Google Docs',
    };
  }
  if (lowerMime === 'application/vnd.google-apps.presentation') {
    return {
      fileExt: 'gslides',
      mimeType: lowerMime,
      suggestedCategory: 'powerpoint',
      typeLabelAr: 'عرض Google Slides',
    };
  }
  if (lowerMime === 'application/vnd.google-apps.spreadsheet') {
    return {
      fileExt: 'gsheet',
      mimeType: lowerMime,
      suggestedCategory: 'extra',
      typeLabelAr: 'جدول Google Sheets',
    };
  }
  if (lowerMime === 'application/pdf' || nameExt === 'pdf') {
    return {
      fileExt: 'pdf',
      mimeType: 'application/pdf',
      suggestedCategory: 'lectures_pdf',
      typeLabelAr: 'ملف PDF',
    };
  }
  if (
    lowerMime.includes('presentationml') ||
    lowerMime.includes('ms-powerpoint') ||
    nameExt === 'ppt' ||
    nameExt === 'pptx'
  ) {
    return {
      fileExt: nameExt === 'ppt' ? 'ppt' : 'pptx',
      mimeType: lowerMime || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      suggestedCategory: 'powerpoint',
      typeLabelAr: 'عرض PowerPoint',
    };
  }
  if (
    lowerMime.includes('wordprocessingml') ||
    lowerMime.includes('msword') ||
    nameExt === 'doc' ||
    nameExt === 'docx'
  ) {
    return {
      fileExt: nameExt === 'doc' ? 'doc' : 'docx',
      mimeType: lowerMime || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      suggestedCategory: 'word',
      typeLabelAr: 'مستند Word',
    };
  }
  if (lowerMime.startsWith('image/')) {
    return {
      fileExt: nameExt || lowerMime.split('/')[1] || 'png',
      mimeType: lowerMime,
      suggestedCategory: 'notes',
      typeLabelAr: 'صورة تعليمية',
    };
  }
  return {
    fileExt: nameExt || 'gdrive',
    mimeType: lowerMime || 'application/octet-stream',
    suggestedCategory: 'extra',
    typeLabelAr: 'ملف Google Drive',
  };
}

async function parseApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string } };
    if (data?.error?.message) return data.error.message;
  } catch {
    // ignore json parse failure
  }
  if (res.status === 401 || res.status === 403) {
    return 'انتهت صلاحية رمز Google Workspace أو تنقصه صلاحيات الوصول. يرجى إعادة الربط بحساب Google.';
  }
  return fallback;
}

export async function listGoogleDriveFiles(
  accessToken: string,
  searchTerm = ''
): Promise<GoogleDriveFileItem[]> {
  const safeSearch = searchTerm.trim().replace(/'/g, "\\'");
  const qParts = [
    "mimeType != 'application/vnd.google-apps.folder'",
    'trashed=false',
  ];
  if (safeSearch) {
    qParts.push(`name contains '${safeSearch}'`);
  }

  const params = new URLSearchParams({
    q: qParts.join(' and '),
    orderBy: 'modifiedTime desc',
    pageSize: '30',
    fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink)',
  });

  const res = await fetch(`${DRIVE_FILES_API}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(await parseApiError(res, 'تعذر جلب الملفات من Google Drive.'));
  }
  const data = (await res.json()) as { files?: GoogleDriveFileItem[] };
  return Array.isArray(data.files) ? data.files : [];
}

export async function listGoogleDocs(
  accessToken: string,
  searchTerm = ''
): Promise<GoogleDriveDocSummary[]> {
  const safeSearch = searchTerm.trim().replace(/'/g, "\\'");
  const qParts = [
    "mimeType='application/vnd.google-apps.document'",
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
    throw new Error(await parseApiError(res, 'تعذر جلب قائمة مستندات Google Docs.'));
  }
  const data = (await res.json()) as { files?: GoogleDriveDocSummary[] };
  return Array.isArray(data.files) ? data.files : [];
}

export async function getGoogleDoc(
  accessToken: string,
  documentId: string
): Promise<GoogleDocContent> {
  const res = await fetch(`${DOCS_API_BASE}/${encodeURIComponent(documentId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(await parseApiError(res, 'تعذر قراءة محتوى مستند Google Docs.'));
  }
  const doc = (await res.json()) as {
    documentId: string;
    title?: string;
    revisionId?: string;
    body?: {
      content?: Array<{
        endIndex?: number;
        paragraph?: {
          paragraphStyle?: { namedStyleType?: string };
          elements?: Array<{ textRun?: { content?: string } }>;
        };
      }>;
    };
  };

  const content = doc.body?.content || [];
  let maxEndIndex = 1;
  const paragraphs: Array<{ text: string; heading?: string }> = [];

  for (const block of content) {
    if (typeof block.endIndex === 'number' && block.endIndex > maxEndIndex) {
      maxEndIndex = block.endIndex;
    }
    if (!block.paragraph?.elements) continue;
    const rawText = block.paragraph.elements
      .map((el) => el.textRun?.content || '')
      .join('')
      .replace(/\n$/, '');
    if (rawText.trim()) {
      paragraphs.push({
        text: rawText,
        heading: block.paragraph.paragraphStyle?.namedStyleType,
      });
    }
  }

  return {
    documentId: doc.documentId,
    title: doc.title || 'مستند بدون عنوان',
    revisionId: doc.revisionId,
    endIndex: Math.max(1, maxEndIndex - 1),
    paragraphs,
  };
}

export async function createGoogleDoc(
  accessToken: string,
  title: string,
  initialBodyText: string
): Promise<{ documentId: string; title: string; webViewLink: string }> {
  const cleanTitle = title.trim() || 'ملخص محاضرة UST';
  const createRes = await fetch(DOCS_API_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: cleanTitle }),
  });
  if (!createRes.ok) {
    throw new Error(await parseApiError(createRes, 'تعذر إنشاء مستند Google Docs جديد.'));
  }
  const created = (await createRes.json()) as { documentId: string; title: string };

  const cleanBody = initialBodyText.trim();
  if (cleanBody) {
    const batchRes = await fetch(
      `${DOCS_API_BASE}/${encodeURIComponent(created.documentId)}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: `${cleanBody}\n`,
              },
            },
          ],
        }),
      }
    );
    if (!batchRes.ok) {
      throw new Error(await parseApiError(batchRes, 'تم إنشاء المستند لكن تعذر إدراج النص فيه.'));
    }
  }

  return {
    documentId: created.documentId,
    title: created.title || cleanTitle,
    webViewLink: `https://docs.google.com/document/d/${encodeURIComponent(created.documentId)}/edit`,
  };
}

export async function appendTextToGoogleDoc(
  accessToken: string,
  documentId: string,
  textToAppend: string
): Promise<GoogleDocContent> {
  const current = await getGoogleDoc(accessToken, documentId);
  const insertAt = Math.max(1, current.endIndex);
  const payloadText = `\n${textToAppend.trim()}\n`;

  const res = await fetch(
    `${DOCS_API_BASE}/${encodeURIComponent(documentId)}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            insertText: {
              location: { index: insertAt },
              text: payloadText,
            },
          },
        ],
      }),
    }
  );
  if (!res.ok) {
    throw new Error(await parseApiError(res, 'تعذر تعديل مستند Google Docs.'));
  }
  return getGoogleDoc(accessToken, documentId);
}

export async function deleteGoogleDoc(accessToken: string, fileId: string): Promise<void> {
  const res = await fetch(`${DRIVE_FILES_API}/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(await parseApiError(res, 'تعذر حذف المستند من Google Drive.'));
  }
}
