import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Crown,
  Lock,
  MailPlus,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserCog,
  UserPlus,
  UserX,
  X,
} from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  PermissionKey,
  ROLE_LABELS_AR,
  UserProfile,
  UserRole,
} from '../types/academic.ts';
import { canAssignRoleChange, generateSafeId } from '../utils/academicLogic.ts';

export function AdminManagementPanel({ onToast }: { onToast: (msg: string) => void }) {
  const { firebaseUser, profile, role: actorRole, permissions: actorPerms, isSuperAdmin, hasPerm, getIdToken } =
    useAuth();
  const {
    users,
    admins,
    adminInvitations,
    permissionProfiles,
    refreshDirectory,
    refreshAuditLogs,
  } = usePlatformData();

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');

  // Add / Edit Admin Workflow State
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<'existing' | 'invite'>('existing');
  const [selectedTargetUid, setSelectedTargetUid] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [editingTargetUser, setEditingTargetUser] = useState<UserProfile | null>(null);

  const [chosenRole, setChosenRole] = useState<'admin' | 'moderator'>('moderator');
  const [chosenPerms, setChosenPerms] = useState<PermissionKey[]>([
    ...DEFAULT_ROLE_PERMISSIONS.moderator,
  ]);
  const [selectedProfileName, setSelectedProfileName] = useState('');
  const [newProfileName, setNewProfileName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Sensitive Action Extra Confirmation
  const [confirmSensitive, setConfirmSensitive] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  const canAssignRoles = isSuperAdmin || hasPerm('roles.assign');
  const canManageUsers = isSuperAdmin || hasPerm('users.manage');

  const actorProfileForCheck: UserProfile | null = firebaseUser
    ? {
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        displayName: profile?.displayName || firebaseUser.displayName || '',
        role: actorRole,
        permissions: actorPerms,
        status: 'active',
      }
    : null;

  const nonSuperStudentsAndStaff = useMemo(
    () =>
      users.filter(
        (u) =>
          u.role !== 'super_admin' &&
          u.uid !== firebaseUser?.uid
      ),
    [users, firebaseUser?.uid]
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

  const togglePermCheckbox = (perm: PermissionKey) => {
    setChosenPerms((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  const applyRoleDefaults = (nextRole: 'admin' | 'moderator') => {
    setChosenRole(nextRole);
    setChosenPerms([...DEFAULT_ROLE_PERMISSIONS[nextRole]]);
  };

  const openAddWorkflow = () => {
    setEditingTargetUser(null);
    setAddMode(nonSuperStudentsAndStaff.length > 0 ? 'existing' : 'invite');
    setSelectedTargetUid(nonSuperStudentsAndStaff[0]?.uid || '');
    setInviteEmail('');
    applyRoleDefaults('moderator');
    setSelectedProfileName('');
    setNewProfileName('');
    setShowAddModal(true);
  };

  const openEditPermissions = (target: UserProfile) => {
    if (target.role === 'super_admin') return;
    setEditingTargetUser(target);
    const baseRole: 'admin' | 'moderator' =
      target.role === 'admin' ? 'admin' : 'moderator';
    setChosenRole(baseRole);
    setChosenPerms(
      target.permissions && target.permissions.length > 0
        ? [...target.permissions]
        : [...DEFAULT_ROLE_PERMISSIONS[baseRole]]
    );
    setSelectedProfileName('');
    setShowAddModal(true);
  };

  const handleSaveCustomProfile = async () => {
    if (!isSuperAdmin || !firebaseUser || newProfileName.trim().length < 2) return;
    const id = generateSafeId('prof');
    await setDoc(doc(db, 'permissionProfiles', id), {
      id,
      name: newProfileName.trim(),
      baseRole: chosenRole,
      permissions: chosenPerms,
      createdBy: firebaseUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setSelectedProfileName(newProfileName.trim());
    setNewProfileName('');
    onToast('تم حفظ قالب الصلاحيات المخصص.');
  };

  const executeAddOrUpdateStaff = async () => {
    setSubmitting(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('يرجى إعادة تسجيل الدخول.');

      if (editingTargetUser || addMode === 'existing') {
        const target =
          editingTargetUser ||
          users.find((u) => u.uid === selectedTargetUid);
        if (!target) throw new Error('يرجى اختيار مستخدم صالح.');

        const clientCheck = canAssignRoleChange({
          actor: actorProfileForCheck,
          target,
          nextRole: chosenRole,
          nextPermissions: chosenPerms,
        });
        if (!clientCheck.allowed) {
          throw new Error(clientCheck.reason || 'غير مصرح بهذه العملية.');
        }

        const res = await fetch(`/api/admin/users/${encodeURIComponent(target.uid)}/role`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            role: chosenRole,
            permissions: chosenPerms,
            assignedProfileName: selectedProfileName || undefined,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'تعذر تحديث الصلاحيات.');
        onToast(`تم اعتماد صلاحيات "${target.email}" بنجاح.`);
      } else {
        if (!isSuperAdmin) {
          throw new Error('دعوة حسابات جديدة حصرية للمدير الرئيسي فقط.');
        }
        const cleanEmail = inviteEmail.trim().toLowerCase();
        if (!cleanEmail || !cleanEmail.includes('@')) {
          throw new Error('يرجى إدخال بريد Google صحيح.');
        }
        const res = await fetch('/api/admin/invitations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            email: cleanEmail,
            role: chosenRole,
            permissions: chosenPerms,
            profileName: selectedProfileName || undefined,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'تعذر إنشاء الدعوة.');
        onToast(`تم حفظ دعوة "${cleanEmail}". ستُفعل الصلاحيات تلقائياً عند تسجيل الدخول عبر Google.`);
      }

      setShowAddModal(false);
      await Promise.all([refreshDirectory(), refreshAuditLogs()]);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'فشلت العملية.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmSubmitModal = (e: React.FormEvent) => {
    e.preventDefault();
    const targetLabel = editingTargetUser
      ? editingTargetUser.email
      : addMode === 'existing'
        ? users.find((u) => u.uid === selectedTargetUid)?.email || 'الحساب المحدد'
        : inviteEmail.trim().toLowerCase();

    setConfirmSensitive({
      title: 'تأكيد منح أو تعديل الصلاحيات الإدارية',
      message: `سيتم تعيين دور "${ROLE_LABELS_AR[chosenRole]}" للحساب (${targetLabel}) مع ${chosenPerms.length} صلاحية مخصصة. هل تريد المتابعة؟`,
      confirmLabel: 'تأكيد واعتماد',
      onConfirm: executeAddOrUpdateStaff,
    });
  };

  const handleRevokeToStudent = (target: UserProfile) => {
    setConfirmSensitive({
      title: 'سحب الصلاحيات الإدارية',
      message: `هل أنت متأكد من إرجاع "${target.email}" إلى دور طالب وسحب كافة صلاحياته الإدارية فوراً؟`,
      confirmLabel: 'سحب الصلاحيات',
      onConfirm: async () => {
        const token = await getIdToken();
        if (!token) return;
        const res = await fetch(`/api/admin/users/${encodeURIComponent(target.uid)}/role`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ role: 'student', permissions: [] }),
        });
        const body = await res.json();
        if (!res.ok) {
          onToast(body.error || 'تعذر سحب الصلاحيات.');
          return;
        }
        await Promise.all([refreshDirectory(), refreshAuditLogs()]);
        onToast(`تم تحويل "${target.email}" إلى حساب طالب.`);
      },
    });
  };

  const handleToggleSuspend = (target: UserProfile) => {
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
        await Promise.all([refreshDirectory(), refreshAuditLogs()]);
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

  return (
    <div className="space-y-6">
      {/* 3-Tier Role Hierarchy Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#0B2545] text-white rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#00A6A6]">المستوى 1</span>
            <Crown className="w-5 h-5 text-[#FF8066]" />
          </div>
          <h3 className="font-display text-base font-bold">المدير الرئيسي / مالك المنصة</h3>
          <p className="text-xs text-white/75 leading-relaxed">
            تحكم كامل بالمنصة، تعيين المسؤولين، ضبط حدود التخزين، والنسخ الاحتياطي. محمي من التعديل أو التعليق.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#00A6A6]">المستوى 2</span>
            <ShieldCheck className="w-5 h-5 text-[#00A6A6]" />
          </div>
          <h3 className="font-display text-base font-bold text-[#0B2545]">مسؤول النظام (Admin)</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            إدارة الهيكلة الأكاديمية، المحاضرات، الإعلانات، وتنفيذ الأدوات المصرح بها في مصفوفة الصلاحيات فقط.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">المستوى 3</span>
            <Shield className="w-5 h-5 text-[#0B2545]" />
          </div>
          <h3 className="font-display text-base font-bold text-[#0B2545]">مشرف المحتوى (Moderator)</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            واجهة مبسطة لرفع ملفات المحاضرات وتعديل ملفاته المرفوعة دون الوصول لإعدادات النظام أو المستخدمين.
          </p>
        </div>
      </div>

      {/* Action Header + Pending Invitations */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold text-[#0B2545]">
            إدارة المسؤولين والمستخدمين ({users.length})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            الطاقم الإداري النشط: {admins.filter((a) => a.status === 'active').length} · الدعوات المعلقة: {pendingInvitations.length}
          </p>
        </div>

        {canAssignRoles && (
          <button
            type="button"
            onClick={openAddWorkflow}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <UserPlus className="w-4 h-4" />
            إضافة مسؤول جديد
          </button>
        )}
      </div>

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
                    الدور المعين: <span className="font-semibold text-[#00A6A6]">{ROLE_LABELS_AR[inv.role]}</span> ·{' '}
                    {inv.permissions.length} صلاحية مخصصة
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

      {/* Search & Filter */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="البحث بالاسم أو البريد الإلكتروني..."
            className="w-full min-h-[42px] pr-9 pl-3 rounded-xl border border-slate-200 text-sm"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
          className="min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
        >
          <option value="all">جميع الأدوار</option>
          <option value="super_admin">المدير الرئيسي</option>
          <option value="admin">مسؤول النظام</option>
          <option value="moderator">مشرف محتوى</option>
          <option value="student">طالب</option>
        </select>
      </div>

      {/* Users & Staff Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-right text-sm">
          <thead className="bg-[#EAF4F7]/70 text-xs font-semibold text-[#0B2545]">
            <tr>
              <th className="p-3.5">المستخدم</th>
              <th className="p-3.5">الدور</th>
              <th className="p-3.5">الحالة</th>
              <th className="p-3.5">الصلاحيات</th>
              <th className="p-3.5">إجراءات الإدارة</th>
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
                const permsCount = isOwner
                  ? 20
                  : (u.permissions?.length || DEFAULT_ROLE_PERMISSIONS[u.role]?.length || 0);
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
                    <td className="p-3.5 text-xs">
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
                      {u.role === 'student' ? 'صلاحيات طالب' : `${permsCount} صلاحية`}
                    </td>
                    <td className="p-3.5">
                      {isOwner ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400">
                          <Lock className="w-3.5 h-3.5" />
                          حساب المالك محمي
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {canAssignRoles && (isSuperAdmin || u.role !== 'admin') && (
                            <button
                              type="button"
                              onClick={() => openEditPermissions(u)}
                              className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#EAF4F7] hover:bg-[#0B2545] text-[#0B2545] hover:text-white text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                            >
                              <UserCog className="w-3.5 h-3.5" />
                              الصلاحيات
                            </button>
                          )}
                          {canAssignRoles && u.role !== 'student' && (isSuperAdmin || u.role === 'moderator') && (
                            <button
                              type="button"
                              onClick={() => handleRevokeToStudent(u)}
                              className="min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:text-[#FF8066]"
                            >
                              إرجاع لطالب
                            </button>
                          )}
                          {canManageUsers && (isSuperAdmin || u.role === 'student') && u.uid !== firebaseUser?.uid && (
                            <button
                              type="button"
                              onClick={() => handleToggleSuspend(u)}
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

      {/* Add / Configure Admin Modal */}
      {showAddModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        >
          <form
            onSubmit={handleConfirmSubmitModal}
            className="bg-white rounded-3xl border border-slate-200 max-w-3xl w-full max-h-[92vh] overflow-y-auto shadow-2xl"
          >
            <div className="px-6 py-4 bg-[#0B2545] text-white flex items-center justify-between sticky top-0 z-10">
              <h3 className="font-display text-base font-bold">
                {editingTargetUser
                  ? `تعديل دور وصلاحيات: ${editingTargetUser.email}`
                  : 'إضافة مسؤول جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="min-h-[36px] min-w-[36px] rounded-lg bg-white/10 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {!editingTargetUser && (
                <div className="space-y-3">
                  {isSuperAdmin && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setAddMode('existing')}
                        className={`flex-1 min-h-[42px] px-4 rounded-xl text-xs font-bold border transition-colors ${
                          addMode === 'existing'
                            ? 'bg-[#0B2545] text-white border-[#0B2545]'
                            : 'bg-white text-slate-600 border-slate-200'
                        }`}
                      >
                        اختيار حساب مسجل
                      </button>
                      <button
                        type="button"
                        onClick={() => setAddMode('invite')}
                        className={`flex-1 min-h-[42px] px-4 rounded-xl text-xs font-bold border transition-colors ${
                          addMode === 'invite'
                            ? 'bg-[#0B2545] text-white border-[#0B2545]'
                            : 'bg-white text-slate-600 border-slate-200'
                        }`}
                      >
                        دعوة بريد Google جديد
                      </button>
                    </div>
                  )}

                  {addMode === 'existing' ? (
                    <div>
                      <label htmlFor="select-existing-user" className="block text-xs font-semibold text-[#0B2545] mb-1">
                        اختر المستخدم المسجل *
                      </label>
                      <select
                        id="select-existing-user"
                        value={selectedTargetUid}
                        onChange={(e) => setSelectedTargetUid(e.target.value)}
                        className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 text-sm"
                      >
                        {nonSuperStudentsAndStaff.length === 0 ? (
                          <option value="">لا يوجد مستخدمون مسجلون آخرون بعد</option>
                        ) : (
                          nonSuperStudentsAndStaff.map((u) => (
                            <option key={u.uid} value={u.uid}>
                              {u.displayName} — {u.email} ({ROLE_LABELS_AR[u.role]})
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label htmlFor="invite-google-email" className="block text-xs font-semibold text-[#0B2545] mb-1">
                        بريد حساب Google المراد دعوته *
                      </label>
                      <input
                        id="invite-google-email"
                        type="email"
                        required
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="faculty.member@gmail.com"
                        className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm font-mono"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Role & Saved Custom Permission Profile */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="assign-role" className="block text-xs font-semibold text-[#0B2545] mb-1">
                    الدور الإداري *
                  </label>
                  <select
                    id="assign-role"
                    value={chosenRole}
                    onChange={(e) =>
                      applyRoleDefaults(e.target.value === 'admin' ? 'admin' : 'moderator')
                    }
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                  >
                    <option value="moderator">مشرف محتوى (Moderator)</option>
                    {isSuperAdmin && <option value="admin">مسؤول نظام (Admin)</option>}
                  </select>
                </div>

                <div>
                  <label htmlFor="assign-profile" className="block text-xs font-semibold text-[#0B2545] mb-1">
                    تطبيق قالب صلاحيات محفوظ (اختياري)
                  </label>
                  <select
                    id="assign-profile"
                    value={selectedProfileName}
                    onChange={(e) => {
                      const prof = permissionProfiles.find((p) => p.name === e.target.value);
                      setSelectedProfileName(e.target.value);
                      if (prof) {
                        setChosenRole(prof.baseRole);
                        setChosenPerms([...prof.permissions]);
                      }
                    }}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
                  >
                    <option value="">تخصيص يدوي</option>
                    {permissionProfiles.map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name} ({p.permissions.length} صلاحية)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Granular Permission Matrix */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-display text-sm font-bold text-[#0B2545]">
                    مصفوفة الصلاحيات التفصيلية ({chosenPerms.length} / 20)
                  </h4>
                  <button
                    type="button"
                    onClick={() => applyRoleDefaults(chosenRole)}
                    className="text-xs font-semibold text-[#00A6A6] hover:underline"
                  >
                    استعادة الافتراضي للدور
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
                          const sovereignLocked =
                            !isSuperAdmin &&
                            ['roles.assign', 'settings.manage', 'storage.manage'].includes(permKey);
                          const checked = chosenPerms.includes(permKey);
                          return (
                            <label
                              key={permKey}
                              className={`flex items-center gap-2 text-xs cursor-pointer ${
                                sovereignLocked ? 'opacity-40 cursor-not-allowed' : 'text-[#0B2545]'
                              }`}
                            >
                              <input
                                type="checkbox"
                                disabled={sovereignLocked}
                                checked={checked}
                                onChange={() => togglePermCheckbox(permKey)}
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

              {/* Save Custom Profile (Super Admin) */}
              {isSuperAdmin && (
                <div className="bg-slate-50 rounded-2xl p-3.5 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                  <input
                    type="text"
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value)}
                    placeholder="احفظ هذه الاختيارات كقالب جديد (مثال: منسق كلية الهندسة)..."
                    className="flex-1 min-h-[38px] px-3 rounded-xl border border-slate-200 text-xs bg-white"
                  />
                  <button
                    type="button"
                    onClick={handleSaveCustomProfile}
                    disabled={newProfileName.trim().length < 2}
                    className="min-h-[38px] px-4 py-1.5 rounded-xl bg-[#0B2545] text-white text-xs font-semibold disabled:opacity-40"
                  >
                    حفظ كقالب مخصص
                  </button>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting || (!editingTargetUser && addMode === 'existing' && !selectedTargetUid)}
                  className="min-h-[42px] px-6 py-2 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  تأكيد وإضافة
                </button>
              </div>
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
