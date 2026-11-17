import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Calendar,
  ChevronLeft,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Heart,
  Layers,
  Lock,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import {
  AcademicYear,
  LectureCategory,
  LectureFile,
  LECTURE_CATEGORY_LABELS,
  Semester,
  Specialization,
  Subject,
} from '../types/academic.ts';
import {
  buildAcademicBreadcrumb,
  canDownloadFile,
  canPreviewInApp,
  countFilesForSubject,
  formatFileSizeArabic,
  getCategoryLabel,
  getFilesForSubject,
  getPublishedSpecializations,
  getSemestersForYear,
  getSubjectsForSemester,
  getYearsForSpecialization,
} from '../utils/academicLogic.ts';
import { AcademicIcon } from './IconPicker.tsx';

export interface LecturesSelectionState {
  specialization: Specialization | null;
  year: AcademicYear | null;
  semester: Semester | null;
  subject: Subject | null;
}

export function LecturesExplorer({
  selection,
  onChangeSelection,
  onBackHome,
  onPreviewFile,
  onRequireSignIn,
}: {
  selection: LecturesSelectionState;
  onChangeSelection: (next: LecturesSelectionState) => void;
  onBackHome: () => void;
  onPreviewFile: (file: LectureFile) => void;
  onRequireSignIn: () => void;
}) {
  const { firebaseUser, isAdmin, favoriteIds, toggleFavorite } = useAuth();
  const { specializations, academicYears, semesters, subjects, lectureFiles, loading } =
    usePlatformData();

  const [activeCategory, setActiveCategory] = useState<LectureCategory | 'all'>('all');
  const [favoriteMessage, setFavoriteMessage] = useState<string | null>(null);

  const publishedSpecs = useMemo(
    () => getPublishedSpecializations(specializations),
    [specializations]
  );

  const availableYears = useMemo(
    () =>
      selection.specialization
        ? getYearsForSpecialization(academicYears, selection.specialization.id)
        : [],
    [academicYears, selection.specialization]
  );

  const availableSemesters = useMemo(
    () =>
      selection.specialization && selection.year
        ? getSemestersForYear(
            semesters,
            selection.specialization.id,
            selection.year.id
          )
        : [],
    [semesters, selection.specialization, selection.year]
  );

  const availableSubjects = useMemo(
    () =>
      selection.specialization && selection.year && selection.semester
        ? getSubjectsForSemester(
            subjects,
            selection.specialization.id,
            selection.year.id,
            selection.semester.id
          )
        : [],
    [subjects, selection.specialization, selection.year, selection.semester]
  );

  const subjectFiles = useMemo(() => {
    if (
      !selection.specialization ||
      !selection.year ||
      !selection.semester ||
      !selection.subject
    ) {
      return [];
    }
    return getFilesForSubject(
      lectureFiles,
      selection.specialization.id,
      selection.year.id,
      selection.semester.id,
      selection.subject.id
    );
  }, [lectureFiles, selection]);

  const filteredFiles = useMemo(() => {
    if (activeCategory === 'all') return subjectFiles;
    return subjectFiles.filter((f) => f.category === activeCategory);
  }, [subjectFiles, activeCategory]);

  const availableCategories = useMemo(() => {
    const cats = new Set(subjectFiles.map((f) => f.category));
    return (Object.keys(LECTURE_CATEGORY_LABELS) as LectureCategory[]).filter((c) =>
      cats.has(c)
    );
  }, [subjectFiles]);

  const breadcrumbs = buildAcademicBreadcrumb({
    specialization: selection.specialization,
    year: selection.year,
    semester: selection.semester,
    subject: selection.subject,
    inLecturesSection: true,
  });

  const handleBreadcrumbClick = (step: string) => {
    setActiveCategory('all');
    if (step === 'home') {
      onBackHome();
    } else if (step === 'specializations') {
      onChangeSelection({ specialization: null, year: null, semester: null, subject: null });
    } else if (step === 'years') {
      onChangeSelection({
        specialization: selection.specialization,
        year: null,
        semester: null,
        subject: null,
      });
    } else if (step === 'semesters') {
      onChangeSelection({
        specialization: selection.specialization,
        year: selection.year,
        semester: null,
        subject: null,
      });
    } else if (step === 'subjects') {
      onChangeSelection({
        specialization: selection.specialization,
        year: selection.year,
        semester: selection.semester,
        subject: null,
      });
    }
  };

  const handleBackStep = () => {
    setActiveCategory('all');
    if (selection.subject) {
      onChangeSelection({ ...selection, subject: null });
    } else if (selection.semester) {
      onChangeSelection({ ...selection, semester: null, subject: null });
    } else if (selection.year) {
      onChangeSelection({ ...selection, year: null, semester: null, subject: null });
    } else if (selection.specialization) {
      onChangeSelection({ specialization: null, year: null, semester: null, subject: null });
    } else {
      onBackHome();
    }
  };

  const handleToggleFav = async (file: LectureFile) => {
    if (!firebaseUser) {
      onRequireSignIn();
      return;
    }
    try {
      await toggleFavorite(file.id, file.subjectId);
      setFavoriteMessage(
        favoriteIds.has(file.id)
          ? 'تمت إزالة الملف من المفضلة.'
          : 'تم حفظ الملف في المفضلة بنجاح.'
      );
      setTimeout(() => setFavoriteMessage(null), 2500);
    } catch {
      setFavoriteMessage('تعذر تحديث المفضلة.');
    }
  };

  const currentStepTitle = selection.subject
    ? selection.subject.name
    : selection.semester
      ? 'المواد الدراسية'
      : selection.year
        ? 'اختر الفصل الدراسي'
        : selection.specialization
          ? 'اختر السنة الدراسية'
          : 'اختر تخصصك';

  return (
    <div className="space-y-6 pb-8">
      {/* Top Breadcrumb + Back Navigation Bar */}
      <div className="bg-[#EAF4F7] rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1.5 min-w-0">
          <nav aria-label="مسار التنقل الأكاديمي" className="flex items-center flex-wrap gap-1.5 text-xs text-slate-600">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <React.Fragment key={`${crumb.step}-${index}`}>
                  {index > 0 && (
                    <ChevronLeft className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    onClick={() => handleBreadcrumbClick(crumb.step)}
                    disabled={isLast}
                    className={`truncate max-w-[180px] transition-colors ${
                      isLast
                        ? 'font-bold text-[#0B2545] cursor-default'
                        : 'hover:text-[#00A6A6] font-medium'
                    }`}
                  >
                    {crumb.label}
                  </button>
                </React.Fragment>
              );
            })}
          </nav>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#0B2545]">
            {currentStepTitle}
          </h1>
        </div>

        <button
          type="button"
          onClick={handleBackStep}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-white hover:bg-[#0B2545] text-[#0B2545] hover:text-white border border-slate-200 text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 self-start sm:self-center"
        >
          <ArrowRight className="w-4 h-4" />
          رجوع
        </button>
      </div>

      {favoriteMessage && (
        <div
          role="status"
          className="rounded-xl bg-[#0B2545] text-white px-4 py-2.5 text-sm font-medium"
        >
          {favoriteMessage}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 rounded-2xl bg-[#EAF4F7]/60 animate-pulse" />
          ))}
        </div>
      ) : !selection.specialization ? (
        /* STEP 1: Choose Specialization */
        publishedSpecs.length === 0 ? (
          <EmptyAcademicState message="لا توجد تخصصات منشورة حالياً. يمكنك إضافتها من لوحة الإدارة." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {publishedSpecs.map((spec) => {
              const yearsCount = getYearsForSpecialization(academicYears, spec.id).length;
              return (
                <button
                  key={spec.id}
                  type="button"
                  onClick={() =>
                    onChangeSelection({
                      specialization: spec,
                      year: null,
                      semester: null,
                      subject: null,
                    })
                  }
                  className="group text-right bg-white hover:bg-[#EAF4F7]/70 border border-slate-200 hover:border-[#00A6A6] rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-13 h-13 rounded-2xl bg-[#EAF4F7] group-hover:bg-[#00A6A6] text-[#0B2545] group-hover:text-white flex items-center justify-center shrink-0 transition-colors">
                      <AcademicIcon iconKey={spec.iconKey} className="w-6 h-6" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="font-display text-lg font-bold text-[#0B2545]">
                        {spec.name}
                      </h2>
                      {spec.description && (
                        <p className="text-xs text-slate-600 mt-1 line-clamp-2 leading-relaxed">
                          {spec.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
                    <span className="tabular-nums">{yearsCount} سنوات دراسية</span>
                    <span className="font-semibold text-[#00A6A6] inline-flex items-center gap-1">
                      فتح التخصص
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )
      ) : !selection.year ? (
        /* STEP 2: Choose Academic Year */
        availableYears.length === 0 ? (
          <EmptyAcademicState message="لم تتم إضافة سنوات دراسية منشورة لهذا التخصص بعد." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {availableYears.map((yr, idx) => {
              const semCount = getSemestersForYear(
                semesters,
                selection.specialization!.id,
                yr.id
              ).length;
              return (
                <button
                  key={yr.id}
                  type="button"
                  onClick={() =>
                    onChangeSelection({
                      ...selection,
                      year: yr,
                      semester: null,
                      subject: null,
                    })
                  }
                  className="group text-right bg-white hover:bg-[#EAF4F7]/70 border border-slate-200 hover:border-[#00A6A6] rounded-2xl p-5 flex items-center justify-between gap-4 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-[#0B2545] group-hover:bg-[#00A6A6] text-white font-display font-bold text-lg flex items-center justify-center tabular-nums transition-colors">
                      {idx + 1}
                    </div>
                    <div>
                      <h2 className="font-display text-lg font-bold text-[#0B2545]">
                        {yr.name}
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                        {semCount} فصول دراسية متاحة
                      </p>
                    </div>
                  </div>
                  <ChevronLeft className="w-5 h-5 text-slate-400 group-hover:text-[#00A6A6]" />
                </button>
              );
            })}
          </div>
        )
      ) : !selection.semester ? (
        /* STEP 3: Choose Semester */
        availableSemesters.length === 0 ? (
          <EmptyAcademicState message="لم تتم إضافة فصول دراسية منشورة لهذه السنة بعد." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {availableSemesters.map((sem) => {
              const subCount = getSubjectsForSemester(
                subjects,
                selection.specialization!.id,
                selection.year!.id,
                sem.id
              ).length;
              return (
                <button
                  key={sem.id}
                  type="button"
                  onClick={() =>
                    onChangeSelection({
                      ...selection,
                      semester: sem,
                      subject: null,
                    })
                  }
                  className="group text-right bg-white hover:bg-[#EAF4F7]/70 border border-slate-200 hover:border-[#00A6A6] rounded-2xl p-5 flex items-center justify-between gap-4 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-[#EAF4F7] group-hover:bg-[#00A6A6] text-[#0B2545] group-hover:text-white flex items-center justify-center transition-colors">
                      <Calendar className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="font-display text-lg font-bold text-[#0B2545]">
                        {sem.name}
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                        {subCount} مواد دراسية
                      </p>
                    </div>
                  </div>
                  <ChevronLeft className="w-5 h-5 text-slate-400 group-hover:text-[#00A6A6]" />
                </button>
              );
            })}
          </div>
        )
      ) : !selection.subject ? (
        /* STEP 4: Display Subjects */
        availableSubjects.length === 0 ? (
          <EmptyAcademicState message="لم تتم إضافة مواد دراسية منشورة لهذا الفصل الدراسي بعد." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {availableSubjects.map((sub) => {
              const filesCount = countFilesForSubject(lectureFiles, sub.id);
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => {
                    setActiveCategory('all');
                    onChangeSelection({ ...selection, subject: sub });
                  }}
                  className="group text-right bg-white hover:bg-[#EAF4F7]/70 border border-slate-200 hover:border-[#00A6A6] rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-[#EAF4F7] group-hover:bg-[#00A6A6] text-[#0B2545] group-hover:text-white flex items-center justify-center shrink-0 transition-colors">
                      <AcademicIcon iconKey={sub.iconKey} className="w-6 h-6" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="font-display text-lg font-bold text-[#0B2545]">
                        {sub.name}
                      </h2>
                      {sub.description && (
                        <p className="text-xs text-slate-600 mt-1 line-clamp-2 leading-relaxed">
                          {sub.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
                    <span className="tabular-nums font-medium">
                      {filesCount} ملف تعليمي
                    </span>
                    <span className="font-semibold text-[#00A6A6] inline-flex items-center gap-1">
                      فتح المادة
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )
      ) : (
        /* STEP 5: Display Subject Files */
        <div className="space-y-5">
          {selection.subject.description && (
            <p className="text-sm text-slate-600 bg-white rounded-xl border border-slate-200 px-4 py-3">
              {selection.subject.description}
            </p>
          )}

          {/* Category Filter Tabs */}
          {availableCategories.length > 0 && (
            <div
              role="tablist"
              aria-label="تصنيف ملفات المادة"
              className="flex items-center gap-1.5 overflow-x-auto pb-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeCategory === 'all'}
                onClick={() => setActiveCategory('all')}
                className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  activeCategory === 'all'
                    ? 'bg-[#0B2545] text-white'
                    : 'bg-[#EAF4F7] text-[#0B2545] hover:bg-slate-200'
                }`}
              >
                الكل ({subjectFiles.length})
              </button>
              {availableCategories.map((cat) => {
                const count = subjectFiles.filter((f) => f.category === cat).length;
                return (
                  <button
                    key={cat}
                    type="button"
                    role="tab"
                    aria-selected={activeCategory === cat}
                    onClick={() => setActiveCategory(cat)}
                    className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      activeCategory === cat
                        ? 'bg-[#00A6A6] text-white'
                        : 'bg-[#EAF4F7] text-[#0B2545] hover:bg-slate-200'
                    }`}
                  >
                    {getCategoryLabel(cat)} ({count})
                  </button>
                );
              })}
            </div>
          )}

          {filteredFiles.length === 0 ? (
            <EmptyAcademicState message="لا توجد ملفات مرفوعة لهذه المادة في هذا التصنيف حالياً." />
          ) : (
            <div className="space-y-3">
              {filteredFiles.map((file) => {
                const previewable = canPreviewInApp(file.fileExt, file.mimeType);
                const downloadable = canDownloadFile(file, isAdmin);
                const isFav = favoriteIds.has(file.id);

                return (
                  <article
                    key={file.id}
                    className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-[#00A6A6]/60 transition-colors"
                  >
                    <div className="flex items-start gap-4 min-w-0">
                      <div className="w-12 h-12 rounded-2xl bg-[#EAF4F7] text-[#0B2545] flex flex-col items-center justify-center shrink-0">
                        <FileText className="w-5 h-5 text-[#00A6A6]" />
                        <span className="text-[10px] font-mono font-bold uppercase mt-0.5">
                          {file.fileExt}
                        </span>
                      </div>
                      <div className="min-w-0 space-y-1">
                        <h2 className="font-display text-base sm:text-lg font-bold text-[#0B2545]">
                          {file.title}
                        </h2>
                        {file.description && (
                          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                            {file.description}
                          </p>
                        )}
                        <div className="text-xs text-slate-500 flex items-center flex-wrap gap-2 pt-0.5">
                          <span className="font-medium text-[#0B2545]">
                            {getCategoryLabel(file.category)}
                          </span>
                          {file.lectureNumber && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{file.lectureNumber}</span>
                            </>
                          )}
                          {file.version && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono">{file.version}</span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">
                            {formatFileSizeArabic(file.fileSize)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={() => handleToggleFav(file)}
                        aria-label={
                          isFav
                            ? `إزالة ${file.title} من المفضلة`
                            : `إضافة ${file.title} إلى المفضلة`
                        }
                        aria-pressed={isFav}
                        className={`min-h-[42px] min-w-[42px] rounded-xl border flex items-center justify-center transition-colors ${
                          isFav
                            ? 'bg-[#FF8066]/10 border-[#FF8066] text-[#FF8066]'
                            : 'bg-white border-slate-200 text-slate-400 hover:text-[#FF8066]'
                        }`}
                      >
                        <Heart className={`w-4 h-4 ${isFav ? 'fill-current' : ''}`} />
                      </button>

                      {previewable && (
                        <button
                          type="button"
                          onClick={() => onPreviewFile(file)}
                          className="min-h-[42px] px-4 py-2 rounded-xl bg-[#EAF4F7] hover:bg-[#0B2545] text-[#0B2545] hover:text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                        >
                          <Eye className="w-4 h-4" />
                          معاينة
                        </button>
                      )}

                      {downloadable ? (
                        <a
                          href={`/api/files/download/${encodeURIComponent(file.id)}`}
                          download={file.originalName}
                          className="min-h-[42px] px-4 py-2 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                        >
                          <Download className="w-4 h-4" />
                          تحميل
                        </a>
                      ) : (
                        <span className="min-h-[42px] px-3 py-2 rounded-xl bg-slate-100 text-slate-500 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap">
                          <Lock className="w-3.5 h-3.5" />
                          للمعاينة فقط
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyAcademicState({ message }: { message: string }) {
  return (
    <div className="bg-[#EAF4F7]/65 rounded-2xl border border-slate-200/80 p-10 text-center space-y-3">
      <div className="w-12 h-12 mx-auto rounded-2xl bg-white text-[#00A6A6] flex items-center justify-center border border-slate-200">
        <Layers className="w-6 h-6" />
      </div>
      <p className="text-sm font-medium text-[#0B2545]">{message}</p>
    </div>
  );
}
