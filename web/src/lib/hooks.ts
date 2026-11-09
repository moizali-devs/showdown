import { useEffect, useState } from 'react';

export function useWidth(): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const f = () => setW(window.innerWidth);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return w;
}

/** Karachi-time calendar key (yyyy-mm-dd) for an ISO instant. */
export const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

/** "Today" / "Tomorrow" / "Sat 14 Nov" in Asia/Karachi. */
export function dayLabel(iso: string): string {
  const now = new Date();
  const k = dayKey(iso);
  if (k === dayKey(now.toISOString())) return 'Today';
  if (k === dayKey(new Date(now.getTime() + 86400000).toISOString())) return 'Tomorrow';
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi', weekday: 'short', day: 'numeric', month: 'short' });
}
