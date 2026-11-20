import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Database,
  FileWarning,
  HardDrive,
  Info,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserX,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import {
  SecurityCenterSnapshot,
  SecurityControlItem,
  SecurityControlStatus,
} from '../types/academic.ts';

type SecuritySectionTab =
  | 'overview'
  | 'auth'
  | 'files'
  | 'database'
  | 'ai'
  | 'backups'
  | 'alerts';

const STATUS_BADGE_MAP: Record<
  SecurityControlStatus,
  { label: string; className: string; icon: React.ReactNode }
> = {
  verified: {
    label: 'مفعل وموثق',
    className: 'bg-[#00A6A6]/15 text-[#008080] border-[#00A6A6]/30',
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-[#00A6A6]" />,
  },
  partial: {
    label: 'حماية جزئية (حدود مجانية)',
    className: 'bg-amber-50 text-amber-800 border-amber-200',
    icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />,
  },
  not_configured: {
    label: 'غير مهيأ بعد',
    className: 'bg-slate-100 text-slate-700 border-slate-200',
    icon: <Info className="w-3.5 h-3.5 text-slate-500" />,
  },
  not_verified: {
    label: 'لم يُختبر عملياً بعد',
    className: 'bg-[#FF8066]/15 text-[#b8442c] border-[#FF8066]/40',
    icon: <XCircle className="w-3.5 h-3.5 text-[#FF8066]" />,
  },
  unknown: {
    label: 'غير محدد',
    className: 'bg-slate-100 text-slate-600 border-slate-200',
    icon: <Info className="w-3.5 h-3.5 text-slate-500" />,
  },
};

const CATEGORY_LABEL_AR: Record<SecurityControlItem['category'], string> = {
  auth: 'الهوية والجلسات',
  rbac: 'الصلاحيات والعزل',
  database: 'قاعدة البيانات RLS',
  files: 'فحص الملفات والرفع',
  storage: 'التخزين السحابي R2',
  ai: 'أمان الذكاء الاصطناعي',
  backups: 'النسخ الاحتياطي والاستعادة',
  api: 'حماية API والترويسات',
};

export function SecurityCenterPanel({ onToast }: { onToast: (msg: string) => void }) {
  const { getIdToken, isSuperAdmin } = useAuth();
  const { users, backups, refreshBackups, refreshAuditLogs } = usePlatformData();
  const [snapshot, setSnapshot] = useState<SecurityCenterSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<SecuritySectionTab>('overview');
  const [revokingUid, setRevokingUid] = useState<string | null>(null);
  const [verifyingBackupId, setVerifyingBackupId] = useState<string | null>(null);

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('يرجى تسجيل الدخول بحساب المالك الرئيسي.');
      const res = await fetch('/api/admin/security-center', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'تعذر قراءة بيانات مركز الأمان.');
      setSnapshot(body.snapshot as SecurityCenterSnapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تحميل مركز الحماية والأمان.');
    } finally {
      setLoading(false);
    }
  }, [getIdToken]);

  useEffect(() => {
    if (isSuperAdmin) {
      void loadSnapshot();
    }
  }, [isSuperAdmin, loadSnapshot]);

  const handleRevokeUserSessions = async (uid: string, email: string) => {
    setRevokingUid(uid);
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch(`/api/admin/users/${encodeURIComponent(uid)}/revoke-sessions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'تعذر إبطال جلسات الحساب.');
      onToast(`تم إبطال كافة جلسات ${email} وإلزامه بتسجيل دخول جديد.`);
      await Promise.all([loadSnapshot(), refreshAuditLogs()]);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'فشل إبطال الجلسات.');
    } finally {
      setRevokingUid(null);
    }
  };

  const handleVerifyLatestBackup = async (backupId: string) => {
    setVerifyingBackupId(backupId);
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch(`/api/backups/${encodeURIComponent(backupId)}/verify-restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'تعذر التحقق من النسخة الاحتياطية.');
      onToast(
        body.ok
          ? 'نجح اختبار سلامة واستعادة النسخة الاحتياطية وتطابقت بصمة SHA-256.'
          : 'رصد اختبار الاستعادة خللاً في سلامة النسخة الاحتياطية!'
      );
      await Promise.all([loadSnapshot(), refreshBackups(), refreshAuditLogs()]);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'فشل اختبار التحقق من النسخة.');
    } finally {
      setVerifyingBackupId(null);
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="bg-white rounded-2xl border border-[#FF8066]/40 p-6 text-center space-y-2">
        <ShieldAlert className="w-8 h-8 text-[#FF8066] mx-auto" />
        <p className="font-display font-bold text-[#0B2545]">
          مركز الحماية والأمان متاح للمدير الرئيسي (Super Admin) فقط
        </p>
      </div>
    );
  }

  const latestBackup = backups[0] || null;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <section className="bg-[#0B2545] text-white rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-[#00A6A6] shrink-0" />
            <h2 className="font-display text-lg sm:text-xl font-bold">
              مركز الحماية والأمان الشامل (الطبقة المجانية)
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-white/80 max-w-2xl leading-relaxed">
            يعرض هذا المركز الحالة الحقيقية والمدعومة بالاختبار لكل ضابط أمني في الخادم وقاعدة البيانات والتخزين والذكاء الاصطناعي دون أي مؤشرات شكلية.
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadSnapshot()}
          disabled={loading}
          className="min-h-[42px] px-4 py-2 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 shrink-0 disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          تحديث الفحص الأمني
        </button>
      </section>

      {/* Navigation Pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {(
          [
            { id: 'overview', label: 'نظرة عامة والضوابط', icon: <ShieldCheck className="w-4 h-4" /> },
            { id: 'auth', label: 'الحسابات والجلسات', icon: <KeyRound className="w-4 h-4" /> },
            { id: 'files', label: 'الملفات والتخزين R2', icon: <HardDrive className="w-4 h-4" /> },
            { id: 'database', label: 'قواعد البيانات RLS', icon: <Database className="w-4 h-4" /> },
            { id: 'ai', label: 'جدار Gemini AI', icon: <Sparkles className="w-4 h-4" /> },
            { id: 'backups', label: 'النسخ والاستعادة', icon: <Archive className="w-4 h-4" /> },
            {
              id: 'alerts',
              label: `التنبيهات والأحداث (${snapshot?.alerts.length ?? 0})`,
              icon: <AlertTriangle className="w-4 h-4" />,
            },
          ] as Array<{ id: SecuritySectionTab; label: string; icon: React.ReactNode }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSection(tab.id)}
            className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 border transition-colors ${
              section === tab.id
                ? 'bg-[#0B2545] text-white border-[#0B2545]'
                : 'bg-white text-[#0B2545] border-slate-200 hover:bg-[#EAF4F7]'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-[#FF8066]/15 border border-[#FF8066]/40 p-4 text-sm text-[#0B2545] font-medium"
        >
          {error}
        </div>
      )}

      {loading && !snapshot ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
          جاري فحص حالة الحماية والضوابط الفعلية...
        </div>
      ) : snapshot ? (
        <>
          {/* SECTION 1: OVERVIEW & VERIFIED CONTROLS */}
          {section === 'overview' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="bg-white rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">ضوابط موثقة بالتحقق</p>
                  <p className="font-display text-2xl font-bold text-[#00A6A6] mt-1 tabular-nums">
                    {snapshot.controls.filter((c) => c.status === 'verified').length} /{' '}
                    {snapshot.controls.length}
                  </p>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">تنبيهات أمنية نشطة</p>
                  <p className="font-display text-2xl font-bold text-[#FF8066] mt-1 tabular-nums">
                    {snapshot.alerts.length}
                  </p>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">ملفات مرفوضة (Magic Bytes)</p>
                  <p className="font-display text-2xl font-bold text-[#0B2545] mt-1 tabular-nums">
                    {snapshot.fileStats.rejectedUploadsCount}
                  </p>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">محاولات حقن AI المحجوبة</p>
                  <p className="font-display text-2xl font-bold text-[#0B2545] mt-1 tabular-nums">
                    {snapshot.aiStats.blockedPromptInjections}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {snapshot.controls.map((ctrl) => {
                  const badge = STATUS_BADGE_MAP[ctrl.status];
                  return (
                    <div
                      key={ctrl.id}
                      className="bg-white rounded-2xl border border-slate-200 p-5 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-[11px] font-semibold text-[#00A6A6]">
                            {CATEGORY_LABEL_AR[ctrl.category]}
                          </span>
                          <h3 className="font-display text-sm font-bold text-[#0B2545] mt-0.5">
                            {ctrl.title}
                          </h3>
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-semibold shrink-0 ${badge.className}`}
                        >
                          {badge.icon}
                          {badge.label}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{ctrl.detail}</p>
                      {ctrl.limitationNote && (
                        <p className="text-[11px] bg-amber-50/90 border border-amber-200/80 text-amber-900 rounded-xl px-3 py-2 leading-relaxed">
                          قيد الطبقة المجانية: {ctrl.limitationNote}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SECTION 2: AUTH & SESSION REVOCATION */}
          {section === 'auth' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: 'المستخدمون المسجلون', value: snapshot.authStats.totalRegisteredUsers },
                  { label: 'المديرون الرئيسيون', value: snapshot.authStats.superAdmins },
                  { label: 'مشرفو التخصص النشطون', value: snapshot.authStats.scopedAdminsActive },
                  { label: 'المشرفون المعلقون', value: snapshot.authStats.scopedAdminsSuspended },
                  { label: 'المدققون (Moderators)', value: snapshot.authStats.moderators },
                  { label: 'سجلات إبطال الجلسات', value: snapshot.authStats.revokedSessionUsers },
                ].map((stat) => (
                  <div key={stat.label} className="bg-white rounded-2xl border border-slate-200 p-4">
                    <p className="text-[11px] text-slate-500">{stat.label}</p>
                    <p className="font-display text-xl font-bold text-[#0B2545] mt-1 tabular-nums">
                      {stat.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
                <div className="px-5 py-3.5 border-b border-slate-100">
                  <h3 className="font-display text-sm font-bold text-[#0B2545]">
                    إبطال الجلسات القسري للحسابات النشطة (Session Revocation)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    يفرض على المستخدم إعادة تسجيل الدخول عبر Google ويلغي أي رموز مصادقة صادرة قبل لحظة الإبطال.
                  </p>
                </div>
                <table className="w-full text-right text-sm">
                  <thead className="bg-[#EAF4F7]/70 text-xs font-semibold text-[#0B2545]">
                    <tr>
                      <th className="p-3.5">المستخدم</th>
                      <th className="p-3.5">البريد الإلكتروني</th>
                      <th className="p-3.5">الدور</th>
                      <th className="p-3.5">إجراء الأمان</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.slice(0, 30).map((u) => (
                      <tr key={u.uid} className="hover:bg-slate-50/70">
                        <td className="p-3.5 text-xs font-bold text-[#0B2545]">{u.displayName}</td>
                        <td className="p-3.5 text-xs font-mono text-slate-600">{u.email}</td>
                        <td className="p-3.5 text-xs font-semibold text-[#00A6A6]">{u.role}</td>
                        <td className="p-3.5">
                          <button
                            type="button"
                            disabled={revokingUid === u.uid}
                            onClick={() => handleRevokeUserSessions(u.uid, u.email)}
                            className="min-h-[34px] px-3 py-1 rounded-lg bg-[#FF8066]/15 hover:bg-[#FF8066] text-[#0B2545] hover:text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                          >
                            <UserX className="w-3.5 h-3.5" />
                            {revokingUid === u.uid ? 'جاري الإبطال...' : 'إبطال كافة الجلسات'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SECTION 3: FILE & R2 STORAGE SECURITY */}
          {section === 'files' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-2">
                <FileWarning className="w-5 h-5 text-[#00A6A6]" />
                <h3 className="font-display text-base font-bold text-[#0B2545]">
                  حماية الملفات المرفوعة والتخزين السحابي
                </h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 text-xs">
                <div className="rounded-xl bg-[#EAF4F7]/70 p-4 space-y-1">
                  <p className="text-slate-500">فحص البصمة الثنائية (Magic Bytes)</p>
                  <p className="font-bold text-[#0B2545]">مفعل في مساري الرفع المباشر والعادي</p>
                </div>
                <div className="rounded-xl bg-[#EAF4F7]/70 p-4 space-y-1">
                  <p className="text-slate-500">مهلة الروابط الموقعة (Signed URLs)</p>
                  <p className="font-bold text-[#0B2545] tabular-nums">
                    {snapshot.fileStats.signedUrlTtlSeconds} ثانية (5 دقائق)
                  </p>
                </div>
                <div className="rounded-xl bg-[#EAF4F7]/70 p-4 space-y-1">
                  <p className="text-slate-500">حالة Cloudflare R2 Worker</p>
                  <p className="font-bold text-[#0B2545]">
                    {snapshot.fileStats.r2Configured
                      ? 'مهيأ ومتصل (Private + CORS صارم)'
                      : 'غير مهيأ (تخزين خادم محلي محمي)'}
                  </p>
                </div>
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-1">
                  <p className="text-amber-800">فحص الفيروسات الخادمي (Antivirus)</p>
                  <p className="font-bold text-amber-900">
                    غير متوفر على الطبقة المجانية (لا يوجد ClamAV)
                  </p>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                الامتدادات المسموحة حالياً:{' '}
                <span className="font-mono font-semibold text-[#0B2545]">
                  {snapshot.fileStats.allowedExtensions.join(', ')}
                </span>{' '}
                · الحد الأقصى للحجم: {snapshot.fileStats.maxFileSizeMB} ميجابايت · ملفات ZIP:{' '}
                {snapshot.fileStats.allowZipUploads ? 'مسموحة' : 'مغلقة'} · إجمالي الملفات المرفوضة أمنياً:{' '}
                <span className="font-bold text-[#FF8066]">{snapshot.fileStats.rejectedUploadsCount}</span>.
              </p>
            </div>
          )}

          {/* SECTION 4: DATABASE & RLS */}
          {section === 'database' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-3">
              <div className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-[#00A6A6]" />
                <h3 className="font-display text-base font-bold text-[#0B2545]">
                  حماية قاعدة البيانات وسياسات العزل (Firestore Rules & PostgreSQL RLS)
                </h3>
              </div>
              <ul className="space-y-2 text-xs text-slate-700 leading-relaxed list-disc list-inside">
                <li>
                  عزل بيانات الطلاب: يمنع كل مستخدم من قراءة أو تعديل مستندات{' '}
                  <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">users/{'{uid}'}</code>{' '}
                  أو المفضلة أو{' '}
                  <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">examAttempts</code> الخاصة بغيره.
                </li>
                <li>
                  منع تصعيد الصلاحيات (Privilege Escalation): قاعدة البيانات تمنع تعديل حقول{' '}
                  <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">role</code> و{' '}
                  <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">permissions</code>{' '}
                  و{' '}
                  <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">assignedSpecializationId</code>{' '}
                  من قِبل الطالب أو المشرف التخصصي.
                </li>
                <li>
                  سجلات النشاط{' '}
                  <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">activityLogs</code>{' '}
                  غير قابلة للتعديل أو الحذف نهائياً (<code className="font-mono">allow update, delete: if false</code>)، وتمر بنظام تنقيح تلقائي لإخفاء الرموز السرية قبل التخزين.
                </li>
                <li>
                  ملفات المحاضرات{' '}
                  <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">lectureFiles</code>{' '}
                  والروابط المركزية محصورة كتابتها وتعديلها وحذفها بالمدير الرئيسي فقط في قواعد Firestore وCloud Storage.
                </li>
              </ul>
            </div>
          )}

          {/* SECTION 5: GEMINI AI SAFETY */}
          {section === 'ai' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#00A6A6]" />
                <h3 className="font-display text-base font-bold text-[#0B2545]">
                  حماية Gemini API وجدار حقن الأوامر (Prompt Injection Firewall)
                </h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 text-xs">
                <div className="rounded-xl bg-[#EAF4F7]/70 p-4">
                  <p className="text-slate-500">حالة مفتاح GEMINI_API_KEY</p>
                  <p className="font-bold text-[#0B2545] mt-1">
                    {snapshot.aiStats.geminiKeyConfigured ? 'مهيأ (خادمي فقط 100%)' : 'غير مهيأ'}
                  </p>
                </div>
                <div className="rounded-xl bg-[#EAF4F7]/70 p-4">
                  <p className="text-slate-500">الاستهلاك اليومي العام</p>
                  <p className="font-bold text-[#0B2545] mt-1 tabular-nums">
                    {snapshot.aiStats.todayRequests} / {snapshot.aiStats.dailyGlobalLimit} طلب
                  </p>
                </div>
                <div className="rounded-xl bg-[#EAF4F7]/70 p-4">
                  <p className="text-slate-500">الحد اليومي للطالب</p>
                  <p className="font-bold text-[#0B2545] mt-1 tabular-nums">
                    {snapshot.aiStats.dailyUserLimit} طلب / يوم
                  </p>
                </div>
                <div className="rounded-xl bg-[#FF8066]/10 border border-[#FF8066]/30 p-4">
                  <p className="text-[#0B2545]">محاولات الحقن المحجوبة</p>
                  <p className="font-bold text-[#FF8066] mt-1 tabular-nums">
                    {snapshot.aiStats.blockedPromptInjections}
                  </p>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                لا يُدرج مفتاح Gemini في حزمة الواجهة مطلقاً. كما يتحقق الخادم من أن أي ملف مرجعي{' '}
                <code className="font-mono">sourceFileId</code> منشور وغير محذوف قبل استخراج نصه، ويحيط المقتطفات بوسوم{' '}
                <code className="font-mono">&lt;untrusted_lecture_reference&gt;</code> مع حد مخرجات 2048 توكن.
              </p>
            </div>
          )}

          {/* SECTION 6: BACKUPS & VERIFICATION */}
          {section === 'backups' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-bold text-[#0B2545]">
                    حالة النسخ الاحتياطي واختبار الاستعادة الحقيقي
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {snapshot.backupStats.freeTierLimitation}
                  </p>
                </div>
                {latestBackup && (
                  <button
                    type="button"
                    disabled={verifyingBackupId === latestBackup.id}
                    onClick={() => handleVerifyLatestBackup(latestBackup.id)}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs font-semibold inline-flex items-center gap-2 shrink-0 disabled:opacity-60"
                  >
                    <Activity className="w-4 h-4" />
                    {verifyingBackupId === latestBackup.id
                      ? 'جاري التحقق من SHA-256...'
                      : 'تنفيذ اختبار استعادة على آخر نسخة'}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 text-xs">
                <div className="rounded-xl bg-[#EAF4F7]/70 p-4">
                  <p className="text-slate-500">إجمالي النسخ المسجلة</p>
                  <p className="font-bold text-[#0B2545] mt-1 tabular-nums">
                    {snapshot.backupStats.totalBackups}
                  </p>
                </div>
                <div className="rounded-xl bg-[#EAF4F7]/70 p-4">
                  <p className="text-slate-500">تاريخ آخر نسخة</p>
                  <p className="font-bold text-[#0B2545] mt-1">
                    {snapshot.backupStats.lastBackupAt
                      ? new Date(snapshot.backupStats.lastBackupAt).toLocaleString('ar-EG')
                      : 'لا توجد نسخ بعد'}
                  </p>
                </div>
                <div className="rounded-xl bg-[#EAF4F7]/70 p-4">
                  <p className="text-slate-500">نتيجة آخر اختبار استعادة فعلي</p>
                  <p className="font-bold text-[#0B2545] mt-1">
                    {snapshot.backupStats.lastVerifiedStatus === 'verified'
                      ? 'موثق وناجح'
                      : snapshot.backupStats.lastVerifiedStatus === 'failed'
                        ? 'فشل الاختبار!'
                        : 'لم يُختبر الاسترداد بعد'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 7: ALERTS & SECURITY EVENTS */}
          {section === 'alerts' && (
            <div className="space-y-4">
              {snapshot.alerts.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-sm text-slate-600">
                  لا توجد تنبيهات أمنية حرجة مسجلة في السجل الحالي.
                </div>
              ) : (
                <div className="space-y-3">
                  {snapshot.alerts.map((al) => (
                    <div
                      key={al.id}
                      className={`rounded-2xl border p-4 flex items-start justify-between gap-3 ${
                        al.severity === 'high' || al.severity === 'critical'
                          ? 'bg-[#FF8066]/10 border-[#FF8066]/40'
                          : 'bg-amber-50 border-amber-200'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-[#FF8066]" />
                          <h4 className="font-display text-sm font-bold text-[#0B2545]">
                            {al.title}
                          </h4>
                        </div>
                        <p className="text-xs text-slate-700">{al.detail}</p>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500 shrink-0">
                        العدد: {al.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
                <div className="px-5 py-3.5 border-b border-slate-100">
                  <h3 className="font-display text-sm font-bold text-[#0B2545]">
                    أحدث الأحداث الأمنية المفلترة (من سجل المراجعة المنقح)
                  </h3>
                </div>
                <table className="w-full text-right text-xs">
                  <thead className="bg-[#EAF4F7]/70 font-semibold text-[#0B2545]">
                    <tr>
                      <th className="p-3">الإجراء</th>
                      <th className="p-3">المنفذ</th>
                      <th className="p-3">النتيجة</th>
                      <th className="p-3">التوقيت</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {snapshot.recentSecurityEvents.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-6 text-center text-slate-500">
                          لا توجد أحداث أمنية مسجلة حتى الآن.
                        </td>
                      </tr>
                    ) : (
                      snapshot.recentSecurityEvents.map((ev) => (
                        <tr key={ev.id}>
                          <td className="p-3 font-semibold text-[#0B2545]">{ev.action}</td>
                          <td className="p-3 font-mono text-slate-600">{ev.actorEmail}</td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded font-semibold ${
                                ev.result === 'denied' || ev.result === 'failed'
                                  ? 'bg-[#FF8066]/15 text-[#b8442c]'
                                  : 'bg-[#00A6A6]/15 text-[#008080]'
                              }`}
                            >
                              {ev.result || 'success'}
                            </span>
                          </td>
                          <td className="p-3 text-slate-500 tabular-nums">
                            {new Date(String(ev.createdAt)).toLocaleString('ar-EG')}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
