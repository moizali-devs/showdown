// Local typed fetch helpers for /api/lab/* (kept here so FE-LAB does not depend on FE-CORE's api.ts shape).
export type Cust = 'A' | 'B';
export type DbSeat = 'FREE' | 'HELD' | 'BOOKED';
export type LabMode = 'off' | 'lock' | 'atomic' | 'optimistic';

export interface DeadlockResult {
  deadlock: boolean; victim: Cust | null; code: '40P01' | null;
  edges: { from: Cust; to: Cust; seat: string }[];
  timeline: { t: number; customer: Cust; text: string }[];
  result: string; ms: number;
}
export interface RushResult {
  tried: number; booked: number; refused: number; errors: number; totalMs: number;
  throughputTps: number; avgResponseMs: number; lockWaitRatio: number;
  bots: { i: number; ok: boolean; ms: number; waitMs: number }[];
}
export interface HistoryRange { from: string; to: string; events: { seat: string; oldStatus: string; newStatus: string; at: string }[] }
export interface HistoryAt { at: string; seats: Record<string, DbSeat>; sql: string }
export interface PerfQuery { name: 'seat_search' | 'sales_report'; sql: string; node: string; ms: number; rows: number; plan: unknown }
export interface PerfResult { indexed: boolean; queries: PerfQuery[] }

async function j<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}
const post = <T,>(url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => j<T>(r));
const get = <T,>(url: string) => fetch(url).then((r) => j<T>(r));

export const labApi = {
  demo: () => get<{ showtimeId: number; seat: string }>('/api/demo'),
  deadlock: (ordered: boolean) => post<DeadlockResult>('/api/lab/deadlock', { ordered }),
  rush: (mode: LabMode) => post<RushResult>('/api/lab/rush', { bots: 50, mode, seat: 'C7' }),
  history: (id: number) => get<HistoryRange>(`/api/lab/history/${id}`),
  historyAt: (id: number, t: string) => get<HistoryAt>(`/api/lab/history/${id}/at?t=${encodeURIComponent(t)}`),
  perf: () => get<PerfResult>('/api/lab/perf'),
  perfIndexes: (create: boolean) => post<PerfResult>('/api/lab/perf/indexes', { create }),
};
