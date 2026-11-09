import type { Mode, RushResult } from '../../../shared/types';
import { type Ctx, demoShowtimeId, mkLine } from '../engine/context';
import { publishSeats, resetSeats, seatRef } from '../engine/seats';
import { Session } from '../engine/session';

const BOT_FIRST_CUSTOMER = 4; // seed: customers 4..53 = "Bot 01".."Bot 50"

/**
 * Rush hour: N dedicated connections, a barrier, then every bot fires its booking transaction at once.
 * Metrics follow Lab 5 (Exercise 8): throughput = completed txns / elapsed s;
 * response time = per-txn wall time (queue + cpu + io + lock-wait + commit); lock-wait ratio = sum(T_lock-wait) / sum(response).
 */
export async function runRush(ctx: Ctx, opts: { bots?: number; mode?: Mode; seat?: string } = {}): Promise<RushResult> {
  const n = Math.max(1, Math.min(opts.bots ?? 50, 150));
  const mode: Mode = opts.mode ?? 'lock';
  const label = opts.seat ?? 'C7';
  const showtimeId = await demoShowtimeId(ctx);
  const ref = await seatRef(ctx, showtimeId, label);
  if (!ref) throw new Error(`seat ${label} not found`);
  // reset the seat and cancel earlier bot bookings
  const botIds = Array.from({ length: 50 }, (_, i) => BOT_FIRST_CUSTOMER + i);
  await resetSeats(ctx, showtimeId, [label], botIds);

  const emit = (l: any) => ctx.bus.publish(showtimeId, { type: 'sql', showtimeId, line: l });
  const sessions = Array.from({ length: n }, (_, i) =>
    new Session(ctx, `bot-${String(i + 1).padStart(2, '0')}`, `bot-${String(i + 1).padStart(2, '0')}`, 'RUSH', () => undefined));
  emit(mkLine('RUSH', 'info', `${n} bots connected, mode=${mode}, seat ${label}. Barrier released.`));

  const pk = [showtimeId, ref.seatId];
  const BOOK = `UPDATE show_seat SET status = 'BOOKED', booking_id = $1, held_until = NULL, version = version + 1
                 WHERE showtime_id = $2 AND seat_id = $3`;
  type BotRes = { i: number; ok: boolean; ms: number; waitMs: number; lockMs: number | null; error: boolean };

  const bot = async (i: number): Promise<BotRes> => {
    const s = sessions[i];
    const customerId = BOT_FIRST_CUSTOMER + (i % 50);
    const t0 = performance.now();
    let lockMs: number | null = null; // duration of the statement that contends for the row lock
    const q = async (sql: string, params: unknown[] = [], contended = false) => {
      const r = await s.exec(sql, params, { quiet: true, waitThresholdMs: 100_000 });
      if (contended && lockMs === null) lockMs = r.ms;
      return r;
    };
    const insert = async () => (await q(
      "INSERT INTO booking (customer_id, showtime_id, status, total) VALUES ($1, $2, 'CONFIRMED', $3) RETURNING booking_id",
      [customerId, showtimeId, ref.price])).rows[0].booking_id as number;
    try {
      await q('BEGIN');
      let ok = false;
      if (mode === 'lock') {
        const r = await q('SELECT status FROM show_seat WHERE showtime_id = $1 AND seat_id = $2 FOR UPDATE', pk, true);
        if (r.rows[0]?.status === 'FREE') { await q(BOOK, [await insert(), ...pk]); ok = true; }
      } else if (mode === 'off') {
        const r = await q('SELECT status FROM show_seat WHERE showtime_id = $1 AND seat_id = $2', pk);
        if (r.rows[0]?.status === 'FREE') { await q(BOOK, [await insert(), ...pk], true); ok = true; }
      } else if (mode === 'atomic') {
        const bid = await insert();
        const r = await q(BOOK + " AND status = 'FREE'", [bid, ...pk], true);
        ok = r.rowCount === 1;
      } else {
        const r = await q('SELECT status, version FROM show_seat WHERE showtime_id = $1 AND seat_id = $2', pk);
        if (r.rows[0]?.status === 'FREE') {
          const bid = await insert();
          const u = await q(BOOK + ' AND version = $4', [bid, ...pk, r.rows[0].version], true);
          ok = u.rowCount === 1;
        }
      }
      await q(ok ? 'COMMIT' : 'ROLLBACK');
      return { i, ok, ms: performance.now() - t0, waitMs: 0, lockMs, error: false };
    } catch {
      try { await q('ROLLBACK'); } catch { /* ignore */ }
      return { i, ok: false, ms: performance.now() - t0, waitMs: 0, lockMs, error: true };
    }
  };

  try {
    await Promise.all(sessions.map((s) => s.connect())); // all connections up before the barrier
    const start = performance.now();
    const results = await Promise.all(sessions.map((_, i) => bot(i))); // fired in the same tick
    const totalMs = performance.now() - start;
    // T_lock-wait = time of the contended statement minus its uncontended time (the fastest bot's, i.e. the winner's)
    const lockTimes = results.map((r) => r.lockMs).filter((x): x is number => x !== null);
    const baseline = lockTimes.length ? Math.min(...lockTimes) : 0;
    for (const r of results) r.waitMs = r.lockMs === null ? 0 : Math.max(0, r.lockMs - baseline);
    const booked = results.filter((r) => r.ok).length;
    const errors = results.filter((r) => r.error).length;
    const refused = n - booked - errors;
    const completed = booked + refused;
    const sumMs = results.reduce((a, r) => a + r.ms, 0);
    const sumWait = results.reduce((a, r) => a + Math.min(r.waitMs, r.ms), 0);
    const out: RushResult = {
      tried: n, booked, refused, errors,
      totalMs: Math.round(totalMs),
      throughputTps: Math.round((completed / (totalMs / 1000)) * 10) / 10,
      avgResponseMs: Math.round((sumMs / n) * 10) / 10,
      lockWaitRatio: sumMs > 0 ? Math.round((sumWait / sumMs) * 1000) / 1000 : 0,
      bots: results.map((r) => ({ i: r.i + 1, ok: r.ok, ms: Math.round(r.ms * 10) / 10, waitMs: Math.round(r.waitMs * 10) / 10 })),
    };
    emit(mkLine('RUSH', 'info',
      `${booked} booked, ${refused} refused in ${out.totalMs} ms (${out.throughputTps} txn/s, avg ${out.avgResponseMs} ms, lock-wait ${(out.lockWaitRatio * 100).toFixed(1)}%)`));
    await publishSeats(ctx, showtimeId, [label]);
    return out;
  } finally {
    await Promise.all(sessions.map((s) => s.close()));
  }
}
