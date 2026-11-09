import type {
  Movie, Showtime, SeatInfo, HoldResult, PayResult, ShowdownState, Mode, Customer,
  DeadlockResult, RushResult, HistoryEvents, HistoryAt, PerfResult,
} from '@shared/types';

export class ApiError extends Error {
  status: number; code?: string; seat?: string;
  constructor(status: number, body: { error?: string; code?: string; seat?: string }) {
    super(body.error ?? `HTTP ${status}`);
    this.status = status; this.code = body.code; this.seat = body.seat;
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: unknown = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(res.status, (data ?? {}) as { error?: string });
  return data as T;
}
const get = <T,>(p: string) => req<T>('GET', p);
const post = <T,>(p: string, b: unknown = {}) => req<T>('POST', p, b);

export const api = {
  health: () => get<{ ok: boolean; db: 'embedded' | 'external' }>('/health'),
  movies: () => get<Movie[]>('/movies'),
  movie: (id: number) => get<{ movie: Movie; showtimes: Showtime[] }>(`/movies/${id}`),
  demo: () => get<{ showtimeId: number; seat: string }>('/demo'),
  showtime: (id: number) => get<{ showtime: Showtime; seats: SeatInfo[] }>(`/showtimes/${id}`),
  hold: (id: number, seats: string[]) => post<HoldResult>(`/showtimes/${id}/hold`, { seats }),
  pay: (bookingId: number, opts: { decline?: boolean; failSeat?: string } = {}) => post<PayResult>(`/bookings/${bookingId}/pay`, opts),
  cancel: (bookingId: number) => post<{ ok?: boolean }>(`/bookings/${bookingId}/cancel`),

  showdown: (id: number) => get<ShowdownState>(`/showdown/${id}`),
  showdownMode: (id: number, mode: Mode) => post<{ accepted: boolean }>(`/showdown/${id}/mode`, { mode }),
  showdownReset: (id: number) => post<{ accepted: boolean }>(`/showdown/${id}/reset`),
  showdownRun: (id: number) => post<{ accepted: boolean }>(`/showdown/${id}/run`),
  showdownAction: (id: number, c: Customer, action: 'attach' | 'begin' | 'confirm' | 'abort') =>
    post<{ accepted: boolean }>(`/showdown/${id}/${c}/${action}`),

  labDeadlock: (ordered: boolean) => post<DeadlockResult>('/lab/deadlock', { ordered }),
  labRush: (o: { bots?: number; mode?: Mode; seat?: string } = {}) => post<RushResult>('/lab/rush', o),
  labHistory: (showtimeId: number) => get<HistoryEvents>(`/lab/history/${showtimeId}`),
  labHistoryAt: (showtimeId: number, t: string) => get<HistoryAt>(`/lab/history/${showtimeId}/at?t=${encodeURIComponent(t)}`),
  labPerf: () => get<PerfResult>('/lab/perf'),
  labPerfIndexes: (create: boolean) => post<PerfResult>('/lab/perf/indexes', { create }),
};

export type { Movie, Showtime, SeatInfo };
export const rs = (n: number) => 'Rs ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
