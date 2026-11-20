import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  FilePlus2,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import {
  appendTextToGoogleDoc,
  createGoogleDoc,
  deleteGoogleDoc,
  getGoogleDoc,
  GoogleDocContent,
  GoogleDriveDocSummary,
  listGoogleDocs,
} from '../utils/googleDocsApi.ts';

type PendingMutation =
  | {
      type: 'append';
      docId: string;
      docTitle: string;
      text: string;
    }
  | {
      type: 'delete';
      docId: string;
      docTitle: string;
    };

export function GoogleDocsWorkspacePanel() {
  const {
    workspaceAccessToken,
    connectGoogleWorkspace,
    clearWorkspaceToken,
    authLoading,
  } = useAuth();

  const [docs, setDocs] = useState<GoogleDriveDocSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<GoogleDocContent | null>(null);
  const [selectedWebLink, setSelectedWebLink] = useState<string | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);

  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [creatingDoc, setCreatingDoc] = useState(false);

  const [appendText, setAppendText] = useState('');
  const [pendingMutation, setPendingMutation] = useState<PendingMutation | null>(null);
  const [mutating, setMutating] = useState(false);

  const [panelError, setPanelError] = useState<string | null>(null);
  const [panelNotice, setPanelNotice] = useState<string | null>(null);

  const fetchDocs = useCallback(
    async (token: string, queryText = '') => {
      setLoadingList(true);
      setPanelError(null);
      try {
        const items = await listGoogleDocs(token, queryText);
        setDocs(items);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'تعذر جلب مستندات Google Docs.';
        setPanelError(msg);
        if (msg.includes('انتهت صلاحية')) {
          clearWorkspaceToken();
        }
      } finally {
        setLoadingList(false);
      }
    },
    [clearWorkspaceToken]
  );

  useEffect(() => {
    if (workspaceAccessToken) {
      fetchDocs(workspaceAccessToken, '');
    } else {
      setDocs([]);
      setSelectedDoc(null);
    }
  }, [workspaceAccessToken, fetchDocs]);

  const handleOpenDoc = async (item: GoogleDriveDocSummary) => {
    if (!workspaceAccessToken) return;
    setLoadingDoc(true);
    setPanelError(null);
    setSelectedWebLink(
      item.webViewLink || `https://docs.google.com/document/d/${encodeURIComponent(item.id)}/edit`
    );
    try {
      const content = await getGoogleDoc(workspaceAccessToken, item.id);
      setSelectedDoc(content);
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : 'تعذر قراءة المستند.');
    } finally {
      setLoadingDoc(false);
    }
  };

  const handleCreateDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceAccessToken || newTitle.trim().length < 2) return;
    setCreatingDoc(true);
    setPanelError(null);
    setPanelNotice(null);
    try {
      const created = await createGoogleDoc(workspaceAccessToken, newTitle, newBody);
      setNewTitle('');
      setNewBody('');
      setPanelNotice(`تم إنشاء المستند "${created.title}" في Google Docs بنجاح.`);
      await fetchDocs(workspaceAccessToken, searchQuery);
      const loaded = await getGoogleDoc(workspaceAccessToken, created.documentId);
      setSelectedDoc(loaded);
      setSelectedWebLink(created.webViewLink);
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : 'تعذر إنشاء المستند.');
    } finally {
      setCreatingDoc(false);
    }
  };

  const handleConfirmMutation = async () => {
    if (!workspaceAccessToken || !pendingMutation) return;
    setMutating(true);
    setPanelError(null);
    setPanelNotice(null);
    try {
      if (pendingMutation.type === 'append') {
        const updated = await appendTextToGoogleDoc(
          workspaceAccessToken,
          pendingMutation.docId,
          pendingMutation.text
        );
        setSelectedDoc(updated);
        setAppendText('');
        setPanelNotice(`تمت إضافة الملاحظة إلى "${pendingMutation.docTitle}" بنجاح.`);
      } else {
        await deleteGoogleDoc(workspaceAccessToken, pendingMutation.docId);
        if (selectedDoc?.documentId === pendingMutation.docId) {
          setSelectedDoc(null);
          setSelectedWebLink(null);
        }
        setPanelNotice(`تم حذف المستند "${pendingMutation.docTitle}" من Google Drive.`);
        await fetchDocs(workspaceAccessToken, searchQuery);
      }
      setPendingMutation(null);
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : 'تعذر تنفيذ العملية على Google Docs.');
      setPendingMutation(null);
    } finally {
      setMutating(false);
    }
  };

  return (
    <section
      aria-label="مستندات Google Docs"
      className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-[#0B2545] flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#00A6A6]" />
            دفتر الملاحظات والمستندات عبر Google Docs
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            تصفح مستنداتك الدراسية، أنشئ ملخصات جديدة، أو أضف ملاحظات مباشرة إلى Google Docs.
          </p>
        </div>

        {workspaceAccessToken && (
          <button
            type="button"
            onClick={() => fetchDocs(workspaceAccessToken, searchQuery)}
            disabled={loadingList}
            className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#EAF4F7] hover:bg-[#d8ecf2] text-[#0B2545] text-xs font-semibold inline-flex items-center gap-1.5 self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingList ? 'animate-spin' : ''}`} />
            تحديث المستندات
          </button>
        )}
      </div>

      {panelError && (
        <div
          role="alert"
          className="rounded-xl bg-[#FF8066]/15 border border-[#FF8066]/40 px-4 py-3 text-xs font-semibold text-[#0B2545]"
        >
          {panelError}
        </div>
      )}

      {panelNotice && (
        <div
          role="status"
          className="rounded-xl bg-[#00A6A6]/12 border border-[#00A6A6]/30 px-4 py-3 text-xs font-semibold text-[#0B2545]"
        >
          {panelNotice}
        </div>
      )}

      {!workspaceAccessToken ? (
        <div className="rounded-2xl bg-[#EAF4F7]/70 border border-slate-200/80 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-bold text-[#0B2545]">
              اربط حساب Google لتفعيل Google Docs داخل المنصة
            </p>
            <p className="text-xs text-slate-600 leading-relaxed">
              تُحفظ صلاحية الوصول في الذاكرة المؤقتة للجلسة فقط دون تخزين محلي لحماية حسابك.
            </p>
          </div>
          <button
            type="button"
            onClick={() => connectGoogleWorkspace()}
            disabled={authLoading}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-[#0B2545] text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2.5 shadow-xs transition-colors shrink-0 disabled:opacity-60"
          >
            <svg viewBox="0 0 48 48" className="w-4 h-4 shrink-0" aria-hidden="true">
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
            <span>Sign in with Google · ربط Google Docs</span>
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Create New Doc Form */}
          <form
            onSubmit={handleCreateDoc}
            className="rounded-2xl bg-[#EAF4F7]/65 border border-slate-200/80 p-4 space-y-3"
          >
            <h3 className="text-xs font-bold text-[#0B2545] flex items-center gap-1.5">
              <FilePlus2 className="w-4 h-4 text-[#00A6A6]" />
              إنشاء مستند محاضرة جديد في Google Docs
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                required
                minLength={2}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="عنوان المستند (مثال: ملخص الفيزياء الطبية 1)"
                className="sm:col-span-2 min-h-[42px] px-3.5 rounded-xl bg-white border border-slate-200 text-sm text-[#0B2545]"
              />
              <button
                type="submit"
                disabled={creatingDoc || newTitle.trim().length < 2}
                className="min-h-[42px] px-4 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {creatingDoc ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                إنشاء المستند
              </button>
            </div>
            <textarea
              rows={2}
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              placeholder="محتوى أولي للمستند (اختياري)..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-[#0B2545]"
            />
          </form>

          {/* Search & Master-Detail Docs View */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5 space-y-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  fetchDocs(workspaceAccessToken, searchQuery);
                }}
                className="flex gap-2"
              >
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ابحث في مستنداتك..."
                    className="w-full min-h-[40px] pr-9 pl-3 rounded-xl border border-slate-200 text-xs text-[#0B2545]"
                  />
                </div>
                <button
                  type="submit"
                  className="min-h-[40px] px-3.5 rounded-xl bg-[#0B2545] text-white text-xs font-semibold"
                >
                  بحث
                </button>
              </form>

              <div className="border border-slate-200 rounded-2xl divide-y divide-slate-100 max-h-[340px] overflow-y-auto">
                {loadingList ? (
                  <p className="p-6 text-center text-xs text-slate-500">
                    جاري تحميل مستندات Google Docs...
                  </p>
                ) : docs.length === 0 ? (
                  <p className="p-6 text-center text-xs text-slate-500">
                    لا توجد مستندات Google Docs مطابقة في حسابك.
                  </p>
                ) : (
                  docs.map((item) => {
                    const active = selectedDoc?.documentId === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`p-3 flex items-center justify-between gap-2 ${
                          active ? 'bg-[#EAF4F7]' : 'hover:bg-slate-50'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleOpenDoc(item)}
                          className="min-w-0 flex-1 text-right"
                        >
                          <p className="text-xs font-bold text-[#0B2545] truncate">{item.name}</p>
                          {item.modifiedTime && (
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              {new Date(item.modifiedTime).toLocaleDateString('ar-EG')}
                            </p>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setPendingMutation({
                              type: 'delete',
                              docId: item.id,
                              docTitle: item.name,
                            })
                          }
                          aria-label={`حذف مستند ${item.name}`}
                          className="min-h-[32px] min-w-[32px] rounded-lg border border-slate-200 text-slate-400 hover:text-[#FF8066] flex items-center justify-center shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Selected Doc Reader + Append Note */}
            <div className="lg:col-span-7 rounded-2xl border border-slate-200 p-4 bg-slate-50/60 flex flex-col justify-between min-h-[280px] space-y-4">
              {loadingDoc ? (
                <div className="flex-1 flex items-center justify-center text-xs text-slate-500 gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-[#00A6A6]" />
                  جاري قراءة المستند...
                </div>
              ) : !selectedDoc ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-xs text-slate-500">
                  <FileText className="w-8 h-8 text-slate-300 mb-2" />
                  اختر مستنداً من القائمة لقراءة محتواه أو إضافة ملاحظات جديدة إليه.
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-200">
                      <h3 className="font-display text-sm font-bold text-[#0B2545]">
                        {selectedDoc.title}
                      </h3>
                      {selectedWebLink && (
                        <a
                          href={selectedWebLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-[#00A6A6] inline-flex items-center gap-1 shrink-0"
                        >
                          فتح في Docs
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                    <div className="space-y-2 max-h-[210px] overflow-y-auto pr-1 text-xs text-[#0B2545] leading-relaxed">
                      {selectedDoc.paragraphs.length === 0 ? (
                        <p className="text-slate-400">المستند فارغ حالياً.</p>
                      ) : (
                        selectedDoc.paragraphs.map((p, idx) => (
                          <p
                            key={idx}
                            className={
                              p.heading?.startsWith('HEADING')
                                ? 'font-bold text-sm text-[#0B2545] pt-1'
                                : 'text-slate-700'
                            }
                          >
                            {p.text}
                          </p>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-200 space-y-2">
                    <label
                      htmlFor="gdoc-append-text"
                      className="block text-[11px] font-semibold text-[#0B2545]"
                    >
                      إضافة ملاحظة إلى نهاية المستند
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="gdoc-append-text"
                        type="text"
                        value={appendText}
                        onChange={(e) => setAppendText(e.target.value)}
                        placeholder="اكتب ملاحظة أو تلخيصاً لإضافته..."
                        className="flex-1 min-h-[38px] px-3 rounded-xl bg-white border border-slate-200 text-xs text-[#0B2545]"
                      />
                      <button
                        type="button"
                        disabled={appendText.trim().length < 2}
                        onClick={() =>
                          setPendingMutation({
                            type: 'append',
                            docId: selectedDoc.documentId,
                            docTitle: selectedDoc.title,
                            text: appendText.trim(),
                          })
                        }
                        className="min-h-[38px] px-3.5 rounded-xl bg-[#00A6A6] text-white text-xs font-semibold disabled:opacity-50"
                      >
                        إضافة للمستند
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mandatory Explicit Confirmation Dialog for Mutating / Deleting Google Docs */}
      {pendingMutation && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="تأكيد تعديل مستند Google Docs"
          className="fixed inset-0 z-50 bg-[#0B2545]/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-md w-full space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-[#FF8066]/15 text-[#FF8066] flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <h3 className="font-display text-base font-bold text-[#0B2545]">
                  {pendingMutation.type === 'delete'
                    ? 'تأكيد حذف مستند Google Docs'
                    : 'تأكيد تعديل مستند Google Docs'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPendingMutation(null)}
                aria-label="إغلاق"
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {pendingMutation.type === 'delete' ? (
              <p className="text-sm text-slate-600 leading-relaxed">
                هل أنت متأكد من حذف المستند{' '}
                <strong className="text-[#0B2545]">"{pendingMutation.docTitle}"</strong> من
                حسابك في Google Drive؟ لا يمكن التراجع عن هذا الإجراء.
              </p>
            ) : (
              <div className="space-y-2 text-sm text-slate-600">
                <p>
                  سيتم تعديل المستند{' '}
                  <strong className="text-[#0B2545]">"{pendingMutation.docTitle}"</strong> بإضافة
                  النص التالي:
                </p>
                <p className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-[#0B2545]">
                  {pendingMutation.text}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingMutation(null)}
                disabled={mutating}
                className="min-h-[40px] px-4 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmMutation}
                disabled={mutating}
                className={`min-h-[40px] px-4 rounded-xl text-white text-xs font-semibold inline-flex items-center gap-2 ${
                  pendingMutation.type === 'delete'
                    ? 'bg-[#FF8066] hover:bg-[#e56d54]'
                    : 'bg-[#00A6A6] hover:bg-[#008e8e]'
                }`}
              >
                {mutating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {pendingMutation.type === 'delete' ? 'تأكيد الحذف' : 'تأكيد التعديل'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
