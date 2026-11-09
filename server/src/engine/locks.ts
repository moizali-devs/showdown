import type { LockRow } from '../../../shared/types';
import type { Ctx } from './context';

/** Read the lock table (pg_locks x pg_stat_activity) for a set of backend pids. */
export async function readLocks(ctx: Ctx, pids: number[]): Promise<LockRow[]> {
  if (pids.length === 0) return [];
  const r = await ctx.pool.query(
    `SELECT l.pid, l.locktype, l.relation::regclass::text AS relation, l.mode, l.granted,
            pg_blocking_pids(l.pid) AS blocked_by
       FROM pg_locks l
       JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.pid = ANY($1::int[])
        AND (
          (l.locktype = 'relation' AND l.relation IN (
              SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relname IN ('show_seat', 'booking', 'payment')))
          OR l.locktype IN ('tuple', 'transactionid'))
      ORDER BY l.granted DESC, l.pid, l.locktype`,
    [pids],
  );
  return r.rows.map((x) => ({
    pid: x.pid,
    customer: ctx.pids.get(x.pid) ?? null,
    locktype: x.locktype,
    relation: x.relation,
    mode: x.mode,
    granted: x.granted,
    blockedBy: x.blocked_by,
  }));
}

/**
 * Poll the lock table every 250 ms while something is active. `activePids` returns the pids to watch
 * (empty => stop). Calls onRows only when the rows change (and once more when polling stops, with []).
 */
export function pollLocks(ctx: Ctx, activePids: () => number[], onRows: (rows: LockRow[]) => void): { stop: () => void; done: () => boolean } {
  let stopped = false;
  let last = '';
  const tick = async () => {
    if (stopped) return;
    const pids = activePids();
    let rows: LockRow[] = [];
    if (pids.length) { try { rows = await readLocks(ctx, pids); } catch { rows = []; } }
    const key = JSON.stringify(rows);
    if (key !== last && !stopped) { last = key; onRows(rows); }
    if (!stopped && pids.length === 0) { stopped = true; clearInterval(timer); }
  };
  const timer = setInterval(tick, 250);
  void tick();
  return { stop: () => { if (!stopped) { stopped = true; clearInterval(timer); onRows([]); } }, done: () => stopped };
}
