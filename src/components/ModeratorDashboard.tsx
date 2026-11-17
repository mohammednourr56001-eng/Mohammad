import React, { useState } from 'react';
import {
  ArrowRight,
  Edit3,
  Eye,
  FileText,
  HardDrive,
  LogOut,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import { LectureFile } from '../types/academic.ts';
import { formatFileSizeArabic, getCategoryLabel } from '../utils/academicLogic.ts';
import { AdminFileUploader } from './AdminFileUploader.tsx';

export function ModeratorDashboard({
  onExitAdmin,
  onPreviewFile,
}: {
  onExitAdmin: () => void;
  onPreviewFile: (file: LectureFile) => void;
}) {
  const { firebaseUser, profile, hasPerm, logout } = useAuth();
  const { lectureFiles, specializations, subjects, storageStats } = usePlatformData();
  const [tab, setTab] = useState<'upload' | 'my_files'>('upload');
  const [editingFile, setEditingFile] = useState<LectureFile | null>(null);

  const canUpload = hasPerm('lectures.upload');
  const canEdit = hasPerm('lectures.edit');

  const myUploadedFiles = lectureFiles.filter(
    (f) => f.uploadedBy === firebaseUser?.uid
  );

  return (
    <div className="min-h-screen bg-[#EAF4F7]/65 flex flex-col">
      <header className="bg-[#0B2545] text-white px-5 py-4 flex items-center justify-between gap-4 sticky top-0 z-30">
        <div>
          <p className="font-display text-base sm:text-lg font-bold">
            لوحة مشرف المحتوى — منصة UST
          </p>
          <p className="text-xs text-[#EAF4F7]/75">
            {profile?.displayName || firebaseUser?.displayName} · {firebaseUser?.email}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onExitAdmin}
            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs sm:text-sm font-semibold inline-flex items-center gap-2"
          >
            <ArrowRight className="w-4 h-4" />
            بوابة الطلاب
          </button>
          <button
            type="button"
            onClick={logout}
            className="min-h-[40px] px-3 py-2 rounded-xl bg-[#FF8066]/15 hover:bg-[#FF8066]/25 text-[#FF8066] text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5"
          >
            <LogOut className="w-4 h-4" />
            خروج
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Authorized Capacity Indicator & Tabs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500">ملفاتي المرفوعة</p>
              <p className="font-display text-2xl font-bold text-[#0B2545] tabular-nums">
                {myUploadedFiles.length}
              </p>
            </div>
            <FileText className="w-6 h-6 text-[#00A6A6]" />
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:col-span-2 flex flex-col justify-center space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-[#0B2545]">
              <span className="inline-flex items-center gap-1.5">
                <HardDrive className="w-4 h-4 text-[#00A6A6]" />
                السعة التخزينية المتاحة للرفع
              </span>
              <span className="tabular-nums">
                {storageStats
                  ? `المتبقي ${formatFileSizeArabic(storageStats.remainingBytes)} (${100 - storageStats.usedPct}%)`
                  : 'جاهز للرفع'}
              </span>
            </div>
            {storageStats && (
              <div className="h-2 bg-[#EAF4F7] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    storageStats.usedPct >= 95 ? 'bg-[#FF8066]' : 'bg-[#00A6A6]'
                  }`}
                  style={{ width: `${Math.max(3, storageStats.usedPct)}%` }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          {canUpload && (
            <button
              type="button"
              onClick={() => {
                setEditingFile(null);
                setTab('upload');
              }}
              className={`min-h-[42px] px-4 py-2 rounded-xl text-sm font-semibold inline-flex items-center gap-2 ${
                tab === 'upload'
                  ? 'bg-[#00A6A6] text-white'
                  : 'bg-white border border-slate-200 text-[#0B2545]'
              }`}
            >
              <Upload className="w-4 h-4" />
              رفع محاضرة جديدة
            </button>
          )}
          <button
            type="button"
            onClick={() => setTab('my_files')}
            className={`min-h-[42px] px-4 py-2 rounded-xl text-sm font-semibold inline-flex items-center gap-2 ${
              tab === 'my_files'
                ? 'bg-[#00A6A6] text-white'
                : 'bg-white border border-slate-200 text-[#0B2545]'
            }`}
          >
            <FileText className="w-4 h-4" />
            سجل الرفع الشخصي ({myUploadedFiles.length})
          </button>
        </div>

        {tab === 'upload' && canUpload && (
          <AdminFileUploader
            editingFile={editingFile}
            onSuccess={() => {
              setEditingFile(null);
              setTab('my_files');
            }}
            onCancelEdit={() => {
              setEditingFile(null);
              setTab('my_files');
            }}
          />
        )}

        {tab === 'my_files' && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-[#EAF4F7]/70 text-xs font-semibold text-[#0B2545]">
                <tr>
                  <th className="p-3.5">العنوان / الملف</th>
                  <th className="p-3.5">التخصص والمادة</th>
                  <th className="p-3.5">التصنيف والحجم</th>
                  <th className="p-3.5">الحالة</th>
                  <th className="p-3.5">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {myUploadedFiles.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-sm text-slate-500">
                      لم تقم برفع أي ملفات محاضرات حتى الآن.
                    </td>
                  </tr>
                ) : (
                  myUploadedFiles.map((file) => {
                    const spec = specializations.find((s) => s.id === file.specializationId);
                    const sub = subjects.find((s) => s.id === file.subjectId);
                    return (
                      <tr key={file.id} className="hover:bg-slate-50/70">
                        <td className="p-3.5">
                          <p className="font-bold text-[#0B2545]">{file.title}</p>
                          <p className="text-xs text-slate-500 font-mono">{file.originalName}</p>
                        </td>
                        <td className="p-3.5 text-xs text-slate-600">
                          {spec?.name} / {sub?.name}
                        </td>
                        <td className="p-3.5 text-xs text-slate-600">
                          <p>{getCategoryLabel(file.category)}</p>
                          <p className="tabular-nums text-slate-400">
                            {formatFileSizeArabic(file.fileSize)}
                          </p>
                        </td>
                        <td className="p-3.5 text-xs font-semibold">
                          <span className={file.status === 'published' ? 'text-[#00A6A6]' : 'text-slate-500'}>
                            {file.status === 'published' ? 'منشور' : 'مسودة'}
                          </span>
                        </td>
                        <td className="p-3.5">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onPreviewFile(file)}
                              className="min-h-[34px] min-w-[34px] rounded-lg border border-slate-200 flex items-center justify-center text-[#0B2545]"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingFile(file);
                                  setTab('upload');
                                }}
                                className="min-h-[34px] min-w-[34px] rounded-lg border border-slate-200 flex items-center justify-center text-[#0B2545]"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
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
        )}
      </main>
    </div>
  );
}
