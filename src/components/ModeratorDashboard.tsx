import React, { useState } from 'react';
import {
  ArrowRight,
  Cloud,
  ExternalLink,
  Eye,
  FileText,
  Lock,
  LogOut,
  Search,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import { LectureFile } from '../types/academic.ts';
import {
  formatFileSizeArabic,
  getCategoryLabel,
  isGoogleDriveFile,
} from '../utils/academicLogic.ts';
import { SUPER_ADMIN_UPLOAD_ONLY_AR } from '../utils/scopedAdminLogic.ts';

export function ModeratorDashboard({
  onExitAdmin,
  onPreviewFile,
}: {
  onExitAdmin: () => void;
  onPreviewFile: (file: LectureFile) => void;
}) {
  const { firebaseUser, profile, logout } = useAuth();
  const { lectureFiles, specializations, subjects } = usePlatformData();
  const [searchQuery, setSearchQuery] = useState('');

  const visibleFiles = lectureFiles.filter((f) => {
    if (f.lifecycleStatus === 'trashed') return false;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      f.title.toLowerCase().includes(q) ||
      f.originalName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-clip bg-[#EAF4F7]/65 flex flex-col">
      <header className="bg-[#0B2545] text-white px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-30">
        <div className="min-w-0">
          <p className="font-display text-base sm:text-lg font-bold truncate">
            لوحة مشرف المحتوى — منصة UST (عرض فقط)
          </p>
          <p className="text-xs text-[#EAF4F7]/75 truncate">
            {profile?.displayName || firebaseUser?.displayName} · {firebaseUser?.email}
          </p>
        </div>
        <div className="flex items-center flex-wrap gap-2 shrink-0">
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

      <main className="flex-1 max-w-5xl w-full min-w-0 mx-auto p-3 sm:p-6 space-y-6">
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
          <Lock className="w-5 h-5 text-[#FF8066] shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 space-y-1">
            <p className="font-bold">{SUPER_ADMIN_UPLOAD_ONLY_AR}</p>
            <p>
              تم تقييد صلاحيات الرفع وتعديل وحذف الملفات لتكون حصرية للمدير الرئيسي (Super Admin) فقط. يمكنك مراجعة بيانات المحاضرات المنشورة هنا.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#EAF4F7] text-[#0B2545] flex items-center justify-center">
              <FileText className="w-5 h-5 text-[#00A6A6]" />
            </div>
            <div>
              <p className="text-xs text-slate-500">المحاضرات المتاحة للمراجعة</p>
              <p className="font-display text-xl font-bold text-[#0B2545] tabular-nums">
                {visibleFiles.length}
              </p>
            </div>
          </div>

          <div className="relative flex-1 sm:max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث في المحاضرات..."
              className="w-full min-h-[40px] pr-9 pl-3 rounded-xl border border-slate-200 text-sm"
            />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-[#EAF4F7]/70 text-xs font-semibold text-[#0B2545]">
              <tr>
                <th className="p-3.5">العنوان / الملف</th>
                <th className="p-3.5">التخصص والمادة</th>
                <th className="p-3.5">التصنيف والحجم</th>
                <th className="p-3.5">الحالة</th>
                <th className="p-3.5">معاينة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleFiles.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-sm text-slate-500">
                    لا توجد محاضرات مطابقة لبحثك.
                  </td>
                </tr>
              ) : (
                visibleFiles.map((file) => {
                  const spec = specializations.find((s) => s.id === file.specializationId);
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
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
