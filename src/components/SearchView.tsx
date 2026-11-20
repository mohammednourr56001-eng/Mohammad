import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Cloud,
  Download,
  Eye,
  FileText,
  Filter,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import {
  LectureCategory,
  LectureFile,
  LECTURE_CATEGORY_LABELS,
  Specialization,
  Subject,
} from '../types/academic.ts';
import {
  canDownloadFile,
  canPreviewInApp,
  formatFileSizeArabic,
  getCategoryLabel,
  getEffectiveCoursePlacements,
  getGoogleDriveDownloadUrl,
  getPublishedSpecializations,
  getSemestersForYear,
  getSubjectsForSemester,
  getYearsForSpecialization,
  isGoogleDriveFile,
  searchLecturesAndSubjects,
} from '../utils/academicLogic.ts';
import { AcademicIcon } from './IconPicker.tsx';

export function SearchView({
  initialQuery = '',
  onNavigateToSpecialization,
  onNavigateToSubject,
  onPreviewFile,
}: {
  initialQuery?: string;
  onNavigateToSpecialization: (spec: Specialization) => void;
  onNavigateToSubject: (subject: Subject) => void;
  onPreviewFile: (file: LectureFile) => void;
}) {
  const { isAdmin } = useAuth();
  const {
    specializations,
    academicYears,
    semesters,
    subjects,
    programCourses,
    lectureFileLinks,
    lectureFiles,
  } = usePlatformData();

  const [queryText, setQueryText] = useState(initialQuery);
  const [specializationId, setSpecializationId] = useState('');
  const [academicYearId, setAcademicYearId] = useState('');
  const [semesterId, setSemesterId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [category, setCategory] = useState<LectureCategory | 'all'>('all');

  const publishedSpecs = useMemo(
    () => getPublishedSpecializations(specializations),
    [specializations]
  );

  const yearsForFilter = useMemo(
    () =>
      specializationId
        ? getYearsForSpecialization(academicYears, specializationId)
        : [],
    [academicYears, specializationId]
  );

  const semestersForFilter = useMemo(
    () =>
      specializationId && academicYearId
        ? getSemestersForYear(semesters, specializationId, academicYearId)
        : [],
    [semesters, specializationId, academicYearId]
  );

  const subjectsForFilter = useMemo(
    () =>
      specializationId && academicYearId && semesterId
        ? getSubjectsForSemester(subjects, specializationId, academicYearId, semesterId, false, programCourses)
        : subjects.filter((s) => {
            if (s.status !== 'published') return false;
            if (!specializationId) return true;
            return getEffectiveCoursePlacements(s, programCourses, false).some(
              (p) => p.specializationId === specializationId
            );
          }),
    [subjects, programCourses, specializationId, academicYearId, semesterId]
  );

  const results = useMemo(
    () =>
      searchLecturesAndSubjects(
        { specializations, subjects, files: lectureFiles, programCourses, lectureFileLinks },
        {
          query: queryText,
          specializationId,
          academicYearId,
          semesterId,
          subjectId,
          category,
        }
      ),
    [
      specializations,
      subjects,
      programCourses,
      lectureFileLinks,
      lectureFiles,
      queryText,
      specializationId,
      academicYearId,
      semesterId,
      subjectId,
      category,
    ]
  );

  const handleResetFilters = () => {
    setQueryText('');
    setSpecializationId('');
    setAcademicYearId('');
    setSemesterId('');
    setSubjectId('');
    setCategory('all');
  };

  return (
    <div className="space-y-6 pb-8">
      <header className="bg-[#EAF4F7] rounded-2xl p-5 sm:p-6 space-y-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#0B2545]">
            البحث والفلترة الأكاديمية
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            ابحث في التخصصات، المواد الدراسية، عناوين المحاضرات، والملفات التعليمية
          </p>
        </div>

        <div className="relative">
          <Search
            className="w-5 h-5 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="اكتب اسم المادة، عنوان المحاضرة، أو اسم الملف..."
            aria-label="البحث عن المحاضرات والمقررات"
            className="w-full min-h-[48px] pr-12 pl-4 rounded-xl bg-white border border-slate-200 text-[#0B2545] text-sm focus:outline-none focus:ring-2 focus:ring-[#00A6A6]"
          />
        </div>

        {/* Cascading Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label htmlFor="filter-spec" className="block text-xs font-medium text-[#0B2545] mb-1">
              التخصص
            </label>
            <select
              id="filter-spec"
              value={specializationId}
              onChange={(e) => {
                setSpecializationId(e.target.value);
                setAcademicYearId('');
                setSemesterId('');
                setSubjectId('');
              }}
              className="w-full min-h-[42px] px-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm text-[#0B2545]"
            >
              <option value="">كل التخصصات</option>
              {publishedSpecs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-year" className="block text-xs font-medium text-[#0B2545] mb-1">
              السنة الدراسية
            </label>
            <select
              id="filter-year"
              value={academicYearId}
              disabled={!specializationId}
              onChange={(e) => {
                setAcademicYearId(e.target.value);
                setSemesterId('');
                setSubjectId('');
              }}
              className="w-full min-h-[42px] px-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm text-[#0B2545] disabled:opacity-50"
            >
              <option value="">كل السنوات</option>
              {yearsForFilter.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-semester" className="block text-xs font-medium text-[#0B2545] mb-1">
              الفصل الدراسي
            </label>
            <select
              id="filter-semester"
              value={semesterId}
              disabled={!academicYearId}
              onChange={(e) => {
                setSemesterId(e.target.value);
                setSubjectId('');
              }}
              className="w-full min-h-[42px] px-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm text-[#0B2545] disabled:opacity-50"
            >
              <option value="">كل الفصول</option>
              {semestersForFilter.map((sem) => (
                <option key={sem.id} value={sem.id}>
                  {sem.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-subject" className="block text-xs font-medium text-[#0B2545] mb-1">
              المادة الدراسية
            </label>
            <select
              id="filter-subject"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className="w-full min-h-[42px] px-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm text-[#0B2545]"
            >
              <option value="">كل المواد</option>
              {subjectsForFilter.map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {sub.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-category" className="block text-xs font-medium text-[#0B2545] mb-1">
              نوع الملف
            </label>
            <select
              id="filter-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as LectureCategory | 'all')}
              className="w-full min-h-[42px] px-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm text-[#0B2545]"
            >
              <option value="all">كل التصنيفات</option>
              {(Object.keys(LECTURE_CATEGORY_LABELS) as LectureCategory[]).map((key) => (
                <option key={key} value={key}>
                  {LECTURE_CATEGORY_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-600 pt-1">
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <Filter className="w-3.5 h-3.5 text-[#00A6A6]" />
            النتائج: {results.files.length} ملف · {results.subjects.length} مادة ·{' '}
            {results.specializations.length} تخصص
          </span>
          <button
            type="button"
            onClick={handleResetFilters}
            className="inline-flex items-center gap-1 text-[#0B2545] hover:text-[#00A6A6] font-semibold"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            إعادة تعيين الفلاتر
          </button>
        </div>
      </header>

      {/* Matched Subjects */}
      {results.subjects.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold text-[#0B2545]">
            المواد الدراسية المطابقة ({results.subjects.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {results.subjects.slice(0, 6).map((sub) => {
              const spec = specializations.find((s) => s.id === sub.specializationId);
              const year = academicYears.find((y) => y.id === sub.academicYearId);
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => onNavigateToSubject(sub)}
                  className="text-right bg-white hover:bg-[#EAF4F7]/70 border border-slate-200 hover:border-[#00A6A6] rounded-2xl p-4 flex items-center justify-between gap-3 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-[#EAF4F7] text-[#0B2545] flex items-center justify-center shrink-0">
                      <AcademicIcon iconKey={sub.iconKey} className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-display text-sm font-bold text-[#0B2545] truncate">
                        {sub.name}
                      </h3>
                      <p className="text-xs text-slate-500 truncate">
                        {spec?.name} · {year?.name}
                      </p>
                    </div>
                  </div>
                  <ArrowLeft className="w-4 h-4 text-slate-400 shrink-0" />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Matched Specializations (when query entered) */}
      {queryText.trim() && results.specializations.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold text-[#0B2545]">
            التخصصات المطابقة ({results.specializations.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {results.specializations.map((spec) => (
              <button
                key={spec.id}
                type="button"
                onClick={() => onNavigateToSpecialization(spec)}
                className="text-right bg-white hover:bg-[#EAF4F7]/70 border border-slate-200 rounded-2xl p-4 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-[#EAF4F7] text-[#00A6A6] flex items-center justify-center shrink-0">
                    <AcademicIcon iconKey={spec.iconKey} className="w-5 h-5" />
                  </div>
                  <span className="font-display text-sm font-bold text-[#0B2545] truncate">
                    {spec.name}
                  </span>
                </div>
                <ArrowLeft className="w-4 h-4 text-slate-400 shrink-0" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Matched Files */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold text-[#0B2545]">
          الملفات والمحاضرات ({results.files.length})
        </h2>
        {results.files.length === 0 ? (
          <div className="bg-[#EAF4F7]/65 rounded-2xl border border-slate-200 p-10 text-center">
            <p className="text-sm text-slate-600">
              لم يتم العثور على ملفات مطابقة لمعايير البحث الحالية.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {results.files.map((file) => {
              const spec = specializations.find((s) => s.id === file.specializationId);
              const year = academicYears.find((y) => y.id === file.academicYearId);
              const sem = semesters.find((s) => s.id === file.semesterId);
              const sub = subjects.find((s) => s.id === file.subjectId);
              const isDrive = isGoogleDriveFile(file);
              const previewable = canPreviewInApp(file.fileExt, file.mimeType, file);
              const downloadable = canDownloadFile(file, isAdmin);
              const downloadHref = isDrive
                ? getGoogleDriveDownloadUrl(file) || file.externalUrl || '#'
                : `/api/files/download/${encodeURIComponent(file.id)}`;

              return (
                <article
                  key={file.id}
                  className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-[#EAF4F7] text-[#0B2545] flex items-center justify-center shrink-0">
                      {isDrive ? (
                        <Cloud className="w-5 h-5 text-[#00A6A6]" />
                      ) : (
                        <FileText className="w-5 h-5 text-[#00A6A6]" />
                      )}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center flex-wrap gap-2">
                        <h3 className="font-display text-base font-bold text-[#0B2545]">
                          {file.title}
                        </h3>
                        {isDrive && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#EAF4F7] text-[#0B2545] text-[11px] font-semibold">
                            <Cloud className="w-3 h-3 text-[#00A6A6]" />
                            Google Drive
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 flex items-center flex-wrap gap-1.5">
                        <span>{spec?.name}</span>
                        <span aria-hidden="true">/</span>
                        <span>{year?.name}</span>
                        <span aria-hidden="true">/</span>
                        <span>{sem?.name}</span>
                        <span aria-hidden="true">/</span>
                        <button
                          type="button"
                          onClick={() => sub && onNavigateToSubject(sub)}
                          className="font-semibold text-[#00A6A6] hover:underline"
                        >
                          {sub?.name}
                        </button>
                      </p>
                      <p className="text-xs text-slate-500 flex items-center gap-2">
                        <span>{getCategoryLabel(file.category)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          {isDrive && (!file.fileSize || file.fileSize <= 0)
                            ? 'رابط سحابي'
                            : formatFileSizeArabic(file.fileSize)}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    {previewable && (
                      <button
                        type="button"
                        onClick={() => onPreviewFile(file)}
                        className="min-h-[40px] px-4 py-2 rounded-xl bg-[#EAF4F7] hover:bg-[#0B2545] text-[#0B2545] hover:text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                        معاينة
                      </button>
                    )}
                    {downloadable && (
                      <a
                        href={downloadHref}
                        download={isDrive ? undefined : file.originalName}
                        target={isDrive ? '_blank' : undefined}
                        rel={isDrive ? 'noopener noreferrer' : undefined}
                        className="min-h-[40px] px-4 py-2 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        تحميل
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
