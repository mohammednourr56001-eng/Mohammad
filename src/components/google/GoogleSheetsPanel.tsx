import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  Table2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { extractSpreadsheetIdFromInput } from '../../utils/googleEcosystemLogic.ts';
import { openGooglePickerDialog } from '../../utils/googlePickerApi.ts';
import {
  appendSpreadsheetRows,
  createSpreadsheet,
  getSpreadsheetMetadata,
  GoogleSpreadsheetListItem,
  GoogleSpreadsheetMetadata,
  listUserSpreadsheets,
  readSpreadsheetValues,
} from '../../utils/googleSheetsApi.ts';
import { ConfirmWorkspaceActionModal } from './ConfirmWorkspaceActionModal.tsx';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';

export function GoogleSheetsPanel({
  initialSpreadsheetId,
}: {
  initialSpreadsheetId?: string;
}) {
  const { workspaceAccessToken, connectGoogleWorkspace, authLoading } = useAuth();

  const [spreadsheets, setSpreadsheets] = useState<GoogleSpreadsheetListItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [sheetUrlOrId, setSheetUrlOrId] = useState(initialSpreadsheetId || '');
  const [activeMeta, setActiveMeta] = useState<GoogleSpreadsheetMetadata | null>(null);
  const [activeTabTitle, setActiveTabTitle] = useState('');
  const [rows, setRows] = useState<string[][]>([]);
  const [loadingSheet, setLoadingSheet] = useState(false);

  // Create new spreadsheet state
  const [newTitle, setNewTitle] = useState('');
  const [newHeadersRaw, setNewHeadersRaw] = useState('الاسم,الرقم الجامعي,المقرر,التقييم');

  // Append row state
  const [appendRowRaw, setAppendRowRaw] = useState('');

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<
    | { kind: 'create'; title: string; headers: string[] }
    | { kind: 'append'; spreadsheetId: string; sheetTitle: string; values: string[] }
    | null
  >(null);

  const loadSpreadsheetsList = async (token: string) => {
    setLoadingList(true);
    try {
      const items = await listUserSpreadsheets(token);
      setSpreadsheets(items);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر جلب قائمة جداول Google Sheets.');
    } finally {
      setLoadingList(false);
    }
  };

  const openSpreadsheetById = async (token: string, rawId: string) => {
    const parsedId = extractSpreadsheetIdFromInput(rawId);
    if (!parsedId) {
      setErrorMsg('يرجى إدخال رابط Google Sheets صالح أو معرف الجدول.');
      return;
    }
    setErrorMessageAndClear(null);
    setLoadingSheet(true);
    try {
      const meta = await getSpreadsheetMetadata(token, parsedId);
      setActiveMeta(meta);
      const firstTitle = meta.sheets[0]?.title || '';
      setActiveTabTitle(firstTitle);
      if (firstTitle) {
        const values = await readSpreadsheetValues(token, meta.spreadsheetId, firstTitle, 'A1:Z100');
        setRows(values);
      } else {
        setRows([]);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر فتح الجدول من Google Sheets.');
    } finally {
      setLoadingSheet(false);
    }
  };

  function setErrorMessageAndClear(err: string | null) {
    setErrorMsg(err);
    if (err) setStatusMsg(null);
  }

  useEffect(() => {
    if (workspaceAccessToken && spreadsheets.length === 0) {
      void loadSpreadsheetsList(workspaceAccessToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceAccessToken]);

  useEffect(() => {
    if (workspaceAccessToken && initialSpreadsheetId) {
      setSheetUrlOrId(initialSpreadsheetId);
      void openSpreadsheetById(workspaceAccessToken, initialSpreadsheetId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSpreadsheetId, workspaceAccessToken]);

  const handleSelectTab = async (tabTitle: string) => {
    if (!workspaceAccessToken || !activeMeta) return;
    setActiveTabTitle(tabTitle);
    setLoadingSheet(true);
    setErrorMsg(null);
    try {
      const values = await readSpreadsheetValues(
        workspaceAccessToken,
        activeMeta.spreadsheetId,
        tabTitle,
        'A1:Z100'
      );
      setRows(values);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر قراءة بيانات الورقة.');
    } finally {
      setLoadingSheet(false);
    }
  };

  const handlePickSheetViaPicker = async () => {
    if (!workspaceAccessToken) return;
    setErrorMsg(null);
    try {
      const picked = await openGooglePickerDialog({
        accessToken: workspaceAccessToken,
        multiSelect: false,
        title: 'اختر جدول Google Sheets · منصة UST',
      });
      if (!picked.cancelled && picked.items[0]) {
        setSheetUrlOrId(picked.items[0].id);
        await openSpreadsheetById(workspaceAccessToken, picked.items[0].id);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر فتح Google Picker.');
    }
  };

  const handleExecuteConfirm = async () => {
    if (!pendingConfirm || !workspaceAccessToken) return;
    setMutating(true);
    setErrorMsg(null);
    try {
      if (pendingConfirm.kind === 'create') {
        const created = await createSpreadsheet(
          workspaceAccessToken,
          pendingConfirm.title,
          'بيانات UST',
          pendingConfirm.headers
        );
        setActiveMeta(created);
        setActiveTabTitle(created.sheets[0]?.title || 'بيانات UST');
        setRows(pendingConfirm.headers.length > 0 ? [pendingConfirm.headers] : []);
        setNewTitle('');
        setStatusMsg(`تم إنشاء جدول البيانات "${created.title}" في حسابك بنجاح.`);
        await loadSpreadsheetsList(workspaceAccessToken);
      } else if (pendingConfirm.kind === 'append') {
        await appendSpreadsheetRows(
          workspaceAccessToken,
          pendingConfirm.spreadsheetId,
          pendingConfirm.sheetTitle,
          [pendingConfirm.values]
        );
        const refreshed = await readSpreadsheetValues(
          workspaceAccessToken,
          pendingConfirm.spreadsheetId,
          pendingConfirm.sheetTitle,
          'A1:Z100'
        );
        setRows(refreshed);
        setAppendRowRaw('');
        setStatusMsg(`تمت إضافة الصف الجديد إلى الورقة "${pendingConfirm.sheetTitle}" بنجاح.`);
      }
      setPendingConfirm(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تنفيذ العملية على Google Sheets.');
      setPendingConfirm(null);
    } finally {
      setMutating(false);
    }
  };

  if (!workspaceAccessToken) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="font-display text-lg font-bold text-[#0B2545] flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-[#00A6A6]" />
              Google Sheets · الجداول الأكاديمية
            </h3>
            <p className="text-xs text-slate-600">
              اربط حسابك لعرض جداول البيانات الأكاديمية، استعراض الأوراق، وإضافة الصفوف بتأكيد صريح.
            </p>
          </div>
          <GoogleSignInButton
            onClick={() => void connectGoogleWorkspace()}
            loading={authLoading}
            label="ربط Google Sheets"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold text-[#0B2545] flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-[#00A6A6]" />
            Google Sheets · استعراض وتحديث الجداول
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            تقرأ المنصة أسماء الأوراق الفعلية للجدول مباشرة ولا تفترض اسماً ثابتاً للورقة.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handlePickSheetViaPicker}
            className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#EAF4F7] hover:bg-[#d8ecf2] text-[#0B2545] text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <FolderOpen className="w-4 h-4 text-[#00A6A6]" />
            اختيار عبر Picker
          </button>
          <button
            type="button"
            onClick={() => void loadSpreadsheetsList(workspaceAccessToken)}
            disabled={loadingList}
            className="min-h-[38px] px-3.5 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-[#0B2545] inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingList ? 'animate-spin' : ''}`} />
            تحديث الجداول
          </button>
        </div>
      </div>

      {/* Load by URL/ID or Dropdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="flex gap-2">
          <input
            type="text"
            dir="ltr"
            value={sheetUrlOrId}
            onChange={(e) => setSheetUrlOrId(e.target.value)}
            placeholder="الصق رابط Google Sheets أو المعرف Spreadsheet ID..."
            className="flex-1 min-h-[42px] px-3 rounded-xl border border-slate-200 text-xs sm:text-sm text-[#0B2545] font-mono text-left"
          />
          <button
            type="button"
            disabled={loadingSheet}
            onClick={() => void openSpreadsheetById(workspaceAccessToken, sheetUrlOrId)}
            className="min-h-[42px] px-4 rounded-xl bg-[#0B2545] text-white text-xs sm:text-sm font-semibold shrink-0 disabled:opacity-60"
          >
            فتح الجدول
          </button>
        </div>

        <select
          aria-label="اختر جدولاً من حسابك"
          value={activeMeta?.spreadsheetId || ''}
          onChange={(e) => {
            if (e.target.value) {
              setSheetUrlOrId(e.target.value);
              void openSpreadsheetById(workspaceAccessToken, e.target.value);
            }
          }}
          className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-xs sm:text-sm text-[#0B2545] bg-white"
        >
          <option value="">
            {loadingList
              ? 'جاري تحميل جداولك...'
              : `اختر من جداولك الحديثة (${spreadsheets.length})`}
          </option>
          {spreadsheets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* Create New Spreadsheet Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!newTitle.trim()) {
            setErrorMsg('يرجى إدخال عنوان للجدول الجديد.');
            return;
          }
          const headers = newHeadersRaw
            .split(',')
            .map((h) => h.trim())
            .filter(Boolean);
          setPendingConfirm({ kind: 'create', title: newTitle.trim(), headers });
        }}
        className="rounded-2xl bg-[#EAF4F7]/50 border border-slate-200/80 p-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-end"
      >
        <div>
          <label htmlFor="new-sheet-title" className="block text-xs font-bold text-[#0B2545] mb-1">
            إنشاء جدول جديد في Google Sheets
          </label>
          <input
            id="new-sheet-title"
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="مثال: سجل متابعة طلاب السنة الأولى"
            className="w-full min-h-[40px] px-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm"
          />
        </div>
        <div>
          <label htmlFor="new-sheet-headers" className="block text-xs font-semibold text-[#0B2545] mb-1">
            عناوين الأعمدة (مفصولة بفاصلة ,)
          </label>
          <input
            id="new-sheet-headers"
            type="text"
            value={newHeadersRaw}
            onChange={(e) => setNewHeadersRaw(e.target.value)}
            className="w-full min-h-[40px] px-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm"
          />
        </div>
        <button
          type="submit"
          className="min-h-[40px] px-4 py-2 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          إنشاء جدول جديد
        </button>
      </form>

      {statusMsg && (
        <div
          role="status"
          className="rounded-xl bg-[#EAF4F7] border border-[#00A6A6]/35 px-4 py-2.5 text-xs font-semibold text-[#0B2545] flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-[#00A6A6] shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl bg-[#FF8066]/10 border border-[#FF8066]/40 px-4 py-2.5 text-xs font-semibold text-[#b8442c]"
        >
          {errorMsg}
        </div>
      )}

      {/* Loaded Spreadsheet Viewer + Append Row */}
      {loadingSheet ? (
        <div className="py-10 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-[#00A6A6]" />
          جاري قراءة الجدول من Google Sheets...
        </div>
      ) : activeMeta ? (
        <div className="space-y-4 border border-slate-200 rounded-2xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="font-display text-base font-bold text-[#0B2545] flex items-center gap-2">
                <Table2 className="w-4 h-4 text-[#00A6A6]" />
                {activeMeta.title}
              </h4>
              <p className="text-[11px] text-slate-500 mt-0.5">
                عدد الأوراق: {activeMeta.sheets.length}
              </p>
            </div>
            <a
              href={activeMeta.spreadsheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#EAF4F7] text-[#0B2545] text-xs font-semibold inline-flex items-center gap-1.5"
            >
              فتح في Google Sheets
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          {/* Sheet Tabs */}
          {activeMeta.sheets.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {activeMeta.sheets.map((tab) => (
                <button
                  key={tab.sheetId}
                  type="button"
                  onClick={() => void handleSelectTab(tab.title)}
                  className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    activeTabTitle === tab.title
                      ? 'bg-[#0B2545] text-white'
                      : 'bg-slate-100 hover:bg-slate-200 text-[#0B2545]'
                  }`}
                >
                  {tab.title}
                </button>
              ))}
            </div>
          )}

          {/* Table Preview */}
          {rows.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500 bg-slate-50 rounded-xl">
              هذه الورقة فارغة حالياً. يمكنك إضافة أول صف باستخدام النموذج أدناه.
            </p>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-[320px]">
              <table className="w-full text-xs text-right border-collapse">
                <thead className="bg-[#EAF4F7] text-[#0B2545] sticky top-0">
                  <tr>
                    {rows[0].map((headerCell, idx) => (
                      <th key={idx} className="px-3 py-2.5 font-bold border-b border-slate-200 whitespace-nowrap">
                        {headerCell || `عمود ${idx + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.slice(1).map((r, rIdx) => (
                    <tr key={rIdx} className="hover:bg-slate-50">
                      {rows[0].map((_, cIdx) => (
                        <td key={cIdx} className="px-3 py-2 text-slate-700 whitespace-nowrap">
                          {r[cIdx] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Append Row Form */}
          {activeTabTitle && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const values = appendRowRaw.split(',').map((v) => v.trim());
                if (values.every((v) => !v)) {
                  setErrorMsg('يرجى إدخال قيمة واحدة على الأقل لإضافة الصف.');
                  return;
                }
                setPendingConfirm({
                  kind: 'append',
                  spreadsheetId: activeMeta.spreadsheetId,
                  sheetTitle: activeTabTitle,
                  values,
                });
              }}
              className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-slate-100"
            >
              <input
                type="text"
                value={appendRowRaw}
                onChange={(e) => setAppendRowRaw(e.target.value)}
                placeholder="أدخل قيم الصف الجديد مفصولة بفاصلة , (مثال: أحمد علي, 202401, تشريح, 95)"
                className="flex-1 min-h-[40px] px-3 rounded-xl border border-slate-200 text-xs sm:text-sm"
              />
              <button
                type="submit"
                className="min-h-[40px] px-4 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs sm:text-sm font-bold shrink-0"
              >
                إضافة صف للورقة
              </button>
            </form>
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-slate-50 border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
          اختر أحد جداولك من القائمة أعلاه أو ألصق رابط Google Sheets لعرض البيانات وإدارتها.
        </div>
      )}

      <ConfirmWorkspaceActionModal
        open={Boolean(pendingConfirm)}
        title={
          pendingConfirm?.kind === 'create'
            ? 'تأكيد إنشاء جدول Google Sheets'
            : 'تأكيد إضافة صف إلى Google Sheets'
        }
        description={
          pendingConfirm?.kind === 'create'
            ? 'سيتم إنشاء ملف جدول بيانات جديد داخل حساب Google Drive الخاص بك.'
            : 'سيتم إضافة صف جديد إلى نهاية البيانات الحالية في الجدول المحدد.'
        }
        details={
          pendingConfirm?.kind === 'create'
            ? [
                { label: 'اسم الجدول', value: pendingConfirm.title },
                { label: 'الأعمدة', value: pendingConfirm.headers.join(' | ') || 'بدون عناوين' },
              ]
            : pendingConfirm?.kind === 'append'
              ? [
                  { label: 'الجدول', value: activeMeta?.title || pendingConfirm.spreadsheetId },
                  { label: 'الورقة', value: pendingConfirm.sheetTitle },
                  { label: 'الصف الجديد', value: pendingConfirm.values.join(' | ') },
                ]
              : []
        }
        busy={mutating}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={handleExecuteConfirm}
      />
    </div>
  );
}
