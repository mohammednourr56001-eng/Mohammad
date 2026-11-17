import React, { useEffect, useState } from 'react';
import {
  Download,
  Eye,
  Heart,
  LogIn,
  LogOut,
  ShieldCheck,
  Trash2,
  User,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import { LectureFile } from '../types/academic.ts';
import {
  canDownloadFile,
  canPreviewInApp,
  formatFileSizeArabic,
  getPublishedSpecializations,
  getYearsForSpecialization,
} from '../utils/academicLogic.ts';

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
    isAdmin,
    authLoading,
    authError,
    favoriteIds,
    signInWithGoogle,
    logout,
    toggleFavorite,
    updateAcademicPreference,
  } = useAuth();
  const { specializations, academicYears, lectureFiles, subjects } = usePlatformData();

  const [prefSpecId, setPrefSpecId] = useState(profile?.specializationId || '');
  const [prefYearId, setPrefYearId] = useState(profile?.academicYearId || '');
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setPrefSpecId(profile?.specializationId || '');
    setPrefYearId(profile?.academicYearId || '');
  }, [profile]);

  const publishedSpecs = getPublishedSpecializations(specializations);
  const yearsForSpec = prefSpecId
    ? getYearsForSpecialization(academicYears, prefSpecId)
    : [];

  const favoriteFiles = lectureFiles.filter(
    (f) => f.status === 'published' && favoriteIds.has(f.id)
  );

  const handleSavePrefs = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateAcademicPreference(prefSpecId, prefYearId);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
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
                  سجّل الدخول بحسابك الجامعي لحفظ المحاضرات في المفضلة وتحديد تخصصك الدراسي.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={authLoading}
              className="min-h-[46px] px-5 py-2.5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              <LogIn className="w-4 h-4" />
              {authLoading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول بحساب Google'}
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                {profile?.photoURL ? (
                  <img
                    src={profile.photoURL}
                    alt={profile.displayName}
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
                    <span>{firebaseUser.email}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-[#00A6A6]">
                      {isAdmin ? 'مشرف المنصة' : 'حساب طالب'}
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                {isAdmin && (
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

            {/* Academic Preference Form */}
            <form
              onSubmit={handleSavePrefs}
              className="bg-[#EAF4F7]/70 rounded-2xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-3 gap-4 items-end"
            >
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
                  حفظ التفضيلات
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
              const previewable = canPreviewInApp(file.fileExt, file.mimeType);
              const downloadable = canDownloadFile(file, isAdmin);
              return (
                <div
                  key={file.id}
                  className="py-3.5 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-[#0B2545] truncate">
                      {file.title}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                      <span>{sub?.name}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{formatFileSizeArabic(file.fileSize)}</span>
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
                        href={`/api/files/download/${encodeURIComponent(file.id)}`}
                        download={file.originalName}
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
    </div>
  );
}
