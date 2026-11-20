import React, { useEffect, useState } from 'react';
import {
  Calendar,
  Clock,
  Cloud,
  Crown,
  Download,
  Eye,
  Heart,
  LogIn,
  LogOut,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  User,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import { GoogleDocsWorkspacePanel } from './GoogleDocsWorkspacePanel.tsx';
import { PWAInstallButton } from './PWAInstallButton.tsx';
import { LectureFile, ROLE_LABELS_AR } from '../types/academic.ts';
import {
  canDownloadFile,
  canPreviewInApp,
  formatFileSizeArabic,
  getGoogleDriveDownloadUrl,
  getPublishedSpecializations,
  getYearsForSpecialization,
  isGoogleDriveFile,
} from '../utils/academicLogic.ts';

function formatAccountDate(raw: unknown): string {
  if (!raw) return 'غير مسجل';
  if (typeof raw === 'string') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString('ar-EG');
  }
  if (typeof raw === 'object' && raw !== null && 'seconds' in raw) {
    const sec = Number((raw as { seconds: number }).seconds);
    return new Date(sec * 1000).toLocaleDateString('ar-EG');
  }
  return 'حديثاً';
}

export function ProfileView({
  onOpenAdmin,
  onPreviewFile,
  initialFocusFavorites = false,
}: {
  onOpenAdmin: () => void;
  onPreviewFile: (file: LectureFile) => void;
  initialFocusFavorites?: boolean;
}) {
  const {
    firebaseUser,
    profile,
    role,
    accountStatus,
    isSuperAdmin,
    isStaff,
    authLoading,
    authError,
    favoriteIds,
    openLoginModal,
    logout,
    getIdToken,
    toggleFavorite,
    updateProfileInfo,
  } = useAuth();
  const { specializations, academicYears, lectureFiles, subjects } = usePlatformData();

  const [displayNameInput, setDisplayNameInput] = useState(
    profile?.displayName || firebaseUser?.displayName || ''
  );
  const [prefSpecId, setPrefSpecId] = useState(profile?.specializationId || '');
  const [prefYearId, setPrefYearId] = useState(profile?.academicYearId || '');
  const [savedNotice, setSavedNotice] = useState(false);
  const [privacyNotice, setPrivacyNotice] = useState<string | null>(null);
  const [privacyBusy, setPrivacyBusy] = useState<'logout_all' | 'export' | 'delete' | null>(null);
  const [confirmSelfDelete, setConfirmSelfDelete] = useState(false);

  useEffect(() => {
    setDisplayNameInput(profile?.displayName || firebaseUser?.displayName || '');
    setPrefSpecId(profile?.specializationId || '');
    setPrefYearId(profile?.academicYearId || '');
  }, [profile, firebaseUser]);

  const publishedSpecs = getPublishedSpecializations(specializations);
  const yearsForSpec = prefSpecId
    ? getYearsForSpecialization(academicYears, prefSpecId)
    : [];

  const favoriteFiles = lectureFiles.filter(
    (f) => f.status === 'published' && f.lifecycleStatus !== 'trashed' && favoriteIds.has(f.id)
  );

  const handleSavePrefs = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateProfileInfo({
      displayName: displayNameInput || profile?.displayName || 'طالب UST',
      specializationId: prefSpecId,
      academicYearId: prefYearId,
    });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  const handleLogoutAllDevices = async () => {
    setPrivacyBusy('logout_all');
    setPrivacyNotice(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('يرجى تسجيل الدخول أولاً.');
      const res = await fetch('/api/auth/logout-all', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'تعذر إبطال الجلسات.');
      setPrivacyNotice('تم إبطال جميع جلسات الدخول على الأجهزة الأخرى. سيتم تسجيل خروجك الآن.');
      setTimeout(() => {
        void logout();
      }, 900);
    } catch (err) {
      setPrivacyNotice(err instanceof Error ? err.message : 'حدث خطأ أثناء إبطال الجلسات.');
    } finally {
      setPrivacyBusy(null);
    }
  };

  const handleExportMyData = async () => {
    setPrivacyBusy('export');
    setPrivacyNotice(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('يرجى تسجيل الدخول أولاً.');
      const res = await fetch('/api/auth/me/export', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'تعذر تصدير بياناتك.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ust-my-data.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setPrivacyNotice('تم تصدير نسخة JSON من بيانات حسابك ومحاولات الاختبارات بنجاح.');
    } catch (err) {
      setPrivacyNotice(err instanceof Error ? err.message : 'تعذر تصدير البيانات.');
    } finally {
      setPrivacyBusy(null);
    }
  };

  const handleConfirmDeleteAccount = async () => {
    setPrivacyBusy('delete');
    setPrivacyNotice(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('يرجى تسجيل الدخول أولاً.');
      const res = await fetch('/api/auth/me', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'تعذر حذف بيانات الحساب.');
      setConfirmSelfDelete(false);
      await logout();
    } catch (err) {
      setPrivacyNotice(err instanceof Error ? err.message : 'تعذر حذف الحساب.');
      setConfirmSelfDelete(false);
    } finally {
      setPrivacyBusy(null);
    }
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Account Card */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
        {!firebaseUser ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-[#EAF4F7] text-[#0B2545] flex items-center justify-center shrink-0">
                <User className="w-7 h-7" />
              </div>
              <div>
                <h1 className="font-display text-xl font-bold text-[#0B2545]">
                  حساب الطالب والمفضلة
                </h1>
                <p className="text-sm text-slate-600 mt-1">
                  سجّل الدخول بحساب Google لحفظ المحاضرات في المفضلة وتحديد تخصصك الدراسي.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <PWAInstallButton />
              <button
                type="button"
                onClick={openLoginModal}
                disabled={authLoading}
                className="min-h-[46px] px-5 py-2.5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
              >
                <LogIn className="w-4 h-4" />
                المتابعة باستخدام Google
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {accountStatus === 'suspended' && (
              <div
                role="alert"
                className="rounded-xl bg-[#FF8066]/15 border border-[#FF8066]/40 px-4 py-3 text-sm text-[#0B2545] flex items-center gap-2 font-semibold"
              >
                <ShieldAlert className="w-5 h-5 text-[#FF8066] shrink-0" />
                تم تعليق صلاحيات هذا الحساب من قبل إدارة المنصة.
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                {profile?.photoURL || firebaseUser.photoURL ? (
                  <img
                    src={profile?.photoURL || firebaseUser.photoURL || ''}
                    alt={profile?.displayName || firebaseUser.displayName || ''}
                    referrerPolicy="no-referrer"
                    className="w-14 h-14 rounded-2xl object-cover border border-slate-200 shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-2xl bg-[#0B2545] text-white flex items-center justify-center font-display text-xl font-bold shrink-0">
                    {(profile?.displayName || 'ط')[0]}
                  </div>
                )}
                <div className="min-w-0">
                  <h1 className="font-display text-xl font-bold text-[#0B2545] truncate">
                    {profile?.displayName || firebaseUser.displayName}
                  </h1>
                  <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span className="font-mono">{firebaseUser.email}</span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 font-semibold text-[#00A6A6]">
                      {isSuperAdmin && <Crown className="w-3.5 h-3.5 text-[#FF8066]" />}
                      {ROLE_LABELS_AR[role]}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className={accountStatus === 'suspended' ? 'text-[#FF8066] font-bold' : 'text-emerald-600 font-semibold'}>
                      {accountStatus === 'suspended' ? 'معلق' : 'نشط'}
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <PWAInstallButton />
                {isStaff && (
                  <button
                    type="button"
                    onClick={onOpenAdmin}
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0B2545] hover:bg-[#133866] text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap"
                  >
                    <ShieldCheck className="w-4 h-4 text-[#00A6A6]" />
                    فتح لوحة الإدارة
                  </button>
                )}
                <button
                  type="button"
                  onClick={logout}
                  disabled={authLoading}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 hover:border-[#FF8066] text-[#0B2545] hover:text-[#FF8066] text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap"
                >
                  <LogOut className="w-4 h-4" />
                  تسجيل الخروج
                </button>
              </div>
            </div>

            {/* Verified Google Metadata Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3">
                <p className="text-slate-500 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-[#00A6A6]" />
                  تاريخ إنشاء الحساب
                </p>
                <p className="font-semibold text-[#0B2545] mt-1">
                  {formatAccountDate(profile?.createdAt || firebaseUser.metadata.creationTime)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3">
                <p className="text-slate-500 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#00A6A6]" />
                  آخر تسجيل دخول
                </p>
                <p className="font-semibold text-[#0B2545] mt-1">
                  {formatAccountDate(profile?.lastLoginAt || firebaseUser.metadata.lastSignInTime)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3">
                <p className="text-slate-500">معرف حساب Google الموثق</p>
                <p className="font-mono text-[11px] font-semibold text-[#0B2545] mt-1 truncate">
                  {profile?.googleSub || firebaseUser.uid}
                </p>
              </div>
            </div>

            {/* Profile Info & Academic Preference Form */}
            <form
              onSubmit={handleSavePrefs}
              className="bg-[#EAF4F7]/70 rounded-2xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end"
            >
              <div>
                <label htmlFor="prof-name" className="block text-xs font-semibold text-[#0B2545] mb-1.5">
                  الاسم المعروض
                </label>
                <input
                  id="prof-name"
                  type="text"
                  value={displayNameInput}
                  onChange={(e) => setDisplayNameInput(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl bg-white border border-slate-200 text-sm text-[#0B2545]"
                />
              </div>

              <div>
                <label htmlFor="pref-spec" className="block text-xs font-semibold text-[#0B2545] mb-1.5">
                  التخصص المفضل
                </label>
                <select
                  id="pref-spec"
                  value={prefSpecId}
                  onChange={(e) => {
                    setPrefSpecId(e.target.value);
                    setPrefYearId('');
                  }}
                  className="w-full min-h-[44px] px-3 rounded-xl bg-white border border-slate-200 text-sm text-[#0B2545]"
                >
                  <option value="">اختر تخصصك</option>
                  {publishedSpecs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="pref-year" className="block text-xs font-semibold text-[#0B2545] mb-1.5">
                  السنة الدراسية
                </label>
                <select
                  id="pref-year"
                  value={prefYearId}
                  disabled={!prefSpecId}
                  onChange={(e) => setPrefYearId(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl bg-white border border-slate-200 text-sm text-[#0B2545] disabled:opacity-50"
                >
                  <option value="">اختر السنة الدراسية</option>
                  {yearsForSpec.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-sm font-semibold transition-colors whitespace-nowrap"
                >
                  حفظ البيانات
                </button>
                {savedNotice && (
                  <span role="status" className="text-xs font-semibold text-[#00A6A6]">
                    تم الحفظ
                  </span>
                )}
              </div>
            </form>
          </div>
        )}

        {authError && (
          <p role="alert" className="text-sm text-[#FF8066] font-medium">
            {authError}
          </p>
        )}
      </section>

      {/* Favorites Section */}
      <section
        id="favorites-section"
        className={`bg-white rounded-2xl border p-6 space-y-4 ${
          initialFocusFavorites ? 'border-[#00A6A6]' : 'border-slate-200'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-[#0B2545] flex items-center gap-2">
            <Heart className="w-5 h-5 text-[#FF8066]" />
            المحاضرات المحفوظة في المفضلة ({favoriteFiles.length})
          </h2>
        </div>

        {!firebaseUser ? (
          <p className="text-sm text-slate-500 py-6 text-center">
            قم بتسجيل الدخول لعرض المحاضرات والملفات التي قمت بحفظها في المفضلة.
          </p>
        ) : favoriteFiles.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">
            لم تقم بحفظ أي محاضرات في المفضلة بعد. اضغط على رمز القلب بجانب أي محاضرة لحفظها هنا.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {favoriteFiles.map((file) => {
              const sub = subjects.find((s) => s.id === file.subjectId);
              const isDrive = isGoogleDriveFile(file);
              const previewable = canPreviewInApp(file.fileExt, file.mimeType, file);
              const downloadable = canDownloadFile(file, isStaff);
              const downloadHref = isDrive
                ? getGoogleDriveDownloadUrl(file) || file.externalUrl || '#'
                : `/api/files/download/${encodeURIComponent(file.id)}`;
              return (
                <div
                  key={file.id}
                  className="py-3.5 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <h3 className="text-sm font-bold text-[#0B2545] truncate">
                        {file.title}
                      </h3>
                      {isDrive && (
                        <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#EAF4F7] text-[#0B2545] text-[10px] font-semibold">
                          <Cloud className="w-3 h-3 text-[#00A6A6]" />
                          Drive
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                      <span>{sub?.name}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {isDrive && (!file.fileSize || file.fileSize <= 0)
                          ? 'رابط سحابي'
                          : formatFileSizeArabic(file.fileSize)}
                      </span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {previewable && (
                      <button
                        type="button"
                        onClick={() => onPreviewFile(file)}
                        className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#EAF4F7] text-[#0B2545] text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        معاينة
                      </button>
                    )}
                    {downloadable && (
                      <a
                        href={downloadHref}
                        download={isDrive ? undefined : file.originalName}
                        target={isDrive ? '_blank' : undefined}
                        rel={isDrive ? 'noopener noreferrer' : undefined}
                        className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#00A6A6] text-white text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        تحميل
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleFavorite(file.id, file.subjectId)}
                      aria-label={`إزالة ${file.title} من المفضلة`}
                      className="min-h-[38px] min-w-[38px] rounded-xl border border-slate-200 text-slate-400 hover:text-[#FF8066] flex items-center justify-center"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Google Docs Study Workspace */}
      <GoogleDocsWorkspacePanel />

      {/* Privacy, Data Control & Multi-Device Session Security */}
      {firebaseUser && (
        <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-display text-lg font-bold text-[#0B2545] flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#00A6A6]" />
                الخصوصية وأمان الجلسات والتحكم بالبيانات
              </h2>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed max-w-2xl">
                تجمع منصة UST فقط بيانات الهوية الأساسية من Google، تخصصك وسنتك المفضلة، المفضلة، ومحاولات الاختبارات لتقديم تجربة دراسية شخصية دون مشاركة بياناتك مع أي طرف ثالث.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={privacyBusy !== null}
              onClick={handleLogoutAllDevices}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-[#0B2545] hover:bg-[#133866] text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              <LogOut className="w-4 h-4 text-[#00A6A6]" />
              {privacyBusy === 'logout_all' ? 'جاري إبطال الجلسات...' : 'تسجيل الخروج من جميع الأجهزة'}
            </button>

            <button
              type="button"
              disabled={privacyBusy !== null}
              onClick={handleExportMyData}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-[#EAF4F7] hover:bg-[#00A6A6] text-[#0B2545] hover:text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              {privacyBusy === 'export' ? 'جاري التحضير...' : 'تصدير بياناتي (JSON)'}
            </button>

            {!isSuperAdmin && (
              <button
                type="button"
                disabled={privacyBusy !== null}
                onClick={() => setConfirmSelfDelete(true)}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-[#FF8066]/60 text-[#b8442c] hover:bg-[#FF8066]/10 text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                حذف بيانات حسابي
              </button>
            )}
          </div>

          {privacyNotice && (
            <p role="status" className="text-xs font-semibold text-[#0B2545] bg-[#EAF4F7] rounded-xl px-4 py-2.5">
              {privacyNotice}
            </p>
          )}
        </section>
      )}

      {confirmSelfDelete && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-md w-full space-y-4 shadow-xl">
            <h3 className="font-display text-lg font-bold text-[#0B2545]">
              تأكيد حذف بيانات الحساب
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              سيؤدي هذا الإجراء إلى مسح ملفك الشخصي في المنصة وإزالة جميع محاولات الاختبارات وإبطال جلساتك النشطة. لن تتأثر حسابات Google الخارجية الخاصة بك.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmSelfDelete(false)}
                className="min-h-[40px] px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={privacyBusy === 'delete'}
                onClick={handleConfirmDeleteAccount}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#FF8066] text-white text-sm font-semibold disabled:opacity-50"
              >
                {privacyBusy === 'delete' ? 'جاري الحذف...' : 'تأكيد الحذف النهائي'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
