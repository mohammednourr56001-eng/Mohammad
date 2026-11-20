import React, { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  GraduationCap,
  Loader2,
  Megaphone,
  Plus,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import {
  ClassroomAnnouncementItem,
  ClassroomCourseItem,
  ClassroomCourseWorkItem,
  ClassroomMaterialItem,
  createClassroomCourseWork,
  listClassroomAnnouncements,
  listClassroomCourses,
  listClassroomCourseWork,
  listClassroomMaterials,
} from '../../utils/googleClassroomApi.ts';
import { ConfirmWorkspaceActionModal } from './ConfirmWorkspaceActionModal.tsx';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';

export function GoogleClassroomPanel() {
  const { workspaceAccessToken, connectGoogleWorkspace, authLoading } = useAuth();

  const [courses, setCourses] = useState<ClassroomCourseItem[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [loadingCourses, setLoadingCourses] = useState(false);

  const [courseWork, setCourseWork] = useState<ClassroomCourseWorkItem[]>([]);
  const [materials, setMaterials] = useState<ClassroomMaterialItem[]>([]);
  const [announcements, setAnnouncements] = useState<ClassroomAnnouncementItem[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Teacher coursework creation state
  const [assignTitle, setAssignTitle] = useState('');
  const [assignDesc, setAssignDesc] = useState('');
  const [assignPoints, setAssignPoints] = useState('10');
  const [assignDueDate, setAssignDueDate] = useState('');

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadCourses = useCallback(async (token: string) => {
    setLoadingCourses(true);
    setErrorMsg(null);
    try {
      const list = await listClassroomCourses(token);
      setCourses(list);
      if (list[0]?.id) {
        setSelectedCourseId((prev) => prev || list[0].id);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'تعذر جلب المقررات من Google Classroom.'
      );
    } finally {
      setLoadingCourses(false);
    }
  }, []);

  const loadCourseDetails = useCallback(async (token: string, courseId: string) => {
    if (!courseId) return;
    setLoadingDetails(true);
    setErrorMsg(null);
    try {
      const [cw, mats, anns] = await Promise.all([
        listClassroomCourseWork(token, courseId).catch(() => [] as ClassroomCourseWorkItem[]),
        listClassroomMaterials(token, courseId),
        listClassroomAnnouncements(token, courseId),
      ]);
      setCourseWork(cw);
      setMaterials(mats);
      setAnnouncements(anns);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تحميل تفاصيل المقرر.');
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  useEffect(() => {
    if (workspaceAccessToken) {
      void loadCourses(workspaceAccessToken);
    }
  }, [workspaceAccessToken, loadCourses]);

  useEffect(() => {
    if (workspaceAccessToken && selectedCourseId) {
      void loadCourseDetails(workspaceAccessToken, selectedCourseId);
    }
  }, [workspaceAccessToken, selectedCourseId, loadCourseDetails]);

  const activeCourse = courses.find((c) => c.id === selectedCourseId) || null;

  const handleConfirmCreateAssignment = async () => {
    if (!workspaceAccessToken || !selectedCourseId) return;
    setMutating(true);
    setErrorMsg(null);
    try {
      const pointsNum = Number(assignPoints);
      const created = await createClassroomCourseWork({
        accessToken: workspaceAccessToken,
        courseId: selectedCourseId,
        title: assignTitle.trim(),
        description: assignDesc.trim() || undefined,
        maxPoints: Number.isFinite(pointsNum) && pointsNum > 0 ? pointsNum : undefined,
        dueDateIso: assignDueDate ? new Date(assignDueDate).toISOString() : undefined,
      });
      setAssignTitle('');
      setAssignDesc('');
      setAssignDueDate('');
      setConfirmOpen(false);
      setStatusMsg(`تم نشر التكليف "${created.title}" في Google Classroom بنجاح.`);
      await loadCourseDetails(workspaceAccessToken, selectedCourseId);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'تعذر نشر التكليف — يتطلب إنشاء التكليفات أن تكون معلماً في هذا الفصل.'
      );
      setConfirmOpen(false);
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
              <GraduationCap className="w-5 h-5 text-[#00A6A6]" />
              Google Classroom · المقررات والتكليفات
            </h3>
            <p className="text-xs text-slate-600">
              اربط حسابك لعرض فصول Google Classroom، التكليفات، المواعيد النهائية، والمواد الدراسية.
            </p>
          </div>
          <GoogleSignInButton
            onClick={() => void connectGoogleWorkspace()}
            loading={authLoading}
            label="ربط Google Classroom"
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
            <GraduationCap className="w-5 h-5 text-[#00A6A6]" />
            Google Classroom · الفصول الدراسية
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            استعرض فصولك النشطة، المهام، المواد، والإعلانات مباشرة من حسابك.
          </p>
        </div>

        <button
          type="button"
          disabled={loadingCourses}
          onClick={() => void loadCourses(workspaceAccessToken)}
          className="min-h-[38px] px-3.5 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-[#0B2545] inline-flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingCourses ? 'animate-spin' : ''}`} />
          تحديث الفصول
        </button>
      </div>

      <div className="rounded-xl bg-[#EAF4F7]/70 border border-slate-200/80 px-4 py-2.5 text-[11px] text-[#0B2545] flex items-start gap-2">
        <ShieldAlert className="w-4 h-4 text-[#00A6A6] shrink-0 mt-0.5" />
        <span>
          يعمل Google Classroom API مجاناً. ملاحظة: بعض نطاقات إدارة الفصول تتطلب حساب Google Workspace for Education، أو أن تكون معلماً في الفصل لإنشاء التكليفات.
        </span>
      </div>

      {loadingCourses ? (
        <div className="py-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-[#00A6A6]" />
          جاري جلب المقررات من Google Classroom...
        </div>
      ) : courses.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center space-y-2">
          <GraduationCap className="w-8 h-8 mx-auto text-[#00A6A6]" />
          <p className="text-sm font-bold text-[#0B2545]">لا توجد فصول نشطة في هذا الحساب</p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            تأكد من التحاقك بمقرر دراسي في Google Classroom أو من أن نطاق المؤسسة يسمح بالوصول عبر API.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Course Switcher */}
          <div className="flex items-center gap-2 flex-wrap">
            {courses.map((course) => (
              <button
                key={course.id}
                type="button"
                onClick={() => setSelectedCourseId(course.id)}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                  selectedCourseId === course.id
                    ? 'bg-[#0B2545] text-white'
                    : 'bg-[#EAF4F7] hover:bg-[#d8ecf2] text-[#0B2545]'
                }`}
              >
                {course.name}
                {course.section ? ` (${course.section})` : ''}
              </button>
            ))}
          </div>

          {activeCourse && (
            <div className="rounded-2xl border border-slate-200 p-4 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                <div>
                  <h4 className="font-display text-base font-bold text-[#0B2545]">
                    {activeCourse.name}
                  </h4>
                  <p className="text-xs text-slate-500">
                    {activeCourse.section || activeCourse.descriptionHeading || 'مقرر Google Classroom'}
                  </p>
                </div>
                {activeCourse.alternateLink && (
                  <a
                    href={activeCourse.alternateLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#EAF4F7] text-[#0B2545] text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    فتح في Classroom
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>

              {loadingDetails ? (
                <div className="py-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-[#00A6A6]" />
                  جاري تحميل التكليفات والمواد والإعلانات...
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* CourseWork */}
                  <div className="space-y-2.5">
                    <h5 className="text-xs font-bold text-[#0B2545] flex items-center gap-1.5">
                      <ClipboardCheck className="w-4 h-4 text-[#00A6A6]" />
                      التكليفات والمهام ({courseWork.length})
                    </h5>
                    {courseWork.length === 0 ? (
                      <p className="text-xs text-slate-500 bg-slate-50 rounded-xl p-3">
                        لا توجد تكليفات حالياً.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {courseWork.map((w) => (
                          <div
                            key={w.id}
                            className="rounded-xl border border-slate-200 p-3 space-y-1 bg-white"
                          >
                            <p className="text-xs font-bold text-[#0B2545]">{w.title}</p>
                            {w.dueDateLabel && (
                              <p className="text-[11px] text-[#FF8066] font-semibold">
                                التسليم: {w.dueDateLabel}
                              </p>
                            )}
                            {typeof w.maxPoints === 'number' && (
                              <p className="text-[11px] text-slate-500">
                                الدرجة: {w.maxPoints}
                              </p>
                            )}
                            {w.alternateLink && (
                              <a
                                href={w.alternateLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] font-semibold text-[#00A6A6] inline-flex items-center gap-1"
                              >
                                عرض المهمة
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Materials */}
                  <div className="space-y-2.5">
                    <h5 className="text-xs font-bold text-[#0B2545] flex items-center gap-1.5">
                      <BookOpen className="w-4 h-4 text-[#00A6A6]" />
                      المواد التعليمية ({materials.length})
                    </h5>
                    {materials.length === 0 ? (
                      <p className="text-xs text-slate-500 bg-slate-50 rounded-xl p-3">
                        لا توجد مواد منشورة.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {materials.map((m) => (
                          <div
                            key={m.id}
                            className="rounded-xl border border-slate-200 p-3 space-y-1 bg-white"
                          >
                            <p className="text-xs font-bold text-[#0B2545]">{m.title}</p>
                            {m.description && (
                              <p className="text-[11px] text-slate-500 line-clamp-2">
                                {m.description}
                              </p>
                            )}
                            {m.alternateLink && (
                              <a
                                href={m.alternateLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] font-semibold text-[#00A6A6] inline-flex items-center gap-1"
                              >
                                فتح المادة
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Announcements */}
                  <div className="space-y-2.5">
                    <h5 className="text-xs font-bold text-[#0B2545] flex items-center gap-1.5">
                      <Megaphone className="w-4 h-4 text-[#00A6A6]" />
                      الإعلانات ({announcements.length})
                    </h5>
                    {announcements.length === 0 ? (
                      <p className="text-xs text-slate-500 bg-slate-50 rounded-xl p-3">
                        لا توجد إعلانات في الفصل.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {announcements.map((a) => (
                          <div
                            key={a.id}
                            className="rounded-xl border border-slate-200 p-3 space-y-1 bg-white"
                          >
                            <p className="text-xs text-[#0B2545] line-clamp-3">{a.text}</p>
                            {a.alternateLink && (
                              <a
                                href={a.alternateLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] font-semibold text-[#00A6A6] inline-flex items-center gap-1"
                              >
                                عرض الإعلان
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Teacher Assignment Publisher (Confirmed) */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (assignTitle.trim().length < 2) {
                    setErrorMsg('يرجى إدخال عنوان واضح للتكليف.');
                    return;
                  }
                  setErrorMsg(null);
                  setConfirmOpen(true);
                }}
                className="rounded-2xl bg-[#EAF4F7]/50 border border-slate-200/80 p-4 space-y-3"
              >
                <h5 className="font-display text-sm font-bold text-[#0B2545]">
                  نشر تكليف جديد في هذا الفصل (للمحاضرين فقط)
                </h5>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="gc-assign-title" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      عنوان التكليف *
                    </label>
                    <input
                      id="gc-assign-title"
                      type="text"
                      value={assignTitle}
                      onChange={(e) => setAssignTitle(e.target.value)}
                      placeholder="مثال: تقرير المحاضرة الثالثة"
                      className="w-full min-h-[40px] px-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="gc-assign-points" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      الدرجة القصوى
                    </label>
                    <input
                      id="gc-assign-points"
                      type="number"
                      min={1}
                      max={1000}
                      value={assignPoints}
                      onChange={(e) => setAssignPoints(e.target.value)}
                      className="w-full min-h-[40px] px-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm tabular-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor="gc-assign-due" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      موعد التسليم (اختياري)
                    </label>
                    <input
                      id="gc-assign-due"
                      type="datetime-local"
                      value={assignDueDate}
                      onChange={(e) => setAssignDueDate(e.target.value)}
                      className="w-full min-h-[40px] px-3 rounded-xl bg-white border border-slate-200 text-xs"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label htmlFor="gc-assign-desc" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      التعليمات (اختياري)
                    </label>
                    <input
                      id="gc-assign-desc"
                      type="text"
                      value={assignDesc}
                      onChange={(e) => setAssignDesc(e.target.value)}
                      placeholder="ارفع ملف PDF بحد أقصى 5 صفحات..."
                      className="w-full min-h-[40px] px-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs sm:text-sm font-bold inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  نشر التكليف في Classroom
                </button>
              </form>
            </div>
          )}
        </div>
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

      <ConfirmWorkspaceActionModal
        open={confirmOpen}
        title="تأكيد نشر تكليف في Google Classroom"
        description="سيتم نشر تكليف دراسي جديد داخل الفصل المحدد وإظهاره لطلاب الصف."
        details={[
          { label: 'الفصل', value: activeCourse?.name || selectedCourseId },
          { label: 'التكليف', value: assignTitle.trim() },
          { label: 'الدرجة', value: assignPoints || 'غير محددة' },
        ]}
        busy={mutating}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirmCreateAssignment}
      />
    </div>
  );
}
