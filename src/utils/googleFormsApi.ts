export interface GoogleFormDetails {
  formId: string;
  title: string;
  description?: string;
  responderUri: string;
  editUri: string;
  itemsCount: number;
  questions: Array<{
    itemId: string;
    title: string;
    required: boolean;
    kind: string;
  }>;
}

const FORMS_API_BASE = 'https://forms.googleapis.com/v1/forms';

async function parseFormsError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body?.error?.message) return body.error.message;
  } catch {
    // ignore
  }
  if (res.status === 401 || res.status === 403) {
    return 'انتهت صلاحية الجلسة أو تنقصك صلاحية Google Forms.';
  }
  return fallback;
}

export async function getGoogleForm(
  accessToken: string,
  formId: string
): Promise<GoogleFormDetails> {
  const safeFormId = encodeURIComponent(formId.trim());
  const res = await fetch(`${FORMS_API_BASE}/${safeFormId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(await parseFormsError(res, 'تعذر قراءة بيانات النموذج من Google Forms.'));
  }
  const data = (await res.json()) as {
    formId: string;
    info?: { title?: string; documentTitle?: string; description?: string };
    responderUri?: string;
    items?: Array<{
      itemId?: string;
      title?: string;
      questionItem?: {
        question?: {
          required?: boolean;
          choiceQuestion?: { type?: string };
          textQuestion?: { paragraph?: boolean };
        };
      };
    }>;
  };

  const items = Array.isArray(data.items) ? data.items : [];
  return {
    formId: data.formId || formId.trim(),
    title: data.info?.title || data.info?.documentTitle || 'نموذج Google Forms',
    description: data.info?.description,
    responderUri:
      data.responderUri || `https://docs.google.com/forms/d/${safeFormId}/viewform`,
    editUri: `https://docs.google.com/forms/d/${safeFormId}/edit`,
    itemsCount: items.length,
    questions: items.map((item, idx) => {
      const q = item.questionItem?.question;
      const kind = q?.choiceQuestion
        ? 'اختيار من متعدد'
        : q?.textQuestion
          ? q.textQuestion.paragraph
            ? 'نص طويل'
            : 'إجابة قصيرة'
          : 'عنصر نموذج';
      return {
        itemId: item.itemId || `item_${idx + 1}`,
        title: item.title || `سؤال ${idx + 1}`,
        required: Boolean(q?.required),
        kind,
      };
    }),
  };
}

export async function createGoogleForm(params: {
  accessToken: string;
  title: string;
  description?: string;
  initialQuestionTitle?: string;
  initialOptions?: string[];
}): Promise<GoogleFormDetails> {
  const cleanTitle = params.title.trim() || 'نموذج أكاديمي UST';
  const createRes = await fetch(FORMS_API_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      info: {
        title: cleanTitle,
        documentTitle: cleanTitle,
      },
    }),
  });
  if (!createRes.ok) {
    throw new Error(await parseFormsError(createRes, 'تعذر إنشاء نموذج Google Forms جديد.'));
  }
  const created = (await createRes.json()) as {
    formId: string;
    responderUri?: string;
  };

  const requests: Array<Record<string, unknown>> = [];
  if (params.description?.trim()) {
    requests.push({
      updateFormInfo: {
        info: { description: params.description.trim().slice(0, 600) },
        updateMask: 'description',
      },
    });
  }

  const questionTitle = params.initialQuestionTitle?.trim();
  if (questionTitle) {
    const cleanOptions = (params.initialOptions || [])
      .map((o) => o.trim())
      .filter(Boolean)
      .slice(0, 6);
    requests.push({
      createItem: {
        item: {
          title: questionTitle,
          questionItem: {
            question:
              cleanOptions.length >= 2
                ? {
                    required: true,
                    choiceQuestion: {
                      type: 'RADIO',
                      options: cleanOptions.map((value) => ({ value })),
                    },
                  }
                : {
                    required: true,
                    textQuestion: { paragraph: false },
                  },
          },
        },
        location: { index: 0 },
      },
    });
  }

  if (requests.length > 0) {
    const safeId = encodeURIComponent(created.formId);
    await fetch(`${FORMS_API_BASE}/${safeId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    }).catch(() => {});
  }

  return getGoogleForm(params.accessToken, created.formId);
}
