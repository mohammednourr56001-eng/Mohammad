import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, FileCheck2, Lock, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';

type LegalTab = 'login' | 'terms' | 'privacy';

export function LoginModal() {
  const { loginModalOpen, closeLoginModal, signInWithGoogle, authLoading, authError } = useAuth();
  const [view, setView] = useState<LegalTab>('login');

  if (!loginModalOpen) return null;

  const handleClose = () => {
    setView('login');
    closeLoginModal();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ust-login-title"
      className="fixed inset-0 z-50 bg-[#0B2545]/60 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-3xl border border-slate-200 max-w-md w-full overflow-hidden shadow-2xl">
        {/* Top Navy Accent Strip */}
        <div className="bg-[#0B2545] text-white px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* UST Emblem SVG */}
            <div className="w-11 h-11 rounded-2xl bg-[#00A6A6]/20 border border-[#00A6A6]/40 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 36 36" className="w-6 h-6 text-[#00A6A6]" fill="none" aria-hidden="true">
                <path
                  d="M6 12L18 6L30 12L18 18L6 12Z"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinejoin="round"
                />
                <path
                  d="M10 15V23.5C10 26 13.6 28.5 18 28.5C22.4 28.5 26 26 26 23.5V15"
                  stroke="#FFFFFF"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div>
              <h2 id="ust-login-title" className="font-display text-lg font-bold">
                منصة UST للمحاضرات
              </h2>
              <p className="text-xs text-[#EAF4F7]/75">جامعة العلوم والتقنية · البوابة الأكاديمية</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            aria-label="إغلاق نافذة تسجيل الدخول"
            className="min-h-[38px] min-w-[38px] rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {view === 'login' && (
            <>
              <div className="space-y-2 text-center">
                <h3 className="font-display text-xl font-bold text-[#0B2545]">
                  مرحباً بك في منصتك الأكاديمية
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  سجّل الدخول عبر حساب Google للوصول إلى مفضلة المحاضرات، حفظ تخصصك وسنتك الدراسية، واستلام تنبيهات المقررات الجديدة.
                </p>
              </div>

              <div className="bg-[#EAF4F7]/70 rounded-2xl p-4 space-y-2 text-xs text-[#0B2545]">
                <div className="flex items-center gap-2 font-semibold">
                  <ShieldCheck className="w-4 h-4 text-[#00A6A6] shrink-0" />
                  <span>تسجيل دخول آمن ومعتمد عبر Google OAuth 2.0</span>
                </div>
                <p className="text-slate-600 leading-relaxed pr-6">
                  تُنشأ جميع الحسابات الجديدة تلقائياً بصلاحية <span className="font-semibold text-[#0B2545]">طالب</span>، ولا تُمنح الصلاحيات الإدارية إلا باعتماد مالك المنصة.
                </p>
              </div>

              {authError && (
                <div
                  role="alert"
                  className="rounded-xl bg-[#FF8066]/10 border border-[#FF8066]/30 px-4 py-3 text-xs font-medium text-[#0B2545]"
                >
                  {authError}
                </div>
              )}

              {/* Official Google Sign-In Button */}
              <button
                type="button"
                onClick={signInWithGoogle}
                disabled={authLoading}
                className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-white hover:bg-slate-50 border-2 border-slate-200 hover:border-[#00A6A6] text-[#0B2545] text-sm font-bold flex items-center justify-center gap-3 shadow-xs transition-all disabled:opacity-60"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.3 0 6.08-1.09 8.105-2.96l-3.88-3.05c-1.1.74-2.51 1.18-4.225 1.18-3.25 0-6.01-2.19-6.995-5.14H1.01v3.14C3.02 21.15 7.185 24 12 24Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.005 14.03A7.2 7.2 0 0 1 4.62 12c0-.7.13-1.38.385-2.03V6.83H1.01A11.98 11.98 0 0 0 0 12c0 1.94.465 3.77 1.01 5.17l3.995-3.14Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.8 0 3.41.62 4.685 1.835l3.51-3.51C18.075 1.19 15.3 0 12 0 7.185 0 3.02 2.85 1.01 6.83l3.995 3.14C5.99 6.94 8.75 4.75 12 4.75Z"
                  />
                </svg>
                <span>{authLoading ? 'جاري التحقق عبر Google...' : 'المتابعة باستخدام Google'}</span>
              </button>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-center gap-4 text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => setView('terms')}
                  className="hover:text-[#00A6A6] underline underline-offset-4"
                >
                  شروط الاستخدام
                </button>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => setView('privacy')}
                  className="hover:text-[#00A6A6] underline underline-offset-4"
                >
                  سياسة الخصوصية
                </button>
              </div>
            </>
          )}

          {view === 'terms' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-bold text-[#0B2545] flex items-center gap-2">
                  <FileCheck2 className="w-5 h-5 text-[#00A6A6]" />
                  شروط الاستخدام — منصة UST للمحاضرات
                </h3>
                <button
                  type="button"
                  onClick={() => setView('login')}
                  className="text-xs font-semibold text-[#00A6A6] inline-flex items-center gap-1"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  رجوع
                </button>
              </div>
              <div className="bg-[#EAF4F7]/50 rounded-2xl p-4 text-xs text-slate-700 leading-relaxed space-y-2.5 max-h-64 overflow-y-auto">
                <p>1. المنصة مخصصة للاستخدام الأكاديمي لطلبة وأعضاء هيئة التدريس في جامعة العلوم والتقنية (UST).</p>
                <p>2. تُحترم حقوق الملكية الفكرية للمحاضرات والملخصات، ويخضع تحميل الملفات لتصاريح النشر المحددة من إدارة المنصة.</p>
                <p>3. يُمنع استخدام أي وسيلة تقنية لمحاولة تجاوز صلاحيات الوصول أو رفع ملفات غير مصرح بها.</p>
                <p>4. تحتفظ إدارة المنصة بحق تعليق أي حساب يسيء استخدام الموارد الأكاديمية أو ينتهك سياسات الاستخدام.</p>
              </div>
              <button
                type="button"
                onClick={() => setView('login')}
                className="w-full min-h-[42px] rounded-xl bg-[#0B2545] text-white text-sm font-semibold"
              >
                العودة لتسجيل الدخول
              </button>
            </div>
          )}

          {view === 'privacy' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-bold text-[#0B2545] flex items-center gap-2">
                  <Lock className="w-5 h-5 text-[#00A6A6]" />
                  سياسة الخصوصية وحماية البيانات
                </h3>
                <button
                  type="button"
                  onClick={() => setView('login')}
                  className="text-xs font-semibold text-[#00A6A6] inline-flex items-center gap-1"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  رجوع
                </button>
              </div>
              <div className="bg-[#EAF4F7]/50 rounded-2xl p-4 text-xs text-slate-700 leading-relaxed space-y-2.5 max-h-64 overflow-y-auto">
                <p className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#00A6A6] shrink-0 mt-0.5" />
                  <span>تستقبل المنصة من Google البيانات الأساسية الموثقة فقط: الاسم، البريد الإلكتروني، الصورة الشخصية، والمعرف الفريد (Google ID).</span>
                </p>
                <p className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#00A6A6] shrink-0 mt-0.5" />
                  <span>تُستخدم هذه البيانات لتخصيص تجربتك الأكاديمية (المفضلة، التخصص المفضل) وتأمين الدخول دون تخزين كلمات مرور محلية.</span>
                </p>
                <p className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#00A6A6] shrink-0 mt-0.5" />
                  <span>جميع الإجراءات الإدارية مسجلة في سجل تدقيق غير قابل للتعديل لضمان الشفافية والأمان.</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setView('login')}
                className="w-full min-h-[42px] rounded-xl bg-[#0B2545] text-white text-sm font-semibold"
              >
                العودة لتسجيل الدخول
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
