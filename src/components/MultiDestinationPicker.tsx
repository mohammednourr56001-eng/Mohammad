import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  BookPlus,
  Check,
  CheckSquare,
  Layers,
  Plus,
  Search,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import {
  FileDestinationInput,
  PublishStatus,
  Subject,
} from '../types/academic.ts';
import {
  computeNextSortOrder,
  generateSafeId,
  getSemestersForYear,
  getSubjectsForSemester,
  getYearsForSpecialization,
  sortByOrder,
} from '../utils/academicLogic.ts';
import { suggestSubjectForSpecialization } from '../utils/centralLibraryLogic.ts';

export interface DestinationRowState {
  rowId: string;
  specializationId: string;
  academicYearId: string;
  semesterId: string;
  subjectId: string;
  status: PublishStatus;
}

export function isDestinationComplete(row: DestinationRowState): boolean {
  return Boolean(
    row.specializationId && row.academicYearId && row.semesterId && row.subjectId
  );
}

export function buildDefaultDestinationRow(params: {
  specializationId: string;
  academicYears: ReturnType<typeof usePlatformData>['academicYears'];
  semesters: ReturnType<typeof usePlatformData>['semesters'];
  subjects: ReturnType<typeof usePlatformData>['subjects'];
  programCourses: ReturnType<typeof usePlatformData>['programCourses'];
  defaultStatus: PublishStatus;
  hintSubjectName?: string;
  hintSubjectCode?: string;
  preferredYearId?: string;
  preferredSemesterId?: string;
  preferredSubjectId?: string;
}): DestinationRowState {
  const {
    specializationId,
    academicYears,
    semesters,
    subjects,
    programCourses,
    defaultStatus,
    hintSubjectName,
    hintSubjectCode,
    preferredYearId,
    preferredSemesterId,
    preferredSubjectId,
  } = params;

  const years = getYearsForSpecialization(academicYears, specializationId, true);
  const yearId =
    (preferredYearId && years.some((y) => y.id === preferredYearId) ? preferredYearId : '') ||
    years[0]?.id ||
    '';

  const sems = yearId ? getSemestersForYear(semesters, specializationId, yearId, true) : [];
  const semId =
    (preferredSemesterId && sems.some((s) => s.id === preferredSemesterId)
      ? preferredSemesterId
      : '') ||
    sems[0]?.id ||
    '';

  const subs =
    yearId && semId
      ? getSubjectsForSemester(subjects, specializationId, yearId, semId, true, programCourses)
      : [];

  let subjectId = '';
  if (preferredSubjectId && subs.some((s) => s.id === preferredSubjectId)) {
    subjectId = preferredSubjectId;
  } else if (hintSubjectName || hintSubjectCode) {
    // First search in selected semester, otherwise search across all semesters of this specialization
    const suggestedInSem = suggestSubjectForSpecialization({
      sourceSubjectName: hintSubjectName,
      sourceSubjectCode: hintSubjectCode,
      targetSubjects: subs,
    });
    if (suggestedInSem) {
      subjectId = suggestedInSem.id;
    } else if (subs.length === 1) {
      subjectId = subs[0].id;
    }
  } else if (subs.length === 1) {
    subjectId = subs[0].id;
  }

  return {
    rowId: generateSafeId('dst'),
    specializationId,
    academicYearId: yearId,
    semesterId: semId,
    subjectId,
    status: defaultStatus,
  };
}

interface MultiDestinationPickerProps {
  rows: DestinationRowState[];
  onChange: React.Dispatch<React.SetStateAction<DestinationRowState[]>>;
  defaultStatus: PublishStatus;
  existingLinkedKeys?: Set<string>;
  hintSubjectName?: string;
  hintSubjectCode?: string;
  titleLabel?: string;
  subtitleLabel?: string;
  compact?: boolean;
  onSubjectCreated?: (subject: Subject) => void;
}

export function MultiDestinationPicker({
  rows,
  onChange,
  defaultStatus,
  existingLinkedKeys,
  hintSubjectName,
  hintSubjectCode,
  titleLabel = 'تحديد البرامج والتخصصات المستهدفة *',
  subtitleLabel = 'اختر تخصصاً واحداً أو عدة تخصصات وحدد السنة الدراسية والفصل والمادة لكل تخصص بشكل مستقل.',
  compact = false,
  onSubjectCreated,
}: MultiDestinationPickerProps) {
  const { isSuperAdmin, hasPerm, firebaseUser } = useAuth();
  const {
    specializations,
    academicYears,
    semesters,
    subjects,
    programCourses,
    refreshAdminCatalog,
  } = usePlatformData();

  const canCreateSubject = isSuperAdmin || hasPerm('subjects.create');
  const [specSearch, setSpecSearch] = useState('');
  const [quickSubjectRowId, setQuickSubjectRowId] = useState<string | null>(null);
  const [quickSubjectName, setQuickSubjectName] = useState('');
  const [quickSubjectCode, setQuickSubjectCode] = useState('');
  const [creatingSubject, setCreatingSubject] = useState(false);
  const [quickSubjectError, setQuickSubjectError] = useState<string | null>(null);

  const sortedSpecs = useMemo(() => sortByOrder(specializations), [specializations]);

  const filteredSpecs = useMemo(() => {
    const q = specSearch.trim().toLowerCase();
    if (!q) return sortedSpecs;
    return sortedSpecs.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q)
    );
  }, [sortedSpecs, specSearch]);

  const selectedSpecIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.specializationId).filter(Boolean))),
    [rows]
  );

  // If the first chosen subject has a name/code, use it as a smart hint for newly added specializations
  const inferredHint = useMemo(() => {
    if (hintSubjectName || hintSubjectCode) {
      return { name: hintSubjectName, code: hintSubjectCode };
    }
    const firstValidSubjectId = rows.find((r) => r.subjectId)?.subjectId;
    const sub = subjects.find((s) => s.id === firstValidSubjectId);
    return { name: sub?.name, code: sub?.code };
  }, [hintSubjectName, hintSubjectCode, rows, subjects]);

  const toggleSpecialization = (specId: string) => {
    const exists = rows.some((r) => r.specializationId === specId);
    if (exists) {
      onChange((prev) => prev.filter((r) => r.specializationId !== specId));
      return;
    }

    // Try matching same year order or subject across specialization
    const newRow = buildDefaultDestinationRow({
      specializationId: specId,
      academicYears,
      semesters,
      subjects,
      programCourses,
      defaultStatus,
      hintSubjectName: inferredHint.name,
      hintSubjectCode: inferredHint.code,
    });

    // Better smart auto-suggestion: if a hint exists and wasn't in semester 1, check all semesters of this spec
    if (!newRow.subjectId && (inferredHint.name || inferredHint.code)) {
      const specSubjects = subjects.filter((s) => s.specializationId === specId);
      const matchAcrossSpec = suggestSubjectForSpecialization({
        sourceSubjectName: inferredHint.name,
        sourceSubjectCode: inferredHint.code,
        targetSubjects: specSubjects,
      });
      if (matchAcrossSpec) {
        newRow.academicYearId = matchAcrossSpec.academicYearId;
        newRow.semesterId = matchAcrossSpec.semesterId;
        newRow.subjectId = matchAcrossSpec.id;
      }
    }

    onChange((prev) => [...prev, newRow]);
  };

  const handleSelectAllFiltered = () => {
    const existingSet = new Set(selectedSpecIds);
    const additions: DestinationRowState[] = [];
    for (const spec of filteredSpecs) {
      if (existingSet.has(spec.id)) continue;
      const newRow = buildDefaultDestinationRow({
        specializationId: spec.id,
        academicYears,
        semesters,
        subjects,
        programCourses,
        defaultStatus,
        hintSubjectName: inferredHint.name,
        hintSubjectCode: inferredHint.code,
      });
      if (!newRow.subjectId && (inferredHint.name || inferredHint.code)) {
        const specSubjects = subjects.filter((s) => s.specializationId === spec.id);
        const matchAcrossSpec = suggestSubjectForSpecialization({
          sourceSubjectName: inferredHint.name,
          sourceSubjectCode: inferredHint.code,
          targetSubjects: specSubjects,
        });
        if (matchAcrossSpec) {
          newRow.academicYearId = matchAcrossSpec.academicYearId;
          newRow.semesterId = matchAcrossSpec.semesterId;
          newRow.subjectId = matchAcrossSpec.id;
        }
      }
      additions.push(newRow);
    }
    if (additions.length > 0) {
      onChange((prev) => [...prev, ...additions]);
    }
  };

  const handleClearAll = () => {
    onChange([]);
    setQuickSubjectRowId(null);
  };

  const handleAddExtraRowForSpec = (specId: string) => {
    const row = buildDefaultDestinationRow({
      specializationId: specId,
      academicYears,
      semesters,
      subjects,
      programCourses,
      defaultStatus,
    });
    onChange((prev) => [...prev, row]);
  };

  const handleUpdateRow = (rowId: string, patch: Partial<DestinationRowState>) => {
    onChange((prev) =>
      prev.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row))
    );
  };

  const handleRemoveRow = (rowId: string) => {
    onChange((prev) => prev.filter((row) => row.rowId !== rowId));
    if (quickSubjectRowId === rowId) {
      setQuickSubjectRowId(null);
    }
  };

  const handleQuickCreateSubject = async (row: DestinationRowState) => {
    setQuickSubjectError(null);
    if (!firebaseUser || !canCreateSubject) {
      setQuickSubjectError('لا تملك صلاحية إنشاء مواد جديدة.');
      return;
    }
    if (!row.specializationId || !row.academicYearId || !row.semesterId) {
      setQuickSubjectError('يرجى تحديد السنة والفصل الدراسي أولاً.');
      return;
    }
    const cleanName = quickSubjectName.trim();
    if (cleanName.length < 2) {
      setQuickSubjectError('اسم المادة يجب أن يكون حرفين على الأقل.');
      return;
    }

    setCreatingSubject(true);
    try {
      const subId = generateSafeId('sub');
      const existingInSem = getSubjectsForSemester(
        subjects,
        row.specializationId,
        row.academicYearId,
        row.semesterId,
        true,
        programCourses
      );
      const cleanCode = quickSubjectCode.trim().toUpperCase();
      const subjectPayload: Subject = {
        id: subId,
        specializationId: row.specializationId,
        academicYearId: row.academicYearId,
        semesterId: row.semesterId,
        name: cleanName.slice(0, 140),
        ...(cleanCode ? { code: cleanCode.slice(0, 40) } : {}),
        iconKey: 'book',
        status: 'published',
        sortOrder: computeNextSortOrder(existingInSem),
      };

      await setDoc(doc(db, 'subjects', subId), {
        ...subjectPayload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await refreshAdminCatalog();
      handleUpdateRow(row.rowId, { subjectId: subId });
      setQuickSubjectRowId(null);
      setQuickSubjectName('');
      setQuickSubjectCode('');
      onSubjectCreated?.(subjectPayload);
    } catch (err) {
      setQuickSubjectError(
        err instanceof Error ? err.message : 'تعذر إنشاء المادة الجديدة.'
      );
    } finally {
      setCreatingSubject(false);
    }
  };

  const completeRows = rows.filter(isDestinationComplete);
  const incompleteRowsCount = rows.length - completeRows.length;

  return (
    <div className="rounded-2xl border border-slate-200 bg-[#EAF4F7]/55 p-4 space-y-4">
      {/* Header + Selected Count Badge */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-bold text-[#0B2545] flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#00A6A6]" />
            <span>{titleLabel}</span>
            <span className="px-2 py-0.5 rounded-lg bg-[#0B2545] text-white text-[11px] font-bold tabular-nums">
              {selectedSpecIds.length} تخصص · {completeRows.length} وجهة جاهزة
            </span>
          </h3>
          <p className="text-xs text-slate-600 mt-0.5">{subtitleLabel}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleSelectAllFiltered}
            disabled={filteredSpecs.length === 0}
            className="min-h-[34px] px-3 py-1.5 rounded-xl bg-white hover:bg-[#0B2545] text-[#0B2545] hover:text-white border border-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <CheckSquare className="w-3.5 h-3.5 text-[#00A6A6]" />
            تحديد الكل ({filteredSpecs.length})
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            disabled={rows.length === 0}
            className="min-h-[34px] px-3 py-1.5 rounded-xl bg-white hover:bg-[#FF8066] text-slate-600 hover:text-white border border-slate-200 text-xs font-semibold inline-flex items-center gap-1 transition-colors disabled:opacity-50"
          >
            <Square className="w-3.5 h-3.5" />
            مسح التحديد
          </button>
        </div>
      </div>

      {/* Specializations Search + Multi-Select Cards */}
      <div className="space-y-2.5">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={specSearch}
            onChange={(e) => setSpecSearch(e.target.value)}
            placeholder="ابحث عن التخصص (مثال: الهندسة الطبية، المدني، الاتصالات...)"
            className="w-full min-h-[40px] pr-9 pl-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm text-[#0B2545]"
          />
        </div>

        <div
          className={`grid gap-2 ${
            compact
              ? 'grid-cols-1 sm:grid-cols-2 max-h-44 overflow-y-auto p-0.5'
              : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 max-h-52 overflow-y-auto p-0.5'
          }`}
        >
          {filteredSpecs.length === 0 ? (
            <p className="col-span-full text-xs text-slate-500 text-center py-4 bg-white rounded-xl border border-slate-200">
              لا توجد تخصصات مطابقة لعبارة البحث.
            </p>
          ) : (
            filteredSpecs.map((spec) => {
              const isSelected = selectedSpecIds.includes(spec.id);
              const countForSpec = rows.filter((r) => r.specializationId === spec.id).length;
              return (
                <button
                  key={spec.id}
                  type="button"
                  onClick={() => toggleSpecialization(spec.id)}
                  className={`min-h-[42px] px-3 py-2 rounded-xl border text-right flex items-center justify-between gap-2 transition-colors ${
                    isSelected
                      ? 'bg-[#0B2545] text-white border-[#0B2545] shadow-xs'
                      : 'bg-white text-[#0B2545] border-slate-200 hover:border-[#00A6A6]'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${
                        isSelected
                          ? 'bg-[#00A6A6] border-[#00A6A6] text-white'
                          : 'border-slate-300 bg-slate-50'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3" />}
                    </span>
                    <span className="text-xs font-bold truncate">{spec.name}</span>
                  </span>
                  {countForSpec > 1 && (
                    <span className="px-1.5 py-0.5 rounded bg-[#00A6A6] text-white text-[10px] font-bold tabular-nums shrink-0">
                      {countForSpec}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Selected Specializations Chips Strip */}
        {selectedSpecIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] font-bold text-[#0B2545]">التخصصات المختارة:</span>
            {selectedSpecIds.map((specId) => {
              const spec = specializations.find((s) => s.id === specId);
              if (!spec) return null;
              return (
                <span
                  key={specId}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-[#00A6A6]/40 text-xs font-semibold text-[#0B2545]"
                >
                  <span>{spec.name}</span>
                  <button
                    type="button"
                    onClick={() => toggleSpecialization(specId)}
                    aria-label={`إزالة ${spec.name}`}
                    className="text-slate-400 hover:text-[#FF8066]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Independent Academic Year / Semester / Subject Selector per Destination Row */}
      {rows.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold text-[#0B2545]">
              تحديد السنة والفصل والمادة لكل وجهة بشكل مستقل ({rows.length}):
            </p>
            {(inferredHint.name || inferredHint.code) && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[#00A6A6] font-semibold">
                <Sparkles className="w-3.5 h-3.5" />
                اقتراح تلقائي للمادة المشابهة مفعّل
              </span>
            )}
          </div>

          <div className="space-y-2.5">
            {rows.map((row) => {
              const spec = specializations.find((s) => s.id === row.specializationId);
              const years = getYearsForSpecialization(academicYears, row.specializationId, true);
              const sems = row.academicYearId
                ? getSemestersForYear(semesters, row.specializationId, row.academicYearId, true)
                : [];
              const subs =
                row.academicYearId && row.semesterId
                  ? getSubjectsForSemester(
                      subjects,
                      row.specializationId,
                      row.academicYearId,
                      row.semesterId,
                      true,
                      programCourses
                    )
                  : [];

              const destKey = `${row.specializationId}::${row.academicYearId}::${row.semesterId}::${row.subjectId}`;
              const isAlreadyLinked = Boolean(
                isDestinationComplete(row) && existingLinkedKeys?.has(destKey)
              );
              const isQuickOpen = quickSubjectRowId === row.rowId;

              return (
                <div
                  key={row.rowId}
                  className={`rounded-xl bg-white border p-3 space-y-2.5 ${
                    isAlreadyLinked
                      ? 'border-amber-300 bg-amber-50/40'
                      : !isDestinationComplete(row)
                        ? 'border-[#FF8066]/60'
                        : 'border-slate-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="px-2 py-0.5 rounded-lg bg-[#EAF4F7] text-[#0B2545] text-xs font-bold truncate">
                        {spec?.name || row.specializationId}
                      </span>
                      {isAlreadyLinked && (
                        <span className="px-2 py-0.5 rounded-lg bg-amber-100 text-amber-800 text-[10px] font-bold">
                          مرتبط مسبقاً بهذا الملف
                        </span>
                      )}
                      {!isDestinationComplete(row) && (
                        <span className="text-[11px] font-semibold text-[#FF8066] inline-flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5" />
                          أكمل اختيار المسار
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleAddExtraRowForSpec(row.specializationId)}
                        title="إضافة مادة/سنة أخرى في نفس التخصص"
                        className="min-h-[30px] px-2 py-1 rounded-lg border border-slate-200 hover:border-[#00A6A6] text-[11px] font-semibold text-[#0B2545] inline-flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3 text-[#00A6A6]" />
                        مادة أخرى
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveRow(row.rowId)}
                        aria-label={`إزالة وجهة ${spec?.name || ''}`}
                        className="min-h-[30px] min-w-[30px] rounded-lg border border-slate-200 hover:border-[#FF8066] text-slate-400 hover:text-[#FF8066] flex items-center justify-center"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        السنة الدراسية *
                      </label>
                      <select
                        value={row.academicYearId}
                        onChange={(e) => {
                          const nextYearId = e.target.value;
                          const nextSems = nextYearId
                            ? getSemestersForYear(semesters, row.specializationId, nextYearId, true)
                            : [];
                          const nextSemId = nextSems[0]?.id || '';
                          const nextSubs =
                            nextYearId && nextSemId
                              ? getSubjectsForSemester(
                                  subjects,
                                  row.specializationId,
                                  nextYearId,
                                  nextSemId,
                                  true,
                                  programCourses
                                )
                              : [];
                          const suggested =
                            inferredHint.name || inferredHint.code
                              ? suggestSubjectForSpecialization({
                                  sourceSubjectName: inferredHint.name,
                                  sourceSubjectCode: inferredHint.code,
                                  targetSubjects: nextSubs,
                                })
                              : undefined;
                          handleUpdateRow(row.rowId, {
                            academicYearId: nextYearId,
                            semesterId: nextSemId,
                            subjectId: suggested?.id || (nextSubs.length === 1 ? nextSubs[0].id : ''),
                          });
                        }}
                        className="w-full min-h-[38px] px-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-[#0B2545]"
                      >
                        <option value="">اختر السنة</option>
                        {years.map((y) => (
                          <option key={y.id} value={y.id}>
                            {y.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        الفصل الدراسي *
                      </label>
                      <select
                        value={row.semesterId}
                        disabled={!row.academicYearId}
                        onChange={(e) => {
                          const nextSemId = e.target.value;
                          const nextSubs =
                            row.academicYearId && nextSemId
                              ? getSubjectsForSemester(
                                  subjects,
                                  row.specializationId,
                                  row.academicYearId,
                                  nextSemId,
                                  true,
                                  programCourses
                                )
                              : [];
                          const suggested =
                            inferredHint.name || inferredHint.code
                              ? suggestSubjectForSpecialization({
                                  sourceSubjectName: inferredHint.name,
                                  sourceSubjectCode: inferredHint.code,
                                  targetSubjects: nextSubs,
                                })
                              : undefined;
                          handleUpdateRow(row.rowId, {
                            semesterId: nextSemId,
                            subjectId: suggested?.id || (nextSubs.length === 1 ? nextSubs[0].id : ''),
                          });
                        }}
                        className="w-full min-h-[38px] px-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-[#0B2545] disabled:opacity-50"
                      >
                        <option value="">اختر الفصل</option>
                        {sems.map((sm) => (
                          <option key={sm.id} value={sm.id}>
                            {sm.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <label className="block text-[11px] font-semibold text-slate-500">
                          المادة الدراسية *
                        </label>
                        {canCreateSubject && row.semesterId && (
                          <button
                            type="button"
                            onClick={() => {
                              setQuickSubjectRowId(isQuickOpen ? null : row.rowId);
                              setQuickSubjectName(inferredHint.name || '');
                              setQuickSubjectCode(inferredHint.code || '');
                              setQuickSubjectError(null);
                            }}
                            className="text-[11px] font-bold text-[#00A6A6] hover:underline inline-flex items-center gap-0.5"
                          >
                            <BookPlus className="w-3 h-3" />
                            + إنشاء مادة جديدة
                          </button>
                        )}
                      </div>
                      <select
                        value={row.subjectId}
                        disabled={!row.semesterId}
                        onChange={(e) =>
                          handleUpdateRow(row.rowId, { subjectId: e.target.value })
                        }
                        className="w-full min-h-[38px] px-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-[#0B2545] disabled:opacity-50"
                      >
                        <option value="">
                          {subs.length === 0 && row.semesterId
                            ? 'لا توجد مواد بهذا الفصل'
                            : 'اختر المادة'}
                        </option>
                        {subs.map((sub) => (
                          <option key={sub.id} value={sub.id}>
                            {sub.name}
                            {sub.code ? ` (${sub.code})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Quick Inline Subject Creation inside this Specialization/Year/Semester */}
                  {isQuickOpen && (
                    <div className="rounded-xl bg-[#EAF4F7] border border-[#00A6A6]/35 p-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-[#0B2545]">
                          إنشاء مادة جديدة داخل {spec?.name}
                        </p>
                        <button
                          type="button"
                          onClick={() => setQuickSubjectRowId(null)}
                          className="text-slate-500 hover:text-[#FF8066]"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <input
                          type="text"
                          value={quickSubjectName}
                          onChange={(e) => setQuickSubjectName(e.target.value)}
                          placeholder="اسم المادة الجديدة (مثال: Calculus 1)"
                          className="sm:col-span-2 min-h-[36px] px-3 rounded-lg bg-white border border-slate-200 text-xs text-[#0B2545]"
                        />
                        <input
                          type="text"
                          value={quickSubjectCode}
                          onChange={(e) => setQuickSubjectCode(e.target.value)}
                          placeholder="رمز المادة (اختياري)"
                          className="min-h-[36px] px-3 rounded-lg bg-white border border-slate-200 text-xs text-[#0B2545] font-mono"
                        />
                      </div>
                      {quickSubjectError && (
                        <p className="text-[11px] font-semibold text-[#FF8066]">
                          {quickSubjectError}
                        </p>
                      )}
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleQuickCreateSubject(row)}
                          disabled={creatingSubject}
                          className="min-h-[34px] px-3.5 py-1 rounded-lg bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs font-bold disabled:opacity-60"
                        >
                          {creatingSubject ? 'جاري الإنشاء...' : 'حفظ وربط المادة'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pre-Publish Distribution Summary */}
      {completeRows.length > 0 && (
        <div className="rounded-xl bg-white border border-[#00A6A6]/35 p-3 space-y-2">
          <p className="text-xs font-bold text-[#0B2545]">
            ملخص التوزيع المعتمد ({completeRows.length} وجهة مستقلة — يتم تخزين الملف مرة واحدة فقط):
          </p>
          <div className="flex flex-wrap gap-1.5">
            {completeRows.map((r) => {
              const sName = specializations.find((s) => s.id === r.specializationId)?.name || r.specializationId;
              const yName = academicYears.find((y) => y.id === r.academicYearId)?.name || r.academicYearId;
              const smName = semesters.find((sm) => sm.id === r.semesterId)?.name || r.semesterId;
              const subName = subjects.find((sb) => sb.id === r.subjectId)?.name || r.subjectId;
              return (
                <span
                  key={r.rowId}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#EAF4F7] text-[#0B2545] text-[11px] font-medium"
                >
                  <span className="font-bold">{sName}</span>
                  <span className="text-slate-400">←</span>
                  <span>{yName}</span>
                  <span className="text-slate-400">←</span>
                  <span>{smName}</span>
                  <span className="text-slate-400">←</span>
                  <span className="text-[#00A6A6] font-bold">{subName}</span>
                </span>
              );
            })}
          </div>
          {incompleteRowsCount > 0 && (
            <p className="text-[11px] font-semibold text-[#FF8066]">
              تنبيه: توجد {incompleteRowsCount} وجهات غير مكتملة (يرجى تحديد السنة/الفصل/المادة أو إزالة الصف).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function rowsToDestinationInputs(
  rows: DestinationRowState[]
): FileDestinationInput[] {
  return rows.filter(isDestinationComplete).map((r) => ({
    specializationId: r.specializationId,
    academicYearId: r.academicYearId,
    semesterId: r.semesterId,
    subjectId: r.subjectId,
    status: r.status,
  }));
}
