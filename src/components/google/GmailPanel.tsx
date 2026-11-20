import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Inbox,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import {
  getGmailProfile,
  GmailMessageSummary,
  GmailProfileSummary,
  listGmailMessages,
  sendGmailMessage,
} from '../../utils/gmailApi.ts';
import { parseAndValidateRecipients } from '../../utils/googleEcosystemLogic.ts';
import { ConfirmWorkspaceActionModal } from './ConfirmWorkspaceActionModal.tsx';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';

export function GmailPanel() {
  const { workspaceAccessToken, connectGoogleWorkspace, authLoading } = useAuth();

  const [gmailProfile, setGmailProfile] = useState<GmailProfileSummary | null>(null);
  const [messages, setMessages] = useState<GmailMessageSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingInbox, setLoadingInbox] = useState(false);

  // Compose state
  const [toInput, setToInput] = useState('');
  const [subjectInput, setSubjectInput] = useState('');
  const [bodyInput, setBodyInput] = useState('');

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [validatedRecipients, setValidatedRecipients] = useState<string[]>([]);

  const loadInbox = useCallback(async (token: string, q: string) => {
    setLoadingInbox(true);
    setErrorMsg(null);
    try {
      const [profileRes, msgsRes] = await Promise.all([
        getGmailProfile(token),
        listGmailMessages(token, q, 10),
      ]);
      setGmailProfile(profileRes);
      setMessages(msgsRes);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر قراءة صندوق بريد Gmail.');
    } finally {
      setLoadingInbox(false);
    }
  }, []);

  useEffect(() => {
    if (workspaceAccessToken) {
      void loadInbox(workspaceAccessToken, '');
    }
  }, [workspaceAccessToken, loadInbox]);

  const handlePrepareSend = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);

    const recipientsCheck = parseAndValidateRecipients(toInput);
    if (!recipientsCheck.valid) {
      setErrorMsg(recipientsCheck.error || 'عنوان المستلم غير صالح.');
      return;
    }
    if (subjectInput.trim().length < 2) {
      setErrorMsg('يرجى إدخال موضوع واضح للرسالة.');
      return;
    }
    if (bodyInput.trim().length < 2) {
      setErrorMsg('يرجى كتابة نص الرسالة قبل الإرسال.');
      return;
    }

    setValidatedRecipients(recipientsCheck.recipients);
    setConfirmOpen(true);
  };

  const handleConfirmSend = async () => {
    if (!workspaceAccessToken || sending) return;
    setSending(true);
    setErrorMsg(null);
    try {
      const sent = await sendGmailMessage({
        accessToken: workspaceAccessToken,
        to: validatedRecipients.join(', '),
        subject: subjectInput.trim(),
        body: bodyInput.trim(),
      });
      setToInput('');
      setSubjectInput('');
      setBodyInput('');
      setConfirmOpen(false);
      setStatusMsg(`تم إرسال الرسالة بنجاح عبر Gmail (معرف الرسالة: ${sent.id}).`);
      await loadInbox(workspaceAccessToken, searchQuery);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر إرسال الرسالة عبر Gmail.');
      setConfirmOpen(false);
    } finally {
      setSending(false);
    }
  };

  if (!workspaceAccessToken) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="font-display text-lg font-bold text-[#0B2545] flex items-center gap-2">
              <Mail className="w-5 h-5 text-[#00A6A6]" />
              Gmail · الرسائل والإشعارات الأكاديمية
            </h3>
            <p className="text-xs text-slate-600">
              اربط حسابك لعرض آخر الرسائل الواردة وإرسال رسائل أكاديمية بتأكيد صريح قبل الإرسال.
            </p>
          </div>
          <GoogleSignInButton
            onClick={() => void connectGoogleWorkspace()}
            loading={authLoading}
            label="ربط Gmail"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold text-[#0B2545] flex items-center gap-2">
            <Mail className="w-5 h-5 text-[#00A6A6]" />
            Gmail · البريد الأكاديمي
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {gmailProfile
              ? `متصل بالحساب: ${gmailProfile.emailAddress}`
              : 'جاري التحقق من عنوان البريد المتصل...'}
          </p>
        </div>

        <button
          type="button"
          disabled={loadingInbox}
          onClick={() => void loadInbox(workspaceAccessToken, searchQuery)}
          className="min-h-[38px] px-3.5 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-[#0B2545] inline-flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingInbox ? 'animate-spin' : ''}`} />
          تحديث الصندوق
        </button>
      </div>

      {/* Zero-Cost & Test User Notice */}
      <div className="rounded-xl bg-[#EAF4F7]/70 border border-slate-200/80 px-4 py-2.5 text-[11px] text-[#0B2545] flex items-start gap-2">
        <ShieldAlert className="w-4 h-4 text-[#00A6A6] shrink-0 mt-0.5" />
        <span>
          نطاقات القراءة والإرسال تعمل ضمن الحصص المجانية لـ Gmail API دون تخزين رسائلك في قاعدة بيانات المنصة. لا يتم إرسال أي بريد إلا بعد تأكيدك داخل نافذة التأكيد.
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent Messages */}
        <div className="space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void loadInbox(workspaceAccessToken, searchQuery);
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث في رسائل Gmail (مثال: label:inbox)..."
                className="w-full min-h-[40px] pr-9 pl-3 rounded-xl border border-slate-200 text-xs sm:text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={loadingInbox}
              className="min-h-[40px] px-4 rounded-xl bg-[#0B2545] text-white text-xs font-semibold"
            >
              بحث
            </button>
          </form>

          {loadingInbox ? (
            <div className="py-10 text-center text-xs text-slate-500 flex items-center justify-center gap-2 border border-slate-200 rounded-2xl">
              <Loader2 className="w-4 h-4 animate-spin text-[#00A6A6]" />
              جاري جلب ملخص الرسائل...
            </div>
          ) : messages.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 border border-dashed border-slate-300 rounded-2xl space-y-1">
              <Inbox className="w-7 h-7 mx-auto text-[#00A6A6]" />
              <p>لا توجد رسائل مطابقة حالياً.</p>
            </div>
          ) : (
            <div className="border border-slate-200 rounded-2xl divide-y divide-slate-100 max-h-[380px] overflow-y-auto">
              {messages.map((msg) => (
                <div key={msg.id} className="p-3.5 space-y-1 hover:bg-slate-50/70">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-xs sm:text-sm font-bold text-[#0B2545] line-clamp-1">
                      {msg.subject}
                    </h4>
                  </div>
                  <p className="text-[11px] font-semibold text-[#00A6A6] truncate">{msg.from}</p>
                  <p className="text-xs text-slate-600 line-clamp-2">{msg.snippet}</p>
                  {msg.date && (
                    <p className="text-[10px] text-slate-400 font-mono truncate">{msg.date}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Compose & Send Email (Strictly Gated) */}
        <form
          onSubmit={handlePrepareSend}
          className="rounded-2xl bg-[#EAF4F7]/50 border border-slate-200/80 p-4 space-y-3.5"
        >
          <h4 className="font-display text-sm font-bold text-[#0B2545] flex items-center gap-2">
            <Send className="w-4 h-4 text-[#00A6A6]" />
            إنشاء وإرسال رسالة جديدة عبر Gmail
          </h4>

          <div>
            <label htmlFor="gmail-to" className="block text-xs font-semibold text-[#0B2545] mb-1">
              إلى (بريد إلكتروني أو عدة عناوين مفصولة بفاصلة) *
            </label>
            <input
              id="gmail-to"
              type="text"
              dir="ltr"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              placeholder="student@example.com, advisor@example.com"
              className="w-full min-h-[40px] px-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm font-mono text-left"
            />
          </div>

          <div>
            <label htmlFor="gmail-sub" className="block text-xs font-semibold text-[#0B2545] mb-1">
              الموضوع *
            </label>
            <input
              id="gmail-sub"
              type="text"
              value={subjectInput}
              onChange={(e) => setSubjectInput(e.target.value)}
              placeholder="تنبيه حول موعد محاضرة الفسيولوجيا"
              className="w-full min-h-[40px] px-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm"
            />
          </div>

          <div>
            <label htmlFor="gmail-body" className="block text-xs font-semibold text-[#0B2545] mb-1">
              نص الرسالة *
            </label>
            <textarea
              id="gmail-body"
              rows={5}
              value={bodyInput}
              onChange={(e) => setBodyInput(e.target.value)}
              placeholder="اكتب نص الرسالة الأكاديمية هنا..."
              className="w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={sending}
            className="min-h-[42px] px-5 py-2 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs sm:text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60"
          >
            <Send className="w-4 h-4" />
            مراجعة وتأكيد الإرسال
          </button>
        </form>
      </div>

      {statusMsg && (
        <div
          role="status"
          className="rounded-xl bg-[#EAF4F7] border border-[#00A6A6]/35 px-4 py-2.5 text-xs font-semibold text-[#0B2545] flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-[#00A6A6] shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl bg-[#FF8066]/10 border border-[#FF8066]/40 px-4 py-2.5 text-xs font-semibold text-[#b8442c]"
        >
          {errorMsg}
        </div>
      )}

      <ConfirmWorkspaceActionModal
        open={confirmOpen}
        title="تأكيد إرسال البريد عبر Gmail"
        description="أنت على وشك إرسال بريد إلكتروني فعلي من حساب Gmail المتصل الخاص بك. يرجى مراجعة المستلمين والموضوع بعناية."
        details={[
          { label: 'من الحساب', value: gmailProfile?.emailAddress || 'حساب Gmail المتصل' },
          { label: 'المستلمون', value: validatedRecipients.join(', ') },
          { label: 'الموضوع', value: subjectInput.trim() },
        ]}
        confirmLabel="إرسال الرسالة الآن"
        busy={sending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirmSend}
      />
    </div>
  );
}
