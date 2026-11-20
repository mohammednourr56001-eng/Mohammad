import React, { useMemo, useState } from 'react';
import { RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import { ROLE_LABELS_AR } from '../types/academic.ts';

function formatLogTimestamp(raw: unknown): string {
  if (!raw) return 'الآن';
  if (typeof raw === 'string') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleString('ar-EG');
  }
  if (typeof raw === 'object' && raw !== null && 'seconds' in raw) {
    const sec = Number((raw as { seconds: number }).seconds);
    return new Date(sec * 1000).toLocaleString('ar-EG');
  }
  return 'الآن';
}

export function AuditLogsPanel() {
  const { activityLogs, specializations, refreshAuditLogs } = usePlatformData();
  const [searchQuery, setSearchQuery] = useState('');
  const [resultFilter, setResultFilter] = useState<'all' | 'success' | 'denied' | 'failed'>('all');
  const [refreshing, setRefreshing] = useState(false);

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return activityLogs.filter((log) => {
      const logResult = log.result || 'success';
      if (resultFilter !== 'all' && logResult !== resultFilter) return false;
      if (!q) return true;
      return (
        log.action.toLowerCase().includes(q) ||
        log.entityName.toLowerCase().includes(q) ||
        log.actorEmail.toLowerCase().includes(q) ||
        (log.targetEmail || '').toLowerCase().includes(q) ||
        (log.actorName || '').toLowerCase().includes(q)
      );
    });
  }, [activityLogs, searchQuery, resultFilter]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshAuditLogs();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-[#0B2545] flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#00A6A6]" />
            سجل النشاط الإداري الموثق (Audit Log)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            سجل غير قابل للتعديل أو الحذف يوثّق كل عملية إدارية مع المنفذ ودوره ونتيجة التنفيذ.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#EAF4F7] hover:bg-[#d8ecf2] text-[#0B2545] text-xs font-semibold inline-flex items-center gap-2 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          تحديث السجل
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالعملية، البريد الإلكتروني، أو العنصر المستهدف..."
            className="w-full min-h-[40px] pr-9 pl-3 rounded-xl border border-slate-200 text-sm"
          />
        </div>
        <select
          value={resultFilter}
          onChange={(e) => setResultFilter(e.target.value as typeof resultFilter)}
          className="min-h-[40px] px-3 rounded-xl border border-slate-200 text-sm"
        >
          <option value="all">جميع النتائج ({activityLogs.length})</option>
          <option value="success">عمليات ناجحة</option>
          <option value="denied">محاولات مرفوضة</option>
          <option value="failed">عمليات فاشلة</option>
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-right text-sm">
          <thead className="bg-[#EAF4F7]/70 text-xs font-semibold text-[#0B2545]">
            <tr>
              <th className="p-3.5">المنفذ</th>
              <th className="p-3.5">الدور</th>
              <th className="p-3.5">العملية</th>
              <th className="p-3.5">المحتوى المستهدف</th>
              <th className="p-3.5">النتيجة</th>
              <th className="p-3.5">التاريخ والوقت</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-sm text-slate-500">
                  لا توجد سجلات مطابقة لمعايير البحث الحالية.
                </td>
              </tr>
            ) : (
              filteredLogs.map((log) => {
                const res = log.result || 'success';
                const specLabel = log.specializationId
                  ? specializations.find((s) => s.id === log.specializationId)?.name || log.specializationId
                  : null;
                return (
                  <tr key={log.id} className="hover:bg-slate-50/70">
                    <td className="p-3.5">
                      <p className="font-semibold text-[#0B2545] text-xs">
                        {log.actorName || log.actorEmail}
                      </p>
                      <p className="text-[11px] text-slate-500 font-mono">{log.actorEmail}</p>
                    </td>
                    <td className="p-3.5 text-xs text-slate-600">
                      {log.actorRole ? ROLE_LABELS_AR[log.actorRole] : 'طاقم الإدارة'}
                    </td>
                    <td className="p-3.5 font-semibold text-xs text-[#0B2545]">
                      {log.action}
                      {log.details && (
                        <p className="text-[11px] font-normal text-slate-500 mt-0.5">{log.details}</p>
                      )}
                      {(log.oldValue || log.newValue) && (
                        <p className="text-[11px] font-normal text-slate-500 mt-0.5">
                          {log.oldValue ? `من: ${log.oldValue}` : ''}{' '}
                          {log.newValue ? `← إلى: ${log.newValue}` : ''}
                        </p>
                      )}
                    </td>
                    <td className="p-3.5 text-xs text-slate-700">
                      <p>{log.entityName}</p>
                      {log.targetEmail && (
                        <p className="text-[11px] text-slate-500 font-mono">{log.targetEmail}</p>
                      )}
                      {specLabel && (
                        <span className="inline-block mt-1 px-2 py-0.5 rounded bg-[#EAF4F7] text-[#0B2545] text-[10px] font-semibold">
                          {specLabel}
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 text-xs">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-md font-semibold ${
                          res === 'success'
                            ? 'bg-[#EAF4F7] text-[#00A6A6]'
                            : res === 'denied'
                              ? 'bg-[#FF8066]/15 text-[#FF8066]'
                              : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {res === 'success' ? 'ناجحة' : res === 'denied' ? 'مرفوضة' : 'فاشلة'}
                      </span>
                    </td>
                    <td className="p-3.5 text-xs text-slate-500 tabular-nums whitespace-nowrap">
                      {formatLogTimestamp(log.createdAt)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
