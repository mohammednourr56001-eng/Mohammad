import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  BookOpen,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Cloud,
  Crown,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  FolderPlus,
  GraduationCap,
  HardDrive,
  Home,
  Layers,
  Library,
  Link2,
  LogOut,
  Megaphone,
  Menu,
  Plus,
  Search,
  Settings,
  ShieldAlert,
  Trash2,
  Unlink,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase.ts';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import {
  AcademicYear,
  Announcement,
  AnnouncementCategory,
  AnnouncementPriority,
  ANNOUNCEMENT_CATEGORY_LABELS,
  LectureFile,
  LectureSourceType,
  ProgramCourseLink,
  PublishStatus,
  ROLE_LABELS_AR,
  Semester,
  Specialization,
  Subject,
} from '../types/academic.ts';
import {
  computeNextSortOrder,
  countFilesForSubject,
  CoursePlacement,
  findPotentialDuplicateCourseGroups,
  formatFileSizeArabic,
  generateSafeId,
  getCategoryLabel,
  getEffectiveCoursePlacements,
  getSemestersForYear,
  getSubjectsForSemester,
  getYearsForSpecialization,
  hasDuplicateProgramLink,
  isGoogleDriveFile,
  sortByOrder,
} from '../utils/academicLogic.ts';
import {
  getFileDestinations,
  isFileTrashed,
} from '../utils/centralLibraryLogic.ts';
import { AcademicIcon, IconPicker } from './IconPicker.tsx';
import { AdminFileUploader } from './AdminFileUploader.tsx';
import { CentralLectureLibrary } from './CentralLectureLibrary.tsx';
import { AdminManagementPanel } from './AdminManagementPanel.tsx';
import { StorageCapacityPanel } from './StorageCapacityPanel.tsx';
import { AuditLogsPanel } from './AuditLogsPanel.tsx';
import { BackupRecoveryPanel } from './BackupRecoveryPanel.tsx';
import { InfrastructureMonitoringPanel } from './InfrastructureMonitoringPanel.tsx';
import { ModeratorDashboard } from './ModeratorDashboard.tsx';
import { SecurityCenterPanel } from './SecurityCenterPanel.tsx';
import { SpecializationAdminDashboard } from './SpecializationAdminDashboard.tsx';

type AdminTab =
  | 'overview'
  | 'specializations'
  | 'years'
  | 'semesters'
  | 'subjects'
  | 'central_library'
  | 'files'
  | 'upload'
  | 'announcements'
  | 'users'
  | 'storage'
  | 'monitoring'
  | 'security_center'
  | 'audit_logs'
  | 'backups'
  | 'settings';

export function AdminDashboard({
  onExitAdmin,
  onPreviewFile,
}: {
  onExitAdmin: () => void;
  onPreviewFile: (file: LectureFile) => void;
}) {
  const {
    firebaseUser,
    profile,
    role,
    accountStatus,
    isSuperAdmin,
    isStaff,
    hasPerm,
    authReady,
    logout,
    getIdToken,
    openLoginModal,
  } = useAuth();
  const {
    specializations,
    academicYears,
    semesters,
    subjects,
    programCourses,
    lectureFileLinks,
    lectureFiles,
    announcements,
    users,
    activityLogs,
    storageStats,
    settings,
    refreshAdminCatalog,
    refreshAuditLogs,
    refreshStorageStats,
  } = usePlatformData();

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    title: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  // Specialization form state
  const [editingSpec, setEditingSpec] = useState<Specialization | null>(null);
  const [specName, setSpecName] = useState('');
  const [specDesc, setSpecDesc] = useState('');
  const [specIcon, setSpecIcon] = useState('stethoscope');
  const [specStatus, setSpecStatus] = useState<PublishStatus>('published');

  // Academic Year management state
  const [yearSpecId, setYearSpecId] = useState('');
  const [editingYear, setEditingYear] = useState<AcademicYear | null>(null);
  const [yearName, setYearName] = useState('');
  const [yearStatus, setYearStatus] = useState<PublishStatus>('published');

  // Semester management state
  const [semSpecId, setSemSpecId] = useState('');
  const [semYearId, setSemYearId] = useState('');
  const [editingSem, setEditingSem] = useState<Semester | null>(null);
  const [semName, setSemName] = useState('');
  const [semStatus, setSemStatus] = useState<PublishStatus>('published');

  // Subject & Shared Courses management state
  const [subSpecId, setSubSpecId] = useState('');
  const [subYearId, setSubYearId] = useState('');
  const [subSemId, setSubSemId] = useState('');
  const [editingSub, setEditingSub] = useState<Subject | null>(null);
  const [subName, setSubName] = useState('');
  const [subCode, setSubCode] = useState('');
  const [subCurriculumVersion, setSubCurriculumVersion] = useState('');
  const [subDesc, setSubDesc] = useState('');
  const [subIcon, setSubIcon] = useState('book');
  const [subStatus, setSubStatus] = useState<PublishStatus>('published');
  const [subjectWorkflowMode, setSubjectWorkflowMode] = useState<'create' | 'link'>('create');
  const [createExtraPlacements, setCreateExtraPlacements] = useState<
    Array<{ specializationId: string; academicYearId: string; semesterId: string }>
  >([]);
  const [linkSearchQuery, setLinkSearchQuery] = useState('');
  const [selectedExistingCourseId, setSelectedExistingCourseId] = useState('');
  const [showDuplicateInspector, setShowDuplicateInspector] = useState(false);

  // Files management filter & edit state
  const [fileSearch, setFileSearch] = useState('');
  const [fileFilterSpec, setFileFilterSpec] = useState('');
  const [editingFile, setEditingFile] = useState<LectureFile | null>(null);
  const [initialUploadMode, setInitialUploadMode] = useState<LectureSourceType>('upload');

  // Announcement state
  const [editingAnn, setEditingAnn] = useState<Announcement | null>(null);
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annCategory, setAnnCategory] = useState<AnnouncementCategory>('academic');
  const [annPriority, setAnnPriority] = useState<AnnouncementPriority>('normal');
  const [annStatus, setAnnStatus] = useState<PublishStatus>('published');

  // Settings state
  const [maxFileSizeMB, setMaxFileSizeMB] = useState<number>(settings.maxFileSizeMB || 25);
  const [allowZipUploads, setAllowZipUploads] = useState<boolean>(
    settings.allowZipUploads !== false
  );
  const [platformTitle, setPlatformTitle] = useState<string>(
    settings.platformTitle || 'منصة UST للمحاضرات'
  );

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const logAdminAction = async (
    action: string,
    entityType: string,
    entityId: string,
    entityName: string
  ) => {
    if (!firebaseUser) return;
    const logId = generateSafeId('log');
    try {
      await setDoc(doc(db, 'activityLogs', logId), {
        id: logId,
        actorUid: firebaseUser.uid,
        actorEmail: firebaseUser.email || '',
        actorName: profile?.displayName || firebaseUser.displayName || '',
        actorRole: role,
        action,
        entityType,
        entityId,
        entityName,
        result: 'success',
        createdAt: serverTimestamp(),
      });
    } catch {
      // non-fatal log error
    }
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
            entityType,
            entityId,
            entityName,
            result: 'success',
          }),
        });
        refreshAuditLogs();
      }
    } catch {
      // non-fatal
    }
  };

  // --- RBAC & SUSPENDED GATES ---
  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#EAF4F7] flex items-center justify-center">
        <div className="text-sm font-semibold text-[#0B2545]">
          جاري التحقق من صلاحيات الوصول...
        </div>
      </div>
    );
  }

  if (firebaseUser && accountStatus === 'suspended') {
    return (
      <div className="min-h-screen bg-[#EAF4F7] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-5 shadow-sm">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[#FF8066]/15 text-[#FF8066] flex items-center justify-center">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h1 className="font-display text-2xl font-bold text-[#0B2545]">
              تم تعليق هذا الحساب
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              تم تعليق صلاحياتك الإدارية مؤقتاً من قبل مالك المنصة. يرجى مراجعة المدير الرئيسي للتحقق من حالة الحساب.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <button
              type="button"
              onClick={onExitAdmin}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#0B2545] text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
            >
              <ArrowRight className="w-4 h-4" />
              العودة إلى بوابة الطلاب
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!firebaseUser || !isStaff) {
    return (
      <div className="min-h-screen bg-[#EAF4F7] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-5 shadow-sm">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[#FF8066]/15 text-[#FF8066] flex items-center justify-center">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h1 className="font-display text-2xl font-bold text-[#0B2545]">
              غير مصرح بالوصول
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              لوحة إدارة منصة UST للمحاضرات مخصصة للمشرفين المعتمدين فقط. لا يملك حسابك الحالي صلاحيات إدارية للوصول إلى هذا القسم.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <button
              type="button"
              onClick={onExitAdmin}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#0B2545] hover:bg-[#133866] text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
            >
              <ArrowRight className="w-4 h-4" />
              العودة إلى بوابة الطلاب
            </button>
            {!firebaseUser && (
              <button
                type="button"
                onClick={openLoginModal}
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-sm font-semibold"
              >
                تسجيل دخول المشرف
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Dedicated Simplified Dashboard for Level 3 Moderators
  if (role === 'moderator') {
    return <ModeratorDashboard onExitAdmin={onExitAdmin} onPreviewFile={onPreviewFile} />;
  }

  // Dedicated Specialization-Scoped Dashboard for Level 2 Admins
  if (!isSuperAdmin && role === 'admin') {
    return (
      <SpecializationAdminDashboard
        onExitAdmin={onExitAdmin}
        onPreviewFile={onPreviewFile}
      />
    );
  }

  const sortedSpecs = sortByOrder(specializations);
  const effectiveYearSpecId = yearSpecId || sortedSpecs[0]?.id || '';
  const yearsForAdmin = effectiveYearSpecId
    ? getYearsForSpecialization(academicYears, effectiveYearSpecId, true)
    : [];

  const effectiveSemSpecId = semSpecId || sortedSpecs[0]?.id || '';
  const yearsForSemTab = effectiveSemSpecId
    ? getYearsForSpecialization(academicYears, effectiveSemSpecId, true)
    : [];
  const effectiveSemYearId = semYearId || yearsForSemTab[0]?.id || '';
  const semsForAdmin =
    effectiveSemSpecId && effectiveSemYearId
      ? getSemestersForYear(semesters, effectiveSemSpecId, effectiveSemYearId, true)
      : [];

  const effectiveSubSpecId = subSpecId || sortedSpecs[0]?.id || '';
  const yearsForSubTab = effectiveSubSpecId
    ? getYearsForSpecialization(academicYears, effectiveSubSpecId, true)
    : [];
  const effectiveSubYearId = subYearId || yearsForSubTab[0]?.id || '';
  const semsForSubTab =
    effectiveSubSpecId && effectiveSubYearId
      ? getSemestersForYear(semesters, effectiveSubSpecId, effectiveSubYearId, true)
      : [];
  const effectiveSubSemId = subSemId || semsForSubTab[0]?.id || '';
  const subjectsForAdmin =
    effectiveSubSpecId && effectiveSubYearId && effectiveSubSemId
      ? getSubjectsForSemester(
          subjects,
          effectiveSubSpecId,
          effectiveSubYearId,
          effectiveSubSemId,
          true,
          programCourses
        )
      : [];

  const duplicateCourseGroups = useMemo(
    () => findPotentialDuplicateCourseGroups(subjects),
    [subjects]
  );

  const searchableExistingCourses = useMemo(() => {
    const q = linkSearchQuery.trim().toLowerCase();
    return sortByOrder(subjects).filter((sub) => {
      if (!q) return true;
      return (
        sub.name.toLowerCase().includes(q) ||
        (sub.code || '').toLowerCase().includes(q) ||
        (sub.description || '').toLowerCase().includes(q)
      );
    });
  }, [subjects, linkSearchQuery]);

  const filteredAdminFiles = lectureFiles.filter((f) => {
    if (fileFilterSpec && f.specializationId !== fileFilterSpec) return false;
    if (
      fileSearch.trim() &&
      !f.title.toLowerCase().includes(fileSearch.trim().toLowerCase()) &&
      !f.originalName.toLowerCase().includes(fileSearch.trim().toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  // --- CRUD HANDLERS ---
  const handleSaveSpecialization = async (e: React.FormEvent) => {
    e.preventDefault();
    if (specName.trim().length < 2) return;
    try {
      const id = editingSpec ? editingSpec.id : generateSafeId('spec');
      if (editingSpec) {
        await updateDoc(doc(db, 'specializations', id), {
          name: specName.trim(),
          description: specDesc.trim(),
          iconKey: specIcon,
          status: specStatus,
          sortOrder: editingSpec.sortOrder,
          updatedAt: serverTimestamp(),
        });
        await logAdminAction('تحديث تخصص', 'specialization', id, specName.trim());
        showToast('تم تحديث التخصص بنجاح.');
      } else {
        await setDoc(doc(db, 'specializations', id), {
          id,
          name: specName.trim(),
          description: specDesc.trim(),
          iconKey: specIcon,
          status: specStatus,
          sortOrder: computeNextSortOrder(specializations),
          createdBy: firebaseUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await logAdminAction('إضافة تخصص جديد', 'specialization', id, specName.trim());
        showToast('تم إضافة التخصص بنجاح.');
      }
      setEditingSpec(null);
      setSpecName('');
      setSpecDesc('');
      setSpecStatus('published');
      await refreshAdminCatalog();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'specializations');
    }
  };

  const handleSaveYear = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveYearSpecId || yearName.trim().length < 2) return;
    try {
      const id = editingYear ? editingYear.id : generateSafeId('yr');
      if (editingYear) {
        await updateDoc(doc(db, 'academicYears', id), {
          name: yearName.trim(),
          status: yearStatus,
          sortOrder: editingYear.sortOrder,
          updatedAt: serverTimestamp(),
        });
        await logAdminAction('تحديث سنة دراسية', 'academicYear', id, yearName.trim());
        showToast('تم تحديث السنة الدراسية.');
      } else {
        await setDoc(doc(db, 'academicYears', id), {
          id,
          specializationId: effectiveYearSpecId,
          name: yearName.trim(),
          status: yearStatus,
          sortOrder: computeNextSortOrder(yearsForAdmin),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await logAdminAction('إضافة سنة دراسية', 'academicYear', id, yearName.trim());
        showToast('تمت إضافة السنة الدراسية.');
      }
      setEditingYear(null);
      setYearName('');
      await refreshAdminCatalog();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'academicYears');
    }
  };

  const handleSaveSemester = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveSemSpecId || !effectiveSemYearId || semName.trim().length < 2) return;
    try {
      const id = editingSem ? editingSem.id : generateSafeId('sem');
      if (editingSem) {
        await updateDoc(doc(db, 'semesters', id), {
          name: semName.trim(),
          status: semStatus,
          sortOrder: editingSem.sortOrder,
          updatedAt: serverTimestamp(),
        });
        await logAdminAction('تحديث فصل دراسي', 'semester', id, semName.trim());
        showToast('تم تحديث الفصل الدراسي.');
      } else {
        await setDoc(doc(db, 'semesters', id), {
          id,
          specializationId: effectiveSemSpecId,
          academicYearId: effectiveSemYearId,
          name: semName.trim(),
          status: semStatus,
          sortOrder: computeNextSortOrder(semsForAdmin),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await logAdminAction('إضافة فصل دراسي', 'semester', id, semName.trim());
        showToast('تمت إضافة الفصل الدراسي.');
      }
      setEditingSem(null);
      setSemName('');
      await refreshAdminCatalog();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'semesters');
    }
  };

  const handleSaveSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !effectiveSubSpecId ||
      !effectiveSubYearId ||
      !effectiveSubSemId ||
      subName.trim().length < 2
    ) {
      return;
    }
    try {
      const id = editingSub ? editingSub.id : generateSafeId('sub');
      const normalizedCode = subCode.trim().toUpperCase();
      const normalizedVersion = subCurriculumVersion.trim();
      if (editingSub) {
        await updateDoc(doc(db, 'subjects', id), {
          name: subName.trim(),
          ...(normalizedCode ? { code: normalizedCode } : {}),
          ...(normalizedVersion ? { curriculumVersion: normalizedVersion } : {}),
          description: subDesc.trim(),
          iconKey: subIcon,
          status: subStatus,
          sortOrder: editingSub.sortOrder,
          updatedAt: serverTimestamp(),
        });
        await logAdminAction('تحديث مقرر دراسي', 'subject', id, subName.trim());
        showToast('تم تحديث المقرر الدراسي.');
      } else {
        await setDoc(doc(db, 'subjects', id), {
          id,
          specializationId: effectiveSubSpecId,
          academicYearId: effectiveSubYearId,
          semesterId: effectiveSubSemId,
          name: subName.trim(),
          ...(normalizedCode ? { code: normalizedCode } : {}),
          ...(normalizedVersion ? { curriculumVersion: normalizedVersion } : {}),
          description: subDesc.trim(),
          iconKey: subIcon,
          status: subStatus,
          sortOrder: computeNextSortOrder(subjectsForAdmin),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        const seenKeys = new Set([
          `${effectiveSubSpecId}::${effectiveSubYearId}::${effectiveSubSemId}`,
        ]);
        let linkedExtras = 0;
        for (const extra of createExtraPlacements) {
          if (!extra.specializationId || !extra.academicYearId || !extra.semesterId) continue;
          const key = `${extra.specializationId}::${extra.academicYearId}::${extra.semesterId}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          const linkId = generateSafeId('lnk');
          await setDoc(doc(db, 'programCourses', linkId), {
            id: linkId,
            courseId: id,
            specializationId: extra.specializationId,
            academicYearId: extra.academicYearId,
            semesterId: extra.semesterId,
            status: subStatus,
            sortOrder: computeNextSortOrder(programCourses) + linkedExtras,
            createdBy: firebaseUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          linkedExtras += 1;
        }

        await logAdminAction(
          linkedExtras > 0 ? 'إضافة مقرر مشترك متعدد التخصصات' : 'إضافة مقرر دراسي',
          'subject',
          id,
          subName.trim()
        );
        showToast(
          linkedExtras > 0
            ? `تم إنشاء المقرر وربطه بـ ${linkedExtras + 1} مسارات دراسية دون تكرار.`
            : 'تمت إضافة المقرر الدراسي.'
        );
      }
      setEditingSub(null);
      setSubName('');
      setSubCode('');
      setSubCurriculumVersion('');
      setSubDesc('');
      setCreateExtraPlacements([]);
      await refreshAdminCatalog();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'subjects');
    }
  };

  const handleLinkExistingCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveSubSpecId || !effectiveSubYearId || !effectiveSubSemId || !selectedExistingCourseId) {
      return;
    }
    const targetCourse = subjects.find((s) => s.id === selectedExistingCourseId);
    if (!targetCourse) return;
    if (
      hasDuplicateProgramLink(
        targetCourse,
        programCourses,
        effectiveSubSpecId,
        effectiveSubYearId,
        effectiveSubSemId
      )
    ) {
      showToast('هذا المقرر مرتبط بالفعل بهذا التخصص والسنة والفصل الدراسي.');
      return;
    }
    try {
      const linkId = generateSafeId('lnk');
      await setDoc(doc(db, 'programCourses', linkId), {
        id: linkId,
        courseId: targetCourse.id,
        specializationId: effectiveSubSpecId,
        academicYearId: effectiveSubYearId,
        semesterId: effectiveSubSemId,
        status: targetCourse.status,
        sortOrder: computeNextSortOrder(subjectsForAdmin),
        createdBy: firebaseUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const specName = specializations.find((s) => s.id === effectiveSubSpecId)?.name || effectiveSubSpecId;
      await logAdminAction('ربط مقرر مشترك بتخصص إضافي', 'programCourse', linkId, `${targetCourse.name} -> ${specName}`);
      setSelectedExistingCourseId('');
      await refreshAdminCatalog();
      showToast(`تم ربط "${targetCourse.name}" بالتخصص بنجاح وتفعيل كافة ملفاته تلقائياً.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'programCourses');
    }
  };

  const handleUnlinkCoursePlacement = async (
    course: Subject,
    placement: CoursePlacement,
    allPlacements: CoursePlacement[]
  ) => {
    if (allPlacements.length <= 1) {
      showToast('هذا هو التخصص الوحيد المتبقي للمقرر. استخدم الحذف النهائي إذا أردت إزالة المقرر بالكامل.');
      return;
    }
    try {
      if (placement.linkId && !placement.isCanonical) {
        await deleteDoc(doc(db, 'programCourses', placement.linkId));
      } else if (placement.isCanonical) {
        const nextPlacement = allPlacements.find(
          (p) =>
            p.specializationId !== placement.specializationId ||
            p.academicYearId !== placement.academicYearId ||
            p.semesterId !== placement.semesterId
        );
        if (!nextPlacement) return;
        await updateDoc(doc(db, 'subjects', course.id), {
          specializationId: nextPlacement.specializationId,
          academicYearId: nextPlacement.academicYearId,
          semesterId: nextPlacement.semesterId,
          updatedAt: serverTimestamp(),
        });
        if (nextPlacement.linkId) {
          await deleteDoc(doc(db, 'programCourses', nextPlacement.linkId));
        }
        if (placement.linkId) {
          await deleteDoc(doc(db, 'programCourses', placement.linkId));
        }
      }
      const specName = specializations.find((s) => s.id === placement.specializationId)?.name || placement.specializationId;
      await logAdminAction('فك ارتباط مقرر بتخصص', 'programCourse', course.id, `${course.name} (${specName})`);
      await refreshAdminCatalog();
      showToast(`تم فك ارتباط "${course.name}" من ${specName} مع بقاء المقرر وملفاته سليمة للتخصصات الأخرى.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'programCourses');
    }
  };

  const handleDeleteCanonicalCourse = async (course: Subject) => {
    try {
      const relatedLinks = programCourses.filter((l) => l.courseId === course.id);
      for (const link of relatedLinks) {
        await deleteDoc(doc(db, 'programCourses', link.id));
      }
      await deleteDoc(doc(db, 'subjects', course.id));
      await logAdminAction('حذف مقرر دراسي نهائياً', 'subject', course.id, course.name);
      await refreshAdminCatalog();
      showToast('تم حذف المقرر وجميع روابطه نهائياً.');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'subjects');
    }
  };

  const handleSwapOrder = async (
    colName: 'specializations' | 'academicYears' | 'semesters' | 'subjects',
    list: Array<{ id: string; sortOrder: number }>,
    index: number,
    direction: -1 | 1
  ) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    const itemA = list[index];
    const itemB = list[targetIdx];
    try {
      await Promise.all([
        updateDoc(doc(db, colName, itemA.id), {
          sortOrder: itemB.sortOrder,
          updatedAt: serverTimestamp(),
        }),
        updateDoc(doc(db, colName, itemB.id), {
          sortOrder: itemA.sortOrder,
          updatedAt: serverTimestamp(),
        }),
      ]);
      await refreshAdminCatalog();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, colName);
    }
  };

  const handleToggleStatus = async (
    colName: 'specializations' | 'academicYears' | 'semesters' | 'subjects' | 'lectureFiles' | 'announcements',
    id: string,
    currentStatus: PublishStatus,
    label: string
  ) => {
    const nextStatus: PublishStatus = currentStatus === 'published' ? 'draft' : 'published';
    try {
      await updateDoc(doc(db, colName, id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      await logAdminAction(
        nextStatus === 'published' ? 'نشر محتوى' : 'إخفاء محتوى',
        colName,
        id,
        label
      );
      await refreshAdminCatalog();
      showToast(nextStatus === 'published' ? 'تم النشر بنجاح.' : 'تم التحويل إلى مسودة.');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `${colName}/${id}`);
    }
  };

  const handleDeleteFile = async (file: LectureFile) => {
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
        );
      }
      const relatedFileLinks = lectureFileLinks.filter((l) => l.lectureFileId === file.id);
      const batch = writeBatch(db);
      for (const lnk of relatedFileLinks) {
        batch.delete(doc(db, 'lectureFileLinks', lnk.id));
      }
      batch.delete(doc(db, 'lectureFiles', file.id));
      await batch.commit();
      await logAdminAction('حذف ملف محاضرة', 'lectureFile', file.id, file.title);
      await Promise.all([refreshAdminCatalog(), refreshStorageStats()]);
      showToast('تم حذف الملف نهائياً.');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `lectureFiles/${file.id}`);
    }
  };

  const handleSaveAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (annTitle.trim().length < 2 || annBody.trim().length < 2) return;
    try {
      const id = editingAnn ? editingAnn.id : generateSafeId('ann');
      if (editingAnn) {
        await updateDoc(doc(db, 'announcements', id), {
          title: annTitle.trim(),
          body: annBody.trim(),
          category: annCategory,
          priority: annPriority,
          status: annStatus,
          updatedAt: serverTimestamp(),
        });
        showToast('تم تحديث الإعلان.');
      } else {
        await setDoc(doc(db, 'announcements', id), {
          id,
          title: annTitle.trim(),
          body: annBody.trim(),
          category: annCategory,
          priority: annPriority,
          status: annStatus,
          createdBy: firebaseUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        showToast('تم نشر الإعلان بنجاح.');
      }
      setEditingAnn(null);
      setAnnTitle('');
      setAnnBody('');
      await refreshAdminCatalog();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'announcements');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await setDoc(
        doc(db, 'settings', 'platform'),
        {
          ...settings,
          maxFileSizeMB: Math.min(500, Math.max(1, Number(maxFileSizeMB) || 25)),
          allowZipUploads,
          platformTitle: platformTitle.trim() || 'منصة UST للمحاضرات',
          updatedBy: firebaseUser.uid,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await logAdminAction('تحديث إعدادات المنصة', 'settings', 'platform', platformTitle.trim());
      showToast('تم حفظ إعدادات المنصة.');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/platform');
    }
  };

  const allSidebarItems: Array<{
    id: AdminTab;
    label: string;
    icon: React.ReactNode;
    visible: boolean;
  }> = [
    { id: 'overview', label: 'الرئيسية', icon: <Home className="w-4 h-4" />, visible: true },
    {
      id: 'specializations',
      label: 'إدارة التخصصات',
      icon: <GraduationCap className="w-4 h-4" />,
      visible: isSuperAdmin,
    },
    {
      id: 'years',
      label: 'إدارة السنوات الدراسية',
      icon: <Layers className="w-4 h-4" />,
      visible: isSuperAdmin || hasPerm('academic_years.manage'),
    },
    {
      id: 'semesters',
      label: 'إدارة الفصول',
      icon: <Calendar className="w-4 h-4" />,
      visible: isSuperAdmin || hasPerm('semesters.manage'),
    },
    {
      id: 'subjects',
      label: 'إدارة المواد',
      icon: <BookOpen className="w-4 h-4" />,
      visible:
        isSuperAdmin ||
        hasPerm('subjects.create') ||
        hasPerm('subjects.edit'),
    },
    {
      id: 'central_library',
      label: 'المكتبة المركزية للمحاضرات',
      icon: <Library className="w-4 h-4" />,
      visible: isSuperAdmin,
    },
    {
      id: 'files',
      label: 'ملفات المحاضرات',
      icon: <FileText className="w-4 h-4" />,
      visible: isSuperAdmin,
    },
    {
      id: 'upload',
      label: 'رفع / ربط Drive',
      icon: <Upload className="w-4 h-4" />,
      visible: isSuperAdmin,
    },
    {
      id: 'announcements',
      label: 'الإعلانات',
      icon: <Megaphone className="w-4 h-4" />,
      visible: isSuperAdmin || hasPerm('announcements.manage'),
    },
    {
      id: 'users',
      label: 'إدارة المسؤولين والمستخدمين',
      icon: <Users className="w-4 h-4" />,
      visible: isSuperAdmin,
    },
    {
      id: 'storage',
      label: 'إدارة مساحة التخزين',
      icon: <HardDrive className="w-4 h-4" />,
      visible: isSuperAdmin,
    },
    {
      id: 'monitoring',
      label: 'المراقبة والبنية السحابية',
      icon: <Activity className="w-4 h-4" />,
      visible: isSuperAdmin,
    },
    {
      id: 'security_center',
      label: 'مركز الحماية والأمان',
      icon: <ShieldAlert className="w-4 h-4" />,
      visible: isSuperAdmin,
    },
    {
      id: 'audit_logs',
      label: 'سجل النشاط الإداري',
      icon: <ClipboardList className="w-4 h-4" />,
      visible: isSuperAdmin || hasPerm('audit_logs.view'),
    },
    {
      id: 'backups',
      label: 'النسخ الاحتياطي',
      icon: <Archive className="w-4 h-4" />,
      visible: isSuperAdmin,
    },
    {
      id: 'settings',
      label: 'الإعدادات',
      icon: <Settings className="w-4 h-4" />,
      visible: isSuperAdmin,
    },
  ];

  const sidebarItems = allSidebarItems.filter((item) => item.visible);

  const studentsCount = users.filter((u) => u.role === 'student').length;
  const adminsCount = users.filter((u) => u.role === 'admin' || u.role === 'super_admin').length;
  const moderatorsCount = users.filter((u) => u.role === 'moderator').length;
  const totalStorageUsed =
    storageStats?.lecturesBytes ??
    lectureFiles.reduce((sum, f) => sum + (Number(f.fileSize) || 0), 0);
  const totalStorageRemaining =
    storageStats?.remainingBytes ??
    Math.max(0, (settings.storageQuotaMB || 1024) * 1024 * 1024 - totalStorageUsed);

  const specFileCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of lectureFiles) {
      if (isFileTrashed(f)) continue;
      const dests = getFileDestinations({
        file: f,
        links: lectureFileLinks,
        subjects,
        programCourses,
        includeDrafts: true,
      });
      const specsSeen = new Set(dests.map((d) => d.specializationId));
      for (const specId of specsSeen) {
        counts.set(specId, (counts.get(specId) || 0) + 1);
      }
    }
    return counts;
  }, [lectureFiles, lectureFileLinks, subjects, programCourses]);

  const maxSpecFiles = Math.max(
    1,
    ...specializations.map((s) => specFileCounts.get(s.id) || 0)
  );

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-clip bg-[#EAF4F7]/65 flex relative">
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Deep Navy Admin Sidebar (#0B2545) — Off-canvas slide-in drawer on < 1024px, sticky on desktop */}
      <aside
        aria-label="قائمة لوحة الإدارة"
        aria-hidden={!sidebarOpen ? undefined : false}
        className={`fixed lg:sticky top-0 bottom-0 right-0 z-50 h-screen w-72 max-w-[85vw] lg:w-68 bg-[#0B2545] text-white flex flex-col justify-between transition-transform duration-200 shrink-0 ${
          sidebarOpen
            ? 'translate-x-0 visible pointer-events-auto shadow-2xl'
            : 'translate-x-full invisible pointer-events-none lg:translate-x-0 lg:visible lg:pointer-events-auto lg:shadow-none'
        }`}
      >
        <div className="p-5 space-y-6 overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-display text-lg font-bold text-white flex items-center gap-1.5">
                {isSuperAdmin && <Crown className="w-4 h-4 text-[#FF8066] shrink-0" />}
                <span className="truncate">إدارة منصة UST</span>
              </p>
              <p className="text-[11px] text-[#00A6A6] font-semibold">
                {ROLE_LABELS_AR[role]}
              </p>
              <p className="text-xs text-[#EAF4F7]/70 truncate max-w-[180px]">
                {firebaseUser.email}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              aria-label="إغلاق القائمة"
              className="lg:hidden min-h-[38px] min-w-[38px] rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="space-y-1">
            {sidebarItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    if (item.id !== 'upload') setEditingFile(null);
                    setSidebarOpen(false);
                  }}
                  className={`w-full min-h-[42px] px-3.5 py-2 rounded-xl text-sm font-medium flex items-center gap-3 transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#00A6A6] text-white font-semibold'
                      : 'text-white/80 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-white/10 space-y-2">
          <button
            type="button"
            onClick={() => {
              setSidebarOpen(false);
              onExitAdmin();
            }}
            className="w-full min-h-[42px] px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-medium flex items-center gap-2.5 transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
            واجهة الطلاب
          </button>
          <button
            type="button"
            onClick={() => {
              setSidebarOpen(false);
              logout();
            }}
            className="w-full min-h-[42px] px-3.5 py-2 rounded-xl text-[#FF8066] hover:bg-[#FF8066]/15 text-sm font-medium flex items-center gap-2.5 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 w-full flex flex-col">
        <header className="bg-white border-b border-slate-200 px-3 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-2.5 sm:gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen((prev) => !prev)}
              aria-label="فتح قائمة الإدارة"
              aria-expanded={sidebarOpen}
              className="lg:hidden min-h-[42px] min-w-[42px] rounded-xl bg-[#EAF4F7] hover:bg-[#d8ecf2] text-[#0B2545] flex items-center justify-center shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-display text-base sm:text-xl font-bold text-[#0B2545] truncate">
              {sidebarItems.find((i) => i.id === activeTab)?.label || 'لوحة الإدارة'}
            </h1>
          </div>

          {isSuperAdmin && (
            <div className="flex items-center flex-wrap gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setEditingFile(null);
                  setInitialUploadMode('google_drive');
                  setActiveTab('upload');
                }}
                className="min-h-[38px] sm:min-h-[40px] px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-xl bg-[#EAF4F7] hover:bg-[#0B2545] text-[#0B2545] hover:text-white border border-slate-200 text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <Cloud className="w-4 h-4 text-[#00A6A6]" />
                <span>ربط Drive</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingFile(null);
                  setInitialUploadMode('upload');
                  setActiveTab('upload');
                }}
                className="min-h-[38px] sm:min-h-[40px] px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 sm:gap-2 transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>رفع ملف</span>
              </button>
            </div>
          )}
        </header>

        <main className="p-3 sm:p-6 lg:p-8 max-w-6xl w-full min-w-0 mx-auto space-y-6">
          {toastMsg && (
            <div
              role="status"
              className="rounded-xl bg-[#0B2545] text-white px-4 py-3 text-sm font-medium flex items-center gap-2 shadow-sm"
            >
              <CheckCircle2 className="w-4 h-4 text-[#00A6A6]" />
              {toastMsg}
            </div>
          )}

          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'إجمالي المستخدمين', value: users.length },
                  { label: 'عدد الطلاب', value: studentsCount },
                  { label: 'المسؤولون والمشرفون', value: `${adminsCount} / ${moderatorsCount}` },
                  { label: 'التخصصات والمواد', value: `${specializations.length} / ${subjects.length}` },
                  { label: 'إجمالي الملفات', value: lectureFiles.length },
                  { label: 'المساحة المستخدمة', value: formatFileSizeArabic(totalStorageUsed) },
                  { label: 'المساحة المتبقية', value: formatFileSizeArabic(totalStorageRemaining) },
                  { label: 'حالة النظام', value: 'مستقر وآمن' },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1"
                  >
                    <p className="text-xs text-slate-500">{stat.label}</p>
                    <p className="font-display text-xl sm:text-2xl font-bold text-[#0B2545] tabular-nums">
                      {stat.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Distribution Chart */}
                <section className="lg:col-span-6 bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                  <h2 className="font-display text-base font-bold text-[#0B2545] flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-[#00A6A6]" />
                    توزيع المحاضرات حسب التخصص
                  </h2>
                  <div className="space-y-3">
                    {sortedSpecs.map((spec) => {
                      const count = specFileCounts.get(spec.id) || 0;
                      const pct = Math.round((count / maxSpecFiles) * 100);
                      return (
                        <div key={spec.id} className="space-y-1">
                          <div className="flex justify-between text-xs font-medium text-[#0B2545]">
                            <span className="truncate">{spec.name}</span>
                            <span className="tabular-nums text-slate-600">{count} ملف</span>
                          </div>
                          <div className="h-2.5 bg-[#EAF4F7] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#00A6A6] rounded-full"
                              style={{ width: `${Math.max(4, pct)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Recent Administrative Activity */}
                <section className="lg:col-span-6 bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                  <h2 className="font-display text-base font-bold text-[#0B2545]">
                    أحدث النشاطات الإدارية
                  </h2>
                  {activityLogs.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4">
                      لم يتم تسجيل أي نشاطات إدارية بعد.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {activityLogs.slice(0, 6).map((log) => (
                        <div key={log.id} className="py-2.5 text-xs flex justify-between gap-3">
                          <div className="min-w-0">
                            <span className="font-semibold text-[#0B2545]">{log.action}:</span>{' '}
                            <span className="text-slate-600">{log.entityName}</span>
                          </div>
                          <span className="text-slate-400 shrink-0 truncate max-w-[140px]">
                            {log.actorEmail}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}

          {/* TAB 2: SPECIALIZATIONS */}
          {activeTab === 'specializations' && (
            <div className="space-y-6">
              {(isSuperAdmin ||
                hasPerm('specializations.create') ||
                (editingSpec && hasPerm('specializations.edit'))) && (
              <form
                onSubmit={handleSaveSpecialization}
                className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4"
              >
                <h2 className="font-display text-base font-bold text-[#0B2545]">
                  {editingSpec ? `تعديل التخصص: ${editingSpec.name}` : 'إضافة تخصص جديد'}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="spec-name" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      اسم التخصص *
                    </label>
                    <input
                      id="spec-name"
                      type="text"
                      required
                      value={specName}
                      onChange={(e) => setSpecName(e.target.value)}
                      placeholder="مثال: الهندسة الطبية الحيوية"
                      className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="spec-status" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      الحالة
                    </label>
                    <select
                      id="spec-status"
                      value={specStatus}
                      onChange={(e) => setSpecStatus(e.target.value as PublishStatus)}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                    >
                      <option value="published">منشور</option>
                      <option value="draft">مسودة (مخفي)</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="spec-desc" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      وصف مختصر (اختياري)
                    </label>
                    <input
                      id="spec-desc"
                      type="text"
                      value={specDesc}
                      onChange={(e) => setSpecDesc(e.target.value)}
                      placeholder="قسم المحاضرات والمواد الخاصة بالتخصص..."
                      className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm"
                    />
                  </div>
                </div>

                <IconPicker value={specIcon} onChange={setSpecIcon} label="أيقونة التخصص" />

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-sm font-semibold"
                  >
                    حفظ التخصص
                  </button>
                  {editingSpec && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSpec(null);
                        setSpecName('');
                        setSpecDesc('');
                      }}
                      className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600"
                    >
                      إلغاء
                    </button>
                  )}
                </div>
              </form>
              )}

              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="divide-y divide-slate-100">
                  {sortedSpecs.map((spec, idx) => (
                    <div
                      key={spec.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-xl bg-[#EAF4F7] text-[#0B2545] flex items-center justify-center shrink-0">
                          <AcademicIcon iconKey={spec.iconKey} className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-display text-sm font-bold text-[#0B2545] truncate">
                            {spec.name}
                          </h3>
                          <p className="text-xs text-slate-500">
                            {spec.status === 'published' ? 'منشور للطلاب' : 'مسودة مخفية'} ·{' '}
                            {getYearsForSpecialization(academicYears, spec.id, true).length} سنوات
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {(isSuperAdmin || hasPerm('specializations.edit')) && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleSwapOrder('specializations', sortedSpecs, idx, -1)}
                              disabled={idx === 0}
                              aria-label={`رفع ترتيب ${spec.name}`}
                              className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 flex items-center justify-center disabled:opacity-30"
                            >
                              <ArrowUp className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSwapOrder('specializations', sortedSpecs, idx, 1)}
                              disabled={idx === sortedSpecs.length - 1}
                              aria-label={`خفض ترتيب ${spec.name}`}
                              className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 flex items-center justify-center disabled:opacity-30"
                            >
                              <ArrowDown className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleToggleStatus('specializations', spec.id, spec.status, spec.name)
                              }
                              aria-label={spec.status === 'published' ? `إخفاء ${spec.name}` : `نشر ${spec.name}`}
                              className="min-h-[36px] px-3 rounded-lg bg-[#EAF4F7] text-xs font-semibold text-[#0B2545]"
                            >
                              {spec.status === 'published' ? 'إخفاء' : 'نشر'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSpec(spec);
                                setSpecName(spec.name);
                                setSpecDesc(spec.description || '');
                                setSpecIcon(spec.iconKey);
                                setSpecStatus(spec.status);
                              }}
                              aria-label={`تعديل ${spec.name}`}
                              className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 flex items-center justify-center text-[#0B2545]"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {(isSuperAdmin || hasPerm('specializations.delete')) && (
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmDelete({
                                title: `هل أنت متأكد من حذف تخصص "${spec.name}"؟`,
                                onConfirm: async () => {
                                  await deleteDoc(doc(db, 'specializations', spec.id));
                                  await logAdminAction('حذف تخصص', 'specialization', spec.id, spec.name);
                                  await refreshAdminCatalog();
                                  showToast('تم حذف التخصص.');
                                },
                              })
                            }
                            aria-label={`حذف ${spec.name}`}
                            className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 flex items-center justify-center text-[#FF8066]"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: ACADEMIC YEARS */}
          {activeTab === 'years' && (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
                <div>
                  <label htmlFor="yr-spec-select" className="block text-xs font-semibold text-[#0B2545] mb-1">
                    اختر التخصص لإدارة سنواته الدراسية
                  </label>
                  <select
                    id="yr-spec-select"
                    value={effectiveYearSpecId}
                    onChange={(e) => setYearSpecId(e.target.value)}
                    className="w-full sm:max-w-sm min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                  >
                    {sortedSpecs.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <form onSubmit={handleSaveYear} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                  <div>
                    <label htmlFor="yr-name" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      اسم السنة الدراسية *
                    </label>
                    <input
                      id="yr-name"
                      type="text"
                      required
                      value={yearName}
                      onChange={(e) => setYearName(e.target.value)}
                      placeholder="مثال: السنة السادسة"
                      className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="yr-status" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      الحالة
                    </label>
                    <select
                      id="yr-status"
                      value={yearStatus}
                      onChange={(e) => setYearStatus(e.target.value as PublishStatus)}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                    >
                      <option value="published">منشورة</option>
                      <option value="draft">مخفية</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="min-h-[42px] px-5 py-2 rounded-xl bg-[#00A6A6] text-white text-sm font-semibold"
                    >
                      {editingYear ? 'تحديث السنة' : 'إضافة سنة'}
                    </button>
                    {editingYear && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingYear(null);
                          setYearName('');
                        }}
                        className="min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                      >
                        إلغاء
                      </button>
                    )}
                  </div>
                </form>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                {yearsForAdmin.length === 0 ? (
                  <p className="p-6 text-sm text-slate-500 text-center">
                    لا توجد سنوات مضافة لهذا التخصص بعد.
                  </p>
                ) : (
                  yearsForAdmin.map((yr, idx) => (
                    <div key={yr.id} className="p-4 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-display text-sm font-bold text-[#0B2545]">{yr.name}</h3>
                        <p className="text-xs text-slate-500">
                          {yr.status === 'published' ? 'منشورة' : 'مخفية'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleSwapOrder('academicYears', yearsForAdmin, idx, -1)}
                          disabled={idx === 0}
                          aria-label={`رفع ${yr.name}`}
                          className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 flex items-center justify-center disabled:opacity-30"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSwapOrder('academicYears', yearsForAdmin, idx, 1)}
                          disabled={idx === yearsForAdmin.length - 1}
                          aria-label={`خفض ${yr.name}`}
                          className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 flex items-center justify-center disabled:opacity-30"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleToggleStatus('academicYears', yr.id, yr.status, yr.name)
                          }
                          className="min-h-[36px] px-3 rounded-lg bg-[#EAF4F7] text-xs font-semibold"
                        >
                          {yr.status === 'published' ? 'إخفاء' : 'نشر'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingYear(yr);
                            setYearName(yr.name);
                            setYearStatus(yr.status);
                          }}
                          aria-label={`تعديل ${yr.name}`}
                          className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 flex items-center justify-center"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmDelete({
                              title: `هل تريد حذف "${yr.name}"؟`,
                              onConfirm: async () => {
                                await deleteDoc(doc(db, 'academicYears', yr.id));
                                await refreshAdminCatalog();
                                showToast('تم حذف السنة الدراسية.');
                              },
                            })
                          }
                          aria-label={`حذف ${yr.name}`}
                          className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 flex items-center justify-center text-[#FF8066]"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 4: SEMESTERS */}
          {activeTab === 'semesters' && (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="sem-spec-select" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      1. التخصص
                    </label>
                    <select
                      id="sem-spec-select"
                      value={effectiveSemSpecId}
                      onChange={(e) => {
                        setSemSpecId(e.target.value);
                        setSemYearId('');
                      }}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                    >
                      {sortedSpecs.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="sem-year-select" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      2. السنة الدراسية
                    </label>
                    <select
                      id="sem-year-select"
                      value={effectiveSemYearId}
                      onChange={(e) => setSemYearId(e.target.value)}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                    >
                      {yearsForSemTab.map((y) => (
                        <option key={y.id} value={y.id}>
                          {y.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <form onSubmit={handleSaveSemester} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                  <div>
                    <label htmlFor="sem-name" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      اسم الفصل الدراسي *
                    </label>
                    <input
                      id="sem-name"
                      type="text"
                      required
                      value={semName}
                      onChange={(e) => setSemName(e.target.value)}
                      placeholder="مثال: الفصل الصيفي"
                      className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="sem-status" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      الحالة
                    </label>
                    <select
                      id="sem-status"
                      value={semStatus}
                      onChange={(e) => setSemStatus(e.target.value as PublishStatus)}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                    >
                      <option value="published">منشور</option>
                      <option value="draft">مخفي</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={!effectiveSemYearId}
                      className="min-h-[42px] px-5 py-2 rounded-xl bg-[#00A6A6] text-white text-sm font-semibold disabled:opacity-50"
                    >
                      {editingSem ? 'تحديث الفصل' : 'إضافة فصل دراسي'}
                    </button>
                  </div>
                </form>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                {semsForAdmin.length === 0 ? (
                  <p className="p-6 text-sm text-slate-500 text-center">
                    لا توجد فصول دراسية مضافة لهذه السنة.
                  </p>
                ) : (
                  semsForAdmin.map((sem, idx) => (
                    <div key={sem.id} className="p-4 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-display text-sm font-bold text-[#0B2545]">{sem.name}</h3>
                        <p className="text-xs text-slate-500">
                          {sem.status === 'published' ? 'منشور' : 'مخفي'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleSwapOrder('semesters', semsForAdmin, idx, -1)}
                          disabled={idx === 0}
                          aria-label={`رفع ${sem.name}`}
                          className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 flex items-center justify-center disabled:opacity-30"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSwapOrder('semesters', semsForAdmin, idx, 1)}
                          disabled={idx === semsForAdmin.length - 1}
                          aria-label={`خفض ${sem.name}`}
                          className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 flex items-center justify-center disabled:opacity-30"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleToggleStatus('semesters', sem.id, sem.status, sem.name)
                          }
                          className="min-h-[36px] px-3 rounded-lg bg-[#EAF4F7] text-xs font-semibold"
                        >
                          {sem.status === 'published' ? 'إخفاء' : 'نشر'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSem(sem);
                            setSemName(sem.name);
                            setSemStatus(sem.status);
                          }}
                          aria-label={`تعديل ${sem.name}`}
                          className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 flex items-center justify-center"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmDelete({
                              title: `هل تريد حذف "${sem.name}"؟`,
                              onConfirm: async () => {
                                await deleteDoc(doc(db, 'semesters', sem.id));
                                await refreshAdminCatalog();
                                showToast('تم حذف الفصل الدراسي.');
                              },
                            })
                          }
                          aria-label={`حذف ${sem.name}`}
                          className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 flex items-center justify-center text-[#FF8066]"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 5: SUBJECTS & SHARED COURSES SYSTEM */}
          {activeTab === 'subjects' && (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-base font-bold text-[#0B2545]">
                      نظام المقررات الدراسية والمقررات المشتركة
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      أنشئ المقرر مرة واحدة واربطه بتخصص أو عدة تخصصات دون تكرار الملفات أو السجلات.
                    </p>
                  </div>
                  {duplicateCourseGroups.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowDuplicateInspector((prev) => !prev)}
                      className="min-h-[38px] px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold inline-flex items-center gap-1.5 self-start sm:self-auto"
                    >
                      <AlertTriangle className="w-4 h-4" />
                      فحص أسماء متطابقة ({duplicateCourseGroups.length})
                    </button>
                  )}
                </div>

                {showDuplicateInspector && duplicateCourseGroups.length > 0 && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold text-amber-900">
                          مقررات تحمل أسماء متطابقة — للمراجعة اليدوية فقط (لا يتم الدمج تلقائياً)
                        </p>
                        <p className="text-[11px] text-amber-800 mt-0.5">
                          قد تختلف المقررات المتشابهة في الرمز أو المنهج أو الكلية. تحقق من الرمز وعدد الملفات قبل أي قرار.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowDuplicateInspector(false)}
                        className="text-xs font-semibold text-amber-800 hover:underline"
                      >
                        إغلاق
                      </button>
                    </div>
                    <div className="space-y-2">
                      {duplicateCourseGroups.map((group) => (
                        <div key={group.normalizedName} className="bg-white rounded-xl border border-amber-200/70 p-3 space-y-1.5">
                          <p className="text-xs font-bold text-[#0B2545]">
                            الاسم المتطابق: {group.courses[0]?.name} ({group.courses.length} سجلات)
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {group.courses.map((c) => {
                              const sName = specializations.find((s) => s.id === c.specializationId)?.name;
                              const fCount = countFilesForSubject(lectureFiles, c.id, true);
                              return (
                                <div key={c.id} className="text-[11px] bg-[#EAF4F7]/50 rounded-lg p-2 flex items-center justify-between gap-2">
                                  <span className="truncate">
                                    {sName} {c.code ? `(${c.code})` : ''} {c.curriculumVersion ? `· ${c.curriculumVersion}` : ''}
                                  </span>
                                  <span className="font-mono text-slate-500 shrink-0">{fCount} ملف</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="sub-spec-select" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      1. التخصص المستهدف
                    </label>
                    <select
                      id="sub-spec-select"
                      value={effectiveSubSpecId}
                      onChange={(e) => {
                        setSubSpecId(e.target.value);
                        setSubYearId('');
                        setSubSemId('');
                      }}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                    >
                      {sortedSpecs.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="sub-year-select" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      2. السنة الدراسية
                    </label>
                    <select
                      id="sub-year-select"
                      value={effectiveSubYearId}
                      onChange={(e) => {
                        setSubYearId(e.target.value);
                        setSubSemId('');
                      }}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                    >
                      {yearsForSubTab.map((y) => (
                        <option key={y.id} value={y.id}>
                          {y.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="sub-sem-select" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      3. الفصل الدراسي
                    </label>
                    <select
                      id="sub-sem-select"
                      value={effectiveSubSemId}
                      onChange={(e) => setSubSemId(e.target.value)}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                    >
                      {semsForSubTab.map((sem) => (
                        <option key={sem.id} value={sem.id}>
                          {sem.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {(isSuperAdmin ||
                  hasPerm('subjects.create') ||
                  (editingSub && hasPerm('subjects.edit'))) && (
                  <div className="space-y-4 pt-3 border-t border-slate-100">
                    {!editingSub && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setSubjectWorkflowMode('create')}
                          className={`min-h-[40px] px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors ${
                            subjectWorkflowMode === 'create'
                              ? 'bg-[#0B2545] text-white'
                              : 'bg-[#EAF4F7] text-[#0B2545]'
                          }`}
                        >
                          <FolderPlus className="w-4 h-4" />
                          إنشاء مقرر جديد (متعدد التخصصات)
                        </button>
                        <button
                          type="button"
                          onClick={() => setSubjectWorkflowMode('link')}
                          className={`min-h-[40px] px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors ${
                            subjectWorkflowMode === 'link'
                              ? 'bg-[#00A6A6] text-white'
                              : 'bg-[#EAF4F7] text-[#0B2545]'
                          }`}
                        >
                          <Link2 className="w-4 h-4" />
                          ربط مقرر موجود بهذا التخصص
                        </button>
                      </div>
                    )}

                    {(editingSub || subjectWorkflowMode === 'create') ? (
                      <form onSubmit={handleSaveSubject} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          <div>
                            <label htmlFor="sub-name" className="block text-xs font-semibold text-[#0B2545] mb-1">
                              اسم المقرر الدراسي *
                            </label>
                            <input
                              id="sub-name"
                              type="text"
                              required
                              value={subName}
                              onChange={(e) => setSubName(e.target.value)}
                              placeholder="مثال: فيزياء عامة 1"
                              className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm"
                            />
                          </div>
                          <div>
                            <label htmlFor="sub-code" className="block text-xs font-semibold text-[#0B2545] mb-1">
                              رمز المقرر (للمقررات المشتركة)
                            </label>
                            <input
                              id="sub-code"
                              type="text"
                              value={subCode}
                              onChange={(e) => setSubCode(e.target.value)}
                              placeholder="مثال: PHYS101"
                              className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm font-mono"
                            />
                          </div>
                          <div>
                            <label htmlFor="sub-status" className="block text-xs font-semibold text-[#0B2545] mb-1">
                              الحالة
                            </label>
                            <select
                              id="sub-status"
                              value={subStatus}
                              onChange={(e) => setSubStatus(e.target.value as PublishStatus)}
                              className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                            >
                              <option value="published">منشور</option>
                              <option value="draft">مخفي</option>
                            </select>
                          </div>
                          <div>
                            <label htmlFor="sub-version" className="block text-xs font-semibold text-[#0B2545] mb-1">
                              نسخة المنهج / السياق (اختياري)
                            </label>
                            <input
                              id="sub-version"
                              type="text"
                              value={subCurriculumVersion}
                              onChange={(e) => setSubCurriculumVersion(e.target.value)}
                              placeholder="مثال: منهج الهندسة الموحد 2025"
                              className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label htmlFor="sub-desc" className="block text-xs font-semibold text-[#0B2545] mb-1">
                              وصف المقرر (اختياري)
                            </label>
                            <input
                              id="sub-desc"
                              type="text"
                              value={subDesc}
                              onChange={(e) => setSubDesc(e.target.value)}
                              placeholder="نبذة مختصرة عن المقرر..."
                              className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm"
                            />
                          </div>
                        </div>

                        {!editingSub && (
                          <div className="rounded-2xl bg-[#EAF4F7]/50 border border-slate-200 p-3.5 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs font-bold text-[#0B2545]">
                                مشاركة هذا المقرر مع تخصصات إضافية أثناء الإنشاء (اختياري):
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  const defaultSpec = sortedSpecs.find((s) => s.id !== effectiveSubSpecId) || sortedSpecs[0];
                                  if (!defaultSpec) return;
                                  const yrs = getYearsForSpecialization(academicYears, defaultSpec.id, true);
                                  const yId = yrs[0]?.id || '';
                                  const sems = yId ? getSemestersForYear(semesters, defaultSpec.id, yId, true) : [];
                                  setCreateExtraPlacements((prev) => [
                                    ...prev,
                                    {
                                      specializationId: defaultSpec.id,
                                      academicYearId: yId,
                                      semesterId: sems[0]?.id || '',
                                    },
                                  ]);
                                }}
                                className="min-h-[34px] px-3 py-1 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-[#00A6A6] inline-flex items-center gap-1"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                إضافة تخصص مرتبط
                              </button>
                            </div>

                            {createExtraPlacements.length > 0 && (
                              <div className="space-y-2">
                                {createExtraPlacements.map((placement, pIdx) => {
                                  const pYears = getYearsForSpecialization(academicYears, placement.specializationId, true);
                                  const pSems = placement.academicYearId
                                    ? getSemestersForYear(semesters, placement.specializationId, placement.academicYearId, true)
                                    : [];
                                  return (
                                    <div key={pIdx} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center bg-white p-2.5 rounded-xl border border-slate-200">
                                      <select
                                        value={placement.specializationId}
                                        onChange={(e) => {
                                          const nextSpec = e.target.value;
                                          const ny = getYearsForSpecialization(academicYears, nextSpec, true);
                                          const nyId = ny[0]?.id || '';
                                          const ns = nyId ? getSemestersForYear(semesters, nextSpec, nyId, true) : [];
                                          setCreateExtraPlacements((prev) =>
                                            prev.map((row, idx) =>
                                              idx === pIdx
                                                ? { specializationId: nextSpec, academicYearId: nyId, semesterId: ns[0]?.id || '' }
                                                : row
                                            )
                                          );
                                        }}
                                        className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 text-xs"
                                      >
                                        {sortedSpecs.map((s) => (
                                          <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                      </select>
                                      <select
                                        value={placement.academicYearId}
                                        onChange={(e) => {
                                          const nyId = e.target.value;
                                          const ns = getSemestersForYear(semesters, placement.specializationId, nyId, true);
                                          setCreateExtraPlacements((prev) =>
                                            prev.map((row, idx) =>
                                              idx === pIdx
                                                ? { ...row, academicYearId: nyId, semesterId: ns[0]?.id || '' }
                                                : row
                                            )
                                          );
                                        }}
                                        className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 text-xs"
                                      >
                                        {pYears.map((y) => (
                                          <option key={y.id} value={y.id}>{y.name}</option>
                                        ))}
                                      </select>
                                      <select
                                        value={placement.semesterId}
                                        onChange={(e) => {
                                          const nSemId = e.target.value;
                                          setCreateExtraPlacements((prev) =>
                                            prev.map((row, idx) => (idx === pIdx ? { ...row, semesterId: nSemId } : row))
                                          );
                                        }}
                                        className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 text-xs"
                                      >
                                        {pSems.map((sm) => (
                                          <option key={sm.id} value={sm.id}>{sm.name}</option>
                                        ))}
                                      </select>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setCreateExtraPlacements((prev) => prev.filter((_, idx) => idx !== pIdx))
                                        }
                                        className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 text-xs text-[#FF8066] font-semibold"
                                      >
                                        إزالة المسار
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        <IconPicker value={subIcon} onChange={setSubIcon} label="أيقونة المقرر" />

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="submit"
                            disabled={!effectiveSubSemId}
                            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#00A6A6] text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2"
                          >
                            <FolderPlus className="w-4 h-4" />
                            {editingSub ? 'حفظ تعديل المقرر' : 'إنشاء وحفظ المقرر'}
                          </button>
                          {editingSub && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSub(null);
                                setSubName('');
                                setSubCode('');
                                setSubCurriculumVersion('');
                                setSubDesc('');
                              }}
                              className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-sm"
                            >
                              إلغاء
                            </button>
                          )}
                        </div>
                      </form>
                    ) : (
                      <form onSubmit={handleLinkExistingCourse} className="space-y-4">
                        <div className="rounded-xl bg-[#EAF4F7]/65 p-3.5 text-xs text-[#0B2545]">
                          سيتم ربط المقرر المختار بالتخصص المحدد أعلاه (<strong>{sortedSpecs.find((s) => s.id === effectiveSubSpecId)?.name}</strong> / {yearsForSubTab.find((y) => y.id === effectiveSubYearId)?.name} / {semsForSubTab.find((sm) => sm.id === effectiveSubSemId)?.name}) وتتوفر جميع ملفاته فوراً دون إعادة رفع أو تكرار تخزيني.
                        </div>

                        <div className="relative">
                          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="search"
                            value={linkSearchQuery}
                            onChange={(e) => setLinkSearchQuery(e.target.value)}
                            placeholder="ابحث باسم المقرر أو رمزه (مثل PHYS101)..."
                            className="w-full min-h-[42px] pr-10 pl-3 rounded-xl border border-slate-200 text-sm"
                          />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-64 overflow-y-auto p-1">
                          {searchableExistingCourses.map((course) => {
                            const alreadyLinkedHere =
                              Boolean(effectiveSubSpecId && effectiveSubYearId && effectiveSubSemId) &&
                              hasDuplicateProgramLink(
                                course,
                                programCourses,
                                effectiveSubSpecId,
                                effectiveSubYearId,
                                effectiveSubSemId
                              );
                            const fCount = countFilesForSubject(lectureFiles, course.id, true);
                            const originSpec = specializations.find((s) => s.id === course.specializationId)?.name;
                            const isSelected = selectedExistingCourseId === course.id;
                            return (
                              <button
                                key={course.id}
                                type="button"
                                disabled={alreadyLinkedHere}
                                onClick={() => setSelectedExistingCourseId(course.id)}
                                className={`text-right p-3 rounded-xl border transition-colors flex items-center justify-between gap-2 ${
                                  alreadyLinkedHere
                                    ? 'bg-slate-50 border-slate-200 opacity-55 cursor-not-allowed'
                                    : isSelected
                                      ? 'bg-[#EAF4F7] border-[#00A6A6] ring-2 ring-[#00A6A6]/30'
                                      : 'bg-white border-slate-200 hover:border-[#00A6A6]'
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-bold text-xs text-[#0B2545] truncate">{course.name}</span>
                                    {course.code && (
                                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-mono text-[#0B2545]">
                                        {course.code}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                                    الأصل: {originSpec} · {fCount} ملف
                                  </p>
                                </div>
                                <span className="text-[11px] font-semibold shrink-0 text-[#00A6A6]">
                                  {alreadyLinkedHere ? 'مرتبط هنا' : isSelected ? 'محدد' : 'اختيار'}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        <button
                          type="submit"
                          disabled={!effectiveSubSemId || !selectedExistingCourseId}
                          className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2"
                        >
                          <Link2 className="w-4 h-4" />
                          ربط المقرر المختار بهذا التخصص
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                {subjectsForAdmin.length === 0 ? (
                  <p className="p-6 text-sm text-slate-500 text-center">
                    لا توجد مقررات دراسية مرتبطة بهذا الفصل بعد.
                  </p>
                ) : (
                  subjectsForAdmin.map((sub, idx) => {
                    const allPlacements = getEffectiveCoursePlacements(sub, programCourses, true);
                    const currentPlacement = allPlacements.find(
                      (p) =>
                        p.specializationId === effectiveSubSpecId &&
                        p.academicYearId === effectiveSubYearId &&
                        p.semesterId === effectiveSubSemId
                    );
                    const filesCount = countFilesForSubject(lectureFiles, sub.id, true);
                    return (
                      <div key={sub.id} className="p-4 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-[#EAF4F7] text-[#0B2545] flex items-center justify-center shrink-0">
                              <AcademicIcon iconKey={sub.iconKey} className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center flex-wrap gap-1.5">
                                <h3 className="font-display text-sm font-bold text-[#0B2545] truncate">
                                  {sub.name}
                                </h3>
                                {sub.code && (
                                  <span className="px-2 py-0.5 rounded bg-[#EAF4F7] text-[#0B2545] text-[10px] font-mono font-bold">
                                    {sub.code}
                                  </span>
                                )}
                                {allPlacements.length > 1 && (
                                  <span className="px-2 py-0.5 rounded bg-[#00A6A6]/12 text-[#00A6A6] text-[10px] font-bold">
                                    مشترك ({allPlacements.length} تخصصات)
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 tabular-nums">
                                {filesCount} ملف مرفق (مخزنة مرة واحدة) ·{' '}
                                {sub.status === 'published' ? 'منشورة' : 'مخفية'}
                                {sub.curriculumVersion ? ` · ${sub.curriculumVersion}` : ''}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center flex-wrap gap-1.5 shrink-0">
                            {(isSuperAdmin || hasPerm('subjects.edit')) && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleSwapOrder('subjects', subjectsForAdmin, idx, -1)}
                                  disabled={idx === 0}
                                  aria-label={`رفع ${sub.name}`}
                                  className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 flex items-center justify-center disabled:opacity-30"
                                >
                                  <ArrowUp className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSwapOrder('subjects', subjectsForAdmin, idx, 1)}
                                  disabled={idx === subjectsForAdmin.length - 1}
                                  aria-label={`خفض ${sub.name}`}
                                  className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 flex items-center justify-center disabled:opacity-30"
                                >
                                  <ArrowDown className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleToggleStatus('subjects', sub.id, sub.status, sub.name)
                                  }
                                  className="min-h-[36px] px-3 rounded-lg bg-[#EAF4F7] text-xs font-semibold"
                                >
                                  {sub.status === 'published' ? 'إخفاء' : 'نشر'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingSub(sub);
                                    setSubName(sub.name);
                                    setSubCode(sub.code || '');
                                    setSubCurriculumVersion(sub.curriculumVersion || '');
                                    setSubDesc(sub.description || '');
                                    setSubIcon(sub.iconKey);
                                    setSubStatus(sub.status);
                                  }}
                                  aria-label={`تعديل ${sub.name}`}
                                  className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 flex items-center justify-center"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                {currentPlacement && allPlacements.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setConfirmDelete({
                                        title: `فك ربط "${sub.name}" من هذا التخصص فقط؟ (سيظل المقرر وملفاته ${filesCount} متاحة لبقية التخصصات المرتبطة)`,
                                        onConfirm: () =>
                                          handleUnlinkCoursePlacement(sub, currentPlacement, allPlacements),
                                      })
                                    }
                                    className="min-h-[36px] px-2.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs font-semibold inline-flex items-center gap-1"
                                  >
                                    <Unlink className="w-3.5 h-3.5" />
                                    فك الربط هنا
                                  </button>
                                )}
                              </>
                            )}
                            {(isSuperAdmin || hasPerm('subjects.delete')) && (
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmDelete({
                                    title:
                                      allPlacements.length > 1
                                        ? `تحذير: مقرر "${sub.name}" مشترك حالياً مع ${allPlacements.length} تخصصات! هل تريد حذفه نهائياً من جميع التخصصات؟`
                                        : `هل تريد حذف مادة "${sub.name}" نهائياً؟`,
                                    onConfirm: () => handleDeleteCanonicalCourse(sub),
                                  })
                                }
                                aria-label={`حذف ${sub.name} نهائياً`}
                                className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 flex items-center justify-center text-[#FF8066]"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Linked Specializations Chips */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className="text-[11px] font-semibold text-slate-500">المسارات المرتبطة:</span>
                          {allPlacements.map((p) => {
                            const sName = specializations.find((s) => s.id === p.specializationId)?.name || p.specializationId;
                            const yName = academicYears.find((y) => y.id === p.academicYearId)?.name || '';
                            const smName = semesters.find((sm) => sm.id === p.semesterId)?.name || '';
                            return (
                              <span
                                key={`${p.specializationId}-${p.academicYearId}-${p.semesterId}`}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#EAF4F7]/80 text-[#0B2545] text-[11px] border border-slate-200/70"
                              >
                                <span>{sName}</span>
                                {yName && <span className="text-slate-400">· {yName}</span>}
                                {smName && <span className="text-slate-400">· {smName}</span>}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 5B: CENTRAL LECTURE LIBRARY */}
          {activeTab === 'central_library' && (
            <CentralLectureLibrary
              onPreviewFile={onPreviewFile}
              onOpenUpload={() => {
                setEditingFile(null);
                setInitialUploadMode('upload');
                setActiveTab('upload');
              }}
              onEditFile={(file) => {
                setEditingFile(file);
                setActiveTab('upload');
              }}
              onToast={showToast}
            />
          )}

          {/* TAB 6: LECTURE FILES TABLE */}
          {activeTab === 'files' && (
            <div className="space-y-4">
              <div className="rounded-2xl bg-[#EAF4F7] border border-[#00A6A6]/30 p-3.5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-semibold text-[#0B2545]">
                  للتوزيع متعدد التخصصات وإعادة استخدام الملفات وإدارة الروابط أو دمج المكررات، افتح المكتبة المركزية للمحاضرات.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('central_library')}
                  className="min-h-[36px] px-3.5 py-1.5 rounded-xl bg-[#0B2545] text-white text-xs font-bold inline-flex items-center gap-1.5 shrink-0"
                >
                  <Library className="w-3.5 h-3.5 text-[#00A6A6]" />
                  فتح المكتبة المركزية
                </button>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row gap-3">
                <input
                  type="search"
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                  placeholder="بحث باسم الملف أو العنوان..."
                  className="flex-1 min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm"
                />
                <select
                  value={fileFilterSpec}
                  onChange={(e) => setFileFilterSpec(e.target.value)}
                  className="min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                >
                  <option value="">كل التخصصات</option>
                  {sortedSpecs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="bg-[#EAF4F7]/70 text-xs font-semibold text-[#0B2545]">
                    <tr>
                      <th className="p-3.5">العنوان / الملف</th>
                      <th className="p-3.5">المسار الأكاديمي</th>
                      <th className="p-3.5">التصنيف والحجم</th>
                      <th className="p-3.5">الحالة</th>
                      <th className="p-3.5">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAdminFiles.map((file) => {
                      const spec = specializations.find((s) => s.id === file.specializationId);
                      const sub = subjects.find((s) => s.id === file.subjectId);
                      const dests = getFileDestinations({
                        file,
                        links: lectureFileLinks,
                        subjects,
                        programCourses,
                        includeDrafts: true,
                      });
                      return (
                        <tr key={file.id} className="hover:bg-slate-50/70">
                          <td className="p-3.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-bold text-[#0B2545]">{file.title}</p>
                              {isGoogleDriveFile(file) && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#EAF4F7] text-[#00A6A6] text-[10px] font-bold">
                                  <Cloud className="w-3 h-3" />
                                  Google Drive
                                </span>
                              )}
                              {dests.length > 1 && (
                                <span className="px-2 py-0.5 rounded-lg bg-[#00A6A6]/12 text-[#008080] text-[10px] font-bold">
                                  موزع على {dests.length} وجهات
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 font-mono">
                              {isGoogleDriveFile(file) && file.externalUrl
                                ? file.externalUrl
                                : file.originalName}
                            </p>
                          </td>
                          <td className="p-3.5 text-xs text-slate-600">
                            {spec?.name || 'مكتبة مركزية'} / {sub?.name}
                          </td>
                          <td className="p-3.5 text-xs text-slate-600">
                            <p>{getCategoryLabel(file.category)}</p>
                            <p className="tabular-nums text-slate-400">
                              {isGoogleDriveFile(file) && (!file.fileSize || file.fileSize <= 0)
                                ? 'رابط سحابي'
                                : formatFileSizeArabic(file.fileSize)}
                            </p>
                          </td>
                          <td className="p-3.5 text-xs">
                            <span
                              className={`font-semibold ${
                                file.status === 'published' ? 'text-[#00A6A6]' : 'text-slate-500'
                              }`}
                            >
                              {file.status === 'published' ? 'منشور' : 'مسودة'}
                            </span>
                            <p className="text-[11px] text-slate-400">
                              {file.allowDownload ? 'التحميل متاح' : 'معاينة فقط'}
                            </p>
                          </td>
                          <td className="p-3.5">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => onPreviewFile(file)}
                                aria-label={`معاينة ${file.title}`}
                                className="min-h-[34px] min-w-[34px] rounded-lg border border-slate-200 flex items-center justify-center text-[#0B2545]"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              {isGoogleDriveFile(file) && file.externalUrl && (
                                <a
                                  href={file.externalUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={`فتح ${file.title} في Google Drive`}
                                  className="min-h-[34px] min-w-[34px] rounded-lg border border-slate-200 flex items-center justify-center text-[#00A6A6]"
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </a>
                              )}
                              {(isSuperAdmin || hasPerm('lectures.publish')) && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleToggleStatus('lectureFiles', file.id, file.status, file.title)
                                  }
                                  aria-label={file.status === 'published' ? `إخفاء ${file.title}` : `نشر ${file.title}`}
                                  className="min-h-[34px] min-w-[34px] rounded-lg border border-slate-200 flex items-center justify-center text-[#0B2545]"
                                >
                                  {file.status === 'published' ? (
                                    <EyeOff className="w-4 h-4" />
                                  ) : (
                                    <Eye className="w-4 h-4 text-[#00A6A6]" />
                                  )}
                                </button>
                              )}
                              {(isSuperAdmin || hasPerm('lectures.edit')) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingFile(file);
                                    setActiveTab('upload');
                                  }}
                                  aria-label={`تعديل ${file.title}`}
                                  className="min-h-[34px] min-w-[34px] rounded-lg border border-slate-200 flex items-center justify-center text-[#0B2545]"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                              )}
                              {(isSuperAdmin || hasPerm('lectures.delete')) && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmDelete({
                                      title:
                                        dests.length > 1
                                          ? `تحذير: ملف "${file.title}" مرتبط حالياً بـ ${dests.length} وجهات أكاديمية! هل تريد حذفه نهائياً من جميع التخصصات؟`
                                          : `هل تريد حذف ملف "${file.title}" نهائياً؟`,
                                      onConfirm: () => handleDeleteFile(file),
                                    })
                                  }
                                  aria-label={`حذف ${file.title}`}
                                  className="min-h-[34px] min-w-[34px] rounded-lg border border-slate-200 flex items-center justify-center text-[#FF8066]"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 7: UPLOAD / LINK GOOGLE DRIVE / EDIT FILE */}
          {activeTab === 'upload' && (
            <AdminFileUploader
              editingFile={editingFile}
              initialUploadMode={initialUploadMode}
              onPreviewFile={onPreviewFile}
              onSuccess={() => {
                setEditingFile(null);
                setActiveTab('central_library');
              }}
              onCancelEdit={() => {
                setEditingFile(null);
                setActiveTab('central_library');
              }}
            />
          )}

          {/* TAB 8: ANNOUNCEMENTS */}
          {activeTab === 'announcements' && (
            <div className="space-y-6">
              <form
                onSubmit={handleSaveAnnouncement}
                className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4"
              >
                <h2 className="font-display text-base font-bold text-[#0B2545]">
                  {editingAnn ? 'تعديل الإعلان' : 'نشر إعلان جامعي جديد'}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label htmlFor="ann-title" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      عنوان الإعلان *
                    </label>
                    <input
                      id="ann-title"
                      type="text"
                      required
                      value={annTitle}
                      onChange={(e) => setAnnTitle(e.target.value)}
                      className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="ann-cat" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      الفئة
                    </label>
                    <select
                      id="ann-cat"
                      value={annCategory}
                      onChange={(e) => setAnnCategory(e.target.value as AnnouncementCategory)}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                    >
                      {(Object.keys(ANNOUNCEMENT_CATEGORY_LABELS) as AnnouncementCategory[]).map(
                        (k) => (
                          <option key={k} value={k}>
                            {ANNOUNCEMENT_CATEGORY_LABELS[k]}
                          </option>
                        )
                      )}
                    </select>
                  </div>
                  <div className="sm:col-span-3">
                    <label htmlFor="ann-body" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      نص الإعلان *
                    </label>
                    <textarea
                      id="ann-body"
                      rows={3}
                      required
                      value={annBody}
                      onChange={(e) => setAnnBody(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="ann-prio" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      الأهمية
                    </label>
                    <select
                      id="ann-prio"
                      value={annPriority}
                      onChange={(e) => setAnnPriority(e.target.value as AnnouncementPriority)}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                    >
                      <option value="normal">عادي</option>
                      <option value="important">مهم / عاجل</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="ann-stat" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      الحالة
                    </label>
                    <select
                      id="ann-stat"
                      value={annStatus}
                      onChange={(e) => setAnnStatus(e.target.value as PublishStatus)}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                    >
                      <option value="published">منشور</option>
                      <option value="draft">مسودة</option>
                    </select>
                  </div>
                </div>
                <button
                  type="submit"
                  className="min-h-[42px] px-5 py-2 rounded-xl bg-[#00A6A6] text-white text-sm font-semibold"
                >
                  {editingAnn ? 'تحديث الإعلان' : 'نشر الإعلان'}
                </button>
              </form>

              <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                {announcements.map((ann) => (
                  <div key={ann.id} className="p-4 flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-display text-sm font-bold text-[#0B2545]">
                        {ann.title}
                      </h3>
                      <p className="text-xs text-slate-600 mt-1">{ann.body}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingAnn(ann);
                          setAnnTitle(ann.title);
                          setAnnBody(ann.body);
                          setAnnCategory(ann.category);
                          setAnnPriority(ann.priority);
                          setAnnStatus(ann.status);
                        }}
                        aria-label={`تعديل ${ann.title}`}
                        className="min-h-[34px] min-w-[34px] rounded-lg border border-slate-200 flex items-center justify-center"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmDelete({
                            title: `هل تريد حذف إعلان "${ann.title}"؟`,
                            onConfirm: async () => {
                              await deleteDoc(doc(db, 'announcements', ann.id));
                              await refreshAdminCatalog();
                              showToast('تم حذف الإعلان.');
                            },
                          })
                        }
                        aria-label={`حذف ${ann.title}`}
                        className="min-h-[34px] min-w-[34px] rounded-lg border border-slate-200 flex items-center justify-center text-[#FF8066]"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 9: ADMINS & USERS */}
          {activeTab === 'users' && <AdminManagementPanel onToast={showToast} />}

          {/* TAB 10: STORAGE CAPACITY */}
          {activeTab === 'storage' && (
            <StorageCapacityPanel onPreviewFile={onPreviewFile} onToast={showToast} />
          )}

          {/* TAB 10B: SUPER ADMIN INFRASTRUCTURE MONITORING */}
          {activeTab === 'monitoring' && (
            <InfrastructureMonitoringPanel onToast={showToast} />
          )}

          {/* TAB 10C: SUPER ADMIN COMPREHENSIVE SECURITY CENTER */}
          {activeTab === 'security_center' && (
            <SecurityCenterPanel onToast={showToast} />
          )}

          {/* TAB 11: AUDIT LOGS */}
          {activeTab === 'audit_logs' && <AuditLogsPanel />}

          {/* TAB 12: BACKUPS & RECOVERY */}
          {activeTab === 'backups' && <BackupRecoveryPanel onToast={showToast} />}

          {/* TAB 13: SETTINGS */}
          {activeTab === 'settings' && (
            <form
              onSubmit={handleSaveSettings}
              className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 max-w-xl"
            >
              <h2 className="font-display text-base font-bold text-[#0B2545]">
                إعدادات المنصة والملفات
              </h2>
              <div>
                <label htmlFor="set-title" className="block text-xs font-semibold text-[#0B2545] mb-1">
                  اسم المنصة
                </label>
                <input
                  id="set-title"
                  type="text"
                  value={platformTitle}
                  onChange={(e) => setPlatformTitle(e.target.value)}
                  className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm"
                />
              </div>
              <div>
                <label htmlFor="set-maxsize" className="block text-xs font-semibold text-[#0B2545] mb-1">
                  الحد الأقصى لحجم الملف (ميجابايت)
                </label>
                <input
                  id="set-maxsize"
                  type="number"
                  min={1}
                  max={500}
                  value={maxFileSizeMB}
                  onChange={(e) => setMaxFileSizeMB(Number(e.target.value))}
                  className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm tabular-nums"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-[#0B2545] cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowZipUploads}
                  onChange={(e) => setAllowZipUploads(e.target.checked)}
                  className="w-4 h-4 accent-[#00A6A6]"
                />
                السماح برفع الملفات المضغوطة (ZIP)
              </label>
              <button
                type="submit"
                className="min-h-[42px] px-5 py-2 rounded-xl bg-[#00A6A6] text-white text-sm font-semibold"
              >
                حفظ الإعدادات
              </button>
            </form>
          )}
        </main>
      </div>

      {/* Confirmation Dialog Modal */}
      {confirmDelete && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-sm w-full space-y-4 shadow-xl">
            <h3 className="font-display text-lg font-bold text-[#0B2545]">
              تأكيد الحذف
            </h3>
            <p className="text-sm text-slate-600">{confirmDelete.title}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="min-h-[40px] px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={async () => {
                  const fn = confirmDelete.onConfirm;
                  setConfirmDelete(null);
                  await fn();
                }}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#FF8066] text-white text-sm font-semibold"
              >
                تأكيد الحذف
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
