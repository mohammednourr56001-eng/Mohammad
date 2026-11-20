import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  FolderOpen,
  GraduationCap,
  Loader2,
  Mail,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import {
  GoogleServiceKey,
  GoogleServiceVerificationResult,
} from '../../types/googleEcosystem.ts';
import {
  evaluateServiceConnectionStatus,
  GOOGLE_SERVICES_CATALOG,
} from '../../utils/googleEcosystemLogic.ts';
import {
  verifyAllGoogleServices,
  verifySingleGoogleService,
} from '../../utils/googleServiceVerifier.ts';
import { GmailPanel } from './GmailPanel.tsx';
import { GoogleCalendarPanel } from './GoogleCalendarPanel.tsx';
import { GoogleClassroomPanel } from './GoogleClassroomPanel.tsx';
import { GoogleFormsPanel } from './GoogleFormsPanel.tsx';
import { GooglePickerPanel } from './GooglePickerPanel.tsx';
import { GoogleSheetsPanel } from './GoogleSheetsPanel.tsx';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';

function ServiceIcon({ serviceKey }: { serviceKey: GoogleServiceKey }) {
  switch (serviceKey) {
    case 'picker':
      return <FolderOpen className="w-5 h-5" />;
    case 'sheets':
      return <FileSpreadsheet className="w-5 h-5" />;
    case 'forms':
      return <ClipboardList className="w-5 h-5" />;
    case 'calendar':
      return <CalendarIcon className="w-5 h-5" />;
    case 'gmail':
      return <Mail className="w-5 h-5" />;
    case 'classroom':
      return <GraduationCap className="w-5 h-5" />;
  }
}

export function GoogleServicesDashboard({
  initialService = 'picker',
}: {
  initialService?: GoogleServiceKey;
}) {
  const {
    firebaseUser,
    workspaceAccessToken,
    workspaceGrantedScopes,
    connectGoogleWorkspace,
    disconnectGoogleWorkspace,
    getIdToken,
    authLoading,
  } = useAuth();

  const [activeService, setActiveService] = useState<GoogleServiceKey>(initialService);
  const [selectedSpreadsheetId, setSelectedSpreadsheetId] = useState<string | undefined>(undefined);
  const [verifications, setVerifications] = useState<
    Partial<Record<GoogleServiceKey, GoogleServiceVerificationResult>>
  >({});
  const [verifyingAll, setVerifyingAll] = useState(false);
  const [checkingKey, setCheckingKey] = useState<GoogleServiceKey | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState<string | undefined>(undefined);

  const runFullVerification = useCallback(
    async (token: string | null) => {
      if (!token) {
        const disconnected = Object.fromEntries(
          GOOGLE_SERVICES_CATALOG.map((svc) => [
            svc.key,
            evaluateServiceConnectionStatus({ serviceKey: svc.key, hasToken: false }),
          ])
        ) as Record<GoogleServiceKey, GoogleServiceVerificationResult>;
        setVerifications(disconnected);
        setVerifiedEmail(undefined);
        return;
      }

      setVerifyingAll(true);
      try {
        // Verify token server-side when Firebase user is logged in (without storing token)
        let resolvedEmail: string | undefined;
        if (firebaseUser) {
          const idToken = await getIdToken();
          if (idToken) {
            const verifyRes = await fetch('/api/google/verify-token', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`,
              },
              body: JSON.stringify({ workspaceAccessToken: token }),
            }).catch(() => null);
            if (verifyRes && verifyRes.ok) {
              const info = (await verifyRes.json()) as { email?: string };
              if (info.email) resolvedEmail = info.email;
            }
          }
        }

        const results = await verifyAllGoogleServices({
          accessToken: token,
          accountEmail: resolvedEmail || firebaseUser?.email || undefined,
        });
        setVerifications(results);
        const gmailEmail = results.gmail?.accountEmail || resolvedEmail;
        if (gmailEmail) setVerifiedEmail(gmailEmail);
      } finally {
        setVerifyingAll(false);
      }
    },
    [firebaseUser, getIdToken]
  );

  useEffect(() => {
    void runFullVerification(workspaceAccessToken);
  }, [workspaceAccessToken, runFullVerification]);

  const handleConnectAndVerify = async (key?: GoogleServiceKey) => {
    if (key) setActiveService(key);
    const token = await connectGoogleWorkspace();
    if (token && key) {
      setCheckingKey(key);
      try {
        const res = await verifySingleGoogleService({
          serviceKey: key,
          accessToken: token,
          accountEmail: firebaseUser?.email || undefined,
        });
        setVerifications((prev) => ({ ...prev, [key]: res }));
      } finally {
        setCheckingKey(null);
      }
    }
  };

  const handleDisconnectAll = async () => {
    await disconnectGoogleWorkspace();
    setVerifiedEmail(undefined);
    await runFullVerification(null);
  };

  const renderStatusBadge = (res?: GoogleServiceVerificationResult) => {
    const status = res?.status || 'disconnected';
    if (!workspaceAccessToken || status === 'disconnected') {
      return (
        <span className="px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-semibold">
          غير متصل
        </span>
      );
    }
    if (status === 'connected') {
      return (
        <span className="px-2.5 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 text-[11px] font-bold inline-flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" />
          متصل وموثق
        </span>
      );
    }
    if (status === 'api_disabled') {
      return (
        <span className="px-2.5 py-0.5 rounded-lg bg-amber-50 text-amber-800 text-[11px] font-bold inline-flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          يتطلب تفعيل API
        </span>
      );
    }
    if (status === 'permission_denied') {
      return (
        <span className="px-2.5 py-0.5 rounded-lg bg-[#FF8066]/15 text-[#b8442c] text-[11px] font-bold">
          صلاحية مفقودة
        </span>
      );
    }
    return (
      <span className="px-2.5 py-0.5 rounded-lg bg-[#FF8066]/15 text-[#b8442c] text-[11px] font-bold">
        تعذر التحقق
      </span>
    );
  };

  const connectedCount = GOOGLE_SERVICES_CATALOG.filter(
    (s) => workspaceAccessToken && verifications[s.key]?.status === 'connected'
  ).length;

  return (
    <div className="space-y-6 pb-8">
      {/* Header Status Banner */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-xl sm:text-2xl font-bold text-[#0B2545]">
                خدمات Google المتكاملة
              </h1>
              <span className="px-2.5 py-0.5 rounded-lg bg-[#EAF4F7] text-[#00A6A6] text-xs font-bold inline-flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                تشغيل مجاني 100%
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-2xl">
              منصة موحدة للوصول إلى Google Picker وSheets وForms وCalendar وGmail وClassroom داخل UST. يتم فحص حالة كل خدمة فعلياً ولا تُعرض كمتصلة إلا بعد التحقق الحي.
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap shrink-0">
            {!workspaceAccessToken ? (
              <GoogleSignInButton
                onClick={() => void handleConnectAndVerify()}
                loading={authLoading}
                label="Sign in with Google · ربط الخدمات"
              />
            ) : (
              <>
                <button
                  type="button"
                  disabled={verifyingAll}
                  onClick={() => void runFullVerification(workspaceAccessToken)}
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-[#EAF4F7] hover:bg-[#d8ecf2] text-[#0B2545] text-xs sm:text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60"
                >
                  <RefreshCw className={`w-4 h-4 text-[#00A6A6] ${verifyingAll ? 'animate-spin' : ''}`} />
                  فحص حي للخدمات ({connectedCount}/6)
                </button>
                <button
                  type="button"
                  onClick={() => void handleDisconnectAll()}
                  className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-200 hover:border-[#FF8066] text-[#0B2545] hover:text-[#b8442c] text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors"
                >
                  <Unplug className="w-4 h-4" />
                  فصل الاتصال وإلغاء الرمز
                </button>
              </>
            )}
          </div>
        </div>

        {/* Live Account Verification Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-2 border-t border-slate-100">
          <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3">
            <p className="text-slate-500">حالة التفويض (OAuth في الذاكرة فقط)</p>
            <p className="font-bold text-[#0B2545] mt-1">
              {workspaceAccessToken
                ? verifiedEmail
                  ? `متصل: ${verifiedEmail}`
                  : 'جلسة تفويض نشطة (قيد الفحص)'
                : 'غير مرتبط — يتطلب موافقة المستخدم'}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3">
            <p className="text-slate-500">الخدمات الموثقة فعلياً</p>
            <p className="font-bold text-[#0B2545] mt-1 tabular-nums">
              {workspaceAccessToken ? `${connectedCount} من أصل 6 خدمات` : '0 من أصل 6 خدمات'}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3">
            <p className="text-slate-500">النطاقات الممنوحة في الجلسة</p>
            <p className="font-bold text-[#0B2545] mt-1 tabular-nums">
              {workspaceAccessToken
                ? `${workspaceGrantedScopes.length} نطاق صلاحية مصرح`
                : 'لا توجد نطاقات نشطة'}
            </p>
          </div>
        </div>
      </section>

      {/* 6 Service Cards Grid */}
      <section aria-label="بطاقات خدمات Google الست" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {GOOGLE_SERVICES_CATALOG.map((svc) => {
          const verification = verifications[svc.key];
          const isSelected = activeService === svc.key;
          const isConnected = workspaceAccessToken && verification?.status === 'connected';
          const isBusy = verifyingAll || checkingKey === svc.key;

          return (
            <article
              key={svc.key}
              className={`rounded-2xl border bg-white p-5 flex flex-col justify-between gap-4 transition-all ${
                isSelected
                  ? 'border-[#00A6A6] ring-2 ring-[#00A6A6]/15 shadow-xs'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        isConnected
                          ? 'bg-[#00A6A6] text-white'
                          : 'bg-[#EAF4F7] text-[#0B2545]'
                      }`}
                    >
                      <ServiceIcon serviceKey={svc.key} />
                    </div>
                    <div className="min-w-0">
                      <h2 className="font-display text-base font-bold text-[#0B2545] truncate">
                        {svc.nameAr}
                      </h2>
                      <p className="text-[11px] text-slate-500">{svc.zeroCostNote}</p>
                    </div>
                  </div>
                  {isBusy ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#00A6A6] font-semibold">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      فحص...
                    </span>
                  ) : (
                    renderStatusBadge(verification)
                  )}
                </div>

                <p className="text-xs text-slate-600 leading-relaxed">{svc.shortDescription}</p>

                <div className="rounded-xl bg-slate-50 border border-slate-200/70 px-3 py-2 text-[11px] text-slate-600">
                  <span className="font-bold text-[#0B2545]">الصلاحية المطلوبة: </span>
                  {svc.permissionSummaryAr}
                </div>

                {verification &&
                  workspaceAccessToken &&
                  verification.status !== 'connected' &&
                  verification.errorMessage && (
                    <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-900 space-y-1">
                      <p className="font-bold">تفاصيل الحالة:</p>
                      <p className="break-words">{verification.errorMessage}</p>
                      {verification.manualSetupHint && (
                        <p className="text-amber-800">{verification.manualSetupHint}</p>
                      )}
                    </div>
                  )}
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setActiveService(svc.key)}
                  className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                    isSelected
                      ? 'bg-[#0B2545] text-white'
                      : 'bg-[#EAF4F7] hover:bg-[#0B2545] text-[#0B2545] hover:text-white'
                  }`}
                >
                  {isSelected ? 'الخدمة المفتوحة' : 'فتح الخدمة'}
                </button>

                {!workspaceAccessToken ? (
                  <button
                    type="button"
                    disabled={authLoading}
                    onClick={() => void handleConnectAndVerify(svc.key)}
                    className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs font-semibold disabled:opacity-60"
                  >
                    ربط
                  </button>
                ) : isConnected ? (
                  <button
                    type="button"
                    onClick={() => void handleDisconnectAll()}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 hover:border-[#FF8066] text-slate-600 hover:text-[#b8442c] text-xs font-semibold"
                  >
                    فصل
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleConnectAndVerify(svc.key)}
                    className="min-h-[38px] px-3.5 py-1.5 rounded-xl border border-[#00A6A6] text-[#00A6A6] hover:bg-[#EAF4F7] text-xs font-semibold disabled:opacity-60"
                  >
                    إعادة الربط
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </section>

      {/* Active Service Interactive Workspace */}
      <section aria-label="مساحة عمل الخدمة المختارة">
        {activeService === 'picker' && (
          <GooglePickerPanel
            onSelectForSheets={(spreadsheetId) => {
              setSelectedSpreadsheetId(spreadsheetId);
              setActiveService('sheets');
            }}
          />
        )}
        {activeService === 'sheets' && (
          <GoogleSheetsPanel initialSpreadsheetId={selectedSpreadsheetId} />
        )}
        {activeService === 'forms' && <GoogleFormsPanel />}
        {activeService === 'calendar' && <GoogleCalendarPanel />}
        {activeService === 'gmail' && <GmailPanel />}
        {activeService === 'classroom' && <GoogleClassroomPanel />}
      </section>
    </div>
  );
}
