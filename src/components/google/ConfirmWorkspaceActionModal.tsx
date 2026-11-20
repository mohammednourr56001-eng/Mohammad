import React from 'react';
import { AlertTriangle, Loader2, ShieldCheck, X } from 'lucide-react';

export interface ConfirmWorkspaceActionModalProps {
  open: boolean;
  title: string;
  description: string;
  details?: Array<{ label: string; value: string }>;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}

export function ConfirmWorkspaceActionModal({
  open,
  title,
  description,
  details = [],
  confirmLabel = 'تأكيد وتنفيذ الإجراء',
  cancelLabel = 'إلغاء',
  busy = false,
  danger = false,
  onCancel,
  onConfirm,
}: ConfirmWorkspaceActionModalProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-confirm-title"
      className="fixed inset-0 z-50 bg-[#0B2545]/60 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-4 bg-[#EAF4F7] border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                danger ? 'bg-[#FF8066]/20 text-[#b8442c]' : 'bg-[#00A6A6]/15 text-[#00A6A6]'
              }`}
            >
              {danger ? (
                <AlertTriangle className="w-5 h-5" />
              ) : (
                <ShieldCheck className="w-5 h-5" />
              )}
            </div>
            <h3
              id="workspace-confirm-title"
              className="font-display text-base font-bold text-[#0B2545] truncate"
            >
              {title}
            </h3>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            aria-label="إغلاق نافذة التأكيد"
            className="min-h-[36px] min-w-[36px] rounded-xl text-slate-500 hover:bg-white flex items-center justify-center disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-700 leading-relaxed">{description}</p>

          {details.length > 0 && (
            <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3.5 space-y-2 text-xs">
              {details.map((row) => (
                <div key={row.label} className="flex items-start justify-between gap-3">
                  <span className="text-slate-500 font-semibold shrink-0">{row.label}:</span>
                  <span className="text-[#0B2545] font-bold text-left break-all">
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          )}

          <p className="text-[11px] text-slate-500">
            لن يتم تنفيذ أي تعديل أو إرسال عبر حسابك في Google إلا بعد الضغط على زر التأكيد أعلاه.
          </p>
        </div>

        <footer className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-[40px] px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-xs sm:text-sm font-semibold text-slate-600 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!busy) void onConfirm();
            }}
            className={`min-h-[40px] px-5 py-2 rounded-xl text-white text-xs sm:text-sm font-bold inline-flex items-center gap-2 transition-colors disabled:opacity-60 ${
              danger
                ? 'bg-[#FF8066] hover:bg-[#e56d54]'
                : 'bg-[#00A6A6] hover:bg-[#008e8e]'
            }`}
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {busy ? 'جاري التنفيذ...' : confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
