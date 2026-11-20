import React, { useState } from 'react';
import {
  Archive,
  CheckCircle2,
  Database,
  Download,
  FolderArchive,
  HardDrive,
  Loader2,
  Save,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import { formatFileSizeArabic } from '../utils/academicLogic.ts';

export function BackupRecoveryPanel({ onToast }: { onToast: (msg: string) => void }) {
  const { firebaseUser, getIdToken, isSuperAdmin, hasPerm } = useAuth();
  const { backups, settings, refreshBackups, refreshAuditLogs } = usePlatformData();

  const [creatingType, setCreatingType] = useState<'database' | 'files' | 'full' | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [retentionDays, setRetentionDays] = useState<number>(settings.backupRetentionDays || 30);
  const [schedule, setSchedule] = useState<'daily' | 'weekly' | 'manual'>(
    settings.autoBackupSchedule || 'weekly'
  );
  const [savingPolicy, setSavingPolicy] = useState(false);

  const canManageBackups = isSuperAdmin || hasPerm('settings.manage');

  const handleCreateBackup = async (type: 'database' | 'files' | 'full') => {
    if (!canManageBackups) return;
    setCreatingType(type);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('يرجى إعادة تسجيل الدخول.');
      const res = await fetch('/api/backups/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ type, notes: notes.trim() || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'تعذر إنشاء النسخة الاحتياطية.');
      setNotes('');
      await Promise.all([refreshBackups(), refreshAuditLogs()]);
      onToast('تم إنشاء النسخة الاحتياطية وحفظها بنجاح.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'فشل إنشاء النسخة الاحتياطية.');
    } finally {
      setCreatingType(null);
    }
  };

  const handleDownloadBackup = async (backupId: string) => {
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch(`/api/backups/download/${encodeURIComponent(backupId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        onToast('تعذر تحميل ملف النسخة الاحتياطية.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ust-backup-${backupId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      onToast('حدث خطأ أثناء تحميل النسخة الاحتياطية.');
    }
  };

  const handleVerifyBackup = async (backupId: string) => {
    if (!canManageBackups) return;
    setVerifyingId(backupId);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('يرجى إعادة تسجيل الدخول.');
      const res = await fetch(`/api/backups/${encodeURIComponent(backupId)}/verify-restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'تعذر تنفيذ اختبار الاستعادة.');
      await Promise.all([refreshBackups(), refreshAuditLogs()]);
      onToast(
        body.ok
          ? 'نجح اختبار الاستعادة والتحقق من بصمة SHA-256.'
          : 'رصد اختبار الاستعادة خللاً في سلامة النسخة الاحتياطية!'
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'فشل التحقق من النسخة.');
    } finally {
      setVerifyingId(null);
    }
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !canManageBackups) return;
    setSavingPolicy(true);
    try {
      await setDoc(
        doc(db, 'settings', 'platform'),
        {
          ...settings,
          backupRetentionDays: Math.min(365, Math.max(1, Number(retentionDays) || 30)),
          autoBackupSchedule: schedule,
          updatedBy: firebaseUser.uid,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      onToast('تم حفظ سياسة الاحتفاظ والنسخ الاحتياطي.');
    } catch {
      onToast('تعذر حفظ سياسة النسخ الاحتياطي.');
    } finally {
      setSavingPolicy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Architecture Overview & Manual Backup Triggers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div className="w-11 h-11 rounded-xl bg-[#EAF4F7] text-[#0B2545] flex items-center justify-center">
            <Database className="w-5 h-5 text-[#00A6A6]" />
          </div>
          <h3 className="font-display text-base font-bold text-[#0B2545]">
            نسخة احتياطية لقاعدة البيانات
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            تصدير آمن لكافة التخصصات، السنوات، الفصول، المواد، بيانات الملفات، المستخدمين وسجلات الصلاحيات بصيغة JSON قابلة للاستعادة.
          </p>
          <button
            type="button"
            disabled={!canManageBackups || creatingType !== null}
            onClick={() => handleCreateBackup('database')}
            className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-[#0B2545] hover:bg-[#133866] text-white text-xs font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {creatingType === 'database' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Database className="w-4 h-4 text-[#00A6A6]" />
            )}
            نسخ قاعدة البيانات الآن
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div className="w-11 h-11 rounded-xl bg-[#EAF4F7] text-[#0B2545] flex items-center justify-center">
            <FolderArchive className="w-5 h-5 text-[#00A6A6]" />
          </div>
          <h3 className="font-display text-base font-bold text-[#0B2545]">
            نسخة احتياطية لملفات المحاضرات
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            إنشاء لقطة استرداد فعلية على وحدة التخزين لكافة ملفات المحاضرات مع التحقق من بصمة SHA-256 لكل ملف.
          </p>
          <button
            type="button"
            disabled={!canManageBackups || creatingType !== null}
            onClick={() => handleCreateBackup('files')}
            className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {creatingType === 'files' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <HardDrive className="w-4 h-4" />
            )}
            نسخ الملفات المرفوعة الآن
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div className="w-11 h-11 rounded-xl bg-[#EAF4F7] text-[#0B2545] flex items-center justify-center">
            <Archive className="w-5 h-5 text-[#FF8066]" />
          </div>
          <h3 className="font-display text-base font-bold text-[#0B2545]">
            نسخة احتياطية شاملة (النظام + الملفات)
          </h3>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ملاحظة اختيارية (مثال: قبل ترقية الفصل الثاني)..."
            className="w-full min-h-[38px] px-3 rounded-xl border border-slate-200 text-xs"
          />
          <button
            type="button"
            disabled={!canManageBackups || creatingType !== null}
            onClick={() => handleCreateBackup('full')}
            className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-[#FF8066] hover:bg-[#f16d52] text-white text-xs font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {creatingType === 'full' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Archive className="w-4 h-4" />
            )}
            إنشاء نسخة احتياطية شاملة
          </button>
        </div>
      </div>

      {/* Retention Policy & Schedule */}
      <form
        onSubmit={handleSavePolicy}
        className="bg-white rounded-2xl border border-slate-200 p-5 grid grid-cols-1 sm:grid-cols-3 gap-4 items-end"
      >
        <div>
          <label htmlFor="bkp-schedule" className="block text-xs font-semibold text-[#0B2545] mb-1">
            الجدولة التلقائية الموصى بها
          </label>
          <select
            id="bkp-schedule"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value as 'daily' | 'weekly' | 'manual')}
            className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm"
          >
            <option value="daily">يومي (تلقائي)</option>
            <option value="weekly">أسبوعي (كل جمعة)</option>
            <option value="manual">يدوي عند الطلب</option>
          </select>
        </div>
        <div>
          <label htmlFor="bkp-retention" className="block text-xs font-semibold text-[#0B2545] mb-1">
            مدة الاحتفاظ بالنسخ (أيام)
          </label>
          <input
            id="bkp-retention"
            type="number"
            min={1}
            max={365}
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
            className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm tabular-nums"
          />
        </div>
        <button
          type="submit"
          disabled={!canManageBackups || savingPolicy}
          className="min-h-[42px] px-5 py-2 rounded-xl bg-[#0B2545] text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Save className="w-4 h-4 text-[#00A6A6]" />
          {savingPolicy ? 'جاري الحفظ...' : 'حفظ سياسة النسخ الاحتياطي'}
        </button>
      </form>

      {/* Backup Snapshots History */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-[#0B2545]">
            سجل النسخ الاحتياطية المنفذة ({backups.length})
          </h3>
        </div>
        <table className="w-full text-right text-sm">
          <thead className="bg-[#EAF4F7]/70 text-xs font-semibold text-[#0B2545]">
            <tr>
              <th className="p-3.5">النوع</th>
              <th className="p-3.5">المحتوى</th>
              <th className="p-3.5">الحجم</th>
              <th className="p-3.5">المنفذ</th>
              <th className="p-3.5">التاريخ</th>
              <th className="p-3.5">تنزيل</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {backups.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-sm text-slate-500">
                  لم يتم إنشاء أي نسخ احتياطية بعد. استخدم الأزرار أعلاه لإنشاء أول نسخة.
                </td>
              </tr>
            ) : (
              backups.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50/70">
                  <td className="p-3.5 text-xs font-bold text-[#0B2545]">
                    {b.type === 'database'
                      ? 'قاعدة البيانات'
                      : b.type === 'files'
                        ? 'ملفات المحاضرات'
                        : 'نسخة شاملة'}
                    <div className="flex items-center gap-1 text-[11px] font-normal mt-0.5">
                      {b.verifiedStatus === 'verified' ? (
                        <span className="inline-flex items-center gap-1 text-[#00A6A6] font-semibold">
                          <CheckCircle2 className="w-3 h-3" />
                          موثقة بالاختبار
                        </span>
                      ) : b.verifiedStatus === 'failed' ? (
                        <span className="inline-flex items-center gap-1 text-[#FF8066] font-semibold">
                          <XCircle className="w-3 h-3" />
                          فشل اختبار الاستعادة
                        </span>
                      ) : (
                        <span className="text-amber-700 font-medium">
                          منشأة (لم يُختبر الاسترداد بعد)
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3.5 text-xs text-slate-600 tabular-nums">
                    {b.totalRecords > 0 && <span>{b.totalRecords} سجل · </span>}
                    {b.totalFiles > 0 && <span>{b.totalFiles} ملف</span>}
                    {b.integritySha256 && (
                      <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                        SHA-256: {b.integritySha256.slice(0, 14)}…
                      </p>
                    )}
                    {b.verifiedNotes && (
                      <p className="text-[10px] text-[#008080] mt-0.5">{b.verifiedNotes}</p>
                    )}
                    {b.notes && <p className="text-[11px] text-slate-400 mt-0.5">{b.notes}</p>}
                  </td>
                  <td className="p-3.5 text-xs text-slate-600 tabular-nums">
                    {formatFileSizeArabic(b.totalBytes)}
                  </td>
                  <td className="p-3.5 text-xs font-mono text-slate-500">{b.createdByEmail}</td>
                  <td className="p-3.5 text-xs text-slate-500 tabular-nums">
                    {new Date(b.createdAt).toLocaleString('ar-EG')}
                  </td>
                  <td className="p-3.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        disabled={verifyingId === b.id}
                        onClick={() => handleVerifyBackup(b.id)}
                        className="min-h-[34px] px-3 py-1 rounded-lg bg-[#0B2545] hover:bg-[#133866] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-[#00A6A6]" />
                        {verifyingId === b.id ? 'جاري الاختبار...' : 'اختبار الاستعادة'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadBackup(b.id)}
                        className="min-h-[34px] px-3 py-1 rounded-lg bg-[#EAF4F7] hover:bg-[#00A6A6] text-[#0B2545] hover:text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        تنزيل
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
