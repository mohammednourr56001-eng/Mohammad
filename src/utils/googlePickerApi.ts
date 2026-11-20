export interface GooglePickedDriveItem {
  id: string;
  name: string;
  mimeType: string;
  url: string;
  iconUrl?: string;
  sizeBytes?: number;
  lastEditedUtc?: number;
}

interface GooglePickerGlobal {
  picker: {
    PickerBuilder: new () => {
      addView: (view: unknown) => GooglePickerBuilder;
      setOAuthToken: (token: string) => GooglePickerBuilder;
      setOrigin: (origin: string) => GooglePickerBuilder;
      setTitle: (title: string) => GooglePickerBuilder;
      setCallback: (cb: (data: GooglePickerCallbackData) => void) => GooglePickerBuilder;
      enableFeature: (feature: unknown) => GooglePickerBuilder;
      build: () => { setVisible: (visible: boolean) => void };
    };
    ViewId: {
      DOCS: unknown;
      DOCS_IMAGES: unknown;
      SPREADSHEETS: unknown;
      PRESENTATIONS: unknown;
      PDFS: unknown;
    };
    DocsView: new (viewId?: unknown) => {
      setIncludeFolders: (flag: boolean) => unknown;
      setSelectFolderEnabled: (flag: boolean) => unknown;
    };
    Feature: {
      MULTISELECT_ENABLED: unknown;
      SUPPORT_DRIVES: unknown;
    };
    Action: {
      PICKED: string;
      CANCEL: string;
    };
  };
}

type GooglePickerBuilder = InstanceType<GooglePickerGlobal['picker']['PickerBuilder']>;

interface GooglePickerCallbackData {
  action: string;
  docs?: Array<{
    id: string;
    name?: string;
    mimeType?: string;
    url?: string;
    iconUrl?: string;
    sizeBytes?: number;
    lastEditedUtc?: number;
  }>;
}

declare global {
  interface Window {
    gapi?: {
      load: (
        apiName: string,
        opts: { callback: () => void; onerror?: () => void; timeout?: number; ontimeout?: () => void }
      ) => void;
    };
    google?: GooglePickerGlobal;
  }
}

let pickerSdkPromise: Promise<void> | null = null;

export function loadGooglePickerSdk(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Picker يعمل داخل المتصفح فقط.'));
  }
  if (window.google?.picker) {
    return Promise.resolve();
  }
  if (pickerSdkPromise) {
    return pickerSdkPromise;
  }

  pickerSdkPromise = new Promise<void>((resolve, reject) => {
    const loadPickerModule = () => {
      if (!window.gapi?.load) {
        pickerSdkPromise = null;
        reject(new Error('تعذر تهيئة مكتبة gapi لتحميل Google Picker.'));
        return;
      }
      window.gapi.load('picker', {
        callback: () => resolve(),
        onerror: () => {
          pickerSdkPromise = null;
          reject(new Error('فشل تحميل مكون Google Picker من خوادم Google.'));
        },
        timeout: 12000,
        ontimeout: () => {
          pickerSdkPromise = null;
          reject(new Error('انتهت مهلة تحميل أداة Google Picker. تحقق من الاتصال أو قيود الشبكة.'));
        },
      });
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src^="https://apis.google.com/js/api.js"]'
    );
    if (existingScript) {
      if (window.gapi) {
        loadPickerModule();
      } else {
        existingScript.addEventListener('load', loadPickerModule, { once: true });
        existingScript.addEventListener(
          'error',
          () => {
            pickerSdkPromise = null;
            reject(new Error('تعذر تحميل سكربت Google APIs (apis.google.com).'));
          },
          { once: true }
        );
      }
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.defer = true;
    script.onload = loadPickerModule;
    script.onerror = () => {
      pickerSdkPromise = null;
      reject(new Error('تعذر تحميل سكربت Google Picker بسبب سياسة المتصفح أو الشبكة.'));
    };
    document.head.appendChild(script);
  });

  return pickerSdkPromise;
}

export async function openGooglePickerDialog(params: {
  accessToken: string;
  multiSelect?: boolean;
  title?: string;
}): Promise<{ cancelled: boolean; items: GooglePickedDriveItem[] }> {
  await loadGooglePickerSdk();

  const googlePicker = window.google?.picker;
  if (!googlePicker) {
    throw new Error('أداة Google Picker غير متاحة حالياً في هذا المتصفح.');
  }

  const pickerOrigin =
    window.location.ancestorOrigins && window.location.ancestorOrigins.length > 0
      ? window.location.ancestorOrigins[window.location.ancestorOrigins.length - 1]
      : window.location.origin;

  return new Promise((resolve, reject) => {
    try {
      const docsView = new googlePicker.DocsView(googlePicker.ViewId.DOCS);
      docsView.setIncludeFolders(true);

      const builder = new googlePicker.PickerBuilder()
        .addView(docsView)
        .addView(googlePicker.ViewId.SPREADSHEETS)
        .addView(googlePicker.ViewId.PRESENTATIONS)
        .addView(googlePicker.ViewId.PDFS)
        .addView(googlePicker.ViewId.DOCS_IMAGES)
        .setOAuthToken(params.accessToken)
        .setOrigin(pickerOrigin)
        .setTitle(params.title || 'اختر ملفات من Google Drive · منصة UST')
        .setCallback((data: GooglePickerCallbackData) => {
          if (data.action === googlePicker.Action.PICKED) {
            const items: GooglePickedDriveItem[] = (data.docs || []).map((d) => ({
              id: d.id,
              name: d.name || 'ملف Google Drive',
              mimeType: d.mimeType || 'application/octet-stream',
              url: d.url || `https://drive.google.com/file/d/${encodeURIComponent(d.id)}/view`,
              iconUrl: d.iconUrl,
              sizeBytes: typeof d.sizeBytes === 'number' ? d.sizeBytes : undefined,
              lastEditedUtc: d.lastEditedUtc,
            }));
            resolve({ cancelled: false, items });
          } else if (data.action === googlePicker.Action.CANCEL) {
            resolve({ cancelled: true, items: [] });
          }
        });

      if (params.multiSelect) {
        builder.enableFeature(googlePicker.Feature.MULTISELECT_ENABLED);
      }

      const picker = builder.build();
      picker.setVisible(true);
    } catch (err) {
      reject(
        err instanceof Error
          ? err
          : new Error('تعذر فتح نافذة Google Picker. يرجى السماح بالنوافذ المنبثقة.')
      );
    }
  });
}

export async function verifyGooglePickerDriveAccess(accessToken: string): Promise<{
  ok: boolean;
  httpStatus: number;
  email?: string;
  error?: string;
}> {
  const res = await fetch(
    'https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id,name)',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    let message = 'تعذر التحقق من صلاحية الوصول لملفات Google Drive.';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      // ignore
    }
    return { ok: false, httpStatus: res.status, error: message };
  }
  return { ok: true, httpStatus: res.status };
}
