import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  Cloud,
  CopyCheck,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  GitMerge,
  HardDrive,
  Layers,
  Link2,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Share2,
  ShieldAlert,
  Trash2,
  Unlink,
  Upload,
  X,
} from 'lucide-react';
import {
  deleteDoc,
  deleteField,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import {
  LECTURE_CATEGORY_LABELS,
  LectureCategory,
  LectureFile,
  PublishStatus,
} from '../types/academic.ts';
import {
  formatFileSizeArabic,
  generateSafeId,
  getCategoryLabel,
  getSemestersForYear,
  getSubjectsForSemester,
  getYearsForSpecialization,
  isGoogleDriveFile,
  sortByOrder,
} from '../utils/academicLogic.ts';
import {
  buildCentralLibraryRows,
  buildDistributionLinkPlan,
  buildUnlinkDestinationPlan,
  CENTRAL_UNLINKED_MARKER,
  CentralLibraryFilterState,
  CentralLibraryRowMeta,
  computeCentralLibraryKpis,
  detectLibraryDuplicateGroups,
  DuplicateFileGroup,
  exportLibraryMetadataCsv,
  filterCentralLibraryRows,
  LibraryEffectiveStatus,
  ResolvedDestination,
} from '../utils/centralLibraryLogic.ts';
import {
  DestinationRowState,
  isDestinationComplete,
  MultiDestinationPicker,
  rowsToDestinationInputs,
} from './MultiDestinationPicker.tsx';

const PAGE_SIZE = 15;

const INITIAL_FILTERS: CentralLibraryFilterState = {
  query: '',
  specializationId: '',
  academicYearId: '',
  semesterId: '',
  subjectId: '',
  category: 'all',
  fileExt: '',
  uploaderUid: '',
  lifecycleFilter: 'all',
  dateFrom: '',
  dateTo: '',
};

const STATUS_BADGES: Record<
  LibraryEffectiveStatus,
  { label: string; className: string }
> = {
  linked: {
    label: 'مرتبط ونشط',
    className: 'bg-[#00A6A6]/12 text-[#008080] border-[#00A6A6]/30',
  },
  unlinked: {
    label: 'غير مرتبط بأي مقرر',
    className: 'bg-amber-50 text-amber-800 border-amber-300',
  },
  needs_review: {
    label: 'يحتاج مراجعة',
    className: 'bg-purple-50 text-purple-800 border-purple-200',
  },
  trashed: {
    label: 'في سلة المهملات',
    className: 'bg-[#FF8066]/15 text-[#c8432b] border-[#FF8066]/40',
  },
};

export function CentralLectureLibrary({
  onPreviewFile,
  onOpenUpload,
  onEditFile,
  onToast,
}: {
  onPreviewFile: (file: LectureFile) => void;
  onOpenUpload: () => void;
  onEditFile: (file: LectureFile) => void;
  onToast: (msg: string) => void;
}) {
  const { firebaseUser, profile, role, isSuperAdmin, hasPerm, getIdToken } =
    useAuth();
  const {
    specializations,
    academicYears,
    semesters,
    subjects,
    programCourses,
    lectureFileLinks,
    lectureFiles,
    refreshAdminCatalog,
    refreshStorageStats,
  } = usePlatformData();

  const canUpload = isSuperAdmin || hasPerm('lectures.upload');
  const canEdit = isSuperAdmin || hasPerm('lectures.edit');
  const canPublish = isSuperAdmin || hasPerm('lectures.publish');
  const canDelete = isSuperAdmin || hasPerm('lectures.delete');

  const [filters, setFilters] = useState<CentralLibraryFilterState>(INITIAL_FILTERS);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [busyAction, setBusyAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Reuse / Bulk Distribute Modal
  const [reuseModal, setReuseModal] = useState<{
    mode: 'single' | 'bulk';
    files: LectureFile[];
  } | null>(null);
  const [reuseRows, setReuseRows] = useState<DestinationRowState[]>([]);
  const [reuseStatus, setReuseStatus] = useState<PublishStatus>(
    canPublish ? 'published' : 'draft'
  );
  const [reuseStep, setReuseStep] = useState<'select' | 'review'>('select');

  // Manage Links Modal
  const [linksModalFile, setLinksModalFile] = useState<LectureFile | null>(null);
  const [addLinkMode, setAddLinkMode] = useState(false);
  const [addLinkRows, setAddLinkRows] = useState<DestinationRowState[]>([]);

  // Permanent Delete Confirmation Modal
  const [permDeleteTarget, setPermDeleteTarget] = useState<CentralLibraryRowMeta | null>(
    null
  );

  // Duplicate consolidation panel toggle
  const [showDuplicateGroups, setShowDuplicateGroups] = useState(false);

  const sortedSpecs = useMemo(() => sortByOrder(specializations), [specializations]);

  const rows = useMemo(
    () =>
      buildCentralLibraryRows({
        files: lectureFiles,
        links: lectureFileLinks,
        subjects,
        programCourses,
      }),
    [lectureFiles, lectureFileLinks, subjects, programCourses]
  );

  const kpis = useMemo(
    () => computeCentralLibraryKpis(rows, lectureFiles),
    [rows, lectureFiles]
  );

  const duplicateGroups = useMemo(
    () => detectLibraryDuplicateGroups(lectureFiles),
    [lectureFiles]
  );

  const availableExtensions = useMemo(() => {
    const set = new Set<string>();
    for (const f of lectureFiles) {
      if (f.fileExt) set.add(f.fileExt.toLowerCase());
    }
    return Array.from(set).sort();
  }, [lectureFiles]);

  const availableUploaders = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of lectureFiles) {
      if (f.uploadedBy) {
        map.set(
          f.uploadedBy,
          f.uploadedByName || f.uploadedByEmail || f.uploadedBy.slice(0, 10)
        );
      }
    }
    return Array.from(map.entries());
  }, [lectureFiles]);

  const filterYears = useMemo(
    () =>
      filters.specializationId
        ? getYearsForSpecialization(academicYears, filters.specializationId, true)
        : [],
    [academicYears, filters.specializationId]
  );
  const filterSemesters = useMemo(
    () =>
      filters.specializationId && filters.academicYearId
        ? getSemestersForYear(
            semesters,
            filters.specializationId,
            filters.academicYearId,
            true
          )
        : [],
    [semesters, filters.specializationId, filters.academicYearId]
  );
  const filterSubjects = useMemo(() => {
    if (filters.specializationId && filters.academicYearId && filters.semesterId) {
      return getSubjectsForSemester(
        subjects,
        filters.specializationId,
        filters.academicYearId,
        filters.semesterId,
        true,
        programCourses
      );
    }
    if (filters.specializationId) {
      return sortByOrder(
        subjects.filter((s) => s.specializationId === filters.specializationId)
      );
    }
    return sortByOrder(subjects);
  }, [
    subjects,
    programCourses,
    filters.specializationId,
    filters.academicYearId,
    filters.semesterId,
  ]);

  const filteredRows = useMemo(
    () => filterCentralLibraryRows(rows, filters),
    [rows, filters]
  );

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, safePage]);

  const updateFilter = (patch: Partial<CentralLibraryFilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const logCentralAction = async (
    action: string,
    entityId: string,
    entityName: string
  ) => {
    if (!firebaseUser) return;
    const logId = generateSafeId('log');
    await setDoc(doc(db, 'activityLogs', logId), {
      id: logId,
      actorUid: firebaseUser.uid,
      actorEmail: firebaseUser.email || '',
      actorName: profile?.displayName || firebaseUser.displayName || '',
      actorRole: role,
      action,
      entityType: 'lectureFile',
      entityId,
      entityName: entityName.slice(0, 190),
      result: 'success',
      createdAt: serverTimestamp(),
    }).catch(() => {});

    try {
      const token = await getIdToken();
      if (token) {
        await fetch('/api/admin/audit-logs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action,
            entityType: 'lectureFile',
            entityId,
            entityName: entityName.slice(0, 190),
            result: 'success',
          }),
        }).catch(() => {});
      }
    } catch {
      // non-fatal
    }
  };

  const describeDestination = (d: ResolvedDestination) => {
    const specName =
      specializations.find((s) => s.id === d.specializationId)?.name || d.specializationId;
    const yearName =
      academicYears.find((y) => y.id === d.academicYearId)?.name || d.academicYearId;
    const semName =
      semesters.find((sm) => sm.id === d.semesterId)?.name || d.semesterId;
    const subName = subjects.find((sb) => sb.id === d.subjectId)?.name || d.subjectId;
    return { specName, yearName, semName, subName };
  };

  const openReuseModal = (files: LectureFile[], mode: 'single' | 'bulk') => {
    setActionError(null);
    setReuseRows([]);
    setReuseStatus(canPublish ? 'published' : 'draft');
    setReuseStep('select');
    setReuseModal({ mode, files });
  };

  const handleConfirmReuseDistribution = async () => {
    if (!reuseModal || !firebaseUser) return;
    const validDestinations = rowsToDestinationInputs(reuseRows);
    if (
      validDestinations.length === 0 ||
      reuseRows.some((r) => !isDestinationComplete(r))
    ) {
      setActionError('يرجى إكمال تحديد التخصص والسنة والفصل والمادة لكل وجهة.');
      return;
    }

    setBusyAction(true);
    setActionError(null);
    try {
      const effectiveStatus: PublishStatus = canPublish ? reuseStatus : 'draft';
      let totalCreated = 0;
      let totalSkipped = 0;

      const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
      const now = serverTimestamp();

      for (const file of reuseModal.files) {
        const currentFileLinks = lectureFileLinks.filter(
          (l) => l.lectureFileId === file.id
        );
        const plan = buildDistributionLinkPlan({
          lectureFileId: file.id,
          destinations: validDestinations,
          existingLinks: currentFileLinks,
          defaultStatus: effectiveStatus,
          createdBy: firebaseUser.uid,
          startingSortOrder: file.sortOrder || 1,
        });

        totalSkipped += plan.skippedDuplicates;
        if (plan.toCreate.length === 0) continue;
        totalCreated += plan.toCreate.length;

        if (
          canEdit &&
          (file.specializationId === CENTRAL_UNLINKED_MARKER ||
            file.lifecycleStatus === 'trashed')
        ) {
          const first = plan.toCreate[0];
          ops.push((b) =>
            b.update(doc(db, 'lectureFiles', file.id), {
              specializationId: first.specializationId,
              academicYearId: first.academicYearId,
              semesterId: first.semesterId,
              subjectId: first.subjectId,
              lifecycleStatus: 'active',
              status: canPublish ? effectiveStatus : file.status,
              updatedAt: now,
            })
          );
        }

        for (const linkPayload of plan.toCreate) {
          ops.push((b) =>
            b.set(doc(db, 'lectureFileLinks', linkPayload.id), {
              ...linkPayload,
              createdAt: now,
              updatedAt: now,
            })
          );
        }
      }

      if (ops.length === 0) {
        onToast(
          `الملفات المختارة مرتبطة مسبقاً بهذه الوجهات (${totalSkipped} مكررة تم تخطيها).`
        );
        setReuseModal(null);
        return;
      }

      // Commit in safe chunks of 380 operations (Firestore limit is 500)
      for (let i = 0; i < ops.length; i += 380) {
        const batch = writeBatch(db);
        for (const fn of ops.slice(i, i + 380)) {
          fn(batch);
        }
        await batch.commit();
      }

      await logCentralAction(
        reuseModal.mode === 'bulk'
          ? 'توزيع جماعي لملفات المكتبة المركزية'
          : 'إعادة استخدام وتوزيع ملف محاضرة',
        reuseModal.files[0].id,
        `${reuseModal.files.length} ملف -> ${totalCreated} وجهة جديدة`
      );

      setReuseModal(null);
      setSelectedFileIds(new Set());
      await refreshAdminCatalog();
      onToast(
        `تم توزيع ${reuseModal.files.length} ملف وإضافة ${totalCreated} رابط جديد بنجاح${
          totalSkipped > 0 ? ` (تم تخطي ${totalSkipped} وجهة مرتبطة مسبقاً)` : ''
        }.`
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'تعذر تنفيذ عملية التوزيع.'
      );
    } finally {
      setBusyAction(false);
    }
  };

  const handleUnlinkSingleDestination = async (
    file: LectureFile,
    dest: ResolvedDestination,
    allDests: ResolvedDestination[]
  ) => {
    if (!firebaseUser) return;
    setBusyAction(true);
    setActionError(null);
    try {
      const plan = buildUnlinkDestinationPlan({
        file,
        targetDestination: dest,
        allCurrentDestinations: allDests,
        actorUid: firebaseUser.uid,
      });

      const batch = writeBatch(db);
      const now = serverTimestamp();

      for (const linkPayload of plan.createLinks) {
        batch.set(doc(db, 'lectureFileLinks', linkPayload.id), {
          ...linkPayload,
          createdAt: now,
          updatedAt: now,
        });
      }

      for (const linkId of plan.deleteLinkIds) {
        batch.delete(doc(db, 'lectureFileLinks', linkId));
      }

      if (plan.markFileUnlinked) {
        batch.update(doc(db, 'lectureFiles', file.id), {
          specializationId: CENTRAL_UNLINKED_MARKER,
          status: 'draft',
          updatedAt: now,
        });
      } else if (
        file.specializationId === dest.specializationId &&
        plan.createLinks.length + (allDests.length - 1) > 0
      ) {
        const remainingFirst = allDests.find(
          (d) =>
            d.specializationId !== dest.specializationId ||
            d.academicYearId !== dest.academicYearId ||
            d.semesterId !== dest.semesterId ||
            d.subjectId !== dest.subjectId
        );
        if (remainingFirst) {
          batch.update(doc(db, 'lectureFiles', file.id), {
            specializationId: remainingFirst.specializationId,
            academicYearId: remainingFirst.academicYearId,
            semesterId: remainingFirst.semesterId,
            subjectId: remainingFirst.subjectId,
            updatedAt: now,
          });
        }
      }

      await batch.commit();

      const info = describeDestination(dest);
      await logCentralAction(
        'فك ارتباط ملف من تخصص واحد',
        file.id,
        `${file.title} <- ${info.specName} (${info.subName})`
      );

      await refreshAdminCatalog();
      onToast(
        plan.markFileUnlinked
          ? `تمت إزالة آخر رابط للملف "${file.title}" وأصبح غير مرتبط داخل المكتبة المركزية.`
          : `تمت إزالة الملف "${file.title}" من ${info.specName} (${info.subName}) فقط مع بقائه في بقية التخصصات.`
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'تعذر فك الارتباط بالوجهة المحددة.'
      );
    } finally {
      setBusyAction(false);
    }
  };

  const handleAddLinksInManageModal = async () => {
    if (!linksModalFile || !firebaseUser) return;
    const valid = rowsToDestinationInputs(addLinkRows);
    if (valid.length === 0 || addLinkRows.some((r) => !isDestinationComplete(r))) {
      setActionError('يرجى إكمال تحديد جميع الحقول لكل وجهة جديدة.');
      return;
    }

    setBusyAction(true);
    setActionError(null);
    try {
      const existing = lectureFileLinks.filter(
        (l) => l.lectureFileId === linksModalFile.id
      );
      const effectiveStatus: PublishStatus = canPublish
        ? linksModalFile.status
        : 'draft';
      const plan = buildDistributionLinkPlan({
        lectureFileId: linksModalFile.id,
        destinations: valid,
        existingLinks: existing,
        defaultStatus: effectiveStatus,
        createdBy: firebaseUser.uid,
      });

      if (plan.toCreate.length === 0) {
        onToast('جميع الوجهات المختارة مرتبطة بالفعل بهذا الملف.');
        setAddLinkMode(false);
        return;
      }

      const batch = writeBatch(db);
      const now = serverTimestamp();

      // If this file was previously an unmigrated legacy file with 0 explicit links,
      // materialize its existing fallback destinations as explicit links too so they are preserved!
      if (existing.length === 0 && linksModalFile.specializationId !== CENTRAL_UNLINKED_MARKER) {
        const currentFallback = getFileDestinationsFallback(linksModalFile);
        const legacyPlan = buildDistributionLinkPlan({
          lectureFileId: linksModalFile.id,
          destinations: currentFallback,
          existingLinks: plan.toCreate.map((c) => ({ ...c })),
          defaultStatus: linksModalFile.status,
          createdBy: firebaseUser.uid,
        });
        for (const lp of legacyPlan.toCreate) {
          batch.set(doc(db, 'lectureFileLinks', lp.id), {
            ...lp,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      if (linksModalFile.specializationId === CENTRAL_UNLINKED_MARKER && canEdit) {
        const first = plan.toCreate[0];
        batch.update(doc(db, 'lectureFiles', linksModalFile.id), {
          specializationId: first.specializationId,
          academicYearId: first.academicYearId,
          semesterId: first.semesterId,
          subjectId: first.subjectId,
          lifecycleStatus: 'active',
          updatedAt: now,
        });
      }

      for (const linkPayload of plan.toCreate) {
        batch.set(doc(db, 'lectureFileLinks', linkPayload.id), {
          ...linkPayload,
          createdAt: now,
          updatedAt: now,
        });
      }

      await batch.commit();
      await logCentralAction(
        'إضافة وجهات توزيع لملف',
        linksModalFile.id,
        `${linksModalFile.title} (+${plan.toCreate.length})`
      );
      setAddLinkMode(false);
      setAddLinkRows([]);
      await refreshAdminCatalog();
      onToast(`تمت إضافة ${plan.toCreate.length} وجهة جديدة للملف بنجاح.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'تعذر إضافة الوجهات.');
    } finally {
      setBusyAction(false);
    }
  };

  function getFileDestinationsFallback(file: LectureFile) {
    const dests =
      rows.find((r) => r.file.id === file.id)?.destinations || [];
    return dests.map((d) => ({
      specializationId: d.specializationId,
      academicYearId: d.academicYearId,
      semesterId: d.semesterId,
      subjectId: d.subjectId,
      status: d.status,
    }));
  }

  const handleSoftDeleteFiles = async (filesToTrash: LectureFile[]) => {
    if (!firebaseUser || !canDelete || filesToTrash.length === 0) return;
    setBusyAction(true);
    setActionError(null);
    try {
      const nowIso = new Date().toISOString();
      for (let i = 0; i < filesToTrash.length; i += 350) {
        const batch = writeBatch(db);
        const now = serverTimestamp();
        for (const f of filesToTrash.slice(i, i + 350)) {
          batch.update(doc(db, 'lectureFiles', f.id), {
            lifecycleStatus: 'trashed',
            deletedAt: nowIso,
            deletedBy: firebaseUser.uid,
            status: 'draft',
            updatedAt: now,
          });
        }
        await batch.commit();
      }
      await logCentralAction(
        filesToTrash.length > 1 ? 'نقل مجموعة ملفات إلى المهملات' : 'نقل ملف إلى المهملات',
        filesToTrash[0].id,
        filesToTrash.length > 1
          ? `${filesToTrash.length} ملفات`
          : filesToTrash[0].title
      );
      setSelectedFileIds(new Set());
      await refreshAdminCatalog();
      onToast(
        filesToTrash.length > 1
          ? `تم نقل ${filesToTrash.length} ملفات إلى سلة المهملات وإخفاؤها عن الطلاب.`
          : `تم نقل "${filesToTrash[0].title}" إلى سلة المهملات.`
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'تعذر النقل إلى المهملات.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleRestoreFile = async (file: LectureFile) => {
    if (!firebaseUser || !canDelete) return;
    setBusyAction(true);
    setActionError(null);
    try {
      await updateDoc(doc(db, 'lectureFiles', file.id), {
        lifecycleStatus: 'active',
        deletedAt: deleteField(),
        deletedBy: deleteField(),
        status: canPublish && file.specializationId !== CENTRAL_UNLINKED_MARKER ? 'published' : 'draft',
        updatedAt: serverTimestamp(),
      });
      await logCentralAction('استعادة ملف من سلة المهملات', file.id, file.title);
      await refreshAdminCatalog();
      onToast(`تمت استعادة "${file.title}" إلى المكتبة المركزية بنجاح.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'تعذر استعادة الملف.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleToggleNeedsReview = async (file: LectureFile) => {
    if (!canEdit) return;
    const nextLifecycle =
      file.lifecycleStatus === 'needs_review' ? 'active' : 'needs_review';
    setBusyAction(true);
    try {
      await updateDoc(doc(db, 'lectureFiles', file.id), {
        lifecycleStatus: nextLifecycle,
        updatedAt: serverTimestamp(),
      });
      await refreshAdminCatalog();
      onToast(
        nextLifecycle === 'needs_review'
          ? `تم تعليم "${file.title}" للمراجعة.`
          : `تمت إزالة وسم المراجعة عن "${file.title}".`
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'تعذر تحديث حالة المراجعة.');
    } finally {
      setBusyAction(false);
    }
  };

  const handlePermanentDeleteConfirm = async () => {
    if (!permDeleteTarget || !canDelete) return;
    const { file } = permDeleteTarget;
    setBusyAction(true);
    setActionError(null);
    try {
      const token = await getIdToken();
      if (
        token &&
        file.storageName &&
        !isGoogleDriveFile(file) &&
        !file.storageName.startsWith('gdrive_')
      ) {
        const qs = new URLSearchParams({
          fileId: file.id,
          ...(file.storagePath ? { storagePath: file.storagePath } : {}),
        });
        await fetch(
          `/api/files/storage/${encodeURIComponent(file.storageName)}?${qs.toString()}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }
        ).catch(() => {});
      }

      const fileLinks = lectureFileLinks.filter((l) => l.lectureFileId === file.id);
      const batch = writeBatch(db);
      for (const l of fileLinks) {
        batch.delete(doc(db, 'lectureFileLinks', l.id));
      }
      batch.delete(doc(db, 'lectureFiles', file.id));
      await batch.commit();

      await logCentralAction('حذف نهائي لملف وجميع روابطه', file.id, file.title);
      setPermDeleteTarget(null);
      await Promise.all([refreshAdminCatalog(), refreshStorageStats()]);
      onToast(`تم الحذف النهائي للملف "${file.title}" وإزالة ${fileLinks.length} روابط.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'تعذر الحذف النهائي.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleConsolidateDuplicateGroup = async (group: DuplicateFileGroup) => {
    if (!firebaseUser || !canEdit || !canDelete) return;
    setBusyAction(true);
    setActionError(null);
    try {
      const canonical = group.canonicalFile;
      const canonicalExistingLinks = lectureFileLinks.filter(
        (l) => l.lectureFileId === canonical.id
      );

      const allDupDestinations = group.duplicates.flatMap((dupFile) =>
        getFileDestinationsFallback(dupFile)
      );

      // Also include canonical fallback placements if canonical had no explicit links yet
      const canonicalSeedDests =
        canonicalExistingLinks.length === 0
          ? getFileDestinationsFallback(canonical)
          : [];

      const combinedPlan = buildDistributionLinkPlan({
        lectureFileId: canonical.id,
        destinations: [...canonicalSeedDests, ...allDupDestinations],
        existingLinks: canonicalExistingLinks,
        defaultStatus: canonical.status,
        createdBy: firebaseUser.uid,
        startingSortOrder: canonical.sortOrder || 1,
      });

      const batch = writeBatch(db);
      const now = serverTimestamp();
      const nowIso = new Date().toISOString();

      for (const lp of combinedPlan.toCreate) {
        batch.set(doc(db, 'lectureFileLinks', lp.id), {
          ...lp,
          createdAt: now,
          updatedAt: now,
        });
      }

      for (const dupFile of group.duplicates) {
        batch.update(doc(db, 'lectureFiles', dupFile.id), {
          lifecycleStatus: 'trashed',
          deletedAt: nowIso,
          deletedBy: firebaseUser.uid,
          status: 'draft',
          updatedAt: now,
        });
      }

      await batch.commit();
      await logCentralAction(
        'دمج آمن للملفات المكررة (SHA-256)',
        canonical.id,
        `${canonical.title} (${group.duplicates.length} مكررة)`
      );
      await refreshAdminCatalog();
      onToast(
        `تم دمج ${group.duplicates.length} نسخ مكررة مع "${canonical.title}" والحفاظ على كافة الروابط دون فقدان أي مقرر.`
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'تعذر دمج المجموعة المكررة.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleExport = (format: 'csv' | 'json') => {
    const targetRows =
      selectedFileIds.size > 0
        ? rows.filter((r) => selectedFileIds.has(r.file.id))
        : filteredRows;

    if (targetRows.length === 0) {
      onToast('لا توجد بيانات للتصدير.');
      return;
    }

    const content =
      format === 'csv'
        ? exportLibraryMetadataCsv(targetRows, specializations, subjects)
        : JSON.stringify(
            targetRows.map((r) => ({
              id: r.file.id,
              title: r.file.title,
              originalName: r.file.originalName,
              fileExt: r.file.fileExt,
              fileSize: r.file.fileSize,
              sha256: r.file.sha256 || null,
              effectiveStatus: r.effectiveStatus,
              destinationsCount: r.destinations.length,
              destinations: r.destinations.map((d) => describeDestination(d)),
            })),
            null,
            2
          );

    const blob = new Blob([content], {
      type:
        format === 'csv'
          ? 'text/csv;charset=utf-8;'
          : 'application/json;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ust-central-library-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onToast(`تم تصدير ${targetRows.length} سجل بصيغة ${format.toUpperCase()}.`);
  };

  const selectedFilesList = useMemo(
    () => lectureFiles.filter((f) => selectedFileIds.has(f.id)),
    [lectureFiles, selectedFileIds]
  );

  const toggleSelectAllOnPage = () => {
    const pageIds = pagedRows.map((r) => r.file.id);
    const allSelected =
      pageIds.length > 0 && pageIds.every((id) => selectedFileIds.has(id));
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  };

  const activeManageDestinations = useMemo(() => {
    if (!linksModalFile) return [];
    const matched = rows.find((r) => r.file.id === linksModalFile.id);
    return matched ? matched.destinations : [];
  }, [linksModalFile, rows]);

  const activeManageExistingKeys = useMemo(
    () =>
      new Set(
        activeManageDestinations.map(
          (d) =>
            `${d.specializationId}::${d.academicYearId}::${d.semesterId}::${d.subjectId}`
        )
      ),
    [activeManageDestinations]
  );

  const reuseExistingKeys = useMemo(() => {
    if (!reuseModal || reuseModal.mode !== 'single') return undefined;
    const f = reuseModal.files[0];
    const dests = rows.find((r) => r.file.id === f.id)?.destinations || [];
    return new Set(
      dests.map(
        (d) =>
          `${d.specializationId}::${d.academicYearId}::${d.semesterId}::${d.subjectId}`
      )
    );
  }, [reuseModal, rows]);

  return (
    <div className="space-y-5">
      {/* Top Action Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-[#0B2545] flex items-center gap-2">
            <Layers className="w-5 h-5 text-[#00A6A6]" />
            المكتبة المركزية للمحاضرات والتوزيع متعدد التخصصات
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            إدارة مركزية موحدة لجميع ملفات المنصة: أعد استخدام أي ملف قديم ووزعه على تخصصات أخرى بنقرة واحدة بدون إعادة الرفع.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {duplicateGroups.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDuplicateGroups((prev) => !prev)}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-bold inline-flex items-center gap-1.5"
            >
              <GitMerge className="w-4 h-4 text-amber-700" />
              تنظيف المكررات ({duplicateGroups.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => handleExport('csv')}
            className="min-h-[40px] px-3 py-2 rounded-xl bg-[#EAF4F7] hover:bg-[#0B2545] text-[#0B2545] hover:text-white border border-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#00A6A6]" />
            تصدير CSV
          </button>
          {canUpload && (
            <button
              type="button"
              onClick={onOpenUpload}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
            >
              <Upload className="w-4 h-4" />
              رفع وتوزيع ملف جديد
            </button>
          )}
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1">
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-[#00A6A6]" />
            إجمالي الملفات المركزية
          </p>
          <p className="font-display text-xl font-bold text-[#0B2545] tabular-nums">
            {kpis.activeFiles}
            <span className="text-xs font-normal text-slate-400 mr-1.5">
              ({kpis.trashedFiles} بالمهملات)
            </span>
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1">
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5 text-[#00A6A6]" />
            الحجم الفعلي المخزّن
          </p>
          <p className="font-display text-xl font-bold text-[#0B2545] tabular-nums">
            {formatFileSizeArabic(kpis.totalStorageBytes)}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1">
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5 text-[#00A6A6]" />
            إجمالي روابط التوزيع
          </p>
          <p className="font-display text-xl font-bold text-[#0B2545] tabular-nums">
            {kpis.totalLinks}
            <span className="text-xs font-normal text-[#00A6A6] mr-1.5">
              ({kpis.linkedFiles} مرتبط)
            </span>
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1">
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            غير مرتبطة / للمراجعة
          </p>
          <p className="font-display text-xl font-bold text-[#0B2545] tabular-nums">
            {kpis.unlinkedFiles} / {kpis.needsReviewFiles}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1 col-span-2 sm:col-span-1">
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <GitMerge className="w-3.5 h-3.5 text-[#FF8066]" />
            تكرارات قابلة للتوفير
          </p>
          <p className="font-display text-xl font-bold text-[#0B2545] tabular-nums">
            {kpis.duplicateGroupsCount}
            <span className="text-xs font-normal text-slate-500 mr-1.5">
              ({formatFileSizeArabic(kpis.recoverableDuplicateBytes)})
            </span>
          </p>
        </div>
      </div>

      {/* Historical Duplicate Consolidation Panel */}
      {showDuplicateGroups && duplicateGroups.length > 0 && (
        <section className="bg-amber-50/70 rounded-2xl border border-amber-300 p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-bold text-[#0B2545] flex items-center gap-2">
                <GitMerge className="w-4 h-4 text-amber-700" />
                الدمج الآمن للملفات المكررة بالمحتوى (SHA-256)
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                يتم نقل كافة الوجهات والروابط من النسخ المكررة إلى الملف الأصلي الأقدم ثم نقل النسخ الزائدة إلى سلة المهملات دون حذف أي مقرر.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowDuplicateGroups(false)}
              className="text-xs font-semibold text-slate-600 hover:text-[#0B2545]"
            >
              إخفاء
            </button>
          </div>

          <div className="space-y-2.5">
            {duplicateGroups.map((grp) => (
              <div
                key={grp.signature}
                className="bg-white rounded-xl border border-amber-200 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-bold text-[#0B2545] truncate">
                    الأصل المعتمد: {grp.canonicalFile.title} ({grp.canonicalFile.originalName})
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {grp.duplicates.length} نسخة مطابقة · قابل للتوفير:{' '}
                    <strong className="text-[#0B2545]">
                      {formatFileSizeArabic(grp.recoverableBytes)}
                    </strong>
                    {grp.sha256 && ` · SHA256: ${grp.sha256.slice(0, 12)}…`}
                  </p>
                </div>
                {canEdit && canDelete && (
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => handleConsolidateDuplicateGroup(grp)}
                    className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#0B2545] hover:bg-[#133866] text-white text-xs font-bold inline-flex items-center gap-1.5 shrink-0 disabled:opacity-60"
                  >
                    <GitMerge className="w-3.5 h-3.5 text-[#00A6A6]" />
                    دمج آمن للمكررات
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Search + Lifecycle Tabs + Cascading Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 'all', label: `النشطة (${kpis.activeFiles})` },
              { id: 'linked', label: `مرتبطة (${kpis.linkedFiles})` },
              { id: 'unlinked', label: `غير مرتبطة (${kpis.unlinkedFiles})` },
              { id: 'needs_review', label: `تحتاج مراجعة (${kpis.needsReviewFiles})` },
              { id: 'duplicates', label: `مكررات (${duplicateGroups.length})` },
              { id: 'trashed', label: `المهملات (${kpis.trashedFiles})` },
            ] as const
          ).map((pill) => {
            const active = filters.lifecycleFilter === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => updateFilter({ lifecycleFilter: pill.id })}
                className={`min-h-[34px] px-3 py-1 rounded-xl text-xs font-bold transition-colors ${
                  active
                    ? 'bg-[#0B2545] text-white'
                    : 'bg-[#EAF4F7]/80 text-[#0B2545] hover:bg-[#EAF4F7]'
                }`}
              >
                {pill.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={filters.query}
              onChange={(e) => updateFilter({ query: e.target.value })}
              placeholder="ابحث بالعنوان أو اسم الملف أو الوصف أو الرافع..."
              className="w-full min-h-[42px] pr-9 pl-3 rounded-xl border border-slate-200 text-sm text-[#0B2545]"
            />
          </div>

          <select
            value={filters.specializationId}
            onChange={(e) =>
              updateFilter({
                specializationId: e.target.value,
                academicYearId: '',
                semesterId: '',
                subjectId: '',
              })
            }
            aria-label="تصفية حسب التخصص"
            className="min-h-[42px] px-3 rounded-xl border border-slate-200 text-xs sm:text-sm text-[#0B2545]"
          >
            <option value="">كل التخصصات</option>
            {sortedSpecs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <select
            value={filters.subjectId}
            onChange={(e) => updateFilter({ subjectId: e.target.value })}
            aria-label="تصفية حسب المادة"
            className="min-h-[42px] px-3 rounded-xl border border-slate-200 text-xs sm:text-sm text-[#0B2545]"
          >
            <option value="">كل المواد</option>
            {filterSubjects.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {sub.name}
                {sub.code ? ` (${sub.code})` : ''}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setShowAdvancedFilters((prev) => !prev)}
            className={`min-h-[42px] px-3.5 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 ${
              showAdvancedFilters
                ? 'bg-[#00A6A6] text-white border-[#00A6A6]'
                : 'bg-white text-[#0B2545] border-slate-200 hover:border-[#00A6A6]'
            }`}
          >
            <Filter className="w-4 h-4" />
            فلاتر متقدمة
          </button>
        </div>

        {showAdvancedFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2 border-t border-slate-100">
            <select
              value={filters.academicYearId}
              disabled={!filters.specializationId}
              onChange={(e) =>
                updateFilter({
                  academicYearId: e.target.value,
                  semesterId: '',
                  subjectId: '',
                })
              }
              className="min-h-[38px] px-3 rounded-xl border border-slate-200 text-xs disabled:opacity-50"
            >
              <option value="">كل السنوات</option>
              {filterYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </select>

            <select
              value={filters.semesterId}
              disabled={!filters.academicYearId}
              onChange={(e) =>
                updateFilter({ semesterId: e.target.value, subjectId: '' })
              }
              className="min-h-[38px] px-3 rounded-xl border border-slate-200 text-xs disabled:opacity-50"
            >
              <option value="">كل الفصول</option>
              {filterSemesters.map((sm) => (
                <option key={sm.id} value={sm.id}>
                  {sm.name}
                </option>
              ))}
            </select>

            <select
              value={filters.category}
              onChange={(e) =>
                updateFilter({
                  category: e.target.value as LectureCategory | 'all',
                })
              }
              className="min-h-[38px] px-3 rounded-xl border border-slate-200 text-xs"
            >
              <option value="all">كل التصنيفات</option>
              {(Object.keys(LECTURE_CATEGORY_LABELS) as LectureCategory[]).map((k) => (
                <option key={k} value={k}>
                  {LECTURE_CATEGORY_LABELS[k]}
                </option>
              ))}
            </select>

            <select
              value={filters.fileExt}
              onChange={(e) => updateFilter({ fileExt: e.target.value })}
              className="min-h-[38px] px-3 rounded-xl border border-slate-200 text-xs"
            >
              <option value="">كل الصيغ</option>
              {availableExtensions.map((ext) => (
                <option key={ext} value={ext}>
                  {ext.toUpperCase()}
                </option>
              ))}
            </select>

            <select
              value={filters.uploaderUid}
              onChange={(e) => updateFilter({ uploaderUid: e.target.value })}
              className="min-h-[38px] px-3 rounded-xl border border-slate-200 text-xs"
            >
              <option value="">كل المشرفين الرافعين</option>
              {availableUploaders.map(([uid, label]) => (
                <option key={uid} value={uid}>
                  {label}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => updateFilter({ dateFrom: e.target.value })}
              aria-label="من تاريخ"
              className="min-h-[38px] px-3 rounded-xl border border-slate-200 text-xs"
            />

            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => updateFilter({ dateTo: e.target.value })}
              aria-label="إلى تاريخ"
              className="min-h-[38px] px-3 rounded-xl border border-slate-200 text-xs"
            />

            <button
              type="button"
              onClick={() => {
                setFilters(INITIAL_FILTERS);
                setPage(1);
              }}
              className="min-h-[38px] px-3 rounded-xl border border-slate-200 text-xs font-semibold text-[#FF8066] hover:bg-[#FF8066]/10"
            >
              إعادة ضبط الفلاتر
            </button>
          </div>
        )}
      </div>

      {/* Bulk Selection Bar */}
      {selectedFileIds.size > 0 && (
        <div className="rounded-2xl bg-[#0B2545] text-white p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-2 text-xs sm:text-sm font-bold">
            <CheckCircle2 className="w-4 h-4 text-[#00A6A6]" />
            <span>تم تحديد {selectedFileIds.size} ملفات</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canUpload && (
              <button
                type="button"
                onClick={() => openReuseModal(selectedFilesList, 'bulk')}
                className="min-h-[36px] px-3.5 py-1.5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Share2 className="w-3.5 h-3.5" />
                توزيع جماعي على برامج متعددة
              </button>
            )}
            <button
              type="button"
              onClick={() => handleExport('csv')}
              className="min-h-[36px] px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
            <button
              type="button"
              onClick={() => handleExport('json')}
              className="min-h-[36px] px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              JSON
            </button>
            {canDelete && filters.lifecycleFilter !== 'trashed' && (
              <button
                type="button"
                disabled={busyAction}
                onClick={() =>
                  handleSoftDeleteFiles(
                    selectedFilesList.filter((f) => f.lifecycleStatus !== 'trashed')
                  )
                }
                className="min-h-[36px] px-3.5 py-1.5 rounded-xl bg-[#FF8066] hover:bg-[#e56d54] text-white text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                نقل المحدد للمهملات
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedFileIds(new Set())}
              className="min-h-[36px] px-2.5 py-1.5 rounded-xl bg-white/10 text-xs"
            >
              إلغاء التحديد
            </button>
          </div>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="rounded-xl bg-[#FF8066]/12 border border-[#FF8066]/40 px-4 py-3 text-xs sm:text-sm font-semibold text-[#0B2545]"
        >
          {actionError}
        </div>
      )}

      {/* Central Library Table (Desktop) & Cards (Mobile) */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 bg-[#EAF4F7]/65 border-b border-slate-200 flex items-center justify-between gap-2 text-xs">
          <label className="inline-flex items-center gap-2 font-bold text-[#0B2545] cursor-pointer">
            <input
              type="checkbox"
              checked={
                pagedRows.length > 0 &&
                pagedRows.every((r) => selectedFileIds.has(r.file.id))
              }
              onChange={toggleSelectAllOnPage}
              className="w-4 h-4 accent-[#00A6A6]"
            />
            تحديد الكل في الصفحة ({pagedRows.length} من أصل {filteredRows.length})
          </label>
          <span className="text-slate-500 tabular-nums">
            صفحة {safePage} من {totalPages}
          </span>
        </div>

        {pagedRows.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Layers className="w-10 h-10 mx-auto text-slate-300" />
            <p className="text-sm font-bold text-[#0B2545]">
              لا توجد ملفات مطابقة لمعايير التصفية الحالية
            </p>
            <p className="text-xs text-slate-500">
              جرّب تعديل كلمات البحث أو الانتقال إلى تبويب آخر من حالة الملفات.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {pagedRows.map((row) => {
              const { file, effectiveStatus, destinations, uniqueSpecializationIds, uniqueSubjectIds, isDuplicate } =
                row;
              const badge = STATUS_BADGES[effectiveStatus];
              const isChecked = selectedFileIds.has(file.id);

              return (
                <div
                  key={file.id}
                  className={`p-4 space-y-3 transition-colors ${
                    isChecked ? 'bg-[#EAF4F7]/45' : 'hover:bg-slate-50/70'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          setSelectedFileIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(file.id);
                            else next.delete(file.id);
                            return next;
                          });
                        }}
                        aria-label={`تحديد ${file.title}`}
                        className="mt-1 w-4 h-4 accent-[#00A6A6] shrink-0"
                      />

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h3 className="font-display text-sm font-bold text-[#0B2545]">
                            {file.title}
                          </h3>
                          <span
                            className={`px-2 py-0.5 rounded-lg border text-[10px] font-bold ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                          {isGoogleDriveFile(file) && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#EAF4F7] text-[#00A6A6] text-[10px] font-bold">
                              <Cloud className="w-3 h-3" />
                              Drive
                            </span>
                          )}
                          {isDuplicate && effectiveStatus !== 'trashed' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-100 text-amber-800 text-[10px] font-bold">
                              <GitMerge className="w-3 h-3" />
                              نسخة مكررة
                            </span>
                          )}
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[#0B2545] text-[10px] font-mono uppercase">
                            {file.fileExt}
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span className="font-mono truncate max-w-[240px]">
                            {file.originalName}
                          </span>
                          <span>·</span>
                          <span>{getCategoryLabel(file.category)}</span>
                          <span>·</span>
                          <span className="tabular-nums">
                            {isGoogleDriveFile(file) && (!file.fileSize || file.fileSize <= 0)
                              ? 'رابط سحابي'
                              : formatFileSizeArabic(file.fileSize)}
                          </span>
                          {(file.uploadedByName || file.uploadedByEmail) && (
                            <>
                              <span>·</span>
                              <span>
                                بواسطة: {file.uploadedByName || file.uploadedByEmail}
                              </span>
                            </>
                          )}
                          {file.sha256 && (
                            <>
                              <span>·</span>
                              <span className="font-mono text-[10px] text-slate-400">
                                #{file.sha256.slice(0, 8)}
                              </span>
                            </>
                          )}
                        </p>

                        {/* Destinations Chips */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className="text-[11px] font-bold text-[#0B2545] tabular-nums">
                            الوجهات ({uniqueSpecializationIds.length} تخصصات ·{' '}
                            {uniqueSubjectIds.length} مواد):
                          </span>
                          {destinations.length === 0 ? (
                            <span className="text-[11px] text-amber-700 font-semibold">
                              لا توجد أي ارتباطات حالياً (محفوظ في المكتبة فقط)
                            </span>
                          ) : (
                            <>
                              {destinations.slice(0, 4).map((d, i) => {
                                const info = describeDestination(d);
                                return (
                                  <span
                                    key={d.linkId || `${d.specializationId}-${i}`}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#EAF4F7] text-[#0B2545] text-[11px] border border-slate-200/70"
                                  >
                                    <span className="font-semibold">{info.specName}</span>
                                    <span className="text-slate-400">·</span>
                                    <span>{info.yearName}</span>
                                    <span className="text-slate-400">·</span>
                                    <span className="text-[#00A6A6] font-semibold">
                                      {info.subName}
                                    </span>
                                  </span>
                                );
                              })}
                              {destinations.length > 4 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setLinksModalFile(file);
                                    setAddLinkMode(false);
                                    setAddLinkRows([]);
                                  }}
                                  className="text-[11px] font-bold text-[#00A6A6] hover:underline"
                                >
                                  +{destinations.length - 4} وجهات أخرى
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onPreviewFile(file)}
                        className="min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 hover:border-[#0B2545] text-xs font-semibold text-[#0B2545] inline-flex items-center gap-1"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        معاينة
                      </button>

                      {effectiveStatus !== 'trashed' && canUpload && (
                        <button
                          type="button"
                          onClick={() => openReuseModal([file], 'single')}
                          className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs font-bold inline-flex items-center gap-1"
                        >
                          <CopyCheck className="w-3.5 h-3.5" />
                          إعادة استخدام هذا الملف
                        </button>
                      )}

                      {effectiveStatus !== 'trashed' && (canEdit || canUpload) && (
                        <button
                          type="button"
                          onClick={() => {
                            setLinksModalFile(file);
                            setAddLinkMode(false);
                            setAddLinkRows([]);
                            setActionError(null);
                          }}
                          className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#EAF4F7] hover:bg-[#0B2545] text-[#0B2545] hover:text-white border border-slate-200 text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                          إدارة الروابط ({destinations.length})
                        </button>
                      )}

                      {canEdit && effectiveStatus !== 'trashed' && (
                        <>
                          <button
                            type="button"
                            onClick={() => onEditFile(file)}
                            aria-label={`تعديل ${file.title}`}
                            title="تعديل بيانات الملف"
                            className="min-h-[34px] min-w-[34px] rounded-lg border border-slate-200 flex items-center justify-center text-[#0B2545]"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleNeedsReview(file)}
                            title={
                              file.lifecycleStatus === 'needs_review'
                                ? 'إزالة وسم المراجعة'
                                : 'تعليم للمراجعة'
                            }
                            className={`min-h-[34px] min-w-[34px] rounded-lg border flex items-center justify-center ${
                              file.lifecycleStatus === 'needs_review'
                                ? 'border-purple-300 bg-purple-50 text-purple-700'
                                : 'border-slate-200 text-slate-500 hover:text-purple-700'
                            }`}
                          >
                            <ShieldAlert className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}

                      {canDelete && effectiveStatus !== 'trashed' && (
                        <button
                          type="button"
                          disabled={busyAction}
                          onClick={() => handleSoftDeleteFiles([file])}
                          title="نقل إلى سلة المهملات"
                          className="min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 hover:border-[#FF8066] text-xs font-semibold text-[#FF8066] inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          للمهملات
                        </button>
                      )}

                      {canDelete && effectiveStatus === 'trashed' && (
                        <>
                          <button
                            type="button"
                            disabled={busyAction}
                            onClick={() => handleRestoreFile(file)}
                            className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#00A6A6] text-white text-xs font-bold inline-flex items-center gap-1"
                          >
                            <ArchiveRestore className="w-3.5 h-3.5" />
                            استعادة
                          </button>
                          <button
                            type="button"
                            disabled={busyAction}
                            onClick={() => setPermDeleteTarget(row)}
                            className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#FF8066] text-white text-xs font-bold inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            حذف نهائي
                          </button>
                        </>
                      )}

                      {canDelete && effectiveStatus !== 'trashed' && (
                        <button
                          type="button"
                          onClick={() => setPermDeleteTarget(row)}
                          aria-label={`حذف نهائي ${file.title}`}
                          title="حذف نهائي (يُحذر من التخصصات المرتبطة)"
                          className="min-h-[34px] min-w-[34px] rounded-lg border border-slate-200 hover:bg-[#FF8066]/10 text-[#FF8066] flex items-center justify-center"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 text-xs">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="min-h-[36px] px-3 py-1 rounded-lg bg-white border border-slate-200 font-semibold text-[#0B2545] disabled:opacity-40"
            >
              السابق
            </button>
            <span className="font-semibold text-[#0B2545] tabular-nums">
              صفحة {safePage} من {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="min-h-[36px] px-3 py-1 rounded-lg bg-white border border-slate-200 font-semibold text-[#0B2545] disabled:opacity-40"
            >
              التالي
            </button>
          </div>
        )}
      </div>

      {/* REUSE / BULK DISTRIBUTE MODAL */}
      {reuseModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="إعادة استخدام وتوزيع الملفات"
          className="fixed inset-0 z-50 bg-[#0B2545]/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6"
          onClick={() => !busyAction && setReuseModal(null)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="px-5 py-4 bg-[#0B2545] text-white flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-base font-bold truncate">
                  {reuseModal.mode === 'bulk'
                    ? `توزيع جماعي لـ ${reuseModal.files.length} ملفات على البرامج المختارة`
                    : `إعادة استخدام الملف: ${reuseModal.files[0]?.title}`}
                </h3>
                <p className="text-xs text-white/75 mt-0.5">
                  سيتم ربط الملف بالوجهات الجديدة مباشرة دون إعادة رفعه أو استهلاك مساحة إضافية.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !busyAction && setReuseModal(null)}
                className="min-h-[36px] min-w-[36px] rounded-lg bg-white/10 hover:bg-[#FF8066] flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </header>

            <div className="p-5 overflow-y-auto space-y-4">
              {reuseStep === 'select' ? (
                <>
                  <MultiDestinationPicker
                    rows={reuseRows}
                    onChange={setReuseRows}
                    defaultStatus={canPublish ? reuseStatus : 'draft'}
                    existingLinkedKeys={reuseExistingKeys}
                    hintSubjectName={
                      subjects.find((s) => s.id === reuseModal.files[0]?.subjectId)?.name
                    }
                    hintSubjectCode={
                      subjects.find((s) => s.id === reuseModal.files[0]?.subjectId)?.code
                    }
                    titleLabel="اختر التخصصات والسنوات والفصول والمواد المستهدفة *"
                  />

                  {canPublish && (
                    <div className="flex items-center gap-3">
                      <label
                        htmlFor="reuse-publish-status"
                        className="text-xs font-bold text-[#0B2545]"
                      >
                        حالة النشر للروابط الجديدة:
                      </label>
                      <select
                        id="reuse-publish-status"
                        value={reuseStatus}
                        onChange={(e) => setReuseStatus(e.target.value as PublishStatus)}
                        className="min-h-[38px] px-3 rounded-xl border border-slate-200 text-xs font-semibold text-[#0B2545]"
                      >
                        <option value="published">منشور للطلاب فوراً</option>
                        <option value="draft">مسودة (مخفي)</option>
                      </select>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl bg-[#EAF4F7] border border-[#00A6A6]/35 p-4 space-y-2">
                    <h4 className="font-display text-sm font-bold text-[#0B2545]">
                      مراجعة التوزيع قبل الاعتماد
                    </h4>
                    <p className="text-xs text-slate-600">
                      سيتم ربط <strong>{reuseModal.files.length}</strong> ملف بـ{' '}
                      <strong>{rowsToDestinationInputs(reuseRows).length}</strong> وجهة أكاديمية جديدة:
                    </p>
                    <ul className="list-disc pr-5 text-xs text-[#0B2545] space-y-1">
                      {rowsToDestinationInputs(reuseRows).map((d, i) => {
                        const info = describeDestination({
                          ...d,
                          isLegacyFallback: false,
                          status: reuseStatus,
                          sortOrder: i + 1,
                        });
                        return (
                          <li key={i}>
                            <strong>{info.specName}</strong> — {info.yearName} /{' '}
                            {info.semName} /{' '}
                            <span className="text-[#00A6A6] font-bold">{info.subName}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              )}

              {actionError && (
                <p role="alert" className="text-xs font-semibold text-[#FF8066]">
                  {actionError}
                </p>
              )}
            </div>

            <footer className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              {reuseStep === 'review' ? (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => setReuseStep('select')}
                  className="min-h-[40px] px-4 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-[#0B2545] inline-flex items-center gap-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  تعديل الوجهات
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => setReuseModal(null)}
                  className="min-h-[40px] px-4 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-600"
                >
                  إلغاء
                </button>
              )}

              {reuseStep === 'select' ? (
                <button
                  type="button"
                  disabled={
                    rowsToDestinationInputs(reuseRows).length === 0 ||
                    reuseRows.some((r) => !isDestinationComplete(r))
                  }
                  onClick={() => {
                    setActionError(null);
                    setReuseStep('review');
                  }}
                  className="min-h-[42px] px-5 py-2 rounded-xl bg-[#0B2545] hover:bg-[#133866] text-white text-xs font-bold disabled:opacity-50"
                >
                  مراجعة ملخص التوزيع ({rowsToDestinationInputs(reuseRows).length})
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={handleConfirmReuseDistribution}
                  className="min-h-[42px] px-5 py-2 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs font-bold inline-flex items-center gap-2 disabled:opacity-60"
                >
                  {busyAction && <Loader2 className="w-4 h-4 animate-spin" />}
                  تأكيد التوزيع والنشر
                </button>
              )}
            </footer>
          </div>
        </div>
      )}

      {/* MANAGE LINKS MODAL */}
      {linksModalFile && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`إدارة روابط الملف: ${linksModalFile.title}`}
          className="fixed inset-0 z-50 bg-[#0B2545]/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6"
          onClick={() => !busyAction && setLinksModalFile(null)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 max-w-3xl w-full max-h-[88vh] flex flex-col overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="px-5 py-4 bg-[#0B2545] text-white flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-base font-bold truncate">
                  إدارة روابط وتوزيع: {linksModalFile.title}
                </h3>
                <p className="text-xs text-white/75 mt-0.5">
                  يمكنك إزالة الملف من تخصص واحد فقط دون التأثير على التخصصات الأخرى أو حذف الملف الفعلي.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !busyAction && setLinksModalFile(null)}
                className="min-h-[36px] min-w-[36px] rounded-lg bg-white/10 hover:bg-[#FF8066] flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </header>

            <div className="p-5 overflow-y-auto space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-bold text-[#0B2545]">
                  الوجهات المرتبطة حالياً ({activeManageDestinations.length}):
                </h4>
                {canUpload && (
                  <button
                    type="button"
                    onClick={() => {
                      setAddLinkMode((prev) => !prev);
                      setAddLinkRows([]);
                    }}
                    className="min-h-[34px] px-3 py-1 rounded-xl bg-[#00A6A6] text-white text-xs font-bold inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {addLinkMode ? 'إغلاق الإضافة' : 'إضافة وجهات جديدة'}
                  </button>
                )}
              </div>

              {addLinkMode && (
                <div className="space-y-3">
                  <MultiDestinationPicker
                    rows={addLinkRows}
                    onChange={setAddLinkRows}
                    defaultStatus={canPublish ? linksModalFile.status : 'draft'}
                    existingLinkedKeys={activeManageExistingKeys}
                    hintSubjectName={
                      subjects.find((s) => s.id === linksModalFile.subjectId)?.name
                    }
                    hintSubjectCode={
                      subjects.find((s) => s.id === linksModalFile.subjectId)?.code
                    }
                    compact
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={
                        busyAction ||
                        rowsToDestinationInputs(addLinkRows).length === 0 ||
                        addLinkRows.some((r) => !isDestinationComplete(r))
                      }
                      onClick={handleAddLinksInManageModal}
                      className="min-h-[38px] px-4 py-1.5 rounded-xl bg-[#0B2545] text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {busyAction && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      حفظ الوجهات الجديدة
                    </button>
                  </div>
                </div>
              )}

              {activeManageDestinations.length === 0 ? (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                  هذا الملف غير مرتبط حالياً بأي تخصص أو مقرر دراسي، ولا يظهر لأي طالب.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                  {activeManageDestinations.map((dest, idx) => {
                    const info = describeDestination(dest);
                    return (
                      <div
                        key={dest.linkId || `${dest.specializationId}-${idx}`}
                        className="p-3 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#0B2545]">
                            {info.specName}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {info.yearName} · {info.semName} ·{' '}
                            <strong className="text-[#00A6A6]">{info.subName}</strong>
                            {dest.isLegacyFallback && (
                              <span className="mr-2 text-[10px] text-slate-400">
                                (ربط تلقائي قديم)
                              </span>
                            )}
                          </p>
                        </div>

                        {(canDelete || canEdit) && (
                          <button
                            type="button"
                            disabled={busyAction}
                            onClick={() =>
                              handleUnlinkSingleDestination(
                                linksModalFile,
                                dest,
                                activeManageDestinations
                              )
                            }
                            className="min-h-[34px] px-3 py-1 rounded-lg border border-amber-300 bg-amber-50 hover:bg-[#FF8066] hover:text-white hover:border-[#FF8066] text-amber-900 text-xs font-semibold inline-flex items-center gap-1 shrink-0 transition-colors disabled:opacity-50"
                          >
                            <Unlink className="w-3.5 h-3.5" />
                            فك الربط عن هذا التخصص فقط
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {actionError && (
                <p role="alert" className="text-xs font-semibold text-[#FF8066]">
                  {actionError}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PERMANENT DELETE CONFIRMATION MODAL (Shows affected courses/specializations!) */}
      {permDeleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => !busyAction && setPermDeleteTarget(null)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FF8066]/15 text-[#FF8066] flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-display text-base font-bold text-[#0B2545]">
                  تأكيد الحذف النهائي للملف
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  أنت على وشك حذف <strong>"{permDeleteTarget.file.title}"</strong> نهائياً من قاعدة البيانات والتخزين (إن لم يكن مشاركاً بملف آخر).
                </p>
              </div>
            </div>

            {permDeleteTarget.destinations.length > 0 && (
              <div className="rounded-xl bg-[#FF8066]/10 border border-[#FF8066]/35 p-3 space-y-1.5">
                <p className="text-xs font-bold text-[#0B2545]">
                  تحذير: سيؤدي الحذف النهائي إلى إزالة الملف من جميع البرامج والمواد التالية (
                  {permDeleteTarget.destinations.length}):
                </p>
                <ul className="list-disc pr-5 text-[11px] text-[#0B2545] max-h-32 overflow-y-auto space-y-0.5">
                  {permDeleteTarget.destinations.map((d, i) => {
                    const info = describeDestination(d);
                    return (
                      <li key={i}>
                        {info.specName} — {info.yearName} / {info.subName}
                      </li>
                    );
                  })}
                </ul>
                <p className="text-[11px] text-slate-600 pt-1">
                  ملاحظة: إذا أردت إخفاءه من تخصص واحد فقط استخدم «إدارة الروابط ← فك الربط».
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={busyAction}
                onClick={() => setPermDeleteTarget(null)}
                className="min-h-[40px] px-4 rounded-xl border border-slate-200 text-xs font-semibold text-[#0B2545]"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={handlePermanentDeleteConfirm}
                className="min-h-[40px] px-4 rounded-xl bg-[#FF8066] hover:bg-[#e56d54] text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                {busyAction && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                تأكيد الحذف النهائي
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
