import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus.ts';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-indicator"
      className="fixed bottom-16 lg:bottom-4 left-4 z-40 flex items-center gap-2 rounded-xl bg-[#0B2545] border border-[#FF8066]/50 px-3.5 py-2 text-xs font-semibold text-white shadow-lg"
    >
      <WifiOff className="w-3.5 h-3.5 text-[#FF8066] shrink-0" />
      <span>وضع عدم الاتصال — يتم تصفح قوائم المحاضرات من الذاكرة المحلية</span>
    </div>
  );
};
