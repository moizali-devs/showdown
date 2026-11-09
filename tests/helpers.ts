import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { WebSocket } from 'ws';
import { createApp, type App } from '../server/src/app';
import type { Customer, ShowdownState } from '../shared/types';

export function testDbUrl(): string {
  const u = process.env.TEST_DATABASE_URL;
  if (!u) throw new Error('TEST_DATABASE_URL is not set (tests/setup/global.ts should export it)');
  return u;
}

export interface TestApp {
  base: string;
  app: App;
  pool: pg.Pool;
  showId: number;
  close: () => Promise<void>;
  get: <T = any>(path: string) => Promise<{ status: number; body: T }>;
  post: <T = any>(path: string, body?: unknown) => Promise<{ status: number; body: T }>;
  state: () => Promise<ShowdownState>;
  waitState: (pred: (s: ShowdownState) => boolean, what: string, timeoutMs?: number) => Promise<ShowdownState>;
  sd: (path: string, body?: unknown) => Promise<{ status: number; body: any }>;
  openWs: (showtimeId: number) => Promise<{ ws: WebSocket; messages: any[]; waitFor: (pred: (m: any) => boolean, ms?: number) => Promise<any> }>;
}

export async function startTestApp(): Promise<TestApp> {
  const connectionString = testDbUrl();
  const app = createApp({ connectionString, db: 'embedded', sweepEveryMs: 3_600_000 });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const pool = new pg.Pool({ connectionString, max: 4 });
  const showId = (await pool.query('SELECT demo_showtime_id() AS id')).rows[0].id as number;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch { /* keep text */ }
    return { status: res.status, body: parsed };
  };
  const state = async () => (await call('GET', `/api/showdown/${showId}`)).body as ShowdownState;
  const waitState = async (pred: (s: ShowdownState) => boolean, what: string, timeoutMs = 15000) => {
    const t0 = Date.now();
    let s = await state();
    while (!pred(s)) {
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${what}; state=${JSON.stringify({ ...s, customers: { A: { ...s.customers.A, sql: undefined }, B: { ...s.customers.B, sql: undefined } } })}`);
      await new Promise((r) => setTimeout(r, 60));
      s = await state();
    }
    return s;
  };
  return {
    base, app, pool, showId,
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b ?? {}),
    sd: (p, b) => call('POST', `/api/showdown/${showId}${p}`, b ?? {}),
    state, waitState,
    openWs: async (showtimeId) => {
      const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
      const messages: any[] = [];
      ws.on('message', (d) => messages.push(JSON.parse(String(d))));
      await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
      ws.send(JSON.stringify({ type: 'subscribe', showtimeId }));
      const waitFor = async (pred: (m: any) => boolean, ms = 8000) => {
        const t0 = Date.now();
        for (;;) {
          const m = messages.find(pred);
          if (m) return m;
          if (Date.now() - t0 > ms) throw new Error('timeout waiting for ws message');
          await new Promise((r) => setTimeout(r, 40));
        }
      };
      return { ws, messages, waitFor };
    },
    close: async () => { await app.close(); await pool.end(); },
  };
}

export const CUSTOMERS: Customer[] = ['A', 'B'];

/** Two-phase driver: A.begin, B.begin, A.confirm, B.confirm with state waits (two-window mode). */
export async function raceManually(t: TestApp, mode: string) {
  await t.sd('/mode', { mode });
  await t.waitState((s) => s.mode === mode && s.customers.A.phase === 'idle', 'mode set');
  await t.sd('/A/attach'); await t.sd('/B/attach');
  await t.waitState((s) => s.customers.A.pid !== null && s.customers.B.pid !== null, 'attached');
  await t.sd('/A/begin');
  await t.waitState((s) => ['ready', 'done'].includes(s.customers.A.phase), 'A begun');
  await t.sd('/B/begin');
  if (mode === 'lock') return; // B blocks: caller continues
  await t.waitState((s) => ['ready', 'done'].includes(s.customers.B.phase), 'B begun');
}

export async function finishRace(t: TestApp) {
  await t.sd('/A/confirm');
  await t.waitState((s) => s.customers.A.phase === 'done', 'A done');
  await t.sd('/B/confirm');
  return t.waitState((s) => s.customers.A.phase === 'done' && s.customers.B.phase === 'done' && s.result !== null, 'both done');
}

export async function bookingsFor(pool: pg.Pool, showId: number, customerIds: number[]) {
  const r = await pool.query(
    "SELECT booking_id, customer_id, status FROM booking WHERE showtime_id = $1 AND customer_id = ANY($2::int[]) AND status = 'CONFIRMED' ORDER BY booking_id",
    [showId, customerIds]);
  return r.rows as { booking_id: number; customer_id: number; status: string }[];
}
