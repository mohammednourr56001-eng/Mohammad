import React, { useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Loader2,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { usePlatformData } from '../../context/PlatformDataContext.tsx';
import { formatFileSizeArabic } from '../../utils/academicLogic.ts';
import { listGoogleDriveFiles, mapDriveMimeToMeta } from '../../utils/googleDocsApi.ts';
import {
  canPublishFileToCourseRepository,
  deduplicatePickedDriveFiles,
} from '../../utils/googleEcosystemLogic.ts';
import { GooglePickedDriveItem, openGooglePickerDialog } from '../../utils/googlePickerApi.ts';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';

export function GooglePickerPanel({
  onSelectForSheets,
}: {
  onSelectForSheets?: (spreadsheetId: string) => void;
}) {
  const {
    firebaseUser,
    role,
    isSuperAdmin,
    workspaceAccessToken,
    connectGoogleWorkspace,
    getIdToken,
    authLoading,
  } = useAuth();
  const { lectureFiles } = usePlatformData();

  const [pickedFiles, setPickedFiles] = useState<GooglePickedDriveItem[]>([]);
  const [openingPicker, setOpeningPicker] = useState(false);
  const [driveSearchQuery, setDriveSearchQuery] = useState('');
  const [searchingDrive, setSearchingDrive] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const canPublishToRepo = canPublishFileToCourseRepository(role, isSuperAdmin);

  const handleOpenPicker = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    let token = workspaceAccessToken;
    if (!token) {
      token = await connectGoogleWorkspace();
    }
    if (!token) return;

    setOpeningPicker(true);
    try {
      const result = await openGooglePickerDialog({
        accessToken: token,
        multiSelect: true,
        title: 'اختيار ملفات ومستندات من Google Drive · منصة UST',
      });
      if (result.cancelled) {
        setStatusMessage('تم إغلاق نافذة Google Picker بدون اختيار ملفات جديدة.');
        return;
      }
      if (result.items.length === 0) {
        setStatusMessage('لم يتم تحديد أي ملفات.');
        return;
      }

      const existingRepoDriveIds = new Set(
        lectureFiles.map((f) => f.driveFileId).filter((v): v is string => Boolean(v))
      );
      const duplicateInRepo = result.items.filter((i) => existingRepoDriveIds.has(i.id));

      const mergedResult = deduplicatePickedDriveFiles(pickedFiles, result.items);
      setPickedFiles(mergedResult.merged);
      setStatusMessage(
        `تمت إضافة ${mergedResult.addedCount} ملف عبر Google Picker` +
          (mergedResult.skippedCount > 0
            ? ` (وتخطي ${mergedResult.skippedCount} مكرر)`
            : '') +
          (duplicateInRepo.length > 0
            ? ` · ملاحظة: ${duplicateInRepo.length} ملف موجود مسبقاً في مكتبة المحاضرات.`
            : '.')
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'تعذر تشغيل Google Picker. يمكنك استخدام البحث المباشر عن ملفات Drive أدناه كبديل.'
      );
    } finally {
      setOpeningPicker(false);
    }
  };

  const handleFallbackDriveSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    let token = workspaceAccessToken;
    if (!token) {
      token = await connectGoogleWorkspace();
    }
    if (!token) return;

    setSearchingDrive(true);
    try {
      const items = await listGoogleDriveFiles(token, driveSearchQuery);
      const converted: GooglePickedDriveItem[] = items.map((item) => ({
        id: item.id,
        name: item.name,
        mimeType: item.mimeType,
        url: item.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(item.id)}/view`,
        sizeBytes: item.size ? Number(item.size) : undefined,
      }));
      const mergedResult = deduplicatePickedDriveFiles(pickedFiles, converted);
      setPickedFiles(mergedResult.merged);
      setStatusMessage(
        converted.length === 0
          ? 'لم يتم العثور على ملفات مطابقة في Google Drive.'
          : `تم استيراد ${mergedResult.addedCount} ملف من بحث Google Drive.`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'تعذر البحث في ملفات Google Drive.');
    } finally {
      setSearchingDrive(false);
    }
  };

  const handleRegisterPickedReference = async (item: GooglePickedDriveItem) => {
    if (!firebaseUser) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setSavingId(item.id);
    try {
      const idToken = await getIdToken();
      if (!idToken) throw new Error('يرجى تسجيل الدخول في منصة UST لحفظ المرجع.');
      const res = await fetch('/api/google/picker/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          driveFileId: item.id,
          name: item.name,
          mimeType: item.mimeType,
          url: item.url,
          iconUrl: item.iconUrl,
          sizeBytes: item.sizeBytes,
          mode: 'reference',
        }),
      });
      const body = (await res.json()) as { error?: string; deduplicated?: boolean };
      if (!res.ok) {
        throw new Error(body.error || 'تعذر حفظ مرجع الملف.');
      }
      setStatusMessage(
        body.deduplicated
          ? `المرجع للملف "${item.name}" محفوظ مسبقاً (تم منع التكرار).`
          : `تم حفظ مرجع "${item.name}" في سجل ملفات Google بنجاح.`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'تعذر حفظ مرجع الملف.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="font-display text-lg font-bold text-[#0B2545] flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-[#00A6A6]" />
            Google Picker · منتقي ملفات Google Drive
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            افتح نافذة Google Picker الرسمية لاختيار ملفات PDF، الجداول، العروض أو الصور دون نسخها أو تخزينها خارج حسابك.
          </p>
        </div>

        {!workspaceAccessToken ? (
          <GoogleSignInButton
            onClick={() => void connectGoogleWorkspace()}
            loading={authLoading}
            label="ربط Google Drive · تشغيل Picker"
          />
        ) : (
          <button
            type="button"
            onClick={handleOpenPicker}
            disabled={openingPicker}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors shrink-0 disabled:opacity-60"
          >
            {openingPicker ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <HardDrive className="w-4 h-4" />
            )}
            {openingPicker ? 'جاري فتح Picker...' : 'فتح نافذة Google Picker'}
          </button>
        )}
      </div>

      {/* RBAC Notice on Course Repository */}
      <div className="rounded-xl bg-[#EAF4F7]/70 border border-slate-200/80 px-4 py-3 text-xs text-[#0B2545] flex items-start gap-2.5">
        <ShieldAlert className="w-4 h-4 text-[#00A6A6] shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          {canPublishToRepo
            ? 'بصفتك Super Admin، يمكنك أيضاً استخدام Google Picker مباشرة من تبويب "رفع محاضرة" لنشر الملفات المختارة داخل المقررات والتخصصات.'
            : 'يمكنك اختيار واستعراض ملفاتك الشخصية بأمان عبر Google Picker. نشر الملفات الأصلية داخل مكتبة المقررات الرسمية مقصور على المدير الرئيسي (Super Admin) فقط.'}
        </p>
      </div>

      {/* Fallback Drive Search */}
      {workspaceAccessToken && (
        <form onSubmit={handleFallbackDriveSearch} className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={driveSearchQuery}
              onChange={(e) => setDriveSearchQuery(e.target.value)}
              placeholder="بحث بديل في Google Drive بالاسم (في حال حجب النوافذ المنبثقة)..."
              className="w-full min-h-[42px] pr-9 pl-3 rounded-xl border border-slate-200 text-xs sm:text-sm text-[#0B2545]"
            />
          </div>
          <button
            type="submit"
            disabled={searchingDrive}
            className="min-h-[42px] px-4 rounded-xl bg-[#0B2545] hover:bg-[#133866] text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 shrink-0 disabled:opacity-60"
          >
            {searchingDrive && <Loader2 className="w-4 h-4 animate-spin" />}
            جلب من Drive
          </button>
        </form>
      )}

      {statusMessage && (
        <div
          role="status"
          className="rounded-xl bg-[#EAF4F7] border border-[#00A6A6]/35 px-4 py-2.5 text-xs font-semibold text-[#0B2545] flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-[#00A6A6] shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl bg-[#FF8066]/10 border border-[#FF8066]/40 px-4 py-2.5 text-xs font-semibold text-[#b8442c]"
        >
          {errorMessage}
        </div>
      )}

      {/* Picked Files Table / Empty State */}
      {pickedFiles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center space-y-2">
          <HardDrive className="w-8 h-8 mx-auto text-[#00A6A6]" />
          <p className="text-sm font-bold text-[#0B2545]">لم يتم اختيار أي ملفات بعد</p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            اضغط على &quot;فتح نافذة Google Picker&quot; لاختيار ملف أو عدة ملفات من حسابك في Google Drive وعرض روابطها هنا.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
          {pickedFiles.map((item) => {
            const meta = mapDriveMimeToMeta(item.mimeType, item.name);
            const isSpreadsheet = item.mimeType === 'application/vnd.google-apps.spreadsheet';
            const existsInCourseLib = lectureFiles.some((f) => f.driveFileId === item.id);
            return (
              <div
                key={item.id}
                className="p-3.5 sm:p-4 bg-white hover:bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-bold text-[#0B2545] truncate">{item.name}</h4>
                    <span className="px-2 py-0.5 rounded bg-[#EAF4F7] text-[#0B2545] text-[11px] font-semibold">
                      {meta.typeLabelAr}
                    </span>
                    {existsInCourseLib && (
                      <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[11px] font-semibold">
                        مرتبط بمقرر UST
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-2 font-mono">
                    <span>ID: {item.id.slice(0, 18)}…</span>
                    {typeof item.sizeBytes === 'number' && item.sizeBytes > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{formatFileSizeArabic(item.sizeBytes)}</span>
                      </>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap shrink-0">
                  {isSpreadsheet && onSelectForSheets && (
                    <button
                      type="button"
                      onClick={() => onSelectForSheets(item.id)}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#00A6A6] text-white text-xs font-semibold"
                    >
                      عرض في Sheets
                    </button>
                  )}
                  {canPublishToRepo && firebaseUser && (
                    <button
                      type="button"
                      disabled={savingId === item.id}
                      onClick={() => void handleRegisterPickedReference(item)}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#EAF4F7] hover:bg-[#0B2545] text-[#0B2545] hover:text-white text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      {savingId === item.id ? 'جاري الحفظ...' : 'حفظ مرجع بالسجل'}
                    </button>
                  )}
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-200 hover:border-[#00A6A6] text-[#0B2545] text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    فتح الملف
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      setPickedFiles((prev) => prev.filter((p) => p.id !== item.id))
                    }
                    aria-label={`إزالة ${item.name} من القائمة`}
                    className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 text-slate-400 hover:text-[#FF8066] flex items-center justify-center"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
