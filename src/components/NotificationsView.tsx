import React, { useState } from 'react';
import { Bell, CheckCircle2, Megaphone } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import {
  AnnouncementCategory,
  ANNOUNCEMENT_CATEGORY_LABELS,
} from '../types/academic.ts';

export function NotificationsView({
  onOpenLecturesBySpec,
}: {
  onOpenLecturesBySpec: (specId: string) => void;
}) {
  const { firebaseUser, readNotificationIds, markNotificationRead } = useAuth();
  const { announcements, notifications, specializations } = usePlatformData();
  const [tab, setTab] = useState<'all' | 'notifications' | 'announcements'>('all');
  const [catFilter, setCatFilter] = useState<AnnouncementCategory | 'all'>('all');

  const publishedNotifications = [...notifications]
    .filter((n) => n.status === 'published')
    .sort((a, b) => {
      const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
      const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
      return tb - ta;
    });

  const publishedAnnouncements = [...announcements]
    .filter((a) => a.status === 'published')
    .filter((a) => catFilter === 'all' || a.category === catFilter)
    .sort((a, b) => {
      const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
      const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
      return tb - ta;
    });

  return (
    <div className="space-y-6 pb-8">
      <header className="bg-[#EAF4F7] rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#0B2545]">
            الإشعارات والإعلانات الجامعية
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            تنبيهات المحاضرات المرفوعة حديثاً وجداول الاختبارات والتحديثات الأكاديمية
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-white rounded-xl border border-slate-200 self-start">
          {[
            { id: 'all', label: 'الكل' },
            { id: 'notifications', label: 'التنبيهات' },
            { id: 'announcements', label: 'الإعلانات' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as typeof tab)}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                tab === item.id
                  ? 'bg-[#0B2545] text-white'
                  : 'text-slate-600 hover:text-[#0B2545]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {(tab === 'all' || tab === 'notifications') && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold text-[#0B2545] flex items-center gap-2">
            <Bell className="w-5 h-5 text-[#00A6A6]" />
            تنبيهات المحاضرات الجديدة ({publishedNotifications.length})
          </h2>

          {publishedNotifications.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
              لا توجد تنبيهات جديدة حالياً.
            </div>
          ) : (
            <div className="space-y-2.5">
              {publishedNotifications.map((notif) => {
                const isRead = readNotificationIds.has(notif.id);
                const spec = specializations.find((s) => s.id === notif.specializationId);
                return (
                  <article
                    key={notif.id}
                    className={`rounded-2xl border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                      isRead
                        ? 'bg-white border-slate-200'
                        : 'bg-[#EAF4F7]/65 border-[#00A6A6]/40'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-display text-base font-bold text-[#0B2545]">
                          {notif.title}
                        </h3>
                        {!isRead && (
                          <span className="text-xs font-semibold text-[#FF8066]">
                            جديد
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-600 leading-relaxed">
                        {notif.message}
                      </p>
                      {spec && (
                        <p className="text-xs text-slate-500">
                          التخصص: {spec.name}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {notif.specializationId && (
                        <button
                          type="button"
                          onClick={() => onOpenLecturesBySpec(notif.specializationId!)}
                          className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs font-semibold transition-colors whitespace-nowrap"
                        >
                          فتح التخصص
                        </button>
                      )}
                      {firebaseUser && !isRead && (
                        <button
                          type="button"
                          onClick={() => markNotificationRead(notif.id)}
                          aria-label={`تحديد تنبيه ${notif.title} كمقروء`}
                          className="min-h-[40px] px-3 py-2 rounded-xl bg-white border border-slate-200 hover:border-[#00A6A6] text-xs font-semibold text-[#0B2545] inline-flex items-center gap-1.5"
                        >
                          <CheckCircle2 className="w-4 h-4 text-[#00A6A6]" />
                          تمت القراءة
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {(tab === 'all' || tab === 'announcements') && (
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold text-[#0B2545] flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-[#FF8066]" />
              الإعلانات الأكاديمية ({publishedAnnouncements.length})
            </h2>

            <div className="flex items-center gap-1.5 overflow-x-auto">
              <button
                type="button"
                onClick={() => setCatFilter('all')}
                className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap ${
                  catFilter === 'all'
                    ? 'bg-[#0B2545] text-white'
                    : 'bg-[#EAF4F7] text-[#0B2545]'
                }`}
              >
                كل الفئات
              </button>
              {(Object.keys(ANNOUNCEMENT_CATEGORY_LABELS) as AnnouncementCategory[]).map(
                (key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setCatFilter(key)}
                    className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap ${
                      catFilter === key
                        ? 'bg-[#00A6A6] text-white'
                        : 'bg-[#EAF4F7] text-[#0B2545]'
                    }`}
                  >
                    {ANNOUNCEMENT_CATEGORY_LABELS[key]}
                  </button>
                )
              )}
            </div>
          </div>

          {publishedAnnouncements.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
              لا توجد إعلانات في هذا التصنيف حالياً.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {publishedAnnouncements.map((ann) => {
                const spec = specializations.find((s) => s.id === ann.specializationId);
                return (
                  <article
                    key={ann.id}
                    className="bg-white rounded-2xl border border-slate-200 p-5 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-display text-base font-bold text-[#0B2545]">
                        {ann.title}
                      </h3>
                      {ann.priority === 'important' && (
                        <span className="text-xs font-bold text-[#FF8066] shrink-0">
                          عاجل / مهم
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed">{ann.body}</p>
                    <p className="text-xs text-slate-500 pt-2 border-t border-slate-100 flex items-center gap-2">
                      <span>{ANNOUNCEMENT_CATEGORY_LABELS[ann.category]}</span>
                      {spec && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{spec.name}</span>
                        </>
                      )}
                    </p>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
