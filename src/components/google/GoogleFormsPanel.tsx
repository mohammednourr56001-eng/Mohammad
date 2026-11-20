import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FilePlus2,
  Loader2,
  Search,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { usePlatformData } from '../../context/PlatformDataContext.tsx';
import { AcademicFormRecord } from '../../types/googleEcosystem.ts';
import { getPublishedSpecializations } from '../../utils/academicLogic.ts';
import { extractGoogleFormIdFromInput } from '../../utils/googleEcosystemLogic.ts';
import {
  createGoogleForm,
  getGoogleForm,
  GoogleFormDetails,
} from '../../utils/googleFormsApi.ts';
import { ConfirmWorkspaceActionModal } from './ConfirmWorkspaceActionModal.tsx';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';

export function GoogleFormsPanel() {
  const {
    firebaseUser,
    isSuperAdmin,
    isStaff,
    assignedSpecializationId,
    hasPerm,
    workspaceAccessToken,
    connectGoogleWorkspace,
    getIdToken,
    authLoading,
  } = useAuth();
  const { specializations } = usePlatformData();

  const publishedSpecs = useMemo(
    () => getPublishedSpecializations(specializations),
    [specializations]
  );

  const canManageSpecForms =
    isSuperAdmin || (isStaff && Boolean(assignedSpecializationId) && hasPerm('announcements.manage'));

  const allowedSpecsForManage = useMemo(() => {
    if (isSuperAdmin) return publishedSpecs;
    if (assignedSpecializationId) {
      return publishedSpecs.filter((s) => s.id === assignedSpecializationId);
    }
    return [];
  }, [isSuperAdmin, assignedSpecializationId, publishedSpecs]);

  const [academicForms, setAcademicForms] = useState<AcademicFormRecord[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [filterSpecId, setFilterSpecId] = useState('');

  // Connect existing form by URL/ID
  const [formInput, setFormInput] = useState('');
  const [inspectedForm, setInspectedForm] = useState<GoogleFormDetails | null>(null);
  const [loadingForm, setLoadingForm] = useState(false);

  // Create new Google Form fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [initialQuestion, setInitialQuestion] = useState('');
  const [initialOptionsRaw, setInitialOptionsRaw] = useState('نعم, لا, جزئياً');
  const [publishToUst, setPublishToUst] = useState(canManageSpecForms);
  const [targetSpecId, setTargetSpecId] = useState(
    assignedSpecializationId || publishedSpecs[0]?.id || ''
  );
  const [formCategory, setFormCategory] = useState<'quiz' | 'survey' | 'assignment' | 'feedback'>(
    'quiz'
  );

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fetchAcademicForms = useCallback(async () => {
    setLoadingCatalog(true);
    try {
      const res = await fetch('/api/google/catalog');
      if (res.ok) {
        const data = (await res.json()) as { academicForms?: AcademicFormRecord[] };
        setAcademicForms(Array.isArray(data.academicForms) ? data.academicForms : []);
      }
    } catch {
      // ignore catalog load failure gracefully
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  useEffect(() => {
    void fetchAcademicForms();
  }, [fetchAcademicForms]);

  useEffect(() => {
    if (!targetSpecId && allowedSpecsForManage[0]?.id) {
      setTargetSpecId(allowedSpecsForManage[0].id);
    }
  }, [allowedSpecsForManage, targetSpecId]);

  const visibleForms = useMemo(() => {
    if (!filterSpecId) return academicForms;
    return academicForms.filter((f) => f.specializationId === filterSpecId);
  }, [academicForms, filterSpecId]);

  const handleInspectForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);

    if (!workspaceAccessToken) {
      await connectGoogleWorkspace();
      return;
    }

    const parsedId = extractGoogleFormIdFromInput(formInput);
    if (!parsedId) {
      setErrorMsg(
        'يرجى إدخال رابط التحرير (/forms/d/{formId}/edit) أو معرف النموذج الأصلي (Form ID). روابط التعبئة العامة /d/e/... لا تُقبل كمعرف API.'
      );
      return;
    }

    setLoadingForm(true);
    try {
      const details = await getGoogleForm(workspaceAccessToken, parsedId);
      setInspectedForm(details);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر قراءة بيانات النموذج.');
    } finally {
      setLoadingForm(false);
    }
  };

  const handleConfirmCreateForm = async () => {
    if (!workspaceAccessToken) return;
    setMutating(true);
    setErrorMsg(null);
    try {
      const options = initialOptionsRaw
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
      const created = await createGoogleForm({
        accessToken: workspaceAccessToken,
        title: title.trim(),
        description: description.trim() || undefined,
        initialQuestionTitle: initialQuestion.trim() || undefined,
        initialOptions: options.length >= 2 ? options : undefined,
      });
      setInspectedForm(created);

      let publishedNote = '';
      if (publishToUst && canManageSpecForms && targetSpecId && firebaseUser) {
        const idToken = await getIdToken();
        if (idToken) {
          const saveRes = await fetch('/api/google/forms', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              title: created.title,
              description: description.trim(),
              formId: created.formId,
              responderUri: created.responderUri,
              editUri: created.editUri,
              specializationId: targetSpecId,
              formCategory,
              status: 'published',
            }),
          });
          if (saveRes.ok) {
            await fetchAcademicForms();
            publishedNote = ' وتم نشره في جدول نماذج التخصص بنجاح.';
          }
        }
      }

      setTitle('');
      setDescription('');
      setInitialQuestion('');
      setConfirmOpen(false);
      setStatusMsg(`تم إنشاء نموذج Google Form "${created.title}" بنجاح${publishedNote}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر إنشاء النموذج في Google Forms.');
      setConfirmOpen(false);
    } finally {
      setMutating(false);
    }
  };

  const handleDeleteAcademicForm = async (formDoc: AcademicFormRecord) => {
    setErrorMsg(null);
    try {
      const idToken = await getIdToken();
      if (!idToken) return;
      const res = await fetch(`/api/google/forms/${encodeURIComponent(formDoc.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error || 'تعذر حذف ربط النموذج.');
      }
      await fetchAcademicForms();
      setStatusMsg(`تمت إزالة "${formDoc.title}" من دليل نماذج المنصة.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر حذف النموذج.');
    }
  };

  const CATEGORY_LABELS: Record<AcademicFormRecord['formCategory'], string> = {
    quiz: 'اختبار قصير',
    survey: 'استبيان أكاديمي',
    assignment: 'تسليم تكليف',
    feedback: 'تقييم مقرر',
  };

  return (
    <div className="space-y-5">
      {/* Published Academic Forms Directory (Zero-Read Student Hub) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold text-[#0B2545] flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-[#00A6A6]" />
              نماذج واستبيانات Google Forms الأكاديمية
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              نماذج الاختبارات والاستبيانات المنشورة لطلبة التخصصات، جاهزة للتعبئة الفورية.
            </p>
          </div>
          <select
            aria-label="تصفية النماذج حسب التخصص"
            value={filterSpecId}
            onChange={(e) => setFilterSpecId(e.target.value)}
            className="min-h-[40px] px-3 rounded-xl border border-slate-200 text-xs sm:text-sm text-[#0B2545] bg-white"
          >
            <option value="">كل التخصصات ({academicForms.length})</option>
            {publishedSpecs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {loadingCatalog ? (
          <div className="py-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-[#00A6A6]" />
            جاري تحميل النماذج...
          </div>
        ) : visibleForms.length === 0 ? (
          <div className="rounded-xl bg-[#EAF4F7]/50 border border-dashed border-slate-300 p-6 text-center text-xs text-slate-600">
            لا توجد نماذج Google Forms منشورة حالياً لهذا التخصص.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visibleForms.map((item) => {
              const specName =
                specializations.find((s) => s.id === item.specializationId)?.name || 'عام';
              const canDelete =
                isSuperAdmin ||
                (canManageSpecForms && item.specializationId === assignedSpecializationId);
              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-slate-200 p-4 bg-white flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-2 py-0.5 rounded bg-[#EAF4F7] text-[#0B2545] text-[11px] font-semibold">
                        {CATEGORY_LABELS[item.formCategory]} · {specName}
                      </span>
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteAcademicForm(item)}
                          aria-label={`إزالة ${item.title}`}
                          className="text-slate-400 hover:text-[#FF8066] p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <h4 className="font-display text-sm font-bold text-[#0B2545]">{item.title}</h4>
                    {item.description && (
                      <p className="text-xs text-slate-500 line-clamp-2">{item.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <a
                      href={item.responderUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[38px] px-4 py-1.5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs font-bold inline-flex items-center gap-1.5"
                    >
                      تعبئة النموذج
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    {item.editUri && canManageSpecForms && (
                      <a
                        href={item.editUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 text-[#0B2545] text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        تحرير في Google
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Interactive Workspace Google Forms Tool */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h4 className="font-display text-base font-bold text-[#0B2545] flex items-center gap-2">
              <FilePlus2 className="w-5 h-5 text-[#00A6A6]" />
              ربط وإنشاء نموذج في حسابك على Google Forms
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">
              استعرض أسئلة أي نموذج تملكه أو أنشئ اختباراً/استبياناً جديداً عبر Google Forms API.
            </p>
          </div>
          {!workspaceAccessToken && (
            <GoogleSignInButton
              onClick={() => void connectGoogleWorkspace()}
              loading={authLoading}
              label="ربط Google Forms"
            />
          )}
        </div>

        {workspaceAccessToken && (
          <>
            {/* Inspect Existing Form */}
            <form onSubmit={handleInspectForm} className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  dir="ltr"
                  value={formInput}
                  onChange={(e) => setFormInput(e.target.value)}
                  placeholder="https://docs.google.com/forms/d/{formId}/edit  أو  Form ID"
                  className="w-full min-h-[42px] pr-9 pl-3 rounded-xl border border-slate-200 text-xs sm:text-sm font-mono text-left"
                />
              </div>
              <button
                type="submit"
                disabled={loadingForm}
                className="min-h-[42px] px-4 rounded-xl bg-[#0B2545] text-white text-xs sm:text-sm font-semibold shrink-0 disabled:opacity-60"
              >
                {loadingForm ? 'جاري الجلب...' : 'فحص النموذج'}
              </button>
            </form>

            {inspectedForm && (
              <div className="rounded-2xl bg-[#EAF4F7]/60 border border-[#00A6A6]/30 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h5 className="font-display text-sm font-bold text-[#0B2545]">
                      {inspectedForm.title}
                    </h5>
                    <p className="text-[11px] text-slate-600">
                      عدد الأسئلة والعناصر: {inspectedForm.itemsCount}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={inspectedForm.responderUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[34px] px-3 py-1 rounded-lg bg-[#00A6A6] text-white text-xs font-semibold inline-flex items-center gap-1"
                    >
                      رابط التعبئة
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <a
                      href={inspectedForm.editUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[34px] px-3 py-1 rounded-lg bg-white border border-slate-200 text-[#0B2545] text-xs font-semibold inline-flex items-center gap-1"
                    >
                      تحرير
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
                {inspectedForm.questions.length > 0 && (
                  <ul className="space-y-1.5 text-xs">
                    {inspectedForm.questions.map((q) => (
                      <li
                        key={q.itemId}
                        className="bg-white rounded-lg px-3 py-2 border border-slate-200/80 flex items-center justify-between gap-2"
                      >
                        <span className="font-semibold text-[#0B2545] truncate">{q.title}</span>
                        <span className="text-[11px] text-slate-500 shrink-0">{q.kind}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Create New Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!title.trim()) {
                  setErrorMsg('يرجى إدخال عنوان النموذج.');
                  return;
                }
                setErrorMsg(null);
                setConfirmOpen(true);
              }}
              className="rounded-2xl border border-slate-200 p-4 space-y-4 bg-slate-50/50"
            >
              <h5 className="font-display text-sm font-bold text-[#0B2545]">
                إنشاء نموذج Google Form جديد
              </h5>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="gf-title" className="block text-xs font-semibold text-[#0B2545] mb-1">
                    عنوان النموذج *
                  </label>
                  <input
                    id="gf-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="مثال: اختبار تقييمي - محاضرة الفسيولوجيا 1"
                    className="w-full min-h-[40px] px-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="gf-desc" className="block text-xs font-semibold text-[#0B2545] mb-1">
                    الوصف / التعليمات (اختياري)
                  </label>
                  <input
                    id="gf-desc"
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="الوقت المقترح 10 دقائق..."
                    className="w-full min-h-[40px] px-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="gf-q1" className="block text-xs font-semibold text-[#0B2545] mb-1">
                    السؤال الأول المبدئي (اختياري)
                  </label>
                  <input
                    id="gf-q1"
                    type="text"
                    value={initialQuestion}
                    onChange={(e) => setInitialQuestion(e.target.value)}
                    placeholder="ما مدى وضوح شرح المحاضرة؟"
                    className="w-full min-h-[40px] px-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="gf-opts" className="block text-xs font-semibold text-[#0B2545] mb-1">
                    خيارات السؤال (مفصولة بفاصلة ,)
                  </label>
                  <input
                    id="gf-opts"
                    type="text"
                    value={initialOptionsRaw}
                    onChange={(e) => setInitialOptionsRaw(e.target.value)}
                    className="w-full min-h-[40px] px-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm"
                  />
                </div>
              </div>

              {canManageSpecForms && allowedSpecsForManage.length > 0 && (
                <div className="pt-2 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                  <label className="flex items-center gap-2 text-xs font-semibold text-[#0B2545] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={publishToUst}
                      onChange={(e) => setPublishToUst(e.target.checked)}
                      className="w-4 h-4 accent-[#00A6A6]"
                    />
                    نشر الرابط للطلبة في UST
                  </label>
                  <select
                    aria-label="التخصص المستهدف للنموذج"
                    value={targetSpecId}
                    disabled={!publishToUst}
                    onChange={(e) => setTargetSpecId(e.target.value)}
                    className="min-h-[38px] px-3 rounded-xl bg-white border border-slate-200 text-xs disabled:opacity-50"
                  >
                    {allowedSpecsForManage.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="نوع النموذج"
                    value={formCategory}
                    disabled={!publishToUst}
                    onChange={(e) =>
                      setFormCategory(e.target.value as AcademicFormRecord['formCategory'])
                    }
                    className="min-h-[38px] px-3 rounded-xl bg-white border border-slate-200 text-xs disabled:opacity-50"
                  >
                    <option value="quiz">اختبار قصير</option>
                    <option value="survey">استبيان أكاديمي</option>
                    <option value="assignment">تسليم تكليف</option>
                    <option value="feedback">تقييم مقرر</option>
                  </select>
                </div>
              )}

              <button
                type="submit"
                className="min-h-[42px] px-5 py-2 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs sm:text-sm font-bold inline-flex items-center gap-2"
              >
                <FilePlus2 className="w-4 h-4" />
                إنشاء النموذج في Google Forms
              </button>
            </form>
          </>
        )}

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
      </div>

      <ConfirmWorkspaceActionModal
        open={confirmOpen}
        title="تأكيد إنشاء نموذج Google Forms"
        description="سيتم إنشاء نموذج جديد داخل حسابك في Google Forms مع الأسئلة المبدئية المحددة."
        details={[
          { label: 'عنوان النموذج', value: title.trim() },
          {
            label: 'نشر للطلبة في UST',
            value: publishToUst && canManageSpecForms ? 'نعم (داخل التخصص المحدد)' : 'لا (شخصي فقط)',
          },
        ]}
        busy={mutating}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirmCreateForm}
      />
    </div>
  );
}
