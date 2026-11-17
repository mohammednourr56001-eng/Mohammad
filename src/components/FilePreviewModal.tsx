import React, { useEffect, useState } from 'react';
import { Download, ExternalLink, FileText, Lock, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { LectureFile } from '../types/academic.ts';
import {
  canDownloadFile,
  canPreviewInApp,
  formatFileSizeArabic,
  getCategoryLabel,
} from '../utils/academicLogic.ts';

export function FilePreviewModal({
  file,
  onClose,
}: {
  file: LectureFile | null;
  onClose: () => void;
}) {
  const { isAdmin, getIdToken } = useAuth();
  const [token, setToken] = useState<string>('');
  const [extractedLines, setExtractedLines] = useState<string[] | null>(null);
  const [viewMode, setViewMode] = useState<'pdf' | 'reader'>(() => {
    if (typeof navigator !== 'undefined' && navigator.pdfViewerEnabled === false) {
      return 'reader';
    }
    return 'pdf';
  });

  useEffect(() => {
    let active = true;
    setExtractedLines(null);
    if (file) {
      const supportsNativePdf =
        typeof navigator !== 'undefined' && navigator.pdfViewerEnabled !== false;
      setViewMode(supportsNativePdf ? 'pdf' : 'reader');

      getIdToken()
        .then((t) => {
          if (active && t) setToken(t);
          if (file.fileExt.toLowerCase() === 'pdf') {
            const q = t ? `?token=${encodeURIComponent(t)}` : '';
            fetch(`/api/files/extract/${encodeURIComponent(file.id)}${q}`)
              .then((res) => (res.ok ? res.json() : null))
              .then((data) => {
                if (active && data?.lines) {
                  setExtractedLines(data.lines);
                }
              })
              .catch(() => {});
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [file, getIdToken]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (file) {
      window.addEventListener('keydown', onKeyDown);
    }
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [file, onClose]);

  if (!file) return null;

  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
  const viewUrl = `/api/files/view/${encodeURIComponent(file.id)}${tokenQuery}`;
  const downloadUrl = `/api/files/download/${encodeURIComponent(file.id)}${tokenQuery}`;
  const isImage = ['jpg', 'jpeg', 'png', 'webp'].includes(file.fileExt.toLowerCase());
  const isPdf = file.fileExt.toLowerCase() === 'pdf';
  const previewable = canPreviewInApp(file.fileExt, file.mimeType);
  const downloadable = canDownloadFile(file, isAdmin);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`معاينة الملف: ${file.title}`}
      className="fixed inset-0 z-50 bg-[#0B2545]/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl h-[88vh] bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 bg-[#0B2545] text-white shrink-0">
          <div className="min-w-0">
            <h2 className="font-display text-base sm:text-lg font-bold truncate">
              {file.title}
            </h2>
            <p className="text-xs text-white/75 mt-0.5 flex items-center gap-2 flex-wrap">
              <span>{getCategoryLabel(file.category)}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums uppercase">{file.fileExt}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{formatFileSizeArabic(file.fileSize)}</span>
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isPdf && (
              <div className="flex items-center gap-1 p-1 bg-white/10 rounded-xl">
                <button
                  type="button"
                  onClick={() => setViewMode('pdf')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    viewMode === 'pdf'
                      ? 'bg-[#00A6A6] text-white'
                      : 'text-white/80 hover:text-white'
                  }`}
                >
                  عارض PDF
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('reader')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    viewMode === 'reader'
                      ? 'bg-[#00A6A6] text-white'
                      : 'text-white/80 hover:text-white'
                  }`}
                >
                  القارئ السريع
                </button>
              </div>
            )}

            {downloadable ? (
              <a
                href={downloadUrl}
                download={file.originalName}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-4 h-4" />
                تحميل الملف
              </a>
            ) : (
              <span className="text-xs text-white/75 inline-flex items-center gap-1.5 px-3 py-1.5">
                <Lock className="w-3.5 h-3.5 text-[#FF8066]" />
                للمعاينة فقط
              </span>
            )}
            <a
              href={viewUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="فتح في نافذة مستقلة"
              className="min-h-[40px] min-w-[40px] rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق المعاينة"
              className="min-h-[40px] min-w-[40px] rounded-xl bg-white/10 hover:bg-[#FF8066] text-white flex items-center justify-center transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 bg-[#EAF4F7] overflow-y-auto flex items-center justify-center">
          {previewable ? (
            isImage ? (
              <img
                src={viewUrl}
                alt={file.title}
                referrerPolicy="no-referrer"
                className="max-w-full max-h-full object-contain p-4"
              />
            ) : viewMode === 'pdf' ? (
              <iframe
                src={viewUrl}
                title={file.title}
                className="w-full h-full border-0 bg-white"
              />
            ) : (
              <div className="w-full h-full overflow-y-auto p-4 sm:p-8 flex justify-center">
                <article className="max-w-3xl w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-10 space-y-6 my-auto">
                  <div className="border-b border-slate-200 pb-4 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold text-[#00A6A6]">
                        معاينة المستند · {file.originalName}
                      </p>
                      <h3 className="font-display text-xl font-bold text-[#0B2545] mt-1">
                        {file.title}
                      </h3>
                      {file.description && (
                        <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                          {file.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {extractedLines && extractedLines.length > 0 ? (
                    <div dir="ltr" className="space-y-3 text-left font-sans text-sm text-[#0B2545] bg-[#EAF4F7]/50 rounded-xl p-5 border border-slate-200/80">
                      {extractedLines.map((line, idx) => (
                        <p
                          key={idx}
                          className={
                            idx === 0
                              ? 'font-bold text-base text-[#0B2545]'
                              : line.startsWith('---')
                                ? 'text-slate-300 text-xs'
                                : 'leading-relaxed'
                          }
                        >
                          {line}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 space-y-3">
                      <FileText className="w-10 h-10 mx-auto text-[#00A6A6]" />
                      <p className="text-sm text-slate-600">
                        المستند جاهز للعرض أو التحميل كملف PDF كامل.
                      </p>
                      {downloadable && (
                        <a
                          href={downloadUrl}
                          download={file.originalName}
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#00A6A6] text-white text-sm font-semibold"
                        >
                          <Download className="w-4 h-4" />
                          تحميل PDF
                        </a>
                      )}
                    </div>
                  )}
                </article>
              </div>
            )
          ) : (
            <div className="max-w-md text-center p-8 bg-white rounded-2xl border border-slate-200 m-4">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[#EAF4F7] text-[#0B2545] flex items-center justify-center">
                <FileText className="w-7 h-7" />
              </div>
              <h3 className="font-display text-lg font-bold text-[#0B2545] mb-2">
                المعاينة المباشرة غير متاحة لصيغة {file.fileExt.toUpperCase()}
              </h3>
              <p className="text-sm text-slate-600 mb-6">
                يمكنك تحميل الملف مباشرة لفتحه عبر التطبيقات المكتبية على جهازك.
              </p>
              {downloadable && (
                <a
                  href={downloadUrl}
                  download={file.originalName}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#00A6A6] text-white text-sm font-semibold hover:bg-[#008e8e] transition-colors"
                >
                  <Download className="w-4 h-4" />
                  تحميل {file.originalName}
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
