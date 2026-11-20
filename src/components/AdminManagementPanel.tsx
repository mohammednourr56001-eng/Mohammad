import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Crown,
  Eye,
  GraduationCap,
  Lock,
  MailPlus,
  Search,
  Shield,
  ShieldCheck,
  Sliders,
  Trash2,
  UserCheck,
  UserCog,
  UserMinus,
  UserPlus,
  UserX,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import {
  AdminAssignment,
  ALLOWED_SCOPED_ADMIN_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  PermissionKey,
  ROLE_LABELS_AR,
  SUPER_ADMIN_ONLY_PERMISSIONS,
  UserProfile,
  UserRole,
} from '../types/academic.ts';
import { sortByOrder } from '../utils/academicLogic.ts';
import {
  getSafeDefaultScopedPermissions,
  isSuperAdminOnlyPermission,
  sanitizeScopedAdminPermissions,
  SUPER_ADMIN_UPLOAD_ONLY_AR,
} from '../utils/scopedAdminLogic.ts';

function formatIsoAr(raw?: string): string {
  if (!raw) return '—';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString('ar-EG', { dateStyle: 'medium' });
}

export function AdminManagementPanel({ onToast }: { onToast: (msg: string) => void }) {
  const { firebaseUser, isSuperAdmin, hasPerm, getIdToken } = useAuth();
  const {
    users,
    admins,
    adminAssignments,
    adminInvitations,
    specializations,
    refreshDirectory,
    refreshAdminAssignments,
    refreshAuditLogs,
  } = usePlatformData();

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [submitting, setSubmitting] = useState(false);

  // --- 7-Step Add Specialization Admin Wizard State ---
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7>(1);
  const [wizardUserQuery, setWizardUserQuery] = useState('');
  const [wizardSelectedUid, setWizardSelectedUid] = useState('');
  const [wizardSpecId, setWizardSpecId] = useState('');
  const [wizardPermissions, setWizardPermissions] = useState<PermissionKey[]>(
    getSafeDefaultScopedPermissions()
  );
  const [wizardNotes, setWizardNotes] = useState('');

  // --- Assignment Row Action Modals ---
  const [viewingAssignment, setViewingAssignment] = useState<AdminAssignment | null>(null);
  const [editingAssignmentPerms, setEditingAssignmentPerms] = useState<AdminAssignment | null>(null);
  const [editPermsDraft, setEditPermsDraft] = useState<PermissionKey[]>([]);
  const [transferringAssignment, setTransferringAssignment] = useState<AdminAssignment | null>(null);
  const [transferTargetSpecId, setTransferTargetSpecId] = useState('');

  // --- Sensitive Action Extra Confirmation ---
  const [confirmSensitive, setConfirmSensitive] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  const canManageUsers = isSuperAdmin || hasPerm('users.manage');

  const sortedSpecs = useMemo(() => sortByOrder(specializations), [specializations]);

  const activeAssignedUids = useMemo(
    () => new Set(adminAssignments.map((a) => a.uid)),
    [adminAssignments]
  );

  // Eligible registered users for Wizard Steps 1 & 2
  const registeredCandidateUsers = useMemo(() => {
    const q = wizardUserQuery.trim().toLowerCase();
    return users
      .filter((u) => u.role !== 'super_admin' && u.uid !== firebaseUser?.uid)
      .filter((u) => {
        if (!q) return true;
        return (
          u.displayName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
        );
      });
  }, [users, firebaseUser?.uid, wizardUserQuery]);

  const wizardSelectedUser = useMemo(
    () => users.find((u) => u.uid === wizardSelectedUid) || null,
    [users, wizardSelectedUid]
  );

  const wizardSelectedSpec = useMemo(
    () => sortedSpecs.find((s) => s.id === wizardSpecId) || null,
    [sortedSpecs, wizardSpecId]
  );

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (!q) return true;
      return (
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      );
    });
  }, [users, searchQuery, roleFilter]);

  const pendingInvitations = useMemo(
    () => adminInvitations.filter((inv) => inv.status === 'pending'),
    [adminInvitations]
  );

  const openWizard = () => {
    setWizardStep(1);
    setWizardUserQuery('');
    const firstEligible = users.find(
      (u) =>
        u.role !== 'super_admin' &&
        u.uid !== firebaseUser?.uid &&
        u.status !== 'suspended' &&
        !activeAssignedUids.has(u.uid)
    );
    setWizardSelectedUid(firstEligible?.uid || '');
    setWizardSpecId(sortedSpecs[0]?.id || '');
    setWizardPermissions(getSafeDefaultScopedPermissions());
    setWizardNotes('');
    setWizardOpen(true);
  };

  const toggleWizardPerm = (perm: PermissionKey) => {
    if (isSuperAdminOnlyPermission(perm)) return;
    setWizardPermissions((prev) =>
      sanitizeScopedAdminPermissions(
        prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
      )
    );
  };

  const toggleEditDraftPerm = (perm: PermissionKey) => {
    if (isSuperAdminOnlyPermission(perm)) return;
    setEditPermsDraft((prev) =>
      sanitizeScopedAdminPermissions(
        prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
      )
    );
  };

  const handleSubmitWizard = async () => {
    if (!isSuperAdmin || !wizardSelectedUser || !wizardSelectedSpec) return;
    setSubmitting(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('يرجى إعادة تسجيل الدخول.');
      const res = await fetch('/api/admin/assignments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          uid: wizardSelectedUser.uid,
          specializationId: wizardSelectedSpec.id,
          permissions: sanitizeScopedAdminPermissions(wizardPermissions),
          notes: wizardNotes.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'تعذر تعيين مشرف التخصص.');
      setWizardOpen(false);
      await Promise.all([refreshAdminAssignments(), refreshDirectory(), refreshAuditLogs()]);
      onToast(
        `تم تعيين "${wizardSelectedUser.displayName}" مشرفاً على تخصص "${wizardSelectedSpec.name}" بنجاح.`
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'فشل تعيين مشرف التخصص.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEditedAssignmentPerms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAssignmentPerms) return;
    setSubmitting(true);
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch(
        `/api/admin/assignments/${encodeURIComponent(editingAssignmentPerms.id)}/permissions`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            permissions: sanitizeScopedAdminPermissions(editPermsDraft),
          }),
        }
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'تعذر تحديث الصلاحيات.');
      setEditingAssignmentPerms(null);
      await Promise.all([refreshAdminAssignments(), refreshDirectory(), refreshAuditLogs()]);
      onToast('تم تحديث صلاحيات مشرف التخصص وتوثيق التغيير في سجل النشاط.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تحديث الصلاحيات.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmTransferSpec = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferringAssignment || !transferTargetSpecId) return;
    const targetAsg = transferringAssignment;
    const targetSpecName =
      sortedSpecs.find((s) => s.id === transferTargetSpecId)?.name || transferTargetSpecId;

    setTransferringAssignment(null);
    setConfirmSensitive({
      title: 'تأكيد نقل مشرف التخصص',
      message: `سيتم نقل "${targetAsg.displayName}" من "${targetAsg.specializationName || targetAsg.specializationId}" إلى "${targetSpecName}" وإلغاء وصوله للتخصص السابق فوراً. هل تريد المتابعة؟`,
      confirmLabel: 'تأكيد النقل',
      onConfirm: async () => {
        const token = await getIdToken();
        if (!token) return;
        const res = await fetch(
          `/api/admin/assignments/${encodeURIComponent(targetAsg.id)}/transfer`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ specializationId: transferTargetSpecId }),
          }
        );
        const body = await res.json();
        if (!res.ok) {
          onToast(body.error || 'تعذر نقل مشرف التخصص.');
          return;
        }
        await Promise.all([refreshAdminAssignments(), refreshDirectory(), refreshAuditLogs()]);
        onToast(`تم نقل "${targetAsg.displayName}" إلى "${targetSpecName}".`);
      },
    });
  };

  const handleToggleAssignmentStatus = (asg: AdminAssignment) => {
    const isCurrentlySuspended = asg.status === 'suspended';
    const nextStatus = isCurrentlySuspended ? 'active' : 'suspended';
    setConfirmSensitive({
      title: isCurrentlySuspended ? 'إعادة تفعيل مشرف التخصص' : 'تعليق صلاحيات مشرف التخصص',
      message: isCurrentlySuspended
        ? `سيتم إعادة تفعيل صلاحيات "${asg.displayName}" على تخصص "${asg.specializationName || asg.specializationId}".`
        : `سيتم تعليق صلاحيات "${asg.displayName}" فوراً ومنعه من الدخول إلى لوحة تخصص "${asg.specializationName || asg.specializationId}".`,
      confirmLabel: isCurrentlySuspended ? 'إعادة التفعيل' : 'تعليق فوري',
      onConfirm: async () => {
        const token = await getIdToken();
        if (!token) return;
        const res = await fetch(`/api/admin/assignments/${encodeURIComponent(asg.id)}/status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: nextStatus }),
        });
        const body = await res.json();
        if (!res.ok) {
          onToast(body.error || 'تعذر تحديث حالة المشرف.');
          return;
        }
        await Promise.all([refreshAdminAssignments(), refreshDirectory(), refreshAuditLogs()]);
        onToast(isCurrentlySuspended ? 'تمت إعادة تفعيل مشرف التخصص.' : 'تم تعليق صلاحيات المشرف.');
      },
    });
  };

  const handleRemoveAssignment = (asg: AdminAssignment) => {
    setConfirmSensitive({
      title: 'إزالة تعيين مشرف التخصص',
      message: `هل تريد سحب صلاحيات الإشراف من "${asg.displayName}" وإرجاعه إلى حساب طالب عادي؟ سيتم الاحتفاظ بحسابه وسجلاته الدراسية دون حذف.`,
      confirmLabel: 'سحب الإشراف وإرجاعه لطالب',
      onConfirm: async () => {
        const token = await getIdToken();
        if (!token) return;
        const res = await fetch(`/api/admin/assignments/${encodeURIComponent(asg.id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        if (!res.ok) {
          onToast(body.error || 'تعذر إزالة التعيين الإداري.');
          return;
        }
        await Promise.all([refreshAdminAssignments(), refreshDirectory(), refreshAuditLogs()]);
        onToast(`تم إرجاع "${asg.email}" إلى دور طالب.`);
      },
    });
  };

  const handleToggleUserSuspend = (target: UserProfile) => {
    const isCurrentlySuspended = target.status === 'suspended';
    const nextStatus = isCurrentlySuspended ? 'active' : 'suspended';
    setConfirmSensitive({
      title: isCurrentlySuspended ? 'إعادة تفعيل الحساب' : 'تعليق حساب المستخدم',
      message: isCurrentlySuspended
        ? `سيتم إعادة تفعيل حساب "${target.email}" والسماح له بالوصول وفق دوره.`
        : `سيتم تعليق حساب "${target.email}" ومنعه فوراً من الوصول إلى أي صلاحيات إدارية.`,
      confirmLabel: isCurrentlySuspended ? 'إعادة التفعيل' : 'تأكيد التعليق',
      onConfirm: async () => {
        const token = await getIdToken();
        if (!token) return;
        const res = await fetch(`/api/admin/users/${encodeURIComponent(target.uid)}/status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: nextStatus }),
        });
        const body = await res.json();
        if (!res.ok) {
          onToast(body.error || 'تعذر تحديث حالة الحساب.');
          return;
        }
        await Promise.all([refreshAdminAssignments(), refreshDirectory(), refreshAuditLogs()]);
        onToast(isCurrentlySuspended ? 'تم تفعيل الحساب بنجاح.' : 'تم تعليق الحساب.');
      },
    });
  };

  const handleDeleteInvite = async (inviteId: string) => {
    const token = await getIdToken();
    if (!token) return;
    const res = await fetch(`/api/admin/invitations/${encodeURIComponent(inviteId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      await Promise.all([refreshDirectory(), refreshAuditLogs()]);
      onToast('تم إلغاء الدعوة.');
    }
  };

  const WIZARD_STEPS: Array<{ step: 1 | 2 | 3 | 4 | 5 | 6 | 7; title: string }> = [
    { step: 1, title: '1. البحث عن مستخدم' },
    { step: 2, title: '2. اختيار الحساب' },
    { step: 3, title: '3. تأكيد المنصب' },
    { step: 4, title: '4. تحديد التخصص' },
    { step: 5, title: '5. الصلاحيات' },
    { step: 6, title: '6. المراجعة' },
    { step: 7, title: '7. الاعتماد' },
  ];

  return (
    <div className="space-y-6">
      {/* Two-Tier Admin Hierarchy + Moderator Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#0B2545] text-white rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#00A6A6]">الرتبة 1 · تحكم كامل</span>
            <Crown className="w-5 h-5 text-[#FF8066]" />
          </div>
          <h3 className="font-display text-base font-bold">المدير الرئيسي (Super Admin)</h3>
          <p className="text-xs text-white/75 leading-relaxed">
            التحكم الشامل بجميع التخصصات، تعيين مشرفي التخصصات، إدارة المكتبة المركزية، وحصرية رفع وحذف المحاضرات.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#00A6A6]">الرتبة 2 · مقيد بتخصص واحد</span>
            <ShieldCheck className="w-5 h-5 text-[#00A6A6]" />
          </div>
          <h3 className="font-display text-base font-bold text-[#0B2545]">مشرف تخصص (Specialization Admin)</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            نطاق عمل مقيد تماماً بتخصص جامعي واحد فقط، بصلاحيات عرض افتراضية آمنة ودون أي صلاحية لرفع الملفات.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">سياسة الرفع الحصرية</span>
            <Lock className="w-5 h-5 text-[#FF8066]" />
          </div>
          <h3 className="font-display text-base font-bold text-[#0B2545]">حماية الملفات والمحاضرات</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            {SUPER_ADMIN_UPLOAD_ONLY_AR} يتم حجب أي محاولة رفع لغير المدير الرئيسي برمجياً وبقواعد Firestore.
          </p>
        </div>
      </div>

      {/* SECTION 1: SPECIALIZATION ADMINS MANAGEMENT */}
      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold text-[#0B2545] flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-[#00A6A6]" />
              إدارة مشرفي التخصصات ({adminAssignments.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              تعيين مشرفين مقيدين بتخصص جامعي محدد، تعديل صلاحياتهم المحدودة، نقلهم بين التخصصات، أو تعليقهم وسحب صلاحياتهم.
            </p>
          </div>

          {isSuperAdmin && (
            <button
              type="button"
              onClick={openWizard}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <UserPlus className="w-4 h-4" />
              تعيين مشرف تخصص جديد
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-[#EAF4F7]/70 text-xs font-semibold text-[#0B2545]">
              <tr>
                <th className="p-3.5">المشرف</th>
                <th className="p-3.5">التخصص المسند</th>
                <th className="p-3.5">الدور والحالة</th>
                <th className="p-3.5">تاريخ التعيين وآخر نشاط</th>
                <th className="p-3.5">الصلاحيات</th>
                <th className="p-3.5">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {adminAssignments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-sm text-slate-500">
                    لم يتم تعيين أي مشرف تخصص بعد. اضغط على «تعيين مشرف تخصص جديد» لاختيار مستخدم مسجل وإسناد تخصص له.
                  </td>
                </tr>
              ) : (
                adminAssignments.map((asg) => {
                  const specLabel =
                    asg.specializationName ||
                    specializations.find((s) => s.id === asg.specializationId)?.name ||
                    asg.specializationId;
                  const isSuspended = asg.status === 'suspended';
                  return (
                    <tr key={asg.id} className="hover:bg-slate-50/70">
                      <td className="p-3.5">
                        <div className="flex items-center gap-2.5">
                          {asg.photoURL ? (
                            <img
                              src={asg.photoURL}
                              alt={asg.displayName}
                              referrerPolicy="no-referrer"
                              className="w-9 h-9 rounded-xl object-cover border border-slate-200 shrink-0"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-xl bg-[#EAF4F7] text-[#0B2545] flex items-center justify-center font-bold text-xs shrink-0">
                              {(asg.displayName || 'م')[0]}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-bold text-[#0B2545] text-xs sm:text-sm truncate">
                              {asg.displayName}
                            </p>
                            <p className="text-[11px] text-slate-500 font-mono truncate">
                              {asg.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="p-3.5">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#EAF4F7] text-[#0B2545] text-xs font-bold">
                          <GraduationCap className="w-3.5 h-3.5 text-[#00A6A6]" />
                          {specLabel}
                        </span>
                      </td>
                      <td className="p-3.5 text-xs space-y-1">
                        <div>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[#00A6A6]/15 text-[#00A6A6] font-semibold">
                            مسؤول تخصص
                          </span>
                        </div>
                        <p className={`font-bold ${isSuspended ? 'text-[#FF8066]' : 'text-[#00A6A6]'}`}>
                          {isSuspended ? 'معلق' : 'نشط'}
                        </p>
                      </td>
                      <td className="p-3.5 text-xs text-slate-600 tabular-nums space-y-0.5">
                        <p>التعيين: {formatIsoAr(asg.assignedAt)}</p>
                        <p className="text-slate-400">
                          آخر نشاط: {formatIsoAr(asg.lastActivityAt)}
                        </p>
                      </td>
                      <td className="p-3.5 text-xs text-slate-700 tabular-nums">
                        <span className="font-bold text-[#0B2545]">
                          {asg.permissions.length}
                        </span>{' '}
                        صلاحية مقيدة
                      </td>
                      <td className="p-3.5">
                        {isSuperAdmin && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => setViewingAssignment(asg)}
                              aria-label={`عرض تفاصيل ${asg.displayName}`}
                              className="min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-semibold text-[#0B2545] hover:bg-slate-50 inline-flex items-center gap-1"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              التفاصيل
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingAssignmentPerms(asg);
                                setEditPermsDraft(sanitizeScopedAdminPermissions(asg.permissions));
                              }}
                              aria-label={`تعديل صلاحيات ${asg.displayName}`}
                              className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#EAF4F7] hover:bg-[#0B2545] text-[#0B2545] hover:text-white text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                            >
                              <Sliders className="w-3.5 h-3.5" />
                              الصلاحيات
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setTransferringAssignment(asg);
                                const nextSpec = sortedSpecs.find(
                                  (s) => s.id !== asg.specializationId
                                );
                                setTransferTargetSpecId(nextSpec?.id || '');
                              }}
                              aria-label={`نقل تخصص ${asg.displayName}`}
                              className="min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-semibold text-[#00A6A6] hover:bg-[#EAF4F7] inline-flex items-center gap-1"
                            >
                              <ArrowLeftRight className="w-3.5 h-3.5" />
                              نقل
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleAssignmentStatus(asg)}
                              className={`min-h-[34px] px-2.5 py-1 rounded-lg border text-xs font-semibold inline-flex items-center gap-1 ${
                                isSuspended
                                  ? 'border-[#00A6A6] text-[#00A6A6]'
                                  : 'border-slate-200 text-[#FF8066]'
                              }`}
                            >
                              {isSuspended ? (
                                <>
                                  <UserCheck className="w-3.5 h-3.5" />
                                  تفعيل
                                </>
                              ) : (
                                <>
                                  <UserX className="w-3.5 h-3.5" />
                                  تعليق
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveAssignment(asg)}
                              aria-label={`إزالة إشراف ${asg.displayName}`}
                              className="min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-semibold text-[#FF8066] hover:bg-[#FF8066]/10 inline-flex items-center gap-1"
                            >
                              <UserMinus className="w-3.5 h-3.5" />
                              سحب الإشراف
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pending Google Email Invitations */}
      {isSuperAdmin && pendingInvitations.length > 0 && (
        <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3.5 bg-[#EAF4F7]/70 border-b border-slate-200 flex items-center gap-2">
            <MailPlus className="w-4 h-4 text-[#00A6A6]" />
            <h3 className="font-display text-sm font-bold text-[#0B2545]">
              الدعوات الإدارية المعلقة (تُفعّل عند أول دخول بـ Google)
            </h3>
          </div>
          <div className="divide-y divide-slate-100">
            {pendingInvitations.map((inv) => (
              <div
                key={inv.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div>
                  <p className="text-sm font-bold text-[#0B2545] font-mono">{inv.email}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    الدور المعين:{' '}
                    <span className="font-semibold text-[#00A6A6]">
                      {ROLE_LABELS_AR[inv.role]}
                    </span>{' '}
                    · {inv.permissions.length} صلاحية مخصصة
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteInvite(inv.id)}
                  className="min-h-[36px] px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-[#FF8066] hover:bg-[#FF8066]/10 inline-flex items-center gap-1.5 self-start sm:self-auto"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  إلغاء الدعوة
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* SECTION 2: ALL REGISTERED USERS DIRECTORY */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-[#0B2545]">
            دليل المستخدمين المسجلين ({users.length})
          </h2>
          <p className="text-xs text-slate-500">
            الطاقم النشط: {admins.filter((a) => a.status === 'active').length} · لإسناد تخصص لمستخدم مسجل استخدم معالج التعيين أعلاه.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2.5 flex-1 sm:max-w-lg">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="البحث بالاسم أو البريد..."
              className="w-full min-h-[40px] pr-9 pl-3 rounded-xl border border-slate-200 text-sm"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
            className="min-h-[40px] px-3 rounded-xl border border-slate-200 text-sm"
          >
            <option value="all">جميع الأدوار</option>
            <option value="super_admin">المدير الرئيسي</option>
            <option value="admin">مسؤول تخصص</option>
            <option value="moderator">مشرف محتوى</option>
            <option value="student">طالب</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-right text-sm">
          <thead className="bg-[#EAF4F7]/70 text-xs font-semibold text-[#0B2545]">
            <tr>
              <th className="p-3.5">المستخدم</th>
              <th className="p-3.5">الدور والتخصص</th>
              <th className="p-3.5">الحالة</th>
              <th className="p-3.5">الصلاحيات</th>
              <th className="p-3.5">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-sm text-slate-500">
                  لا توجد حسابات مطابقة للبحث.
                </td>
              </tr>
            ) : (
              filteredUsers.map((u) => {
                const isOwner = u.role === 'super_admin';
                const isSuspended = u.status === 'suspended';
                const assignedSpecName = u.assignedSpecializationId
                  ? specializations.find((s) => s.id === u.assignedSpecializationId)?.name ||
                    u.assignedSpecializationId
                  : null;
                const matchedAssignment = adminAssignments.find((a) => a.uid === u.uid);
                return (
                  <tr key={u.uid} className="hover:bg-slate-50/70">
                    <td className="p-3.5">
                      <div className="flex items-center gap-2.5">
                        {u.photoURL ? (
                          <img
                            src={u.photoURL}
                            alt={u.displayName}
                            referrerPolicy="no-referrer"
                            className="w-9 h-9 rounded-xl object-cover border border-slate-200 shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-xl bg-[#EAF4F7] text-[#0B2545] flex items-center justify-center font-bold text-xs shrink-0">
                            {(u.displayName || 'ط')[0]}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-bold text-[#0B2545] text-xs sm:text-sm truncate">
                            {u.displayName}
                          </p>
                          <p className="text-[11px] text-slate-500 font-mono truncate">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3.5 text-xs space-y-1">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold ${
                          isOwner
                            ? 'bg-[#0B2545] text-white'
                            : u.role === 'admin'
                              ? 'bg-[#00A6A6]/15 text-[#00A6A6]'
                              : u.role === 'moderator'
                                ? 'bg-[#EAF4F7] text-[#0B2545]'
                                : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {isOwner && <Crown className="w-3 h-3 text-[#FF8066]" />}
                        {ROLE_LABELS_AR[u.role]}
                      </span>
                      {assignedSpecName && (
                        <p className="text-[11px] text-slate-600 font-semibold">
                          التخصص: {assignedSpecName}
                        </p>
                      )}
                    </td>
                    <td className="p-3.5 text-xs">
                      <span
                        className={`font-semibold ${
                          isSuspended ? 'text-[#FF8066]' : 'text-[#00A6A6]'
                        }`}
                      >
                        {isSuspended ? 'معلق' : 'نشط'}
                      </span>
                    </td>
                    <td className="p-3.5 text-xs text-slate-600 tabular-nums">
                      {isOwner
                        ? 'كامل الصلاحيات'
                        : u.role === 'student'
                          ? 'صلاحيات طالب'
                          : `${(u.permissions || []).length} صلاحية`}
                    </td>
                    <td className="p-3.5">
                      {isOwner ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400">
                          <Lock className="w-3.5 h-3.5" />
                          حساب المالك محمي
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {isSuperAdmin && u.role === 'student' && u.status !== 'suspended' && (
                            <button
                              type="button"
                              onClick={() => {
                                setWizardStep(3);
                                setWizardSelectedUid(u.uid);
                                setWizardSpecId(sortedSpecs[0]?.id || '');
                                setWizardPermissions(getSafeDefaultScopedPermissions());
                                setWizardNotes('');
                                setWizardOpen(true);
                              }}
                              className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#EAF4F7] hover:bg-[#0B2545] text-[#0B2545] hover:text-white text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                            >
                              <UserCog className="w-3.5 h-3.5" />
                              تعيين مشرف تخصص
                            </button>
                          )}
                          {isSuperAdmin && matchedAssignment && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingAssignmentPerms(matchedAssignment);
                                setEditPermsDraft(
                                  sanitizeScopedAdminPermissions(matchedAssignment.permissions)
                                );
                              }}
                              className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#EAF4F7] text-[#0B2545] text-xs font-semibold inline-flex items-center gap-1"
                            >
                              <Sliders className="w-3.5 h-3.5" />
                              الصلاحيات
                            </button>
                          )}
                          {canManageUsers && u.uid !== firebaseUser?.uid && (
                            <button
                              type="button"
                              onClick={() => handleToggleUserSuspend(u)}
                              className={`min-h-[34px] px-2.5 py-1 rounded-lg border text-xs font-semibold inline-flex items-center gap-1 ${
                                isSuspended
                                  ? 'border-[#00A6A6] text-[#00A6A6]'
                                  : 'border-slate-200 text-[#FF8066]'
                              }`}
                            >
                              {isSuspended ? (
                                <>
                                  <UserCheck className="w-3.5 h-3.5" />
                                  تفعيل
                                </>
                              ) : (
                                <>
                                  <UserX className="w-3.5 h-3.5" />
                                  تعليق
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 7-STEP ADD SPECIALIZATION ADMIN WIZARD MODAL */}
      {wizardOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-3xl border border-slate-200 max-w-3xl w-full max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="px-5 py-4 bg-[#0B2545] text-white flex items-center justify-between sticky top-0 z-10">
              <div>
                <h3 className="font-display text-base font-bold">
                  معالج تعيين مشرف تخصص جديد (7 خطوات)
                </h3>
                <p className="text-[11px] text-[#00A6A6] font-semibold">
                  يقبل المستخدمين المسجلين فعلياً فقط · بدون صلاحيات رفع ملفات
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWizardOpen(false)}
                aria-label="إغلاق المعالج"
                className="min-h-[36px] min-w-[36px] rounded-lg bg-white/10 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Stepper Progress Pills */}
            <div className="px-5 py-3 bg-[#EAF4F7]/65 border-b border-slate-200 flex items-center gap-1.5 overflow-x-auto">
              {WIZARD_STEPS.map((st) => (
                <button
                  key={st.step}
                  type="button"
                  onClick={() => {
                    if (st.step <= wizardStep) setWizardStep(st.step);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap shrink-0 transition-colors ${
                    wizardStep === st.step
                      ? 'bg-[#0B2545] text-white'
                      : wizardStep > st.step
                        ? 'bg-[#00A6A6]/15 text-[#00A6A6]'
                        : 'bg-white text-slate-400 border border-slate-200'
                  }`}
                >
                  {st.title}
                </button>
              ))}
            </div>

            <div className="p-5 sm:p-6 space-y-5">
              {/* STEP 1: Search Registered Users */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h4 className="font-display text-sm font-bold text-[#0B2545]">
                      الخطوة 1: البحث في المستخدمين المسجلين بالمنصة
                    </h4>
                    <p className="text-xs text-slate-500">
                      لا يمكن إنشاء حسابات وهمية أو تعيين بريد غير مسجل. ابحث عن المستخدم المسجل بالاسم أو البريد الإلكتروني.
                    </p>
                  </div>
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="search"
                      value={wizardUserQuery}
                      onChange={(e) => setWizardUserQuery(e.target.value)}
                      placeholder="اكتب الاسم أو البريد الإلكتروني للبحث..."
                      className="w-full min-h-[44px] pr-10 pl-3 rounded-xl border border-slate-200 text-sm"
                    />
                  </div>
                  <p className="text-xs font-semibold text-[#00A6A6]">
                    عدد الحسابات المطابقة: {registeredCandidateUsers.length} مستخدم مسجل
                  </p>
                </div>
              )}

              {/* STEP 2: Select Existing Registered User */}
              {wizardStep === 2 && (
                <div className="space-y-3">
                  <h4 className="font-display text-sm font-bold text-[#0B2545]">
                    الخطوة 2: اختيار المستخدم المسجل
                  </h4>
                  <div className="max-h-64 overflow-y-auto space-y-2 p-1">
                    {registeredCandidateUsers.length === 0 ? (
                      <p className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl">
                        لا يوجد مستخدمون مسجلون مطابقون لبحثك. يجب أن يسجل المستخدم دخوله أولاً بحساب Google.
                      </p>
                    ) : (
                      registeredCandidateUsers.map((u) => {
                        const alreadyAssigned = activeAssignedUids.has(u.uid);
                        const isSuspended = u.status === 'suspended';
                        const disabled = isSuspended;
                        const selected = wizardSelectedUid === u.uid;
                        return (
                          <button
                            key={u.uid}
                            type="button"
                            disabled={disabled}
                            onClick={() => setWizardSelectedUid(u.uid)}
                            className={`w-full text-right p-3 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
                              disabled
                                ? 'bg-slate-50 border-slate-200 opacity-50 cursor-not-allowed'
                                : selected
                                  ? 'bg-[#EAF4F7] border-[#00A6A6] ring-2 ring-[#00A6A6]/30'
                                  : 'bg-white border-slate-200 hover:border-[#00A6A6]'
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="font-bold text-xs sm:text-sm text-[#0B2545] truncate">
                                {u.displayName}
                              </p>
                              <p className="text-[11px] text-slate-500 font-mono truncate">
                                {u.email}
                              </p>
                            </div>
                            <span className="text-[11px] font-bold shrink-0 text-[#00A6A6]">
                              {isSuspended
                                ? 'حساب معلق'
                                : alreadyAssigned
                                  ? 'معين حالياً (سيُحدّث)'
                                  : selected
                                    ? 'مختار'
                                    : 'اختيار'}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* STEP 3: Confirm Role (Specialization Admin) */}
              {wizardStep === 3 && (
                <div className="space-y-4">
                  <h4 className="font-display text-sm font-bold text-[#0B2545]">
                    الخطوة 3: تأكيد الدور الوظيفي
                  </h4>
                  <div className="rounded-2xl border-2 border-[#00A6A6] bg-[#EAF4F7]/50 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-display font-bold text-sm text-[#0B2545]">
                        مسؤول تخصص (Specialization Admin)
                      </span>
                      <ShieldCheck className="w-5 h-5 text-[#00A6A6]" />
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      سيحصل الحساب ({wizardSelectedUser?.email}) على لوحة تحكم مخصصة ومحصورة في تخصص واحد فقط.
                    </p>
                  </div>
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5 text-xs text-amber-900 flex items-start gap-2.5">
                    <Lock className="w-4 h-4 text-[#FF8066] shrink-0 mt-0.5" />
                    <span>{SUPER_ADMIN_UPLOAD_ONLY_AR}</span>
                  </div>
                </div>
              )}

              {/* STEP 4: Pick Target Specialization */}
              {wizardStep === 4 && (
                <div className="space-y-3">
                  <h4 className="font-display text-sm font-bold text-[#0B2545]">
                    الخطوة 4: اختيار التخصص الجامعي المسند *
                  </h4>
                  <label htmlFor="wizard-spec-select" className="block text-xs font-semibold text-slate-600">
                    سيُقيد المشرف تماماً بهذا التخصص ولن يرى أو يعدل أي تخصص آخر:
                  </label>
                  <select
                    id="wizard-spec-select"
                    value={wizardSpecId}
                    onChange={(e) => setWizardSpecId(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm"
                  >
                    {sortedSpecs.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <div>
                    <label htmlFor="wizard-notes" className="block text-xs font-semibold text-[#0B2545] mb-1">
                      ملاحظات التعيين (اختياري)
                    </label>
                    <input
                      id="wizard-notes"
                      type="text"
                      value={wizardNotes}
                      onChange={(e) => setWizardNotes(e.target.value)}
                      placeholder="مثال: منسق قسم الهندسة للفصل الحالي"
                      className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm"
                    />
                  </div>
                </div>
              )}

              {/* STEP 5: Configure Granular Permissions */}
              {wizardStep === 5 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <h4 className="font-display text-sm font-bold text-[#0B2545]">
                        الخطوة 5: ضبط الصلاحيات التفصيلية داخل التخصص ({wizardPermissions.length})
                      </h4>
                      <p className="text-xs text-slate-500">
                        تبدأ الصلاحيات افتراضياً بالعرض الآمن فقط (4 صلاحيات). صلاحيات الرفع والإدارة العامة مقفلة للـ Super Admin فقط.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setWizardPermissions(getSafeDefaultScopedPermissions())}
                      className="text-xs font-semibold text-[#00A6A6] hover:underline"
                    >
                      استعادة الافتراضي الآمن (4 صلاحيات)
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {PERMISSION_GROUPS.map((group) => (
                      <div
                        key={group.id}
                        className="rounded-2xl border border-slate-200 bg-[#EAF4F7]/35 p-3.5 space-y-2"
                      >
                        <p className="text-xs font-bold text-[#0B2545] border-b border-slate-200/80 pb-1.5">
                          {group.label}
                        </p>
                        <div className="space-y-1.5">
                          {group.permissions.map((permKey) => {
                            const lockedSuperOnly = isSuperAdminOnlyPermission(permKey);
                            const checked = !lockedSuperOnly && wizardPermissions.includes(permKey);
                            return (
                              <label
                                key={permKey}
                                className={`flex items-center gap-2 text-xs ${
                                  lockedSuperOnly
                                    ? 'opacity-45 cursor-not-allowed text-slate-400'
                                    : 'cursor-pointer text-[#0B2545]'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  disabled={lockedSuperOnly}
                                  checked={checked}
                                  onChange={() => toggleWizardPerm(permKey)}
                                  className="w-4 h-4 accent-[#00A6A6]"
                                />
                                <span>{PERMISSION_LABELS[permKey]}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* STEP 6: Review Summary */}
              {wizardStep === 6 && (
                <div className="space-y-4">
                  <h4 className="font-display text-sm font-bold text-[#0B2545]">
                    الخطوة 6: مراجعة ملخص التعيين قبل الاعتماد
                  </h4>
                  <div className="rounded-2xl border border-slate-200 bg-[#EAF4F7]/45 p-4 space-y-2.5 text-xs">
                    <p>
                      <span className="font-bold text-[#0B2545]">المشرف المعين:</span>{' '}
                      {wizardSelectedUser?.displayName} ({wizardSelectedUser?.email})
                    </p>
                    <p>
                      <span className="font-bold text-[#0B2545]">الدور:</span> مسؤول تخصص (Specialization Admin)
                    </p>
                    <p>
                      <span className="font-bold text-[#0B2545]">التخصص المسند:</span>{' '}
                      {wizardSelectedSpec?.name}
                    </p>
                    <p>
                      <span className="font-bold text-[#0B2545]">صلاحية رفع/حذف المحاضرات:</span>{' '}
                      <span className="font-bold text-[#FF8066]">محظورة (حصرية للـ Super Admin)</span>
                    </p>
                    <div>
                      <p className="font-bold text-[#0B2545] mb-1.5">
                        الصلاحيات الممنوحة ({wizardPermissions.length}):
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {wizardPermissions.map((p) => (
                          <span
                            key={p}
                            className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[#0B2545]"
                          >
                            {PERMISSION_LABELS[p]}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 7: Final Confirmation */}
              {wizardStep === 7 && (
                <div className="space-y-4 text-center py-4">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-[#00A6A6]/15 text-[#00A6A6] flex items-center justify-center">
                    <ShieldCheck className="w-7 h-7" />
                  </div>
                  <h4 className="font-display text-base font-bold text-[#0B2545]">
                    الخطوة 7: الاعتماد النهائي
                  </h4>
                  <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
                    بالضغط على زر «اعتماد تعيين مشرف التخصص»، سيتم تفعيل نطاق التخصص فوراً وتسجيل العملية في سجل الأمان والتدقيق.
                  </p>
                </div>
              )}

              {/* Wizard Footer Navigation */}
              <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() =>
                    wizardStep === 1
                      ? setWizardOpen(false)
                      : setWizardStep((s) => (s - 1) as typeof wizardStep)
                  }
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 text-xs sm:text-sm font-semibold text-slate-600 inline-flex items-center gap-1"
                >
                  <ChevronRight className="w-4 h-4" />
                  {wizardStep === 1 ? 'إلغاء' : 'السابق'}
                </button>

                {wizardStep < 7 ? (
                  <button
                    type="button"
                    disabled={
                      (wizardStep === 2 && !wizardSelectedUser) ||
                      (wizardStep === 4 && !wizardSelectedSpec)
                    }
                    onClick={() => setWizardStep((s) => (s + 1) as typeof wizardStep)}
                    className="min-h-[42px] px-5 rounded-xl bg-[#0B2545] hover:bg-[#133866] text-white text-xs sm:text-sm font-bold inline-flex items-center gap-1 disabled:opacity-40"
                  >
                    التالي
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={submitting || !wizardSelectedUser || !wizardSelectedSpec}
                    onClick={handleSubmitWizard}
                    className="min-h-[42px] px-6 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs sm:text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" />
                    اعتماد تعيين مشرف التخصص
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW ASSIGNMENT DETAILS MODAL */}
      {viewingAssignment && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-3xl border border-slate-200 max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-[#0B2545]">
                تفاصيل تعيين مشرف التخصص
              </h3>
              <button
                type="button"
                onClick={() => setViewingAssignment(null)}
                aria-label="إغلاق"
                className="min-h-[34px] min-w-[34px] rounded-lg bg-slate-100 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs text-slate-700 bg-[#EAF4F7]/50 rounded-2xl p-4">
              <p>
                <strong>الاسم:</strong> {viewingAssignment.displayName}
              </p>
              <p>
                <strong>البريد الإلكتروني:</strong> {viewingAssignment.email}
              </p>
              <p>
                <strong>التخصص المسند:</strong>{' '}
                {viewingAssignment.specializationName || viewingAssignment.specializationId}
              </p>
              <p>
                <strong>الحالة:</strong>{' '}
                {viewingAssignment.status === 'suspended' ? 'معلق' : 'نشط'} (إصدار النطاق v
                {viewingAssignment.scopeVersion})
              </p>
              <p>
                <strong>تم التعيين بواسطة:</strong> {viewingAssignment.assignedByEmail} في{' '}
                {formatIsoAr(viewingAssignment.assignedAt)}
              </p>
              <p>
                <strong>آخر نشاط مسجل:</strong> {formatIsoAr(viewingAssignment.lastActivityAt)}
              </p>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-bold text-[#0B2545]">
                الصلاحيات الفعالة ({viewingAssignment.permissions.length}):
              </p>
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                {viewingAssignment.permissions.map((perm) => (
                  <span
                    key={perm}
                    className="px-2.5 py-1 rounded-lg bg-[#EAF4F7] text-[#0B2545] text-[11px] font-semibold"
                  >
                    {PERMISSION_LABELS[perm] || perm}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EDIT ASSIGNMENT PERMISSIONS MODAL */}
      {editingAssignmentPerms && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        >
          <form
            onSubmit={handleSaveEditedAssignmentPerms}
            className="bg-white rounded-3xl border border-slate-200 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
          >
            <div className="px-6 py-4 bg-[#0B2545] text-white flex items-center justify-between sticky top-0 z-10">
              <div>
                <h3 className="font-display text-base font-bold">
                  تعديل صلاحيات: {editingAssignmentPerms.displayName}
                </h3>
                <p className="text-[11px] text-[#00A6A6]">
                  النطاق: {editingAssignmentPerms.specializationName || editingAssignmentPerms.specializationId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingAssignmentPerms(null)}
                className="min-h-[36px] min-w-[36px] rounded-lg bg-white/10 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                تقتصر التعديلات على الصلاحيات المسموحة داخل التخصص فقط ({ALLOWED_SCOPED_ADMIN_PERMISSIONS.length} صلاحية). صلاحيات الرفع والإدارة العامة مقفلة للـ Super Admin ({SUPER_ADMIN_ONLY_PERMISSIONS.length} صلاحية).
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {ALLOWED_SCOPED_ADMIN_PERMISSIONS.map((permKey) => (
                  <label
                    key={permKey}
                    className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 bg-[#EAF4F7]/30 text-xs text-[#0B2545] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={editPermsDraft.includes(permKey)}
                      onChange={() => toggleEditDraftPerm(permKey)}
                      className="w-4 h-4 accent-[#00A6A6]"
                    />
                    <span>{PERMISSION_LABELS[permKey]}</span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingAssignmentPerms(null)}
                  className="min-h-[40px] px-4 rounded-xl border border-slate-200 text-sm text-slate-600"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[40px] px-5 rounded-xl bg-[#00A6A6] text-white text-sm font-bold disabled:opacity-50"
                >
                  حفظ الصلاحيات المحدثة
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* TRANSFER SPECIALIZATION MODAL */}
      {transferringAssignment && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleConfirmTransferSpec}
            className="bg-white rounded-3xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-2xl"
          >
            <h3 className="font-display text-base font-bold text-[#0B2545]">
              نقل المشرف إلى تخصص آخر
            </h3>
            <p className="text-xs text-slate-600">
              المشرف: <strong>{transferringAssignment.displayName}</strong> · التخصص الحالي:{' '}
              <strong>
                {transferringAssignment.specializationName || transferringAssignment.specializationId}
              </strong>
            </p>
            <div>
              <label htmlFor="transfer-spec-select" className="block text-xs font-semibold text-[#0B2545] mb-1">
                التخصص الجديد *
              </label>
              <select
                id="transfer-spec-select"
                value={transferTargetSpecId}
                onChange={(e) => setTransferTargetSpecId(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
              >
                {sortedSpecs
                  .filter((s) => s.id !== transferringAssignment.specializationId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTransferringAssignment(null)}
                className="min-h-[40px] px-4 rounded-xl border border-slate-200 text-sm text-slate-600"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={!transferTargetSpecId}
                className="min-h-[40px] px-5 rounded-xl bg-[#0B2545] text-white text-sm font-semibold disabled:opacity-40"
              >
                متابعة النقل
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Sensitive Action Confirmation Dialog */}
      {confirmSensitive && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FF8066]/15 text-[#FF8066] flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="font-display text-base font-bold text-[#0B2545]">
                {confirmSensitive.title}
              </h3>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">{confirmSensitive.message}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmSensitive(null)}
                className="min-h-[40px] px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={async () => {
                  const action = confirmSensitive.onConfirm;
                  setConfirmSensitive(null);
                  await action();
                }}
                className="min-h-[40px] px-5 py-2 rounded-xl bg-[#0B2545] hover:bg-[#133866] text-white text-sm font-semibold"
              >
                {confirmSensitive.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
