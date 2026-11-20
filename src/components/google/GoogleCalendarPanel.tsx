import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar as CalendarIcon,
  CalendarPlus,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  MapPin,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { usePlatformData } from '../../context/PlatformDataContext.tsx';
import { AcademicCalendarRecord } from '../../types/googleEcosystem.ts';
import { getPublishedSpecializations } from '../../utils/academicLogic.ts';
import {
  createCalendarEvent,
  GoogleCalendarEventItem,
  GoogleCalendarListItem,
  listCalendarEvents,
  listUserCalendars,
} from '../../utils/googleCalendarApi.ts';
import { validateCalendarEventDraft } from '../../utils/googleEcosystemLogic.ts';
import { ConfirmWorkspaceActionModal } from './ConfirmWorkspaceActionModal.tsx';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';

function toLocalDateTimeInput(offsetHours: number): string {
  const d = new Date(Date.now() + offsetHours * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function GoogleCalendarPanel() {
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

  const canManageSpecCalendar =
    isSuperAdmin || (isStaff && Boolean(assignedSpecializationId) && hasPerm('announcements.manage'));

  const allowedSpecsForManage = useMemo(() => {
    if (isSuperAdmin) return publishedSpecs;
    if (assignedSpecializationId) {
      return publishedSpecs.filter((s) => s.id === assignedSpecializationId);
    }
    return [];
  }, [isSuperAdmin, assignedSpecializationId, publishedSpecs]);

  // Academic Calendar Schedule (UST published events)
  const [academicEvents, setAcademicEvents] = useState<AcademicCalendarRecord[]>([]);
  const [loadingAcademic, setLoadingAcademic] = useState(false);
  const [filterSpecId, setFilterSpecId] = useState('');

  // Google Calendar API state
  const [calendars, setCalendars] = useState<GoogleCalendarListItem[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState('primary');
  const [googleEvents, setGoogleEvents] = useState<GoogleCalendarEventItem[]>([]);
  const [loadingGoogleCal, setLoadingGoogleCal] = useState(false);

  // Create event form
  const [evTitle, setEvTitle] = useState('');
  const [evLocation, setEvLocation] = useState('');
  const [evDesc, setEvDesc] = useState('');
  const [evStartsAt, setEvStartsAt] = useState(() => toLocalDateTimeInput(2));
  const [evEndsAt, setEvEndsAt] = useState(() => toLocalDateTimeInput(3));
  const [evType, setEvType] = useState<AcademicCalendarRecord['eventType']>('lecture');
  const [publishToUst, setPublishToUst] = useState(canManageSpecCalendar);
  const [targetSpecId, setTargetSpecId] = useState(
    assignedSpecializationId || publishedSpecs[0]?.id || ''
  );

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fetchAcademicSchedule = useCallback(async () => {
    setLoadingAcademic(true);
    try {
      const res = await fetch('/api/google/catalog');
      if (res.ok) {
        const data = (await res.json()) as { academicCalendars?: AcademicCalendarRecord[] };
        setAcademicEvents(Array.isArray(data.academicCalendars) ? data.academicCalendars : []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingAcademic(false);
    }
  }, []);

  const loadGoogleCalendarData = useCallback(
    async (token: string, calId: string) => {
      setLoadingGoogleCal(true);
      setErrorMsg(null);
      try {
        const [cals, events] = await Promise.all([
          listUserCalendars(token),
          listCalendarEvents(token, calId, 20),
        ]);
        setCalendars(cals);
        setGoogleEvents(events);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'تعذر جلب أحداث Google Calendar.');
      } finally {
        setLoadingGoogleCal(false);
      }
    },
    []
  );

  useEffect(() => {
    void fetchAcademicSchedule();
  }, [fetchAcademicSchedule]);

  useEffect(() => {
    if (workspaceAccessToken) {
      void loadGoogleCalendarData(workspaceAccessToken, selectedCalendarId);
    }
  }, [workspaceAccessToken, selectedCalendarId, loadGoogleCalendarData]);

  useEffect(() => {
    if (!targetSpecId && allowedSpecsForManage[0]?.id) {
      setTargetSpecId(allowedSpecsForManage[0].id);
    }
  }, [allowedSpecsForManage, targetSpecId]);

  const visibleAcademicEvents = useMemo(() => {
    if (!filterSpecId) return academicEvents;
    return academicEvents.filter((ev) => ev.specializationId === filterSpecId);
  }, [academicEvents, filterSpecId]);

  const handleConfirmCreateEvent = async () => {
    if (!workspaceAccessToken) return;
    setMutating(true);
    setErrorMsg(null);
    try {
      const startsIso = new Date(evStartsAt).toISOString();
      const endsIso = new Date(evEndsAt).toISOString();
      const created = await createCalendarEvent({
        accessToken: workspaceAccessToken,
        calendarId: selectedCalendarId,
        summary: evTitle.trim(),
        description: evDesc.trim() || undefined,
        location: evLocation.trim() || undefined,
        startsAtIso: startsIso,
        endsAtIso: endsIso,
      });

      let ustNote = '';
      if (publishToUst && canManageSpecCalendar && targetSpecId && firebaseUser) {
        const idToken = await getIdToken();
        if (idToken) {
          const saveRes = await fetch('/api/google/calendars', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              title: evTitle.trim(),
              description: evDesc.trim(),
              specializationId: targetSpecId,
              eventType: evType,
              startsAt: startsIso,
              endsAt: endsIso,
              location: evLocation.trim(),
              googleCalendarId: selectedCalendarId,
              googleEventId: created.id,
              googleHtmlLink: created.htmlLink,
              status: 'published',
            }),
          });
          if (saveRes.ok) {
            await fetchAcademicSchedule();
            ustNote = ' وتم نشره في الجدول الأكاديمي للطلبة.';
          }
        }
      }

      setEvTitle('');
      setEvLocation('');
      setEvDesc('');
      setConfirmOpen(false);
      setStatusMsg(`تمت إضافة الموعد "${created.summary}" إلى Google Calendar${ustNote}`);
      await loadGoogleCalendarData(workspaceAccessToken, selectedCalendarId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر إنشاء الحدث في Google Calendar.');
      setConfirmOpen(false);
    } finally {
      setMutating(false);
    }
  };

  const handleDeleteAcademicEvent = async (record: AcademicCalendarRecord) => {
    setErrorMsg(null);
    try {
      const idToken = await getIdToken();
      if (!idToken) return;
      const res = await fetch(`/api/google/calendars/${encodeURIComponent(record.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error || 'تعذر حذف الحدث.');
      }
      await fetchAcademicSchedule();
      setStatusMsg(`تمت إزالة "${record.title}" من الجدول الأكاديمي.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر حذف الموعد.');
    }
  };

  const EVENT_TYPE_LABELS: Record<AcademicCalendarRecord['eventType'], string> = {
    lecture: 'محاضرة',
    exam: 'اختبار',
    deadline: 'موعد تسليم',
    seminar: 'ندوة علمية',
  };

  return (
    <div className="space-y-5">
      {/* UST Published Academic Calendar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold text-[#0B2545] flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-[#00A6A6]" />
              التقويم الأكاديمي والمواعيد الدراسية
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              مواعيد المحاضرات والاختبارات والتسليمات المعلنة للتخصصات.
            </p>
          </div>
          <select
            aria-label="تصفية التقويم حسب التخصص"
            value={filterSpecId}
            onChange={(e) => setFilterSpecId(e.target.value)}
            className="min-h-[40px] px-3 rounded-xl border border-slate-200 text-xs sm:text-sm text-[#0B2545] bg-white"
          >
            <option value="">كل التخصصات ({academicEvents.length})</option>
            {publishedSpecs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {loadingAcademic ? (
          <div className="py-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-[#00A6A6]" />
            جاري تحميل المواعيد...
          </div>
        ) : visibleAcademicEvents.length === 0 ? (
          <div className="rounded-xl bg-[#EAF4F7]/50 border border-dashed border-slate-300 p-6 text-center text-xs text-slate-600">
            لا توجد مواعيد أكاديمية منشورة لهذا التخصص بعد.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visibleAcademicEvents.map((ev) => {
              const specName =
                specializations.find((s) => s.id === ev.specializationId)?.name || 'عام';
              const canDelete =
                isSuperAdmin ||
                (canManageSpecCalendar && ev.specializationId === assignedSpecializationId);
              return (
                <div
                  key={ev.id}
                  className="rounded-xl border border-slate-200 p-4 bg-white space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2 py-0.5 rounded bg-[#EAF4F7] text-[#0B2545] text-[11px] font-semibold">
                      {EVENT_TYPE_LABELS[ev.eventType]} · {specName}
                    </span>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteAcademicEvent(ev)}
                        aria-label={`حذف ${ev.title}`}
                        className="text-slate-400 hover:text-[#FF8066] p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <h4 className="font-display text-sm font-bold text-[#0B2545]">{ev.title}</h4>
                  <p className="text-[11px] text-slate-600 flex items-center gap-1.5 tabular-nums">
                    <Clock className="w-3.5 h-3.5 text-[#00A6A6]" />
                    {new Date(ev.startsAt).toLocaleString('ar-EG', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                  {ev.location && (
                    <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-[#00A6A6]" />
                      {ev.location}
                    </p>
                  )}
                  {ev.googleHtmlLink && (
                    <a
                      href={ev.googleHtmlLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-[#00A6A6] inline-flex items-center gap-1 hover:underline"
                    >
                      عرض في Google Calendar
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Interactive User Google Calendar Panel */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h4 className="font-display text-base font-bold text-[#0B2545] flex items-center gap-2">
              <CalendarPlus className="w-5 h-5 text-[#00A6A6]" />
              تقويم Google Calendar الشخصي
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">
              استعرض أحداث تقويمك القادمة وأضف مواعيد محاضرات أو مذاكرة مع تأكيد صريح.
            </p>
          </div>
          {!workspaceAccessToken ? (
            <GoogleSignInButton
              onClick={() => void connectGoogleWorkspace()}
              loading={authLoading}
              label="ربط Google Calendar"
            />
          ) : (
            <div className="flex items-center gap-2">
              <select
                aria-label="اختيار التقويم"
                value={selectedCalendarId}
                onChange={(e) => setSelectedCalendarId(e.target.value)}
                className="min-h-[38px] px-3 rounded-xl border border-slate-200 text-xs text-[#0B2545] bg-white"
              >
                <option value="primary">التقويم الرئيسي (Primary)</option>
                {calendars
                  .filter((c) => c.id !== 'primary')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.summary}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={loadingGoogleCal}
                onClick={() =>
                  void loadGoogleCalendarData(workspaceAccessToken, selectedCalendarId)
                }
                className="min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-[#0B2545] inline-flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingGoogleCal ? 'animate-spin' : ''}`} />
                تحديث
              </button>
            </div>
          )}
        </div>

        {workspaceAccessToken && (
          <>
            {/* Create Event Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const check = validateCalendarEventDraft({
                  title: evTitle,
                  startsAtIso: new Date(evStartsAt).toISOString(),
                  endsAtIso: new Date(evEndsAt).toISOString(),
                });
                if (!check.valid) {
                  setErrorMsg(check.error || 'بيانات الموعد غير مكتملة.');
                  return;
                }
                setErrorMsg(null);
                setConfirmOpen(true);
              }}
              className="rounded-2xl bg-[#EAF4F7]/50 border border-slate-200/80 p-4 space-y-3"
            >
              <h5 className="font-display text-sm font-bold text-[#0B2545]">
                إضافة موعد أو حدث إلى Google Calendar
              </h5>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label htmlFor="cal-title" className="block text-xs font-semibold text-[#0B2545] mb-1">
                    عنوان الحدث *
                  </label>
                  <input
                    id="cal-title"
                    type="text"
                    value={evTitle}
                    onChange={(e) => setEvTitle(e.target.value)}
                    placeholder="مثال: مراجعة اختبار التشريح - القاعة 2"
                    className="w-full min-h-[40px] px-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="cal-start" className="block text-xs font-semibold text-[#0B2545] mb-1">
                    وقت البدء *
                  </label>
                  <input
                    id="cal-start"
                    type="datetime-local"
                    value={evStartsAt}
                    onChange={(e) => setEvStartsAt(e.target.value)}
                    className="w-full min-h-[40px] px-3 rounded-xl bg-white border border-slate-200 text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="cal-end" className="block text-xs font-semibold text-[#0B2545] mb-1">
                    وقت الانتهاء *
                  </label>
                  <input
                    id="cal-end"
                    type="datetime-local"
                    value={evEndsAt}
                    onChange={(e) => setEvEndsAt(e.target.value)}
                    className="w-full min-h-[40px] px-3 rounded-xl bg-white border border-slate-200 text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="cal-loc" className="block text-xs font-semibold text-[#0B2545] mb-1">
                    المكان / القاعة (اختياري)
                  </label>
                  <input
                    id="cal-loc"
                    type="text"
                    value={evLocation}
                    onChange={(e) => setEvLocation(e.target.value)}
                    placeholder="مبنى العلوم الطبية"
                    className="w-full min-h-[40px] px-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label htmlFor="cal-desc" className="block text-xs font-semibold text-[#0B2545] mb-1">
                    ملاحظات (اختياري)
                  </label>
                  <input
                    id="cal-desc"
                    type="text"
                    value={evDesc}
                    onChange={(e) => setEvDesc(e.target.value)}
                    placeholder="تفاصيل المحاضرة أو المواضيع المطلوبة..."
                    className="w-full min-h-[40px] px-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm"
                  />
                </div>
              </div>

              {canManageSpecCalendar && allowedSpecsForManage.length > 0 && (
                <div className="pt-2 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                  <label className="flex items-center gap-2 text-xs font-semibold text-[#0B2545] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={publishToUst}
                      onChange={(e) => setPublishToUst(e.target.checked)}
                      className="w-4 h-4 accent-[#00A6A6]"
                    />
                    نشر الموعد لطلبة التخصص في UST
                  </label>
                  <select
                    aria-label="التخصص المستهدف للحدث"
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
                    aria-label="تصنيف الحدث"
                    value={evType}
                    disabled={!publishToUst}
                    onChange={(e) =>
                      setEvType(e.target.value as AcademicCalendarRecord['eventType'])
                    }
                    className="min-h-[38px] px-3 rounded-xl bg-white border border-slate-200 text-xs disabled:opacity-50"
                  >
                    <option value="lecture">محاضرة</option>
                    <option value="exam">اختبار</option>
                    <option value="deadline">موعد تسليم</option>
                    <option value="seminar">ندوة علمية</option>
                  </select>
                </div>
              )}

              <button
                type="submit"
                className="min-h-[42px] px-5 py-2 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs sm:text-sm font-bold inline-flex items-center gap-2"
              >
                <CalendarPlus className="w-4 h-4" />
                إضافة الحدث إلى Google Calendar
              </button>
            </form>

            {/* Upcoming Events List */}
            <div className="space-y-2">
              <h5 className="font-display text-sm font-bold text-[#0B2545]">
                الأحداث القادمة في تقويمك ({googleEvents.length})
              </h5>
              {loadingGoogleCal ? (
                <div className="py-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-[#00A6A6]" />
                  جاري جلب المواعيد من Google Calendar...
                </div>
              ) : googleEvents.length === 0 ? (
                <p className="py-5 text-center text-xs text-slate-500 bg-slate-50 rounded-xl">
                  لا توجد أحداث قادمة في هذا التقويم حالياً.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                  {googleEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-bold text-[#0B2545] truncate">
                          {ev.summary}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-2">
                          <span>
                            {ev.startIso
                              ? new Date(ev.startIso).toLocaleString('ar-EG', {
                                  dateStyle: 'medium',
                                  timeStyle: ev.isAllDay ? undefined : 'short',
                                })
                              : 'وقت غير محدد'}
                          </span>
                          {ev.location && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{ev.location}</span>
                            </>
                          )}
                        </p>
                      </div>
                      {ev.htmlLink && (
                        <a
                          href={ev.htmlLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-[34px] px-3 py-1 rounded-lg bg-[#EAF4F7] text-[#0B2545] text-xs font-semibold inline-flex items-center gap-1 shrink-0"
                        >
                          فتح بالتقويم
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
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
        title="تأكيد إضافة موعد إلى Google Calendar"
        description="سيتم إنشاء الحدث في تقويم Google المحدد، وإذا فعلت خيار النشر سيظهر أيضاً لطلبة التخصص."
        details={[
          { label: 'العنوان', value: evTitle.trim() },
          {
            label: 'البدء',
            value: new Date(evStartsAt).toLocaleString('ar-EG'),
          },
          {
            label: 'الانتهاء',
            value: new Date(evEndsAt).toLocaleString('ar-EG'),
          },
        ]}
        busy={mutating}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirmCreateEvent}
      />
    </div>
  );
}
