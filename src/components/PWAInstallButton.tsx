import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        aria-label="تثبيت تطبيق UST على الجهاز"
        className={
          compact
            ? 'min-h-[38px] px-2.5 py-1.5 rounded-xl bg-[#EAF4F7] hover:bg-[#d8ecf2] text-[#0B2545] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0'
            : 'min-h-[42px] px-4 py-2 rounded-xl bg-[#0B2545] hover:bg-[#133866] text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0'
        }
      >
        <Download className="w-4 h-4 text-[#00A6A6]" />
        <span>تثبيت التطبيق</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          aria-label="تثبيت التطبيق على iPhone و iPad"
          className={
            compact
              ? 'min-h-[38px] px-2.5 py-1.5 rounded-xl bg-[#EAF4F7] hover:bg-[#d8ecf2] text-[#0B2545] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0'
              : 'min-h-[42px] px-4 py-2 rounded-xl border border-slate-200 hover:border-[#00A6A6] text-[#0B2545] text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0'
          }
        >
          <Smartphone className="w-4 h-4 text-[#00A6A6]" />
          <span>تثبيت على iOS</span>
        </button>

        {showIOSGuide && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="تثبيت منصة UST على iPhone أو iPad"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
            onClick={() => setShowIOSGuide(false)}
          >
            <div
              className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 p-6 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-base font-bold text-[#0B2545]">
                  تثبيت منصة UST على جهازك
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="إغلاق نافذة التثبيت"
                  className="min-h-[36px] min-w-[36px] rounded-xl bg-slate-100 text-[#0B2545] flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="text-sm text-slate-600 space-y-2 list-decimal pr-4 leading-relaxed">
                <li>
                  اضغط على زر <strong>المشاركة (Share)</strong> في شريط متصفح Safari.
                </li>
                <li>
                  مرّر للأسفل واختر <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong>.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-[42px] rounded-xl bg-[#00A6A6] text-white text-sm font-semibold hover:bg-[#008e8e] transition-colors"
              >
                حسناً
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
