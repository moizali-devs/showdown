import pg from 'pg';
import type { SqlLine, WsServerMsg } from '../../../shared/types';

export type BusListener = (showtimeId: number, msg: WsServerMsg) => void;

/** In-process pub/sub: engine/hall/lab publish, the WS hub subscribes. */
export class Bus {
  private listeners = new Set<BusListener>();
  subscribe(fn: BusListener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  publish(showtimeId: number, msg: WsServerMsg): void {
    for (const fn of this.listeners) { try { fn(showtimeId, msg); } catch { /* listener errors never break the engine */ } }
  }
}

export interface Ctx {
  connectionString: string;
  dbKind: 'embedded' | 'external';
  /** shared pool: admin queries, REST reads, hold/pay. */
  pool: pg.Pool;
  bus: Bus;
  /** backend pid -> label ('A', 'B', 'bot-07') for lock-table / "waiting on A" mapping */
  pids: Map<number, string>;
  /** every dedicated client created, so shutdown can end them all */
  clients: Set<pg.Client>;
  demoShowtimeId?: number;
}

export function createCtx(connectionString: string, dbKind: 'embedded' | 'external'): Ctx {
  const pool = new pg.Pool({ connectionString, max: Number(process.env.PG_POOL_MAX) || 20, application_name: 'showdown-admin' });
  pool.on('error', () => { /* idle client errors: ignore */ });
  return { connectionString, dbKind, pool, bus: new Bus(), pids: new Map(), clients: new Set() };
}

export async function demoShowtimeId(ctx: Ctx): Promise<number> {
  if (ctx.demoShowtimeId) return ctx.demoShowtimeId;
  const r = await ctx.pool.query('SELECT demo_showtime_id() AS id');
  ctx.demoShowtimeId = Number(r.rows[0].id);
  return ctx.demoShowtimeId;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function mkLine(customer: SqlLine['customer'], kind: SqlLine['kind'], text: string, extra: Partial<SqlLine> = {}): SqlLine {
  return { at: Date.now(), customer, kind, text, ...extra };
}
