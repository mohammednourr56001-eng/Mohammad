import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Eye,
  FileText,
  HardDrive,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import {
  DEFAULT_STORAGE_THRESHOLDS,
  LectureFile,
  SUPPORTED_FILE_EXTENSIONS,
} from '../types/academic.ts';
import {
  computeStorageAnalytics,
  evaluateStorageQuota,
  formatFileSizeArabic,
  isGoogleDriveFile,
} from '../utils/academicLogic.ts';

export function StorageCapacityPanel({
  onPreviewFile,
  onToast,
}: {
  onPreviewFile: (file: LectureFile) => void;
  onToast: (msg: string) => void;
}) {
  const { firebaseUser, isSuperAdmin, hasPerm, getIdToken } = useAuth();
  const {
    lectureFiles,
    specializations,
    academicYears,
    subjects,
    storageStats,
    settings,
    refreshAdminCatalog,
    refreshStorageStats,
  } = usePlatformData();

  const canManageStorage = isSuperAdmin || hasPerm('storage.manage');
  const canDeleteLectures = isSuperAdmin || hasPerm('lectures.delete');

  const [quotaMB, setQuotaMB] = useState<number>(
    settings.storageQuotaMB || storageStats?.quotaMB || 1024
  );
  const [maxFileSizeMB, setMaxFileSizeMB] = useState<number>(settings.maxFileSizeMB || 25);
  const [allowZipUploads, setAllowZipUploads] = useState<boolean>(
    settings.allowZipUploads !== false
  );
  const [allowedExtensions, setAllowedExtensions] = useState<string[]>(
    settings.allowedExtensions || [...SUPPORTED_FILE_EXTENSIONS]
  );
  const [thresholds, setThresholds] = useState(
    settings.alertThresholds || DEFAULT_STORAGE_THRESHOLDS
  );
  const [saving, setSaving] = useState(false);

  const analytics = useMemo(
    () =>
      computeStorageAnalytics({
        files: lectureFiles,
        specializations,
        academicYears,
        subjects,
      }),
    [lectureFiles, specializations, academicYears, subjects]
  );

  const usedBytes = storageStats?.lecturesBytes ?? analytics.totalBytes;
  const effectiveQuotaMB = settings.storageQuotaMB || storageStats?.quotaMB || 1024;
  const quotaEval = evaluateStorageQuota({
    usedBytes,
    quotaMB: effectiveQuotaMB,
    thresholds: settings.alertThresholds || DEFAULT_STORAGE_THRESHOLDS,
  });

  const toggleExtension = (ext: string) => {
    setAllowedExtensions((prev) =>
      prev.includes(ext) ? prev.filter((e) => e !== ext) : [...prev, ext]
    );
  };

  const handleSaveStoragePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !canManageStorage) return;
    if (allowedExtensions.length === 0) {
      onToast('يجب إبقاء صيغة ملف واحدة على الأقل مفعّلة.');
      return;
    }
    setSaving(true);
    try {
      await setDoc(
        doc(db, 'settings', 'platform'),
        {
          ...settings,
          maxFileSizeMB: Math.min(500, Math.max(1, Number(maxFileSizeMB) || 25)),
          storageQuotaMB: Math.min(1048576, Math.max(1, Number(quotaMB) || 1024)),
          allowZipUploads,
          allowedExtensions,
          alertThresholds: thresholds,
          updatedBy: firebaseUser.uid,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await refreshStorageStats();
      onToast('تم تحديث سياسة السعة التخزينية وصيغ الملفات بنجاح.');
    } catch {
      onToast('تعذر حفظ إعدادات السعة التخزينية.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDuplicateOrLarge = async (file: LectureFile) => {
    if (!canDeleteLectures) return;
    try {
      const token = await getIdToken();
      if (
        token &&
        file.storageName &&
        !isGoogleDriveFile(file) &&
        !file.storageName.startsWith('gdrive_')
      ) {
        await fetch(
          `/api/files/storage/${encodeURIComponent(file.storageName)}?fileId=${encodeURIComponent(file.id)}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }
        );
      }
      await deleteDoc(doc(db, 'lectureFiles', file.id));
      await refreshAdminCatalog();
      onToast(`تم حذف "${file.title}" وتحرير المساحة.`);
    } catch {
      onToast('تعذر حذف الملف.');
    }
  };

  const alertBannerStyles: Record<string, { bg: string; text: string; msg: string }> = {
    info: {
      bg: 'bg-[#EAF4F7] border-[#00A6A6]/40',
      text: 'text-[#0B2545]',
      msg: `تنبيه سعة التخزين: تم استهلاك ${quotaEval.usedPct}% من المساحة المتاحة.`,
    },
    warning: {
      bg: 'bg-[#FF8066]/10 border-[#FF8066]/40',
      text: 'text-[#0B2545]',
      msg: `تحذير ارتفاع الاستهلاك: وصلت نسبة استخدام التخزين إلى ${quotaEval.usedPct}%. يُنصح بمراجعة الملفات المكررة أو ترقية السعة.`,
    },
    critical: {
      bg: 'bg-[#FF8066]/20 border-[#FF8066]',
      text: 'text-[#0B2545]',
      msg: `تحذير حرج: مساحة التخزين أوشكت على الامتلاء (${quotaEval.usedPct}%).`,
    },
    blocked: {
      bg: 'bg-[#FF8066] border-[#FF8066]',
      text: 'text-white',
      msg: 'عذراً، مساحة التخزين المتاحة غير كافية. يرجى مراجعة مسؤول المنصة أو زيادة السعة لإعادة تفعيل الرفع.',
    },
  };

  return (
    <div className="space-y-6">
      {/* Alert Banner when thresholds reached */}
      {quotaEval.alertLevel !== 'normal' && alertBannerStyles[quotaEval.alertLevel] && (
        <div
          role="alert"
          className={`rounded-2xl border px-5 py-3.5 flex items-center gap-3 text-sm font-semibold ${
            alertBannerStyles[quotaEval.alertLevel].bg
          } ${alertBannerStyles[quotaEval.alertLevel].text}`}
        >
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{alertBannerStyles[quotaEval.alertLevel].msg}</span>
        </div>
      )}

      {/* Primary Storage Quota Overview */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-[#0B2545] flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-[#00A6A6]" />
              نظرة عامة على السعة التخزينية
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              قياس فعلي للملفات المخزنة في المسارات الأكاديمية (uploads/ust-storage/specializations/...)
            </p>
          </div>
          <button
            type="button"
            onClick={refreshStorageStats}
            className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#EAF4F7] text-[#0B2545] text-xs font-semibold inline-flex items-center gap-2 self-start"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            تحديث القراءة
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl bg-[#EAF4F7]/65 p-4">
            <p className="text-xs text-slate-500">المساحة الإجمالية المخصصة</p>
            <p className="font-display text-xl font-bold text-[#0B2545] tabular-nums mt-1">
              {formatFileSizeArabic(quotaEval.quotaBytes)}
            </p>
          </div>
          <div className="rounded-2xl bg-[#EAF4F7]/65 p-4">
            <p className="text-xs text-slate-500">المساحة المستخدمة</p>
            <p className="font-display text-xl font-bold text-[#00A6A6] tabular-nums mt-1">
              {formatFileSizeArabic(quotaEval.usedBytes)}
            </p>
          </div>
          <div className="rounded-2xl bg-[#EAF4F7]/65 p-4">
            <p className="text-xs text-slate-500">المساحة المتبقية</p>
            <p className="font-display text-xl font-bold text-[#0B2545] tabular-nums mt-1">
              {formatFileSizeArabic(quotaEval.remainingBytes)}
            </p>
          </div>
          <div className="rounded-2xl bg-[#EAF4F7]/65 p-4">
            <p className="text-xs text-slate-500">عدد الملفات الكلي</p>
            <p className="font-display text-xl font-bold text-[#0B2545] tabular-nums mt-1">
              {storageStats?.lecturesFileCount ?? analytics.totalFiles} ملف
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between text-xs font-semibold text-[#0B2545]">
            <span>نسبة الاستهلاك الحالية</span>
            <span className="tabular-nums">{quotaEval.usedPct}%</span>
          </div>
          <div className="w-full h-3 bg-[#EAF4F7] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                quotaEval.usedPct >= 95
                  ? 'bg-[#FF8066]'
                  : quotaEval.usedPct >= 70
                    ? 'bg-amber-500'
                    : 'bg-[#00A6A6]'
              }`}
              style={{ width: `${Math.max(2, quotaEval.usedPct)}%` }}
            />
          </div>
        </div>
      </section>

      {/* Format Breakdown Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'ملفات PDF', data: analytics.byFormat.pdf },
          { label: 'عروض PowerPoint', data: analytics.byFormat.powerpoint },
          { label: 'مستندات Word', data: analytics.byFormat.word },
          { label: 'ملفات أخرى', data: analytics.byFormat.other },
        ].map((item) => (
          <div key={item.label} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{item.label}</span>
              <FileText className="w-4 h-4 text-[#00A6A6]" />
            </div>
            <p className="font-display text-lg font-bold text-[#0B2545] tabular-nums">
              {formatFileSizeArabic(item.data.bytes)}
            </p>
            <p className="text-[11px] text-slate-500 tabular-nums">{item.data.count} ملف</p>
          </div>
        ))}
      </div>

      {/* Distribution by Specialization / Subject / Uploader */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <h3 className="font-display text-sm font-bold text-[#0B2545]">
            الاستهلاك حسب التخصص الأكاديمي
          </h3>
          <div className="space-y-3">
            {analytics.bySpecialization.map((item) => {
              const pct = analytics.totalBytes > 0 ? Math.round((item.bytes / analytics.totalBytes) * 100) : 0;
              return (
                <div key={item.id} className="space-y-1">
                  <div className="flex justify-between text-xs text-[#0B2545]">
                    <span className="font-semibold truncate">{item.name}</span>
                    <span className="tabular-nums text-slate-600">
                      {formatFileSizeArabic(item.bytes)} ({item.count} ملف)
                    </span>
                  </div>
                  <div className="h-2 bg-[#EAF4F7] rounded-full overflow-hidden">
                    <div className="h-full bg-[#00A6A6] rounded-full" style={{ width: `${Math.max(4, pct)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <h3 className="font-display text-sm font-bold text-[#0B2545]">
            الاستهلاك حسب المسؤول / المشرف الرافع
          </h3>
          <div className="space-y-2.5">
            {analytics.byUploader.map((u) => (
              <div key={u.uid} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100 last:border-0">
                <span className="font-mono text-[#0B2545] truncate max-w-[200px]">{u.email}</span>
                <span className="tabular-nums text-slate-600 font-semibold">
                  {u.count} ملف · {formatFileSizeArabic(u.bytes)}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Duplicate Detection & Large Files Cleanup */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <h3 className="font-display text-sm font-bold text-[#0B2545] flex items-center gap-2">
            <Copy className="w-4 h-4 text-[#FF8066]" />
            كشف الملفات المكررة ({analytics.duplicateGroups.length} مجموعات)
          </h3>
          {analytics.duplicateGroups.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#00A6A6]" />
              لا توجد ملفات مكررة حالياً في التخزين.
            </p>
          ) : (
            <div className="space-y-3">
              {analytics.duplicateGroups.map((grp) => (
                <div key={grp.signature} className="rounded-xl bg-[#EAF4F7]/60 p-3 space-y-2">
                  <p className="text-xs font-bold text-[#0B2545]">
                    {grp.files[0].originalName} — مساحة مهدرة: {formatFileSizeArabic(grp.wastedBytes)}
                  </p>
                  <div className="space-y-1">
                    {grp.files.map((dup, idx) => (
                      <div key={dup.id} className="flex items-center justify-between text-xs">
                        <span className="truncate text-slate-600">{dup.title}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => onPreviewFile(dup)}
                            className="p-1 text-[#0B2545] hover:text-[#00A6A6]"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          {idx > 0 && canDeleteLectures && (
                            <button
                              type="button"
                              onClick={() => handleDeleteDuplicateOrLarge(dup)}
                              className="p-1 text-[#FF8066]"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <h3 className="font-display text-sm font-bold text-[#0B2545]">
            أكبر الملفات حجماً
          </h3>
          <div className="divide-y divide-slate-100">
            {analytics.largeFiles.slice(0, 5).map((f) => (
              <div key={f.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <p className="font-semibold text-[#0B2545] truncate">{f.title}</p>
                  <p className="text-[11px] text-slate-400 font-mono truncate">{f.originalName}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="tabular-nums font-bold text-[#0B2545]">
                    {formatFileSizeArabic(f.fileSize)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onPreviewFile(f)}
                    className="p-1.5 rounded-lg bg-[#EAF4F7] text-[#0B2545]"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Quota & Allowed Formats Settings (Storage Manager / Super Admin) */}
      {canManageStorage && (
        <form
          onSubmit={handleSaveStoragePolicy}
          className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5"
        >
          <h3 className="font-display text-base font-bold text-[#0B2545]">
            إعدادات الحصة التخزينية والصيغ المسموح بها
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="st-quota" className="block text-xs font-semibold text-[#0B2545] mb-1">
                الحد الأقصى لمساحة المنصة (ميجابايت)
              </label>
              <input
                id="st-quota"
                type="number"
                min={1}
                max={1048576}
                value={quotaMB}
                onChange={(e) => setQuotaMB(Number(e.target.value))}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="st-maxfile" className="block text-xs font-semibold text-[#0B2545] mb-1">
                الحد الأقصى لحجم الملف الواحد (ميجابايت)
              </label>
              <input
                id="st-maxfile"
                type="number"
                min={1}
                max={500}
                value={maxFileSizeMB}
                onChange={(e) => setMaxFileSizeMB(Number(e.target.value))}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm tabular-nums"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-[#0B2545] cursor-pointer min-h-[42px]">
                <input
                  type="checkbox"
                  checked={allowZipUploads}
                  onChange={(e) => setAllowZipUploads(e.target.checked)}
                  className="w-4 h-4 accent-[#00A6A6]"
                />
                السماح برفع الملفات المضغوطة (ZIP)
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#0B2545]">الصيغ المسموح برفعها</p>
            <div className="flex flex-wrap gap-2">
              {SUPPORTED_FILE_EXTENSIONS.map((ext) => {
                const active = allowedExtensions.includes(ext);
                return (
                  <button
                    key={ext}
                    type="button"
                    onClick={() => toggleExtension(ext)}
                    className={`min-h-[34px] px-3 py-1 rounded-xl text-xs font-bold uppercase border transition-colors ${
                      active
                        ? 'bg-[#0B2545] text-white border-[#0B2545]'
                        : 'bg-white text-slate-500 border-slate-200'
                    }`}
                  >
                    .{ext}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">تنبيه مبكر (%)</label>
              <input
                type="number"
                min={10}
                max={95}
                value={thresholds.infoPct}
                onChange={(e) => setThresholds((t) => ({ ...t, infoPct: Number(e.target.value) }))}
                className="w-full min-h-[38px] px-3 rounded-xl border border-slate-200 text-xs tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">تحذير (%)</label>
              <input
                type="number"
                min={10}
                max={99}
                value={thresholds.warningPct}
                onChange={(e) => setThresholds((t) => ({ ...t, warningPct: Number(e.target.value) }))}
                className="w-full min-h-[38px] px-3 rounded-xl border border-slate-200 text-xs tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">تحذير حرج (%)</label>
              <input
                type="number"
                min={10}
                max={100}
                value={thresholds.criticalPct}
                onChange={(e) => setThresholds((t) => ({ ...t, criticalPct: Number(e.target.value) }))}
                className="w-full min-h-[38px] px-3 rounded-xl border border-slate-200 text-xs tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">إيقاف الرفع (%)</label>
              <input
                type="number"
                min={50}
                max={100}
                value={thresholds.blockPct}
                onChange={(e) => setThresholds((t) => ({ ...t, blockPct: Number(e.target.value) }))}
                className="w-full min-h-[38px] px-3 rounded-xl border border-slate-200 text-xs tabular-nums"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] px-6 py-2 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'جاري الحفظ...' : 'حفظ سياسة التخزين'}
          </button>
        </form>
      )}
    </div>
  );
}
