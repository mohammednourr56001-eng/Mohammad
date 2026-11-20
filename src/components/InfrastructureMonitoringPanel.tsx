import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Cpu,
  Database,
  Flame,
  Globe,
  HardDrive,
  Layers,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldAlert,
  Trash2,
  Users,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { AiJobRecord, ObservabilitySnapshot } from '../types/academic.ts';
import { formatFileSizeArabic } from '../utils/academicLogic.ts';

interface ScaleScenarioPreset {
  id: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  label: string;
  concurrentUsers: number;
  appReplicas: number;
  dbTier: string;
  redisSize: string;
  estMonthlyUsdRange: string;
  notes: string;
}

const SCALE_SCENARIOS: ScaleScenarioPreset[] = [
  {
    id: 'A',
    label: 'السيناريو A — 1,000 مستخدم متزامن',
    concurrentUsers: 1000,
    appReplicas: 2,
    dbTier: '2 vCPU / 4 GB + Pooler',
    redisSize: '1 GB Shared Cache',
    estMonthlyUsdRange: '$95 – $180',
    notes: 'مناسب للذروة اليومية في كلية واحدة مع تفعيل الكاش وCDN.',
  },
  {
    id: 'B',
    label: 'السيناريو B — 5,000 مستخدم متزامن',
    concurrentUsers: 5000,
    appReplicas: 4,
    dbTier: '4 vCPU / 16 GB + Read Replica',
    redisSize: '2.5 GB HA Redis',
    estMonthlyUsdRange: '$320 – $580',
    notes: 'توسع أفقي تلقائي مع توزيع القراءة وفصل عمال الذكاء الاصطناعي.',
  },
  {
    id: 'C',
    label: 'السيناريو C — 10,000 مستخدم متزامن',
    concurrentUsers: 10000,
    appReplicas: 8,
    dbTier: '8 vCPU / 32 GB + 2 Read Replicas',
    redisSize: '5 GB Cluster',
    estMonthlyUsdRange: '$750 – $1,350',
    notes: 'موسم امتحانات نصف الفصل مع تسخين مسبق للكاش وحدود حماية 429.',
  },
  {
    id: 'D',
    label: 'السيناريو D — 25,000 مستخدم متزامن',
    concurrentUsers: 25000,
    appReplicas: 16,
    dbTier: '16 vCPU / 64 GB + PgBouncer',
    redisSize: '10 GB Cluster',
    estMonthlyUsdRange: '$1,850 – $3,100',
    notes: 'اختبارات موحدة عبر عدة كليات، تسليم CDN 100% للملفات الثابتة.',
  },
  {
    id: 'E',
    label: 'السيناريو E — 50,000 مستخدم متزامن',
    concurrentUsers: 50000,
    appReplicas: 30,
    dbTier: '32 vCPU / 128 GB + Partitioned Tables',
    redisSize: '25 GB Sharded',
    estMonthlyUsdRange: '$4,200 – $6,900',
    notes: 'ذروة اختبارات نهائية على مستوى الجامعة مع جدولة توسع استباقية.',
  },
  {
    id: 'F',
    label: 'السيناريو F — 100,000 مستخدم متزامن',
    concurrentUsers: 100000,
    appReplicas: 55,
    dbTier: 'Multi-Region HA + Dedicated AI Workers',
    redisSize: '50 GB Enterprise Cluster',
    estMonthlyUsdRange: '$9,500 – $15,800',
    notes: 'يتطلب اختبار حمل موزع واعتماد ميزانية سحابية مسبقة قبل الإطلاق.',
  },
];

function formatUptimeArabic(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) return `${hrs}س ${mins}د`;
  if (mins > 0) return `${mins}د ${secs}ث`;
  return `${secs}ث`;
}

export function InfrastructureMonitoringPanel({
  onToast,
}: {
  onToast: (msg: string) => void;
}) {
  const { getIdToken, isSuperAdmin } = useAuth();
  const [snapshot, setSnapshot] = useState<ObservabilitySnapshot | null>(null);
  const [recentAiJobs, setRecentAiJobs] = useState<AiJobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<ScaleScenarioPreset['id']>('C');
  const [busyAction, setBusyAction] = useState(false);

  const loadSnapshot = useCallback(async () => {
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/admin/monitoring', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'تعذر قراءة بيانات المراقبة.');
        return;
      }
      setErrorMsg(null);
      setSnapshot(data.snapshot as ObservabilitySnapshot);
      setRecentAiJobs(Array.isArray(data.recentAiJobs) ? data.recentAiJobs : []);
    } catch {
      setErrorMsg('تعذر الاتصال بنقطة مراقبة البنية التحتية.');
    } finally {
      setLoading(false);
    }
  }, [getIdToken]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = window.setInterval(() => {
      void loadSnapshot();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [autoRefresh, loadSnapshot]);

  const handleCacheAction = async (mode: 'warm' | 'invalidate') => {
    setBusyAction(true);
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch(`/api/admin/cache/${mode}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        onToast(
          mode === 'warm'
            ? 'تم تسخين ذاكرة التخزين المؤقت للمقررات والاختبارات.'
            : 'تم مسح مفاتيح ذاكرة التخزين المؤقت.'
        );
        await loadSnapshot();
      }
    } finally {
      setBusyAction(false);
    }
  };

  const handleRetryJob = async (jobId: string) => {
    const token = await getIdToken();
    if (!token) return;
    const res = await fetch(`/api/ai/jobs/${encodeURIComponent(jobId)}/retry`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      onToast('تمت إعادة جدولة مهمة الذكاء الاصطناعي.');
      await loadSnapshot();
    }
  };

  const selectedScenario = useMemo(
    () => SCALE_SCENARIOS.find((s) => s.id === selectedScenarioId) || SCALE_SCENARIOS[2],
    [selectedScenarioId]
  );

  if (!isSuperAdmin) {
    return (
      <div className="rounded-2xl bg-[#FF8066]/10 border border-[#FF8066]/40 p-6 text-center text-sm font-semibold text-[#0B2545]">
        لوحة المراقبة الحية للبنية التحتية والتكاليف متاحة حصرياً للمدير الرئيسي (Super Admin).
      </div>
    );
  }

  if (loading && !snapshot) {
    return (
      <div className="space-y-4">
        <div className="h-24 rounded-2xl bg-white animate-pulse border border-slate-200" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-white animate-pulse border border-slate-200" />
          ))}
        </div>
      </div>
    );
  }

  const maxHistoryReqs = Math.max(
    1,
    ...(snapshot?.history || []).map((b) => b.requests)
  );

  return (
    <div className="space-y-6">
      {/* Control Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-[#00A6A6]" />
            <h2 className="font-display text-lg font-bold text-[#0B2545]">
              مراقبة البنية التحتية الحية والأداء (قياسات فعلية)
            </h2>
          </div>
          {snapshot && (
            <p className="text-xs text-slate-500 tabular-nums">
              العقدة: <span className="font-mono font-semibold">{snapshot.instance.instanceId}</span> ·
              PID {snapshot.instance.pid} · مدة التشغيل {formatUptimeArabic(snapshot.instance.uptimeSeconds)} ·
              آخر تحديث {new Date(snapshot.capturedAt).toLocaleTimeString('ar-YE')}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#EAF4F7] text-xs font-semibold text-[#0B2545] inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-[#00A6A6]"
            />
            تحديث تلقائي (5 ثوانٍ)
          </label>
          <button
            type="button"
            disabled={busyAction}
            onClick={() => void handleCacheAction('warm')}
            className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#00A6A6] text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Flame className="w-3.5 h-3.5" />
            تسخين الكاش
          </button>
          <button
            type="button"
            disabled={busyAction}
            onClick={() => void handleCacheAction('invalidate')}
            className="min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-[#0B2545] hover:bg-rose-50 inline-flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5 text-[#FF8066]" />
            مسح الكاش
          </button>
          <button
            type="button"
            onClick={() => void loadSnapshot()}
            className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#0B2545] text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            تحديث الآن
          </button>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-2xl bg-[#FF8066]/15 border border-[#FF8066]/40 px-4 py-3 text-sm text-[#0B2545] flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-[#FF8066]" />
          {errorMsg}
        </div>
      )}

      {/* Alerts Banner */}
      {snapshot && snapshot.alerts.length > 0 && (
        <div className="space-y-2">
          {snapshot.alerts.map((al) => (
            <div
              key={al.id}
              className={`rounded-2xl border px-4 py-3 text-xs sm:text-sm flex flex-wrap items-center justify-between gap-2 ${
                al.severity === 'critical'
                  ? 'bg-rose-50 border-rose-300 text-rose-900'
                  : 'bg-amber-50 border-amber-300 text-amber-900'
              }`}
            >
              <span className="flex items-center gap-2 font-semibold">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                {al.message}
              </span>
              <span className="tabular-nums font-mono text-xs">
                الحالي: {al.currentValue} / الحد: {al.threshold}
              </span>
            </div>
          ))}
        </div>
      )}

      {snapshot && (
        <>
          {/* SECTION 1: SYSTEM STATUS */}
          <section className="space-y-3">
            <h3 className="font-display text-base font-bold text-[#0B2545] flex items-center gap-2">
              <Server className="w-4 h-4 text-[#00A6A6]" />
              1. حالة النظام والخدمات (System Status)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>خادم التطبيق (App Server)</span>
                  <Server className="w-4 h-4 text-[#00A6A6]" />
                </div>
                <p className="font-display text-lg font-bold text-[#0B2545]">
                  {snapshot.systemStatus.appServer === 'healthy' ? 'سليم ومتاح' : 'في وضع التصريف'}
                </p>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  الحالة الكلية: {snapshot.systemStatus.overall}
                </p>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>قاعدة البيانات (Database)</span>
                  <Database className="w-4 h-4 text-[#00A6A6]" />
                </div>
                <p className="font-display text-lg font-bold text-[#0B2545]">
                  {snapshot.systemStatus.database.status === 'healthy' ? 'متصلة وسريعة' : 'بطء استجابة'}
                </p>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  زمن الفحص: {snapshot.systemStatus.database.latencyMs} مللي ثانية
                </p>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>الكاش الموزع (Cache / Redis)</span>
                  <Zap className="w-4 h-4 text-[#00A6A6]" />
                </div>
                <p className="font-display text-lg font-bold text-[#0B2545] tabular-nums">
                  نسبة الإصابة {snapshot.systemStatus.cache.hitRatioPct}%
                </p>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  الوضع: {snapshot.systemStatus.cache.mode === 'redis' ? 'Redis موزع' : 'In-Memory LRU'} ·{' '}
                  {snapshot.systemStatus.cache.keysCount} مفتاح
                </p>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>CDN والتخزين والطابور</span>
                  <Globe className="w-4 h-4 text-[#00A6A6]" />
                </div>
                <p className="font-display text-lg font-bold text-[#0B2545] tabular-nums">
                  تخزين {snapshot.systemStatus.storage.usedPct}%
                </p>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  روابط CDN موقعة: {snapshot.systemStatus.cdn.signedUrlsEnabled ? 'مفعّلة' : 'معطلة'} · طابور AI:{' '}
                  {snapshot.systemStatus.backgroundQueue.waiting}/{snapshot.systemStatus.backgroundQueue.processing}
                </p>
              </div>
            </div>
          </section>

          {/* SECTION 2: LIVE TRAFFIC */}
          <section className="space-y-3">
            <h3 className="font-display text-base font-bold text-[#0B2545] flex items-center gap-2">
              <Users className="w-4 h-4 text-[#00A6A6]" />
              2. حركة المرور الحية (Live Traffic)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              {[
                { label: 'مستخدمون (5 د)', value: snapshot.liveTraffic.activeUsers5m },
                { label: 'جلسات نشطة', value: snapshot.liveTraffic.activeSessions },
                { label: 'الطلبات / ثانية (RPS)', value: snapshot.liveTraffic.requestsPerSecond },
                { label: 'اتصالات متزامنة', value: snapshot.liveTraffic.concurrentConnections },
                { label: 'إجمالي الطلبات', value: snapshot.liveTraffic.totalRequests },
                { label: 'تنزيلات الملفات', value: snapshot.liveTraffic.fileDownloads },
                { label: 'تسليم الاختبارات', value: snapshot.liveTraffic.examSubmissions },
                { label: 'حظر Rate Limit 429', value: snapshot.liveTraffic.rateLimitedRequests },
              ].map((m) => (
                <div key={m.label} className="bg-white rounded-2xl border border-slate-200 p-3.5 space-y-1">
                  <p className="text-[11px] text-slate-500">{m.label}</p>
                  <p className="font-display text-xl font-bold text-[#0B2545] tabular-nums">
                    {m.value}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* SECTION 3: PERFORMANCE METRICS & HISTORY CHART */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <h3 className="font-display text-base font-bold text-[#0B2545] flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#00A6A6]" />
                3. مؤشرات الأداء الفعلية (Performance)
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'متوسط الاستجابة', value: `${snapshot.performance.avgResponseMs} ms` },
                  { label: 'P50 Latency', value: `${snapshot.performance.p50ResponseMs} ms` },
                  { label: 'P95 Latency', value: `${snapshot.performance.p95ResponseMs} ms` },
                  { label: 'P99 Latency', value: `${snapshot.performance.p99ResponseMs} ms` },
                  { label: 'معدل أخطاء 5xx', value: `${snapshot.performance.errorRatePct}%` },
                  { label: 'إصابة الكاش', value: `${snapshot.performance.cacheHitRatioPct}%` },
                ].map((perf) => (
                  <div key={perf.label} className="rounded-xl bg-[#EAF4F7]/65 p-3">
                    <p className="text-[11px] text-slate-600">{perf.label}</p>
                    <p className="font-display text-lg font-bold text-[#0B2545] tabular-nums">
                      {perf.value}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 tabular-nums">
                عينة القياس الحالية: {snapshot.performance.sampleCount} طلب · فحص قاعدة البيانات:{' '}
                {snapshot.performance.dbProbeLatencyMs} ms · مهام AI منجزة:{' '}
                {snapshot.systemStatus.aiService.totalGenerated} (وفّر الكاش{' '}
                {snapshot.systemStatus.aiService.cacheSavedCalls} استدعاء)
              </p>
            </div>

            <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-base font-bold text-[#0B2545]">
                  السجل الزمني للطلبات والكمون (آخر {snapshot.history.length} دقيقة)
                </h3>
                <span className="text-[11px] text-slate-500">قياس حقيقي بالدقيقة</span>
              </div>
              {snapshot.history.length === 0 ? (
                <p className="text-xs text-slate-500 py-8 text-center">
                  لم تتجمع نقاط زمنية كافية بعد.
                </p>
              ) : (
                <div className="h-44 flex items-end gap-1.5 pt-4 border-b border-slate-200 pb-2 overflow-x-auto">
                  {snapshot.history.slice(-24).map((bucket) => {
                    const heightPct = Math.max(8, Math.round((bucket.requests / maxHistoryReqs) * 100));
                    return (
                      <div
                        key={bucket.minuteIso}
                        className="flex-1 min-w-[14px] flex flex-col items-center gap-1 group"
                        title={`${bucket.label} — ${bucket.requests} طلب | P95: ${bucket.p95LatencyMs}ms`}
                      >
                        <div className="w-full h-32 flex items-end justify-center">
                          <div
                            className={`w-full max-w-[20px] rounded-t-md transition-all ${
                              bucket.errors > 0 ? 'bg-[#FF8066]' : 'bg-[#00A6A6]'
                            }`}
                            style={{ height: `${heightPct}%` }}
                          />
                        </div>
                        <span className="text-[9px] text-slate-500 tabular-nums">{bucket.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* SECTION 4: INFRASTRUCTURE RESOURCES & AI QUEUE */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <h3 className="font-display text-base font-bold text-[#0B2545] flex items-center gap-2">
                <Cpu className="w-4 h-4 text-[#00A6A6]" />
                4. موارد البنية التحتية (Infrastructure)
              </h3>
              <div className="space-y-3 text-xs">
                {[
                  {
                    label: `استهلاك المعالج (CPU) · Load ${snapshot.infrastructure.loadAvg1m}`,
                    pct: snapshot.infrastructure.cpuPercent,
                    detail: `${snapshot.infrastructure.cpuPercent}%`,
                  },
                  {
                    label: 'الذاكرة المستخدمة (Heap / RSS)',
                    pct: Math.min(
                      100,
                      Math.round(
                        (snapshot.infrastructure.memoryRssMB /
                          Math.max(1, snapshot.infrastructure.osTotalMemMB)) *
                          100
                      )
                    ),
                    detail: `RSS ${snapshot.infrastructure.memoryRssMB} MB · Heap ${snapshot.infrastructure.heapUsedMB} MB`,
                  },
                  {
                    label: 'مساحة التخزين المستخدمة',
                    pct: snapshot.systemStatus.storage.usedPct,
                    detail: `${formatFileSizeArabic(snapshot.systemStatus.storage.usedBytes)} / ${formatFileSizeArabic(snapshot.systemStatus.storage.quotaBytes)}`,
                  },
                ].map((resItem) => (
                  <div key={resItem.label} className="space-y-1">
                    <div className="flex justify-between font-medium text-[#0B2545]">
                      <span>{resItem.label}</span>
                      <span className="tabular-nums text-slate-600">{resItem.detail}</span>
                    </div>
                    <div className="h-2.5 bg-[#EAF4F7] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          resItem.pct >= 85 ? 'bg-[#FF8066]' : 'bg-[#00A6A6]'
                        }`}
                        style={{ width: `${Math.max(3, Math.min(100, resItem.pct))}%` }}
                      />
                    </div>
                  </div>
                ))}
                <div className="pt-2 border-t border-slate-100 flex justify-between text-slate-600 tabular-nums">
                  <span>بيانات الشبكة المرسلة</span>
                  <span>{formatFileSizeArabic(snapshot.infrastructure.networkBytesSent)}</span>
                </div>
                <div className="flex justify-between text-slate-600 tabular-nums">
                  <span>نسخ الخادم المهيأة حالياً</span>
                  <span>{snapshot.infrastructure.serverInstancesConfigured}</span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-base font-bold text-[#0B2545] flex items-center gap-2">
                  <BrainCircuit className="w-4 h-4 text-[#00A6A6]" />
                  طابور مهام الذكاء الاصطناعي ({snapshot.systemStatus.aiService.model})
                </h3>
                <span className="text-[11px] text-slate-500 tabular-nums">
                  انتظار: {snapshot.systemStatus.backgroundQueue.waiting} · نشط:{' '}
                  {snapshot.systemStatus.backgroundQueue.processing} · مكتمل:{' '}
                  {snapshot.systemStatus.backgroundQueue.completed}
                </span>
              </div>

              {recentAiJobs.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">
                  لا توجد مهام AI مسجلة حالياً في هذا التشغيل.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
                  {recentAiJobs.map((job) => (
                    <div key={job.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <p className="font-semibold text-[#0B2545] truncate">{job.topic}</p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {job.requestedByEmail} · {job.type} · محاولات {job.attempts}/{job.maxRetries}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2 py-0.5 rounded bg-[#EAF4F7] text-[#0B2545] font-semibold">
                          {job.status}
                        </span>
                        {job.status === 'failed' && (
                          <button
                            type="button"
                            onClick={() => void handleRetryJob(job.id)}
                            className="px-2.5 py-1 rounded bg-[#FF8066] text-white font-semibold inline-flex items-center gap-1"
                          >
                            <RotateCcw className="w-3 h-3" />
                            إعادة
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* SECTION 5: ARCHITECTURAL COST & CAPACITY PLANNER */}
          <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-bold text-[#0B2545] flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-[#00A6A6]" />
                  نموذج تخطيط السعة والتكلفة التقديرية (1,000 – 100,000 مستخدم متزامن)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  تقديرات هندسية لتخطيط البنية والميزانية حسب عدد النسخ وقاعدة البيانات؛ السعة الفعلية تُعتمد بعد اختبار الحمل على البيئة المجمّعة.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SCALE_SCENARIOS.map((sc) => (
                  <button
                    key={sc.id}
                    type="button"
                    onClick={() => setSelectedScenarioId(sc.id)}
                    className={`min-h-[34px] px-3 py-1 rounded-xl text-xs font-bold tabular-nums transition-colors ${
                      selectedScenarioId === sc.id
                        ? 'bg-[#0B2545] text-white'
                        : 'bg-[#EAF4F7] text-[#0B2545] hover:bg-[#d7ebf1]'
                    }`}
                  >
                    {sc.id}: {sc.concurrentUsers.toLocaleString('en-US')}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-[#EAF4F7]/50 rounded-2xl p-4 border border-slate-200/80">
              <div>
                <p className="text-[11px] text-slate-500">المستخدمون المتزامنون المستهدفون</p>
                <p className="font-display text-lg font-bold text-[#0B2545] tabular-nums">
                  {selectedScenario.concurrentUsers.toLocaleString('en-US')}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">عدد نسخ التطبيق (Stateless Replicas)</p>
                <p className="font-display text-lg font-bold text-[#00A6A6] tabular-nums">
                  {selectedScenario.appReplicas} نسخ
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">قاعدة البيانات والكاش الموزع</p>
                <p className="text-xs font-bold text-[#0B2545] mt-1">
                  {selectedScenario.dbTier} · {selectedScenario.redisSize}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">التكلفة الشهرية التقديرية</p>
                <p className="font-display text-lg font-bold text-[#FF8066] tabular-nums">
                  {selectedScenario.estMonthlyUsdRange}
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-600">{selectedScenario.notes}</p>
          </section>
        </>
      )}
    </div>
  );
}
