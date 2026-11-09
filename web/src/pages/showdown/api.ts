import type { Customer, Mode, ShowdownState, SeatInfo } from '../../../../shared/types';

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}
const post = (url: string, body?: unknown) =>
  j<{ accepted?: boolean }>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

export const sdApi = {
  demo: () => j<{ showtimeId: number; seat: string }>('/api/demo'),
  state: (id: number) => j<ShowdownState>(`/api/showdown/${id}`),
  seats: (id: number) => j<{ seats: SeatInfo[] }>(`/api/showtimes/${id}`),
  mode: (id: number, mode: Mode) => post(`/api/showdown/${id}/mode`, { mode }),
  run: (id: number) => post(`/api/showdown/${id}/run`),
  reset: (id: number) => post(`/api/showdown/${id}/reset`),
  act: (id: number, c: Customer, a: 'attach' | 'begin' | 'confirm' | 'abort') =>
    post(`/api/showdown/${id}/${c}/${a}`),
};
