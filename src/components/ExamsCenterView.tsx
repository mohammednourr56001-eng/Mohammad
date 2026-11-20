import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Award,
  BrainCircuit,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import {
  AiJobRecord,
  ExamAttempt,
  ExamDifficulty,
  ExamRecord,
} from '../types/academic.ts';

type ExamsTab = 'take' | 'ai_queue' | 'history';

interface ExamDraftStorage {
  idempotencyKey: string;
  answers: Record<string, number>;
  startedAtMs: number;
  updatedAt: string;
}

const DIFFICULTY_LABELS: Record<ExamDifficulty, string> = {
  easy: 'أساسي',
  medium: 'متوسط',
  hard: 'متقدم',
};

const JOB_STATUS_LABELS: Record<AiJobRecord['status'], { label: string; badgeClass: string }> = {
  waiting: { label: 'في الانتظار', badgeClass: 'bg-amber-50 text-amber-800 border-amber-200' },
  processing: { label: 'قيد المعالجة', badgeClass: 'bg-sky-50 text-sky-800 border-sky-200' },
  completed: { label: 'مكتمل', badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  failed: { label: 'فشل', badgeClass: 'bg-rose-50 text-rose-800 border-rose-200' },
};

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function ExamsCenterView() {
  const { firebaseUser, getIdToken, openLoginModal } = useAuth();
  const { specializations, subjects, lectureFiles } = usePlatformData();

  const [tab, setTab] = useState<ExamsTab>('take');
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [aiJobs, setAiJobs] = useState<AiJobRecord[]>([]);
  const [loadingExams, setLoadingExams] = useState(true);
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Active exam runner state
  const [activeExam, setActiveExam] = useState<ExamRecord | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [startedAtMs, setStartedAtMs] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitFailedNetwork, setSubmitFailedNetwork] = useState(false);
  const [lastResult, setLastResult] = useState<ExamAttempt | null>(null);
  const [restoredDraftNotice, setRestoredDraftNotice] = useState(false);

  // AI Queue request state
  const [aiType, setAiType] = useState<'exam_generation' | 'pdf_summary'>('exam_generation');
  const [aiSubjectId, setAiSubjectId] = useState<string>('');
  const [aiSourceFileId, setAiSourceFileId] = useState<string>('');
  const [aiTopic, setAiTopic] = useState<string>('');
  const [aiDifficulty, setAiDifficulty] = useState<ExamDifficulty>('medium');
  const [aiCount, setAiCount] = useState<number>(5);
  const [queueingJob, setQueueingJob] = useState(false);

  const publishedSubjects = useMemo(
    () => subjects.filter((s) => s.status === 'published'),
    [subjects]
  );

  const publishedPdfsForSelectedSubject = useMemo(
    () =>
      lectureFiles.filter(
        (f) =>
          f.status === 'published' &&
          (!aiSubjectId || f.subjectId === aiSubjectId) &&
          f.fileExt === 'pdf'
      ),
    [lectureFiles, aiSubjectId]
  );

  useEffect(() => {
    if (!aiSubjectId && publishedSubjects.length > 0) {
      setAiSubjectId(publishedSubjects[0].id);
    }
  }, [publishedSubjects, aiSubjectId]);

  const fetchExamsCatalog = useCallback(async () => {
    setLoadingExams(true);
    try {
      const url =
        subjectFilter !== 'all'
          ? `/api/exams?limit=50&subjectId=${encodeURIComponent(subjectFilter)}`
          : '/api/exams?limit=50';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setExams(Array.isArray(data.items) ? data.items : []);
      }
    } catch {
      // ignore transient network errors
    } finally {
      setLoadingExams(false);
    }
  }, [subjectFilter]);

  const fetchUserAttempts = useCallback(async () => {
    if (!firebaseUser) {
      setAttempts([]);
      return;
    }
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/exams/attempts/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAttempts(Array.isArray(data.attempts) ? data.attempts : []);
      }
    } catch {
      // ignore
    }
  }, [firebaseUser, getIdToken]);

  const fetchAiJobs = useCallback(async () => {
    if (!firebaseUser) {
      setAiJobs([]);
      return;
    }
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/ai/jobs', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAiJobs(Array.isArray(data.jobs) ? data.jobs : []);
      }
    } catch {
      // ignore
    }
  }, [firebaseUser, getIdToken]);

  useEffect(() => {
    void fetchExamsCatalog();
  }, [fetchExamsCatalog]);

  useEffect(() => {
    void fetchUserAttempts();
    void fetchAiJobs();
  }, [fetchUserAttempts, fetchAiJobs]);

  // Poll AI jobs when any job is waiting or processing
  const hasPendingJobs = useMemo(
    () => aiJobs.some((j) => j.status === 'waiting' || j.status === 'processing'),
    [aiJobs]
  );

  useEffect(() => {
    if (!hasPendingJobs || !firebaseUser) return;
    const timer = window.setInterval(() => {
      void fetchAiJobs();
      void fetchExamsCatalog();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [hasPendingJobs, firebaseUser, fetchAiJobs, fetchExamsCatalog]);

  // Local countdown timer (zero DB calls per tick)
  const autoSubmittedRef = useRef(false);
  useEffect(() => {
    if (!activeExam || lastResult) return;
    const timer = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeExam, lastResult]);

  // Persist exam draft answers locally on every selection so students never lose progress
  useEffect(() => {
    if (!activeExam || lastResult || !idempotencyKey) return;
    const draftKey = `ust_exam_draft_${firebaseUser?.uid || 'guest'}_${activeExam.id}`;
    const payload: ExamDraftStorage = {
      idempotencyKey,
      answers,
      startedAtMs,
      updatedAt: new Date().toISOString(),
    };
    try {
      window.localStorage.setItem(draftKey, JSON.stringify(payload));
    } catch {
      // ignore storage quota errors
    }
  }, [activeExam, answers, idempotencyKey, startedAtMs, firebaseUser, lastResult]);

  const startExamById = async (examId: string) => {
    setErrorMsg(null);
    setBannerMsg(null);
    setLastResult(null);
    setSubmitFailedNetwork(false);
    setRestoredDraftNotice(false);
    autoSubmittedRef.current = false;

    try {
      const res = await fetch(`/api/exams/${encodeURIComponent(examId)}`);
      if (!res.ok) {
        setErrorMsg('تعذر تحميل بيانات الاختبار حالياً.');
        return;
      }
      const data = await res.json();
      const loadedExam = data.exam as ExamRecord;
      const totalDurationSec = Math.max(60, (loadedExam.durationMinutes || 15) * 60);
      const draftKey = `ust_exam_draft_${firebaseUser?.uid || 'guest'}_${loadedExam.id}`;

      let nextAnswers: Record<string, number> = {};
      let nextKey = `idem_${loadedExam.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      let nextStarted = Date.now();
      let nextRemaining = totalDurationSec;

      try {
        const rawDraft = window.localStorage.getItem(draftKey);
        if (rawDraft) {
          const parsed = JSON.parse(rawDraft) as ExamDraftStorage;
          if (parsed?.idempotencyKey && parsed?.startedAtMs) {
            const elapsedSec = Math.floor((Date.now() - parsed.startedAtMs) / 1000);
            if (elapsedSec < totalDurationSec) {
              nextAnswers = parsed.answers || {};
              nextKey = parsed.idempotencyKey;
              nextStarted = parsed.startedAtMs;
              nextRemaining = Math.max(30, totalDurationSec - elapsedSec);
              setRestoredDraftNotice(true);
            } else {
              window.localStorage.removeItem(draftKey);
            }
          }
        }
      } catch {
        // ignore invalid localStorage draft
      }

      setActiveExam(loadedExam);
      setAnswers(nextAnswers);
      setIdempotencyKey(nextKey);
      setStartedAtMs(nextStarted);
      setRemainingSeconds(nextRemaining);
      setTab('take');
    } catch {
      setErrorMsg('تعذر الاتصال بالخادم لبدء الاختبار.');
    }
  };

  const handleSubmitExam = useCallback(async () => {
    if (!activeExam) return;
    if (!firebaseUser) {
      setErrorMsg('سجّل الدخول بحساب Google لحفظ وتسليم نتيجتك (إجاباتك محفوظة محلياً ولن تضيع).');
      openLoginModal();
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    setSubmitFailedNetwork(false);

    try {
      const token = await getIdToken();
      if (!token) {
        openLoginModal();
        return;
      }
      const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtMs) / 1000));
      const res = await fetch(`/api/exams/${encodeURIComponent(activeExam.id)}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          idempotencyKey,
          answers,
          durationSeconds,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setSubmitFailedNetwork(true);
        setErrorMsg(data.error || 'تعذر تسليم الاختبار. إجاباتك محفوظة محلياً ويمكنك إعادة المحاولة.');
        return;
      }

      const attempt = data.attempt as ExamAttempt;
      setLastResult(attempt);
      const draftKey = `ust_exam_draft_${firebaseUser.uid}_${activeExam.id}`;
      try {
        window.localStorage.removeItem(draftKey);
      } catch {
        // ignore
      }
      void fetchUserAttempts();
    } catch {
      setSubmitFailedNetwork(true);
      setErrorMsg('حدث انقطاع مؤقت في الشبكة. تم حفظ جميع إجاباتك محلياً؛ اضغط إعادة الإرسال.');
    } finally {
      setSubmitting(false);
    }
  }, [activeExam, firebaseUser, getIdToken, openLoginModal, startedAtMs, idempotencyKey, answers, fetchUserAttempts]);

  // Auto-submit if countdown reaches 0 and user is signed in
  useEffect(() => {
    if (
      activeExam &&
      !lastResult &&
      remainingSeconds === 0 &&
      startedAtMs > 0 &&
      !autoSubmittedRef.current &&
      firebaseUser
    ) {
      autoSubmittedRef.current = true;
      void handleSubmitExam();
    }
  }, [activeExam, lastResult, remainingSeconds, startedAtMs, firebaseUser, handleSubmitExam]);

  const handleEnqueueAiJob = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setBannerMsg(null);

    if (!firebaseUser) {
      openLoginModal();
      return;
    }

    if (aiTopic.trim().length < 2) {
      setErrorMsg('يرجى إدخال موضوع أو عنوان واضح لإنشاء الاختبار أو الملخص.');
      return;
    }

    setQueueingJob(true);
    try {
      const token = await getIdToken();
      if (!token) {
        openLoginModal();
        return;
      }
      const subject = subjects.find((s) => s.id === aiSubjectId);
      const res = await fetch('/api/ai/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: aiType,
          specializationId: subject?.specializationId || specializations[0]?.id || 'spec_general',
          academicYearId: subject?.academicYearId || 'yr_general',
          semesterId: subject?.semesterId || 'sem_general',
          subjectId: subject?.id || 'sub_general',
          subjectName: subject?.name || 'مقرر جامعي',
          sourceFileId: aiSourceFileId || undefined,
          topic: aiTopic.trim(),
          difficulty: aiDifficulty,
          questionCount: aiCount,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'تعذر جدولة المهمة في قائمة الانتظار.');
        return;
      }
      setBannerMsg('تمت إضافة المهمة إلى قائمة المعالجة بالذكاء الاصطناعي في الخلفية.');
      setAiTopic('');
      await fetchAiJobs();
    } catch {
      setErrorMsg('تعذر الاتصال بخدمة جدولة مهام الذكاء الاصطناعي.');
    } finally {
      setQueueingJob(false);
    }
  };

  const handleRetryAiJob = async (jobId: string) => {
    if (!firebaseUser) {
      openLoginModal();
      return;
    }
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch(`/api/ai/jobs/${encodeURIComponent(jobId)}/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setBannerMsg('تمت إعادة جدولة المهمة في قائمة المعالجة.');
        await fetchAiJobs();
      }
    } catch {
      setErrorMsg('تعذر إعادة تشغيل المهمة.');
    }
  };

  // --- ACTIVE EXAM RUNNER SCREEN ---
  if (activeExam) {
    const answeredCount = Object.keys(answers).length;
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="bg-[#0B2545] text-white rounded-3xl p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4 shadow-sm">
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => {
                setActiveExam(null);
                setLastResult(null);
              }}
              className="text-xs text-[#EAF4F7]/80 hover:text-white inline-flex items-center gap-1 mb-1"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              العودة إلى قائمة الاختبارات
            </button>
            <h1 className="font-display text-lg sm:text-2xl font-bold">{activeExam.title}</h1>
            <p className="text-xs text-[#EAF4F7]/80">
              {activeExam.subjectName || 'مقرر جامعي'} · {activeExam.questionCount} أسئلة ·{' '}
              {DIFFICULTY_LABELS[activeExam.difficulty]}
            </p>
          </div>

          {!lastResult && (
            <div className="flex items-center gap-3">
              <div className="px-4 py-2 rounded-2xl bg-white/10 text-center">
                <p className="text-[10px] text-[#EAF4F7]/75">تمت الإجابة</p>
                <p className="font-display text-base font-bold tabular-nums">
                  {answeredCount} / {activeExam.questions.length}
                </p>
              </div>
              <div
                className={`px-4 py-2 rounded-2xl text-center ${
                  remainingSeconds <= 60 ? 'bg-[#FF8066] text-white' : 'bg-[#00A6A6] text-white'
                }`}
              >
                <p className="text-[10px] opacity-90 flex items-center justify-center gap-1">
                  <Clock className="w-3 h-3" />
                  الوقت المتبقي
                </p>
                <p className="font-display text-base font-bold tabular-nums">
                  {formatCountdown(remainingSeconds)}
                </p>
              </div>
            </div>
          )}
        </div>

        {restoredDraftNotice && !lastResult && (
          <div
            role="status"
            className="rounded-2xl bg-[#EAF4F7] border border-[#00A6A6]/40 px-4 py-3 text-xs sm:text-sm text-[#0B2545] flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-[#00A6A6] shrink-0" />
            تم استرجاع إجاباتك المحفوظة محلياً تلقائياً مع الحفاظ على مفتاح عدم التكرار.
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="rounded-2xl bg-[#FF8066]/15 border border-[#FF8066]/40 px-4 py-3 text-sm text-[#0B2545] flex flex-wrap items-center justify-between gap-3"
          >
            <span className="flex items-center gap-2 font-medium">
              {submitFailedNetwork ? (
                <WifiOff className="w-4 h-4 text-[#FF8066] shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-[#FF8066] shrink-0" />
              )}
              {errorMsg}
            </span>
            {submitFailedNetwork && (
              <button
                type="button"
                onClick={handleSubmitExam}
                disabled={submitting}
                className="min-h-[38px] px-4 py-1.5 rounded-xl bg-[#00A6A6] text-white text-xs font-bold inline-flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                إعادة إرسال الإجابات
              </button>
            )}
          </div>
        )}

        {lastResult ? (
          <div className="space-y-5">
            <div className="bg-white rounded-3xl border border-slate-200 p-6 text-center space-y-3 shadow-xs">
              <div className="w-16 h-16 rounded-2xl bg-[#EAF4F7] text-[#00A6A6] mx-auto flex items-center justify-center">
                <Award className="w-8 h-8" />
              </div>
              <h2 className="font-display text-2xl font-bold text-[#0B2545]">
                تم تصحيح الاختبار وتسليم النتيجة
              </h2>
              <p className="font-display text-4xl font-extrabold text-[#00A6A6] tabular-nums">
                {lastResult.score} / {lastResult.totalQuestions} ({lastResult.percentage}%)
              </p>
              <p className="text-xs text-slate-500 tabular-nums">
                المدة المستغرقة: {lastResult.durationSeconds} ثانية · رقم المرجع:{' '}
                <span className="font-mono">{lastResult.idempotencyKey}</span>
              </p>
              <div className="pt-2 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveExam(null);
                    setLastResult(null);
                  }}
                  className="min-h-[42px] px-5 py-2 rounded-xl bg-[#0B2545] text-white text-sm font-semibold"
                >
                  تصفح اختبارات أخرى
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {activeExam.questions.map((q, idx) => {
                const fb = lastResult.feedback?.find((item) => item.questionId === q.id);
                return (
                  <div
                    key={q.id}
                    className={`rounded-2xl border p-4 sm:p-5 space-y-2.5 ${
                      fb?.isCorrect
                        ? 'bg-emerald-50/50 border-emerald-200'
                        : 'bg-rose-50/40 border-rose-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-display text-sm sm:text-base font-bold text-[#0B2545]">
                        {idx + 1}. {q.prompt}
                      </p>
                      {fb?.isCorrect ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                      ) : (
                        <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs sm:text-sm">
                      {q.options.map((opt, optIdx) => {
                        const isCorrect = fb?.correctIndex === optIdx;
                        const isSelected = fb?.selectedIndex === optIdx;
                        return (
                          <div
                            key={optIdx}
                            className={`px-3 py-2 rounded-xl border ${
                              isCorrect
                                ? 'bg-emerald-100/80 border-emerald-400 text-emerald-950 font-semibold'
                                : isSelected
                                  ? 'bg-rose-100/80 border-rose-300 text-rose-900'
                                  : 'bg-white border-slate-200 text-slate-600'
                            }`}
                          >
                            {opt}
                          </div>
                        );
                      })}
                    </div>
                    {fb?.explanation && (
                      <p className="text-xs text-slate-700 bg-white/80 rounded-xl px-3 py-2 border border-slate-200/70">
                        <span className="font-bold text-[#0B2545]">التوضيح الأكاديمي: </span>
                        {fb.explanation}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {activeExam.questions.map((q, idx) => (
              <section
                key={q.id}
                className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3"
              >
                <h2 className="font-display text-sm sm:text-base font-bold text-[#0B2545]">
                  {idx + 1}. {q.prompt}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {q.options.map((opt, optIdx) => {
                    const selected = answers[q.id] === optIdx;
                    return (
                      <button
                        key={optIdx}
                        type="button"
                        onClick={() =>
                          setAnswers((prev) => ({
                            ...prev,
                            [q.id]: optIdx,
                          }))
                        }
                        className={`min-h-[44px] text-right px-4 py-2.5 rounded-xl border text-xs sm:text-sm font-medium transition-colors ${
                          selected
                            ? 'bg-[#00A6A6] border-[#00A6A6] text-white font-semibold'
                            : 'bg-[#EAF4F7]/40 border-slate-200 hover:border-[#00A6A6] text-[#0B2545]'
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}

            <div className="sticky bottom-16 lg:bottom-4 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3 shadow-md">
              <p className="text-xs text-slate-600">
                يتم حفظ التقدم محلياً مع مفتاح منع تكرار التسليم ({idempotencyKey.slice(0, 14)}...)
              </p>
              <button
                type="button"
                disabled={submitting}
                onClick={handleSubmitExam}
                className="min-h-[44px] px-6 py-2.5 rounded-xl bg-[#FF8066] hover:bg-[#ef6e54] disabled:opacity-60 text-white text-sm font-bold inline-flex items-center gap-2 transition-colors"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    جاري التصحيح...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    تسليم الاختبار والتصحيح الفوري
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- MAIN EXAMS HUB ---
  return (
    <div className="space-y-6">
      <div className="bg-[#0B2545] text-white rounded-3xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-xs font-semibold text-[#EAF4F7]">
            <BrainCircuit className="w-4 h-4 text-[#00A6A6]" />
            منظومة الاختبارات التفاعلية وطابور الذكاء الاصطناعي المعزول
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">
            مركز الاختبارات والمراجعة الذكية
          </h1>
          <p className="text-xs sm:text-sm text-[#EAF4F7]/85 leading-relaxed">
            أدِّ اختبارات المقررات بمؤقت محلي خفيف وحفظ تلقائي للإجابات، أو أرسل طلب توليد اختبار أو ملخص من ملفات PDF عبر قائمة الانتظار غير المتزامنة دون التأثير على سرعة التصفح.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 shrink-0">
          {[
            { id: 'take', label: 'الاختبارات المتاحة', icon: <FileText className="w-4 h-4" /> },
            { id: 'ai_queue', label: 'مولد الذكاء الاصطناعي', icon: <Sparkles className="w-4 h-4" /> },
            { id: 'history', label: 'سجل نتائجي', icon: <Award className="w-4 h-4" /> },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as ExamsTab)}
              className={`min-h-[42px] px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors ${
                tab === item.id
                  ? 'bg-[#00A6A6] text-white'
                  : 'bg-white/10 hover:bg-white/20 text-white/90'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {bannerMsg && (
        <div
          role="status"
          className="rounded-2xl bg-[#EAF4F7] border border-[#00A6A6]/40 px-4 py-3 text-sm text-[#0B2545] flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-[#00A6A6] shrink-0" />
          {bannerMsg}
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="rounded-2xl bg-[#FF8066]/15 border border-[#FF8066]/40 px-4 py-3 text-sm text-[#0B2545] flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-[#FF8066] shrink-0" />
          {errorMsg}
        </div>
      )}

      {tab === 'take' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="exam-subject-filter" className="text-xs font-semibold text-[#0B2545]">
                تصفية حسب المادة:
              </label>
              <select
                id="exam-subject-filter"
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                className="min-h-[40px] px-3 rounded-xl border border-slate-200 bg-white text-sm"
              >
                <option value="all">جميع المقررات</option>
                {publishedSubjects.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => void fetchExamsCatalog()}
              className="min-h-[40px] px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-[#EAF4F7] text-xs font-semibold text-[#0B2545] inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              تحديث القائمة
            </button>
          </div>

          {loadingExams ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-44 rounded-2xl bg-[#EAF4F7]/60 animate-pulse" />
              ))}
            </div>
          ) : exams.length === 0 ? (
            <div className="rounded-2xl bg-[#EAF4F7]/70 p-8 text-center space-y-2">
              <p className="text-sm font-semibold text-[#0B2545]">
                لا توجد اختبارات مطابقة للتصفية الحالية.
              </p>
              <button
                type="button"
                onClick={() => setTab('ai_queue')}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#00A6A6] text-white text-xs font-semibold"
              >
                أنشئ اختباراً جديداً بالذكاء الاصطناعي
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {exams.map((exam) => (
                <article
                  key={exam.id}
                  className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between gap-4 hover:border-[#00A6A6] transition-colors shadow-xs"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 text-[11px] font-semibold">
                      <span className="px-2.5 py-0.5 rounded-lg bg-[#EAF4F7] text-[#0B2545]">
                        {exam.source === 'ai_generated' ? 'مولّد بالذكاء الاصطناعي' : 'بنك الأسئلة الرسمي'}
                      </span>
                      <span className="text-[#00A6A6]">{DIFFICULTY_LABELS[exam.difficulty]}</span>
                    </div>
                    <h2 className="font-display text-base font-bold text-[#0B2545] leading-snug">
                      {exam.title}
                    </h2>
                    {exam.description && (
                      <p className="text-xs text-slate-600 line-clamp-2">{exam.description}</p>
                    )}
                    <p className="text-xs text-slate-500 flex items-center gap-3 tabular-nums pt-1">
                      <span>{exam.questionCount} أسئلة</span>
                      <span>·</span>
                      <span>{exam.durationMinutes} دقيقة</span>
                      {exam.subjectName && (
                        <>
                          <span>·</span>
                          <span className="truncate">{exam.subjectName}</span>
                        </>
                      )}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => void startExamById(exam.id)}
                    className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-[#0B2545] hover:bg-[#00A6A6] text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                  >
                    <Play className="w-4 h-4" />
                    بدء الاختبار الآن
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'ai_queue' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleEnqueueAiJob}
            className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4 h-fit"
          >
            <h2 className="font-display text-lg font-bold text-[#0B2545] flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#00A6A6]" />
              جدولة مهمة ذكاء اصطناعي جديدة
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              تُعالج المهام في طابور خلفي مستقل لتفادي الضغط على الخوادم وتقليل استهلاك واجهة Gemini مع حفظ المخرجات في الكاش الموزع.
            </p>

            <div>
              <label htmlFor="ai-type" className="block text-xs font-semibold text-[#0B2545] mb-1">
                نوع المهمة
              </label>
              <select
                id="ai-type"
                value={aiType}
                onChange={(e) =>
                  setAiType(e.target.value as 'exam_generation' | 'pdf_summary')
                }
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
              >
                <option value="exam_generation">توليد اختبار تدريبي تفاعلي</option>
                <option value="pdf_summary">توليد ملخص وشرح أكاديمي مركز</option>
              </select>
            </div>

            <div>
              <label htmlFor="ai-subject" className="block text-xs font-semibold text-[#0B2545] mb-1">
                المقرر الدراسي
              </label>
              <select
                id="ai-subject"
                value={aiSubjectId}
                onChange={(e) => {
                  setAiSubjectId(e.target.value);
                  setAiSourceFileId('');
                }}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
              >
                {publishedSubjects.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="ai-source-pdf" className="block text-xs font-semibold text-[#0B2545] mb-1">
                ملف PDF مرجعي (اختياري)
              </label>
              <select
                id="ai-source-pdf"
                value={aiSourceFileId}
                onChange={(e) => setAiSourceFileId(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
              >
                <option value="">توليد بناءً على عنوان الموضوع فقط</option>
                {publishedPdfsForSelectedSubject.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="ai-topic" className="block text-xs font-semibold text-[#0B2545] mb-1">
                موضوع الاختبار أو التلخيص *
              </label>
              <input
                id="ai-topic"
                type="text"
                required
                value={aiTopic}
                onChange={(e) => setAiTopic(e.target.value)}
                placeholder="مثال: تشريح شبكية العين أو هياكل البيانات المتقدمة"
                className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm"
              />
            </div>

            {aiType === 'exam_generation' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ai-diff" className="block text-xs font-semibold text-[#0B2545] mb-1">
                    مستوى الصعوبة
                  </label>
                  <select
                    id="ai-diff"
                    value={aiDifficulty}
                    onChange={(e) => setAiDifficulty(e.target.value as ExamDifficulty)}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                  >
                    <option value="easy">أساسي</option>
                    <option value="medium">متوسط</option>
                    <option value="hard">متقدم</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="ai-count" className="block text-xs font-semibold text-[#0B2545] mb-1">
                    عدد الأسئلة
                  </label>
                  <input
                    id="ai-count"
                    type="number"
                    min={3}
                    max={10}
                    value={aiCount}
                    onChange={(e) => setAiCount(Number(e.target.value) || 5)}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm tabular-nums"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={queueingJob}
              className="w-full min-h-[44px] px-5 py-2.5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] disabled:opacity-60 text-white text-sm font-bold inline-flex items-center justify-center gap-2"
            >
              {queueingJob ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  جاري الجدولة...
                </>
              ) : (
                <>
                  <BrainCircuit className="w-4 h-4" />
                  إرسال إلى قائمة الانتظار
                </>
              )}
            </button>
          </form>

          <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-lg font-bold text-[#0B2545]">
                حالة مهام الذكاء الاصطناعي في الطابور
              </h2>
              <button
                type="button"
                onClick={() => void fetchAiJobs()}
                className="min-h-[36px] px-3 py-1 rounded-xl border border-slate-200 text-xs font-semibold text-[#0B2545] inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                تحديث
              </button>
            </div>

            {!firebaseUser ? (
              <div className="rounded-2xl bg-[#EAF4F7] p-6 text-center space-y-3">
                <p className="text-sm font-medium text-[#0B2545]">
                  سجّل الدخول بحساب Google لعرض ومراقبة مهامك في قائمة الذكاء الاصطناعي.
                </p>
                <button
                  type="button"
                  onClick={openLoginModal}
                  className="min-h-[40px] px-5 py-2 rounded-xl bg-[#00A6A6] text-white text-xs font-bold"
                >
                  المتابعة باستخدام Google
                </button>
              </div>
            ) : aiJobs.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">
                لم يتم جدولة أي مهام ذكاء اصطناعي بعد.
              </p>
            ) : (
              <div className="space-y-3">
                {aiJobs.map((job) => {
                  const st = JOB_STATUS_LABELS[job.status];
                  return (
                    <div
                      key={job.id}
                      className="rounded-2xl border border-slate-200 p-4 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="font-display text-sm font-bold text-[#0B2545]">
                            {job.topic}
                          </h3>
                          <p className="text-[11px] text-slate-500">
                            {job.subjectName} · {job.type === 'exam_generation' ? 'اختبار ذكي' : 'ملخص PDF'}
                            {job.cacheHit ? ' · استُرجع من الكاش' : ''}
                          </p>
                        </div>
                        <span
                          className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold ${st.badgeClass}`}
                        >
                          {st.label}
                        </span>
                      </div>

                      {job.status === 'failed' && (
                        <div className="flex flex-wrap items-center justify-between gap-2 bg-rose-50 rounded-xl px-3 py-2 text-xs text-rose-800">
                          <span>{job.errorMessage || 'تعذر إكمال المهمة.'}</span>
                          <button
                            type="button"
                            onClick={() => void handleRetryAiJob(job.id)}
                            className="px-3 py-1 rounded-lg bg-rose-600 text-white font-semibold inline-flex items-center gap-1"
                          >
                            <RotateCcw className="w-3 h-3" />
                            إعادة المحاولة
                          </button>
                        </div>
                      )}

                      {job.status === 'completed' && job.resultExamId && (
                        <button
                          type="button"
                          onClick={() => void startExamById(job.resultExamId!)}
                          className="min-h-[38px] px-4 py-1.5 rounded-xl bg-[#00A6A6] text-white text-xs font-bold inline-flex items-center gap-1.5"
                        >
                          <Play className="w-3.5 h-3.5" />
                          بدء الاختبار المولّد الآن
                        </button>
                      )}

                      {job.status === 'completed' && job.resultSummary && (
                        <div className="rounded-xl bg-[#EAF4F7]/60 p-3 text-xs text-[#0B2545] whitespace-pre-line leading-relaxed">
                          {job.resultSummary}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
          <h2 className="font-display text-lg font-bold text-[#0B2545]">سجل اختباراتك السابقة</h2>
          {!firebaseUser ? (
            <div className="rounded-2xl bg-[#EAF4F7] p-6 text-center space-y-3">
              <p className="text-sm font-medium text-[#0B2545]">
                سجّل الدخول لعرض سجل المحاولات والدرجات المحفوظة.
              </p>
              <button
                type="button"
                onClick={openLoginModal}
                className="min-h-[40px] px-5 py-2 rounded-xl bg-[#00A6A6] text-white text-xs font-bold"
              >
                المتابعة باستخدام Google
              </button>
            </div>
          ) : attempts.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">
              لم تسلم أي اختبار حتى الآن.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {attempts.map((att) => (
                <div
                  key={att.id}
                  className="py-3.5 flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <h3 className="font-display text-sm font-bold text-[#0B2545]">{att.examTitle}</h3>
                    <p className="text-xs text-slate-500 tabular-nums">
                      {new Date(att.submittedAt).toLocaleString('ar-YE')} · المدة {att.durationSeconds} ثانية
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="px-3 py-1 rounded-xl bg-[#EAF4F7] text-[#0B2545] text-sm font-bold tabular-nums">
                      {att.score} / {att.totalQuestions} ({att.percentage}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
