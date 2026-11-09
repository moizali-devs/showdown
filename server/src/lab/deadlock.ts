import type { Customer, DeadlockResult } from '../../../shared/types';
import { type Ctx, demoShowtimeId } from '../engine/context';
import { pollLocks } from '../engine/locks';
import { resetSeats, seatRef } from '../engine/seats';
import { Session } from '../engine/session';

const LOCK_SQL = 'SELECT status FROM show_seat WHERE showtime_id = $1 AND seat_id = $2 FOR UPDATE';

/**
 * A locks C7 then C8; B locks C8 then C7 -> circular wait -> Postgres kills one with 40P01.
 * ordered=true: both lock C7 then C8, so B simply waits for A (no cycle, no deadlock).
 */
export async function runDeadlock(ctx: Ctx, ordered: boolean): Promise<DeadlockResult> {
  const showtimeId = await demoShowtimeId(ctx);
  await resetSeats(ctx, showtimeId, ['C7', 'C8'], []);
  const c7 = await seatRef(ctx, showtimeId, 'C7');
  const c8 = await seatRef(ctx, showtimeId, 'C8');
  if (!c7 || !c8) throw new Error('C7/C8 not found');

  const t0 = performance.now();
  const timeline: DeadlockResult['timeline'] = [];
  const edges: DeadlockResult['edges'] = [];
  const mark = (customer: Customer, text: string) => timeline.push({ t: Math.round(performance.now() - t0), customer, text });
  const emit = (l: any) => ctx.bus.publish(showtimeId, { type: 'sql', showtimeId, line: l });

  const A = new Session(ctx, 'lab-A', 'A', 'LAB', emit);
  const B = new Session(ctx, 'lab-B', 'B', 'LAB', emit);
  const sessions: Record<Customer, Session> = { A, B };
  const poller = pollLocks(ctx, () => [A, B].filter((s) => s.inTx && s.pid !== null).map((s) => s.pid!), (rows) =>
    ctx.bus.publish(showtimeId, { type: 'locks', showtimeId, rows }));

  let victim = null as Customer | null;
  let code = null as '40P01' | null;

  const lock = async (who: Customer, label: 'C7' | 'C8', waitsOn?: Customer) => {
    const s = sessions[who];
    const ref = label === 'C7' ? c7 : c8;
    mark(who, `SELECT ${label} FOR UPDATE`);
    try {
      await s.exec(LOCK_SQL, [showtimeId, ref.seatId], {
        waitThresholdMs: 60,
        onWait: () => {
          if (waitsOn) { edges.push({ from: who, to: waitsOn, seat: label }); mark(who, `waiting for ${label} held by ${waitsOn}`); }
        },
      });
      mark(who, `lock acquired on ${label}`);
      return true;
    } catch (e: any) {
      if (e.code === '40P01') {
        victim = who; code = '40P01';
        mark(who, 'ERROR 40P01 deadlock detected');
        try { await s.exec('ROLLBACK'); } catch { /* ignore */ }
        s.inTx = false;
        mark(who, 'ROLLBACK (victim)');
        return false;
      }
      throw e;
    }
  };

  const finish = async (who: Customer) => {
    const s = sessions[who];
    if (!s.inTx) return;
    await s.exec('COMMIT');
    s.inTx = false;
    mark(who, 'COMMIT');
  };

  try {
    await Promise.all([A.connect(), B.connect()]);
    // fast detection for the demo (superuser may change it per session)
    await Promise.all([A, B].map((s) => s.exec("SET deadlock_timeout = '200ms'", [], { quiet: true })));
    for (const s of [A, B]) { await s.exec('BEGIN'); s.inTx = true; }
    mark('A', 'BEGIN'); mark('B', 'BEGIN');

    if (!ordered) {
      await lock('A', 'C7');
      await lock('B', 'C8');
      // cross requests at the same time: A wants C8 (held by B), B wants C7 (held by A)
      const pa = lock('A', 'C8', 'B');
      await new Promise((r) => setTimeout(r, 80));
      const pb = lock('B', 'C7', 'A');
      await Promise.all([pa, pb]);
      // whoever survived now holds both locks: commit
      await Promise.all([finish('A'), finish('B')]);
    } else {
      await lock('A', 'C7');
      const pb = lock('B', 'C7', 'A'); // B blocks behind A
      await new Promise((r) => setTimeout(r, 120));
      await lock('A', 'C8');
      await finish('A');
      await pb;
      await lock('B', 'C8');
      await finish('B');
    }
  } finally {
    for (const s of [A, B]) {
      try { if (s.inTx) await s.exec('ROLLBACK', [], { quiet: true }); } catch { /* ignore */ }
      s.inTx = false;
    }
    poller.stop();
    await Promise.all([A.close(), B.close()]);
  }

  const ms = Math.round(performance.now() - t0);
  const deadlock = victim !== null;
  const survivor: Customer | null = victim ? (victim === 'A' ? 'B' : 'A') : null;
  if (deadlock) {
    // the cycle always has both edges, even if one wait was too short for the 60 ms detector to see
    if (!edges.some((e) => e.from === 'A')) edges.push({ from: 'A', to: 'B', seat: 'C8' });
    if (!edges.some((e) => e.from === 'B')) edges.push({ from: 'B', to: 'A', seat: 'C7' });
  }
  const result = deadlock
    ? `Deadlock detected. ${victim} was aborted (40P01); ${survivor} committed.`
    : ordered
      ? 'No deadlock. B waited for A, then both committed.'
      : 'No deadlock this time.';
  return { deadlock, victim, code, edges, timeline, result, ms };
}
