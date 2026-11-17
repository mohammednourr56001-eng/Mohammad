import React, { useState } from 'react';
import {
  ArrowLeft,
  Bell,
  BookOpen,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Megaphone,
  Search,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import { LectureFile, Specialization } from '../types/academic.ts';
import {
  canDownloadFile,
  canPreviewInApp,
  formatFileSizeArabic,
  getCategoryLabel,
  getPublishedSpecializations,
  getYearsForSpecialization,
} from '../utils/academicLogic.ts';
import { AcademicIcon } from './IconPicker.tsx';

export function StudentHome({
  onOpenLectures,
  onSelectSpecialization,
  onOpenSearch,
  onOpenNotifications,
  onPreviewFile,
}: {
  onOpenLectures: () => void;
  onSelectSpecialization: (spec: Specialization) => void;
  onOpenSearch: (initialQuery?: string) => void;
  onOpenNotifications: () => void;
  onPreviewFile: (file: LectureFile) => void;
}) {
  const { profile, isAdmin } = useAuth();
  const {
    specializations,
    academicYears,
    subjects,
    lectureFiles,
    announcements,
    loading,
  } = usePlatformData();

  const [quickQuery, setQuickQuery] = useState('');
  const [heroImgError, setHeroImgError] = useState(false);

  const publishedSpecs = getPublishedSpecializations(specializations);
  const featuredSpecs = publishedSpecs.slice(0, 3);
  const publishedFiles = lectureFiles.filter((f) => f.status === 'published');
  const recentFiles = [...publishedFiles]
    .sort((a, b) => {
      const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
      const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
      return tb - ta;
    })
    .slice(0, 4);

  const publishedAnnouncements = announcements
    .filter((a) => a.status === 'published')
    .slice(0, 3);

  const handleQuickSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onOpenSearch(quickQuery.trim());
  };

  return (
    <div className="space-y-10 pb-8">
      {/* Hero Banner Card matching the sketch's visual focus */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-stretch">
        {/* Visual Illustration Card (above hero text on mobile like the sketch) */}
        <div className="lg:col-span-5 lg:order-2 bg-[#EAF4F7] rounded-3xl overflow-hidden border border-slate-200/80 flex flex-col justify-between">
          {!heroImgError ? (
            <img
              src="/src/assets/images/hero_ust_academic_1794917760307.jpg"
              alt="رسم توضيحي أكاديمي لمنصة UST للمحاضرات"
              referrerPolicy="no-referrer"
              onError={() => setHeroImgError(true)}
              className="w-full h-36 sm:h-52 lg:h-full object-cover"
            />
          ) : (
            <div className="w-full h-36 lg:h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-[#EAF4F7] to-white">
              <Sparkles className="w-10 h-10 text-[#00A6A6] mb-3" />
              <p className="font-display font-bold text-[#0B2545]">
                أرشيف المحاضرات الرقمي لجامعة UST
              </p>
            </div>
          )}
        </div>

        <div className="lg:col-span-7 lg:order-1 bg-[#0B2545] text-white rounded-3xl p-5 sm:p-8 flex flex-col justify-between relative overflow-hidden">
          <div className="space-y-2.5 sm:space-y-4 relative z-10">
            <p className="text-xs sm:text-sm font-medium text-[#EAF4F7]/85">
              جامعة العلوم والتقنية · البوابة الأكاديمية
            </p>
            <h1 className="font-display text-xl sm:text-4xl font-bold leading-snug text-balance">
              {profile?.displayName
                ? `مرحباً ${profile.displayName.split(' ')[0]} في منصة UST للمحاضرات`
                : 'منصة UST للمحاضرات والمقررات الجامعية'}
            </h1>
            <p className="text-xs sm:text-base text-[#EAF4F7]/85 max-w-xl leading-relaxed">
              تصفّح محاضراتك، المذكرات، الملخصات، والاختبارات السابقة في مسار أكاديمي منظم: التخصص ثم السنة الدراسية ثم الفصل الدراسي وصولاً إلى ملفات كل مادة.
            </p>
          </div>

          <div className="mt-4 sm:mt-6 space-y-3 sm:space-y-4 relative z-10">
            {/* Search bar */}
            <form onSubmit={handleQuickSearchSubmit} className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search
                  className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={quickQuery}
                  onChange={(e) => setQuickQuery(e.target.value)}
                  placeholder="ابحث عن تخصص، مادة، أو محاضرة..."
                  aria-label="ابحث عن تخصص، مادة، أو محاضرة"
                  className="w-full min-h-[44px] pr-10 pl-4 rounded-xl bg-white text-[#0B2545] placeholder:text-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-[#00A6A6]"
                />
              </div>
              <button
                type="submit"
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                بحث
              </button>
            </form>

            {/* Primary CTA: المحاضرات */}
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={onOpenLectures}
                className="min-h-[46px] px-6 py-2.5 rounded-xl bg-[#FF8066] hover:bg-[#f16d52] text-white font-display font-bold text-sm sm:text-base inline-flex items-center gap-2.5 transition-transform active:scale-[0.98] whitespace-nowrap shrink-0 shadow-sm"
              >
                <BookOpen className="w-5 h-5" />
                المحاضرات
                <ArrowLeft className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={onOpenNotifications}
                className="min-h-[46px] px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs sm:text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
              >
                <Bell className="w-4 h-4 text-[#FF8066]" />
                الإعلانات والتحديثات
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Core Sketch Section: ما تخصصك؟ */}
      <section aria-labelledby="what-major-heading" className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2
              id="what-major-heading"
              className="font-display text-2xl sm:text-3xl font-bold text-[#0B2545]"
            >
              ما تخصصك؟
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              اختر تخصصك الجامعي للانتقال مباشرة إلى السنوات والفصول والمواد الدراسية
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenLectures}
            className="min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold text-[#00A6A6] hover:bg-[#EAF4F7] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            عرض المزيد
            <ArrowLeft className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((idx) => (
              <div
                key={idx}
                className="h-32 rounded-2xl bg-[#EAF4F7]/60 animate-pulse border border-slate-200/60"
              />
            ))}
          </div>
        ) : featuredSpecs.length === 0 ? (
          <div className="rounded-2xl bg-[#EAF4F7] p-8 text-center">
            <p className="text-sm font-medium text-[#0B2545]">
              لم يتم نشر أي تخصصات بعد.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {featuredSpecs.map((spec) => {
              const yearCount = getYearsForSpecialization(academicYears, spec.id).length;
              return (
                <button
                  key={spec.id}
                  type="button"
                  onClick={() => onSelectSpecialization(spec)}
                  className="group text-right bg-white hover:bg-[#EAF4F7]/70 border border-slate-200 hover:border-[#00A6A6] rounded-2xl p-5 flex items-center justify-between gap-4 transition-all duration-150 shadow-xs"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-14 h-14 rounded-2xl bg-[#EAF4F7] group-hover:bg-[#00A6A6] text-[#0B2545] group-hover:text-white flex items-center justify-center shrink-0 transition-colors">
                      <AcademicIcon iconKey={spec.iconKey} className="w-7 h-7" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-display text-lg font-bold text-[#0B2545] truncate">
                        {spec.name}
                      </h3>
                      <p className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                        <span className="tabular-nums">{yearCount} سنوات دراسية</span>
                        <span aria-hidden="true">·</span>
                        <span>تصفح المواد</span>
                      </p>
                    </div>
                  </div>
                  <ArrowLeft className="w-5 h-5 text-slate-400 group-hover:text-[#00A6A6] shrink-0 transition-transform group-hover:-translate-x-1" />
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Two-Column Rhythm: Recent Uploads & Announcements */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Recent Uploads */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold text-[#0B2545] flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-[#00A6A6]" />
              أحدث الملفات المرفوعة
            </h2>
            <button
              type="button"
              onClick={() => onOpenSearch('')}
              className="text-xs font-semibold text-[#00A6A6] hover:underline whitespace-nowrap shrink-0"
            >
              استعراض الكل
            </button>
          </div>

          {recentFiles.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              لا توجد ملفات منشورة حالياً.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentFiles.map((file) => {
                const subject = subjects.find((s) => s.id === file.subjectId);
                const spec = specializations.find((s) => s.id === file.specializationId);
                const previewable = canPreviewInApp(file.fileExt, file.mimeType);
                const downloadable = canDownloadFile(file, isAdmin);

                return (
                  <div
                    key={file.id}
                    className="py-3.5 first:pt-1 last:pb-1 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-[#EAF4F7] text-[#0B2545] flex items-center justify-center shrink-0">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-[#0B2545] truncate">
                          {file.title}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <span>{subject?.name || 'مقرر دراسي'}</span>
                          <span aria-hidden="true">·</span>
                          <span>{spec?.name || ''}</span>
                          <span aria-hidden="true">·</span>
                          <span>{getCategoryLabel(file.category)}</span>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">
                            {formatFileSizeArabic(file.fileSize)}
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {previewable && (
                        <button
                          type="button"
                          onClick={() => onPreviewFile(file)}
                          aria-label={`معاينة ${file.title}`}
                          className="min-h-[40px] px-3 py-1.5 rounded-xl bg-[#EAF4F7] hover:bg-[#00A6A6] text-[#0B2545] hover:text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          معاينة
                        </button>
                      )}
                      {downloadable && (
                        <a
                          href={`/api/files/download/${encodeURIComponent(file.id)}`}
                          download={file.originalName}
                          aria-label={`تحميل ${file.title}`}
                          className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 hover:border-[#00A6A6] text-[#0B2545] hover:text-[#00A6A6] flex items-center justify-center transition-colors"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Announcements */}
        <div className="lg:col-span-5 bg-[#EAF4F7]/65 rounded-2xl border border-slate-200/80 p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold text-[#0B2545] flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-[#FF8066]" />
              الإعلانات الجامعية
            </h2>
            <button
              type="button"
              onClick={onOpenNotifications}
              className="text-xs font-semibold text-[#00A6A6] hover:underline whitespace-nowrap shrink-0"
            >
              كل الإعلانات
            </button>
          </div>

          {publishedAnnouncements.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              لا توجد إعلانات حالياً.
            </p>
          ) : (
            <div className="space-y-3">
              {publishedAnnouncements.map((ann) => (
                <article
                  key={ann.id}
                  className="bg-white rounded-xl border border-slate-200/80 p-4 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-[#0B2545] leading-snug">
                      {ann.title}
                    </h3>
                    {ann.priority === 'important' && (
                      <span className="text-xs font-semibold text-[#FF8066] shrink-0">
                        مهم
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">
                    {ann.body}
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
