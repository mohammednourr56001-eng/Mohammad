import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Calendar,
  ClipboardList,
  Cloud,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  GraduationCap,
  Home,
  Layers,
  Link2,
  Lock,
  LogOut,
  Megaphone,
  Menu,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import {
  ANNOUNCEMENT_CATEGORY_LABELS,
  Announcement,
  AnnouncementCategory,
  AnnouncementPriority,
  LectureFile,
  PublishStatus,
} from '../types/academic.ts';
import {
  formatFileSizeArabic,
  generateSafeId,
  getCategoryLabel,
  isGoogleDriveFile,
  sortByOrder,
} from '../utils/academicLogic.ts';
import {
  canScopedAdminPerformAction,
  computeSpecializationDashboardSummary,
  parseAdminRequestedSpecFromUrl,
  SCOPED_ADMIN_ACCESS_DENIED_AR,
  SUPER_ADMIN_UPLOAD_ONLY_AR,
} from '../utils/scopedAdminLogic.ts';
import { AuditLogsPanel } from './AuditLogsPanel.tsx';
import { AcademicIcon } from './IconPicker.tsx';

type ScopedTab =
  | 'overview'
  | 'structure'
  | 'subjects'
  | 'lectures'
  | 'shared_courses'
  | 'spec_info'
  | 'announcements'
  | 'audit';

export function SpecializationAdminDashboard({
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
    permissions,
    accountStatus,
    assignedSpecializationId,
    hasPerm,
    logout,
    getIdToken,
  } = useAuth();
  const {
    specializations,
    academicYears,
    semesters,
    subjects,
    programCourses,
    lectureFiles,
    lectureFileLinks,
    announcements,
    activityLogs,
    users,
    refreshAdminCatalog,
    refreshAuditLogs,
  } = usePlatformData();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ScopedTab>('overview');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [aggregateStudentCountOverride, setAggregateStudentCountOverride] = useState<number | null>(
    null
  );

  // Scoped structure forms
  const [yearName, setYearName] = useState('');
  const [yearStatus, setYearStatus] = useState<PublishStatus>('published');
  const [semYearId, setSemYearId] = useState('');
  const [semName, setSemName] = useState('');
  const [semStatus, setSemStatus] = useState<PublishStatus>('published');

  // Scoped subject create/edit state
  const [subYearId, setSubYearId] = useState('');
  const [subSemId, setSubSemId] = useState('');
  const [subName, setSubName] = useState('');
  const [subCode, setSubCode] = useState('');
  const [subDesc, setSubDesc] = useState('');
  const [subStatus, setSubStatus] = useState<PublishStatus>('published');
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);

  // Specialization info editor
  const [infoName, setInfoName] = useState('');
  const [infoDesc, setInfoDesc] = useState('');

  // Announcements editor (strictly scoped to assignedSpecializationId)
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annCategory, setAnnCategory] = useState<AnnouncementCategory>('academic');
  const [annPriority, setAnnPriority] = useState<AnnouncementPriority>('normal');
  const [annStatus, setAnnStatus] = useState<PublishStatus>('published');
  const [editingAnn, setEditingAnn] = useState<Announcement | null>(null);

  // Read-only lecture filter inside specialization
  const [lectureFilter, setLectureFilter] = useState('');

  const loggedDeniedRef = useRef<string | null>(null);

  const requestedSpecId =
    typeof window !== 'undefined'
      ? parseAdminRequestedSpecFromUrl(window.location.pathname, window.location.search)
      : null;

  const isOutOfScopeUrl = Boolean(
    requestedSpecId && (!assignedSpecializationId || requestedSpecId !== assignedSpecializationId)
  );

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3200);
  };

  // Log unauthorized cross-specialization URL attempt once
  useEffect(() => {
    if (!isOutOfScopeUrl || !firebaseUser) return;
    const key = `${firebaseUser.uid}:${requestedSpecId || 'none'}`;
    if (loggedDeniedRef.current === key) return;
    loggedDeniedRef.current = key;
    (async () => {
      try {
        const token = await getIdToken();
        if (!token) return;
        await fetch('/api/admin/audit-logs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: 'محاولة وصول مباشر إلى تخصص خارج النطاق المسند',
            entityType: 'specialization',
            entityId: requestedSpecId || 'unknown',
            entityName: requestedSpecId || 'غير مصرح',
            specializationId: assignedSpecializationId || undefined,
            result: 'denied',
            details: `Requested=${requestedSpecId || 'none'} Assigned=${assignedSpecializationId || 'none'}`,
          }),
        });
      } catch {
        // non-fatal
      }
    })();
  }, [isOutOfScopeUrl, firebaseUser, requestedSpecId, assignedSpecializationId, getIdToken]);

  // Fetch authoritative server-scoped summary (aggregate student count when permitted + spec verification)
  useEffect(() => {
    if (!firebaseUser || !assignedSpecializationId || isOutOfScopeUrl) return;
    let active = true;
    (async () => {
      try {
        const token = await getIdToken();
        if (!token) return;
        const res = await fetch('/api/admin/scoped/overview', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || !active) return;
        const data = await res.json();
        if (
          active &&
          typeof data?.summary?.aggregateStudentCount === 'number'
        ) {
          setAggregateStudentCountOverride(data.summary.aggregateStudentCount);
        }
      } catch {
        // non-fatal
      }
    })();
    return () => {
      active = false;
    };
  }, [firebaseUser, assignedSpecializationId, isOutOfScopeUrl, getIdToken]);

  const summary = useMemo(() => {
    if (!assignedSpecializationId || !firebaseUser) {
      return null;
    }
    return computeSpecializationDashboardSummary({
      assignedSpecializationId,
      actorUid: firebaseUser.uid,
      canViewStats: hasPerm('spec.stats.view'),
      canViewAudit: hasPerm('spec.audit.view'),
      specializations,
      academicYears,
      semesters,
      subjects,
      programCourses,
      lectureFiles,
      lectureFileLinks,
      announcements,
      activityLogs,
      usersDirectory: users,
    });
  }, [
    assignedSpecializationId,
    firebaseUser,
    hasPerm,
    specializations,
    academicYears,
    semesters,
    subjects,
    programCourses,
    lectureFiles,
    lectureFileLinks,
    announcements,
    activityLogs,
    users,
  ]);

  const assignedSpec = summary?.specialization || null;

  useEffect(() => {
    if (assignedSpec) {
      setInfoName(assignedSpec.name);
      setInfoDesc(assignedSpec.description || '');
    }
  }, [assignedSpec?.id, assignedSpec?.name, assignedSpec?.description]);

  // Keep valid dependent year/semester defaults inside assigned specialization
  const specYears = useMemo(
    () => (summary ? sortByOrder(summary.years) : []),
    [summary]
  );
  const effectiveSemYearId = semYearId || specYears[0]?.id || '';
  const effectiveSubYearId = subYearId || specYears[0]?.id || '';
  const semestersForSubYear = useMemo(
    () =>
      summary
        ? sortByOrder(summary.semesters.filter((s) => s.academicYearId === effectiveSubYearId))
        : [],
    [summary, effectiveSubYearId]
  );
  const effectiveSubSemId = subSemId || semestersForSubYear[0]?.id || '';

  if (!firebaseUser || accountStatus === 'suspended') {
    return (
      <div className="min-h-screen bg-[#EAF4F7] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-5 shadow-sm">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[#FF8066]/15 text-[#FF8066] flex items-center justify-center">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h1 className="font-display text-2xl font-bold text-[#0B2545]">
            تم تعليق هذا الحساب
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            تم تعليق صلاحياتك الإدارية مؤقتاً من قبل المدير الرئيسي. يرجى مراجعة إدارة المنصة.
          </p>
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
    );
  }

  // Unassigned specialization or cross-specialization direct URL guard
  if (!assignedSpecializationId || isOutOfScopeUrl) {
    return (
      <div className="min-h-screen bg-[#EAF4F7] flex items-center justify-center p-4 sm:p-6">
        <div className="max-w-lg w-full bg-white rounded-3xl border border-[#FF8066]/40 p-6 sm:p-8 text-center space-y-5 shadow-sm">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[#FF8066]/15 text-[#FF8066] flex items-center justify-center">
            <Lock className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h1 className="font-display text-xl sm:text-2xl font-bold text-[#0B2545]">
              وصول مقيد بالتخصص المسند
            </h1>
            <p className="text-sm text-slate-700 leading-relaxed font-semibold">
              {assignedSpecializationId
                ? SCOPED_ADMIN_ACCESS_DENIED_AR
                : 'لم يتم إسناد تخصص جامعي لحسابك بعد. تواصل مع المدير الرئيسي لتعيين تخصصك.'}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-1">
            {assignedSpecializationId && (
              <button
                type="button"
                onClick={() => {
                  try {
                    window.history.pushState(
                      {},
                      '',
                      `/admin/specializations/${assignedSpecializationId}`
                    );
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  } catch {
                    // ignore
                  }
                }}
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
              >
                <ShieldCheck className="w-4 h-4" />
                الانتقال إلى تخصصي المسند
              </button>
            )}
            <button
              type="button"
              onClick={onExitAdmin}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#0B2545] hover:bg-[#133866] text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
            >
              <ArrowRight className="w-4 h-4" />
              العودة لبوابة الطلاب
            </button>
          </div>
        </div>
      </div>
    );
  }

  const sidebarItems: Array<{
    id: ScopedTab;
    label: string;
    icon: React.ReactNode;
    visible: boolean;
  }> = [
    {
      id: 'overview',
      label: 'ملخص التخصص',
      icon: <Home className="w-4 h-4" />,
      visible: hasPerm('spec.dashboard.view'),
    },
    {
      id: 'structure',
      label: 'السنوات والفصول الدراسية',
      icon: <Layers className="w-4 h-4" />,
      visible:
        hasPerm('spec.structure.view') ||
        hasPerm('academic_years.manage') ||
        hasPerm('semesters.manage'),
    },
    {
      id: 'subjects',
      label: 'مقررات التخصص',
      icon: <BookOpen className="w-4 h-4" />,
      visible:
        hasPerm('spec.structure.view') ||
        hasPerm('subjects.create') ||
        hasPerm('subjects.edit'),
    },
    {
      id: 'lectures',
      label: 'المحاضرات (للقراءة فقط)',
      icon: <FileText className="w-4 h-4" />,
      visible: hasPerm('spec.lectures.metadata.view'),
    },
    {
      id: 'shared_courses',
      label: 'المواد المشتركة',
      icon: <Link2 className="w-4 h-4" />,
      visible: hasPerm('spec.shared_courses.view'),
    },
    {
      id: 'spec_info',
      label: 'معلومات التخصص',
      icon: <GraduationCap className="w-4 h-4" />,
      visible: hasPerm('spec.info.manage'),
    },
    {
      id: 'announcements',
      label: 'إعلانات التخصص',
      icon: <Megaphone className="w-4 h-4" />,
      visible: hasPerm('announcements.manage'),
    },
    {
      id: 'audit',
      label: 'سجل نشاط التخصص',
      icon: <ClipboardList className="w-4 h-4" />,
      visible: hasPerm('spec.audit.view'),
    },
  ];

  const visibleTabs = sidebarItems.filter((item) => item.visible);
  const currentTab: ScopedTab = visibleTabs.some((t) => t.id === activeTab)
    ? activeTab
    : visibleTabs[0]?.id || 'overview';

  const actorForScopeCheck = {
    role,
    status: accountStatus,
    permissions,
    assignedSpecializationId,
  };

  // --- Handlers strictly scoped to assignedSpecializationId ---
  const handleCreateYear = async (e: React.FormEvent) => {
    e.preventDefault();
    if (yearName.trim().length < 2) return;
    setSubmitting(true);
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/admin/scoped/years', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          specializationId: assignedSpecializationId,
          name: yearName.trim(),
          status: yearStatus,
          sortOrder: (specYears.length || 0) + 1,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body.error || 'تعذر إضافة السنة الدراسية.');
        return;
      }
      setYearName('');
      await Promise.all([refreshAdminCatalog(), refreshAuditLogs()]);
      showToast('تمت إضافة السنة الدراسية داخل التخصص بنجاح.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateSemester = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveSemYearId || semName.trim().length < 2) return;
    setSubmitting(true);
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/admin/scoped/semesters', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          specializationId: assignedSpecializationId,
          academicYearId: effectiveSemYearId,
          name: semName.trim(),
          status: semStatus,
          sortOrder: (summary?.semesters.length || 0) + 1,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body.error || 'تعذر إضافة الفصل الدراسي.');
        return;
      }
      setSemName('');
      await Promise.all([refreshAdminCatalog(), refreshAuditLogs()]);
      showToast('تمت إضافة الفصل الدراسي داخل التخصص بنجاح.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateOrUpdateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (subName.trim().length < 2) return;
    setSubmitting(true);
    try {
      const token = await getIdToken();
      if (!token) return;

      if (editingSubjectId) {
        const res = await fetch(
          `/api/admin/scoped/subjects/${encodeURIComponent(editingSubjectId)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              name: subName.trim(),
              code: subCode.trim(),
              description: subDesc.trim(),
            }),
          }
        );
        const body = await res.json();
        if (!res.ok) {
          showToast(body.error || 'تعذر تحديث بيانات المادة.');
          return;
        }
        setEditingSubjectId(null);
        setSubName('');
        setSubCode('');
        setSubDesc('');
        await Promise.all([refreshAdminCatalog(), refreshAuditLogs()]);
        showToast('تم تحديث بيانات المادة الدراسية.');
      } else {
        if (!effectiveSubYearId || !effectiveSubSemId) {
          showToast('يرجى اختيار السنة والفصل الدراسي أولاً.');
          return;
        }
        const res = await fetch('/api/admin/scoped/subjects', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            specializationId: assignedSpecializationId,
            academicYearId: effectiveSubYearId,
            semesterId: effectiveSubSemId,
            name: subName.trim(),
            code: subCode.trim(),
            description: subDesc.trim(),
            status: subStatus,
            sortOrder: (summary?.subjects.length || 0) + 1,
          }),
        });
        const body = await res.json();
        if (!res.ok) {
          showToast(body.error || 'تعذر إضافة المادة الدراسية.');
          return;
        }
        setSubName('');
        setSubCode('');
        setSubDesc('');
        await Promise.all([refreshAdminCatalog(), refreshAuditLogs()]);
        showToast('تمت إضافة المادة الدراسية داخل التخصص.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveSpecInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (infoName.trim().length < 2) return;
    setSubmitting(true);
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/admin/scoped/specialization', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          specializationId: assignedSpecializationId,
          name: infoName.trim(),
          description: infoDesc.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body.error || 'تعذر تحديث معلومات التخصص.');
        return;
      }
      await Promise.all([refreshAdminCatalog(), refreshAuditLogs()]);
      showToast('تم تحديث معلومات التخصص المسند بنجاح.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (annTitle.trim().length < 2 || annBody.trim().length < 2) return;
    setSubmitting(true);
    try {
      const id = editingAnn ? editingAnn.id : generateSafeId('ann');
      if (editingAnn) {
        await updateDoc(doc(db, 'announcements', id), {
          title: annTitle.trim(),
          body: annBody.trim(),
          category: annCategory,
          priority: annPriority,
          specializationId: assignedSpecializationId,
          status: annStatus,
          updatedAt: serverTimestamp(),
        });
        showToast('تم تحديث إعلان التخصص.');
      } else {
        await setDoc(doc(db, 'announcements', id), {
          id,
          title: annTitle.trim(),
          body: annBody.trim(),
          category: annCategory,
          priority: annPriority,
          specializationId: assignedSpecializationId,
          status: annStatus,
          createdBy: firebaseUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        showToast('تم نشر إعلان التخصص بنجاح.');
      }
      const token = await getIdToken();
      if (token) {
        void fetch('/api/admin/audit-logs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: editingAnn ? 'تحديث إعلان التخصص' : 'نشر إعلان خاص بالتخصص',
            entityType: 'announcement',
            entityId: id,
            entityName: annTitle.trim(),
            specializationId: assignedSpecializationId,
            result: 'success',
          }),
        });
      }
      setEditingAnn(null);
      setAnnTitle('');
      setAnnBody('');
      await Promise.all([refreshAdminCatalog(), refreshAuditLogs()]);
    } catch {
      showToast('تعذر حفظ الإعلان. تحقق من صلاحيات الإعلانات.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteScopedAnnouncement = async (ann: Announcement) => {
    try {
      await deleteDoc(doc(db, 'announcements', ann.id));
      await Promise.all([refreshAdminCatalog(), refreshAuditLogs()]);
      showToast('تم حذف الإعلان.');
    } catch {
      showToast('تعذر حذف الإعلان.');
    }
  };

  const filteredLectures = (summary?.lectureMetadata || []).filter((f) => {
    const q = lectureFilter.trim().toLowerCase();
    if (!q) return true;
    return (
      f.title.toLowerCase().includes(q) ||
      f.originalName.toLowerCase().includes(q)
    );
  });

  const displayedStudentCount =
    aggregateStudentCountOverride !== null
      ? aggregateStudentCountOverride
      : summary?.aggregateStudentCount ?? null;

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

      {/* Scoped Admin Sidebar (RTL Drawer on mobile, sticky on desktop) */}
      <aside
        aria-label="قائمة إدارة التخصص"
        aria-hidden={!sidebarOpen ? undefined : false}
        className={`fixed lg:sticky top-0 bottom-0 right-0 z-50 h-screen w-72 max-w-[85vw] lg:w-68 bg-[#0B2545] text-white flex flex-col justify-between transition-transform duration-200 shrink-0 ${
          sidebarOpen
            ? 'translate-x-0 visible pointer-events-auto shadow-2xl'
            : 'translate-x-full invisible pointer-events-none lg:translate-x-0 lg:visible lg:pointer-events-auto lg:shadow-none'
        }`}
      >
        <div className="p-5 space-y-5 overflow-y-auto">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <p className="font-display text-base font-bold text-white flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#00A6A6] shrink-0" />
                <span className="truncate">لوحة مشرف التخصص</span>
              </p>
              <span className="inline-block px-2.5 py-0.5 rounded-lg bg-[#00A6A6]/20 text-[#00A6A6] text-[11px] font-bold">
                Specialization Admin — {assignedSpec?.name || assignedSpecializationId}
              </span>
              <p className="text-xs text-[#EAF4F7]/70 truncate">
                {profile?.displayName || firebaseUser.displayName} · {firebaseUser.email}
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
            {visibleTabs.map((item) => {
              const active = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
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

          <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-[11px] text-white/75 space-y-1">
            <p className="font-bold text-[#FF8066] flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              نطاق الصلاحيات المقيد
            </p>
            <p className="leading-relaxed">
              تقتصر إدارتك على هذا التخصص فقط، كما أن رفع أو حذف ملفات المحاضرات حصري للـ Super Admin.
            </p>
          </div>
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

      {/* Main Content */}
      <div className="flex-1 min-w-0 w-full flex flex-col">
        <header className="bg-white border-b border-slate-200 px-3 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-2.5 sticky top-0 z-30">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen((prev) => !prev)}
              aria-label="فتح قائمة التخصص"
              aria-expanded={sidebarOpen}
              className="lg:hidden min-h-[42px] min-w-[42px] rounded-xl bg-[#EAF4F7] hover:bg-[#d8ecf2] text-[#0B2545] flex items-center justify-center shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="font-display text-base sm:text-lg font-bold text-[#0B2545] truncate">
                {visibleTabs.find((i) => i.id === currentTab)?.label || 'إدارة التخصص'}
              </h1>
              <p className="text-[11px] font-semibold text-[#00A6A6] truncate">
                Specialization Admin — {assignedSpec?.name || assignedSpecializationId}
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold shrink-0">
            <Lock className="w-3.5 h-3.5 text-[#FF8066]" />
            رفع المحاضرات حصري للـ Super Admin
          </span>
        </header>

        <main className="flex-1 p-3 sm:p-6 max-w-6xl w-full min-w-0 mx-auto space-y-6">
          {toastMsg && (
            <div
              role="status"
              className="rounded-xl bg-[#0B2545] text-white px-4 py-3 text-sm font-medium shadow-md"
            >
              {toastMsg}
            </div>
          )}

          {/* TAB 1: OVERVIEW */}
          {currentTab === 'overview' && summary && (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-[#EAF4F7] text-[#0B2545] text-xs font-bold">
                    Specialization Admin — {assignedSpec?.name || assignedSpecializationId}
                  </span>
                  <h2 className="font-display text-xl font-bold text-[#0B2545]">
                    {assignedSpec?.name || assignedSpecializationId}
                  </h2>
                  <p className="text-xs text-slate-600">
                    {assignedSpec?.description || 'إدارة التخصص الأكاديمي ضمن الصلاحيات المخولة.'}
                  </p>
                </div>
                <div className="text-xs text-slate-500 bg-[#EAF4F7]/60 rounded-xl px-4 py-2.5 shrink-0">
                  <p className="font-bold text-[#0B2545]">الصلاحيات النشطة: {permissions.length}</p>
                  <p>إدارة محصورة في هذا التخصص فقط</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-500">السنوات / الفصول</p>
                    <p className="font-display text-2xl font-bold text-[#0B2545] tabular-nums">
                      {summary.years.length} / {summary.semesters.length}
                    </p>
                  </div>
                  <Layers className="w-6 h-6 text-[#00A6A6]" />
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-500">مقررات التخصص</p>
                    <p className="font-display text-2xl font-bold text-[#0B2545] tabular-nums">
                      {summary.subjects.length}
                    </p>
                  </div>
                  <BookOpen className="w-6 h-6 text-[#00A6A6]" />
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-500">المحاضرات المنشورة</p>
                    <p className="font-display text-2xl font-bold text-[#0B2545] tabular-nums">
                      {summary.publishedLectureCount}
                    </p>
                  </div>
                  <FileText className="w-6 h-6 text-[#00A6A6]" />
                </div>

                {hasPerm('spec.stats.view') ? (
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-slate-500">إجمالي طلاب التخصص</p>
                      <p className="font-display text-2xl font-bold text-[#0B2545] tabular-nums">
                        {displayedStudentCount ?? 0}
                      </p>
                    </div>
                    <Users className="w-6 h-6 text-[#00A6A6]" />
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-slate-500">المواد المشتركة</p>
                      <p className="font-display text-2xl font-bold text-[#0B2545] tabular-nums">
                        {summary.sharedSubjects.length}
                      </p>
                    </div>
                    <Link2 className="w-6 h-6 text-[#00A6A6]" />
                  </div>
                )}
              </div>

              <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
                <Lock className="w-5 h-5 text-[#FF8066] shrink-0 mt-0.5" />
                <div className="text-xs text-amber-900 space-y-1">
                  <p className="font-bold">{SUPER_ADMIN_UPLOAD_ONLY_AR}</p>
                  <p>
                    يمكنك استعراض بيانات المحاضرات وإدارة المهام المصرح بها ضمن تخصصك. لرفع محاضرة جديدة أو حذف ملف، يرجى التواصل مع المدير الرئيسي للمنصة.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: STRUCTURE (YEARS & SEMESTERS) */}
          {currentTab === 'structure' && summary && (
            <div className="space-y-6">
              {hasPerm('academic_years.manage') && (
                <form
                  onSubmit={handleCreateYear}
                  className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3"
                >
                  <h2 className="font-display text-base font-bold text-[#0B2545]">
                    إضافة سنة دراسية داخل ({assignedSpec?.name})
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                    <div>
                      <label htmlFor="scoped-year-name" className="block text-xs font-semibold text-[#0B2545] mb-1">
                        اسم السنة الدراسية *
                      </label>
                      <input
                        id="scoped-year-name"
                        type="text"
                        required
                        value={yearName}
                        onChange={(e) => setYearName(e.target.value)}
                        placeholder="مثال: السنة الأولى"
                        className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor="scoped-year-status" className="block text-xs font-semibold text-[#0B2545] mb-1">
                        الحالة
                      </label>
                      <select
                        id="scoped-year-status"
                        value={yearStatus}
                        onChange={(e) => setYearStatus(e.target.value as PublishStatus)}
                        className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                      >
                        <option value="published">منشورة</option>
                        <option value="draft">مخفية</option>
                      </select>
                    </div>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="min-h-[42px] px-5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <Plus className="w-4 h-4" />
                      إضافة سنة
                    </button>
                  </div>
                </form>
              )}

              {hasPerm('semesters.manage') && (
                <form
                  onSubmit={handleCreateSemester}
                  className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3"
                >
                  <h2 className="font-display text-base font-bold text-[#0B2545]">
                    إضافة فصل دراسي داخل ({assignedSpec?.name})
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                    <div>
                      <label htmlFor="scoped-sem-year" className="block text-xs font-semibold text-[#0B2545] mb-1">
                        السنة الدراسية *
                      </label>
                      <select
                        id="scoped-sem-year"
                        value={effectiveSemYearId}
                        onChange={(e) => setSemYearId(e.target.value)}
                        className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                      >
                        {specYears.map((y) => (
                          <option key={y.id} value={y.id}>
                            {y.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="scoped-sem-name" className="block text-xs font-semibold text-[#0B2545] mb-1">
                        اسم الفصل *
                      </label>
                      <input
                        id="scoped-sem-name"
                        type="text"
                        required
                        value={semName}
                        onChange={(e) => setSemName(e.target.value)}
                        placeholder="مثال: الفصل الأول"
                        className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor="scoped-sem-status" className="block text-xs font-semibold text-[#0B2545] mb-1">
                        الحالة
                      </label>
                      <select
                        id="scoped-sem-status"
                        value={semStatus}
                        onChange={(e) => setSemStatus(e.target.value as PublishStatus)}
                        className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                      >
                        <option value="published">منشور</option>
                        <option value="draft">مخفي</option>
                      </select>
                    </div>
                    <button
                      type="submit"
                      disabled={submitting || !effectiveSemYearId}
                      className="min-h-[42px] px-5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <Plus className="w-4 h-4" />
                      إضافة فصل
                    </button>
                  </div>
                </form>
              )}

              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                <h3 className="font-display text-sm font-bold text-[#0B2545]">
                  الهيكل الأكاديمي للتخصص ({specYears.length} سنوات)
                </h3>
                {specYears.length === 0 ? (
                  <p className="text-sm text-slate-500">لا توجد سنوات دراسية مضافة لهذا التخصص.</p>
                ) : (
                  <div className="space-y-3">
                    {specYears.map((y) => {
                      const ySems = sortByOrder(
                        summary.semesters.filter((sm) => sm.academicYearId === y.id)
                      );
                      return (
                        <div key={y.id} className="rounded-xl border border-slate-200 p-4 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-sm text-[#0B2545]">{y.name}</span>
                            <span className="text-xs text-slate-500">{ySems.length} فصول</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {ySems.map((sm) => (
                              <span
                                key={sm.id}
                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#EAF4F7] text-[#0B2545] text-xs font-medium"
                              >
                                <Calendar className="w-3.5 h-3.5 text-[#00A6A6]" />
                                {sm.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: SUBJECTS INSIDE ASSIGNED SPECIALIZATION */}
          {currentTab === 'subjects' && summary && (
            <div className="space-y-6">
              {(hasPerm('subjects.create') || (editingSubjectId && hasPerm('subjects.edit'))) && (
                <form
                  onSubmit={handleCreateOrUpdateSubject}
                  className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4"
                >
                  <h2 className="font-display text-base font-bold text-[#0B2545]">
                    {editingSubjectId
                      ? 'تعديل بيانات مقرر داخل التخصص'
                      : `إضافة مادة دراسية جديدة في (${assignedSpec?.name})`}
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {!editingSubjectId && (
                      <>
                        <div>
                          <label htmlFor="scoped-sub-year" className="block text-xs font-semibold text-[#0B2545] mb-1">
                            السنة الدراسية *
                          </label>
                          <select
                            id="scoped-sub-year"
                            value={effectiveSubYearId}
                            onChange={(e) => {
                              setSubYearId(e.target.value);
                              setSubSemId('');
                            }}
                            className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                          >
                            {specYears.map((y) => (
                              <option key={y.id} value={y.id}>
                                {y.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label htmlFor="scoped-sub-sem" className="block text-xs font-semibold text-[#0B2545] mb-1">
                            الفصل الدراسي *
                          </label>
                          <select
                            id="scoped-sub-sem"
                            value={effectiveSubSemId}
                            onChange={(e) => setSubSemId(e.target.value)}
                            className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                          >
                            {semestersForSubYear.map((sm) => (
                              <option key={sm.id} value={sm.id}>
                                {sm.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}
                    <div>
                      <label htmlFor="scoped-sub-name" className="block text-xs font-semibold text-[#0B2545] mb-1">
                        اسم المادة *
                      </label>
                      <input
                        id="scoped-sub-name"
                        type="text"
                        required
                        value={subName}
                        onChange={(e) => setSubName(e.target.value)}
                        placeholder="مثال: برمجة متقدمة"
                        className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor="scoped-sub-code" className="block text-xs font-semibold text-[#0B2545] mb-1">
                        رمز المقرر (اختياري)
                      </label>
                      <input
                        id="scoped-sub-code"
                        type="text"
                        value={subCode}
                        onChange={(e) => setSubCode(e.target.value)}
                        placeholder="CS204"
                        className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label htmlFor="scoped-sub-status" className="block text-xs font-semibold text-[#0B2545] mb-1">
                        الحالة
                      </label>
                      <select
                        id="scoped-sub-status"
                        value={subStatus}
                        onChange={(e) => setSubStatus(e.target.value as PublishStatus)}
                        className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                      >
                        <option value="published">منشورة</option>
                        <option value="draft">مخفية</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label htmlFor="scoped-sub-desc" className="block text-xs font-semibold text-[#0B2545] mb-1">
                        وصف المقرر
                      </label>
                      <input
                        id="scoped-sub-desc"
                        type="text"
                        value={subDesc}
                        onChange={(e) => setSubDesc(e.target.value)}
                        placeholder="وصف موجز لمحتوى المادة..."
                        className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="min-h-[42px] px-5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-sm font-semibold disabled:opacity-50"
                    >
                      {editingSubjectId ? 'حفظ التعديل' : 'إضافة المادة'}
                    </button>
                    {editingSubjectId && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSubjectId(null);
                          setSubName('');
                          setSubCode('');
                          setSubDesc('');
                        }}
                        className="min-h-[42px] px-4 rounded-xl border border-slate-200 text-sm text-slate-600"
                      >
                        إلغاء
                      </button>
                    )}
                  </div>
                </form>
              )}

              <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                {summary.subjects.length === 0 ? (
                  <p className="p-6 text-sm text-slate-500 text-center">
                    لا توجد مقررات مسجلة في هذا التخصص.
                  </p>
                ) : (
                  summary.subjects.map((sub) => {
                    const editCheck = canScopedAdminPerformAction({
                      actor: actorForScopeCheck,
                      action: 'subjects.edit',
                      targetSpecializationId: sub.specializationId,
                      subject: sub,
                      programCourses,
                      subjectId: sub.id,
                    });
                    const isShared = summary.sharedSubjects.some(
                      (item) => item.subject.id === sub.id
                    );
                    return (
                      <div
                        key={sub.id}
                        className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
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
                              {isShared && (
                                <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-bold">
                                  مادة مشتركة — التعديل المشترك حصري للـ Super Admin
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 truncate">
                              {sub.description || 'مقرر دراسي'}
                            </p>
                          </div>
                        </div>
                        {hasPerm('subjects.edit') && (
                          <button
                            type="button"
                            disabled={!editCheck.allowed}
                            onClick={() => {
                              setEditingSubjectId(sub.id);
                              setSubName(sub.name);
                              setSubCode(sub.code || '');
                              setSubDesc(sub.description || '');
                            }}
                            className="min-h-[36px] px-3 rounded-xl border border-slate-200 text-xs font-semibold text-[#0B2545] inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed self-start sm:self-auto"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            {editCheck.allowed ? 'تعديل' : 'محمية (مشتركة)'}
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 4: READ-ONLY LECTURE METADATA */}
          {currentTab === 'lectures' && summary && (
            <div className="space-y-4">
              <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
                <Lock className="w-5 h-5 text-[#FF8066] shrink-0 mt-0.5" />
                <div className="text-xs text-amber-900 space-y-1">
                  <p className="font-bold">{SUPER_ADMIN_UPLOAD_ONLY_AR}</p>
                  <p>
                    هذه القائمة للعرض والمراجعة فقط. لا تتوفر أزرار رفع أو استبدال أو حذف ملفات المحاضرات لمشرفي التخصصات.
                  </p>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <input
                  type="search"
                  value={lectureFilter}
                  onChange={(e) => setLectureFilter(e.target.value)}
                  placeholder="بحث في محاضرات التخصص بالعنوان أو اسم الملف..."
                  className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm"
                />
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="bg-[#EAF4F7]/70 text-xs font-semibold text-[#0B2545]">
                    <tr>
                      <th className="p-3.5">المحاضرة / الملف</th>
                      <th className="p-3.5">المادة</th>
                      <th className="p-3.5">التصنيف والحجم</th>
                      <th className="p-3.5">الحالة</th>
                      <th className="p-3.5">معاينة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredLectures.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-sm text-slate-500">
                          لا توجد محاضرات مسجلة لهذا التخصص حتى الآن.
                        </td>
                      </tr>
                    ) : (
                      filteredLectures.map((file) => {
                        const sub = subjects.find((s) => s.id === file.subjectId);
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
                              </div>
                              <p className="text-xs text-slate-500 font-mono">
                                {isGoogleDriveFile(file) && file.externalUrl
                                  ? file.externalUrl
                                  : file.originalName}
                              </p>
                            </td>
                            <td className="p-3.5 text-xs text-slate-600">{sub?.name || 'مقرر'}</td>
                            <td className="p-3.5 text-xs text-slate-600">
                              <p>{getCategoryLabel(file.category)}</p>
                              <p className="tabular-nums text-slate-400">
                                {isGoogleDriveFile(file) && (!file.fileSize || file.fileSize <= 0)
                                  ? 'رابط سحابي'
                                  : formatFileSizeArabic(file.fileSize)}
                              </p>
                            </td>
                            <td className="p-3.5 text-xs font-semibold">
                              <span
                                className={
                                  file.status === 'published' ? 'text-[#00A6A6]' : 'text-slate-500'
                                }
                              >
                                {file.status === 'published' ? 'منشور' : 'مسودة'}
                              </span>
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
                                    aria-label={`فتح ${file.title}`}
                                    className="min-h-[34px] min-w-[34px] rounded-lg border border-slate-200 flex items-center justify-center text-[#00A6A6]"
                                  >
                                    <ExternalLink className="w-4 h-4" />
                                  </a>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: SHARED COURSES VIEW (READ-ONLY) */}
          {currentTab === 'shared_courses' && summary && (
            <div className="space-y-4">
              <div className="rounded-2xl bg-[#EAF4F7] border border-[#00A6A6]/30 p-4 text-xs text-[#0B2545]">
                تظهر هنا المقررات المشتركة بين تخصصك وتخصصات أخرى. فك الربط أو تعديل التوزيع بين التخصصات حصري للـ Super Admin فقط لحماية بقية الكليات.
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                {summary.sharedSubjects.length === 0 ? (
                  <p className="p-6 text-sm text-slate-500 text-center">
                    لا توجد مقررات مشتركة مرتبطة بهذا التخصص حالياً.
                  </p>
                ) : (
                  summary.sharedSubjects.map(({ subject, linkedSpecIds }) => (
                    <div key={subject.id} className="p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <h3 className="font-display text-sm font-bold text-[#0B2545]">
                          {subject.name} {subject.code ? `(${subject.code})` : ''}
                        </h3>
                        <span className="px-2.5 py-0.5 rounded-lg bg-[#00A6A6]/15 text-[#00A6A6] text-xs font-bold">
                          مشترك مع {linkedSpecIds.length + 1} تخصصات
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {linkedSpecIds.map((sid) => {
                          const sName = specializations.find((s) => s.id === sid)?.name || sid;
                          return (
                            <span
                              key={sid}
                              className="px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-[11px]"
                            >
                              {sName}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 6: SPECIALIZATION INFO */}
          {currentTab === 'spec_info' && (
            <form
              onSubmit={handleSaveSpecInfo}
              className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4 max-w-xl"
            >
              <h2 className="font-display text-base font-bold text-[#0B2545]">
                تحديث معلومات التخصص المسند
              </h2>
              <div>
                <label htmlFor="scoped-spec-name" className="block text-xs font-semibold text-[#0B2545] mb-1">
                  اسم التخصص *
                </label>
                <input
                  id="scoped-spec-name"
                  type="text"
                  required
                  value={infoName}
                  onChange={(e) => setInfoName(e.target.value)}
                  className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm"
                />
              </div>
              <div>
                <label htmlFor="scoped-spec-desc" className="block text-xs font-semibold text-[#0B2545] mb-1">
                  وصف التخصص
                </label>
                <textarea
                  id="scoped-spec-desc"
                  rows={3}
                  value={infoDesc}
                  onChange={(e) => setInfoDesc(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="min-h-[42px] px-5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-sm font-semibold disabled:opacity-50"
              >
                حفظ معلومات التخصص
              </button>
            </form>
          )}

          {/* TAB 7: SCOPED ANNOUNCEMENTS */}
          {currentTab === 'announcements' && summary && (
            <div className="space-y-6">
              <form
                onSubmit={handleSaveAnnouncement}
                className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4"
              >
                <h2 className="font-display text-base font-bold text-[#0B2545]">
                  {editingAnn
                    ? 'تعديل إعلان التخصص'
                    : `نشر إعلان خاص بـ (${assignedSpec?.name})`}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label htmlFor="scoped-ann-title" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      عنوان الإعلان *
                    </label>
                    <input
                      id="scoped-ann-title"
                      type="text"
                      required
                      value={annTitle}
                      onChange={(e) => setAnnTitle(e.target.value)}
                      className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="scoped-ann-cat" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      الفئة
                    </label>
                    <select
                      id="scoped-ann-cat"
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
                    <label htmlFor="scoped-ann-body" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      نص الإعلان *
                    </label>
                    <textarea
                      id="scoped-ann-body"
                      rows={3}
                      required
                      value={annBody}
                      onChange={(e) => setAnnBody(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="scoped-ann-prio" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      الأهمية
                    </label>
                    <select
                      id="scoped-ann-prio"
                      value={annPriority}
                      onChange={(e) => setAnnPriority(e.target.value as AnnouncementPriority)}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                    >
                      <option value="normal">عادي</option>
                      <option value="important">مهم / عاجل</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="scoped-ann-status" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      الحالة
                    </label>
                    <select
                      id="scoped-ann-status"
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
                  disabled={submitting}
                  className="min-h-[42px] px-5 rounded-xl bg-[#00A6A6] text-white text-sm font-semibold disabled:opacity-50"
                >
                  {editingAnn ? 'تحديث الإعلان' : 'نشر الإعلان'}
                </button>
              </form>

              <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                {summary.announcements.length === 0 ? (
                  <p className="p-6 text-sm text-slate-500 text-center">
                    لا توجد إعلانات خاصة بهذا التخصص بعد.
                  </p>
                ) : (
                  summary.announcements.map((ann) => (
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
                          className="min-h-[34px] px-3 rounded-lg border border-slate-200 text-xs font-semibold"
                        >
                          تعديل
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteScopedAnnouncement(ann)}
                          className="min-h-[34px] px-3 rounded-lg border border-slate-200 text-xs font-semibold text-[#FF8066]"
                        >
                          حذف
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 8: SCOPED AUDIT LOGS */}
          {currentTab === 'audit' && <AuditLogsPanel />}
        </main>
      </div>
    </div>
  );
}
