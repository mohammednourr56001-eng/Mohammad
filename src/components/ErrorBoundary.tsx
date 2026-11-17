import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let readableMessage = error.message || 'حدث خطأ غير متوقع في المنصة.';
    try {
      const parsed = JSON.parse(error.message);
      if (parsed?.error) {
        readableMessage = parsed.error.includes('Missing or insufficient permissions')
          ? 'ليس لديك صلاحية تنفيذ هذا الإجراء في قاعدة البيانات.'
          : parsed.error;
      }
    } catch {
      // keep original message
    }
    return { hasError: true, message: readableMessage };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          className="min-h-screen bg-[#EAF4F7] flex items-center justify-center p-6"
        >
          <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-sm">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[#FF8066]/15 text-[#FF8066] flex items-center justify-center">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h1 className="font-display text-xl font-bold text-[#0B2545] mb-2">
              تعذر إتمام العملية
            </h1>
            <p className="text-sm text-slate-600 mb-6 leading-relaxed">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#00A6A6] text-white text-sm font-semibold hover:bg-[#008e8e] transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              إعادة تحميل المنصة
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
