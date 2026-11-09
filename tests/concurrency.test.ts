import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookingsFor, finishRace, raceManually, startTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await startTestApp(); });
afterAll(async () => { await t.sd('/reset'); await t.waitState((s) => s.seatStatus === 'FREE' && s.result === null, 'reset'); await t.close(); });

describe('Off mode: the lost update is real', () => {
  it('both transactions commit, two CONFIRMED bookings for C7, history shows both writes', async () => {
    await raceManually(t, 'off');
    const s = await finishRace(t);
    expect(s.customers.A.status).toBe('Double booked');
    expect(s.customers.B.status).toBe('Double booked');
    expect(s.seatStatus).toBe('CONFLICT');
    expect(s.result).toBe('Double booked. Lost update.');

    const bookings = await bookingsFor(t.pool, t.showId, [1, 2]);
    expect(bookings.map((b) => b.customer_id).sort()).toEqual([1, 2]);

    // history: both writers touched C7 (FREE->BOOKED by A, then B overwrote booking_id)
    const h = await t.pool.query(
      `SELECT h.old_status, h.new_status, h.booking_id, h.changed_by
         FROM seat_history h JOIN seat s USING (seat_id)
        WHERE h.showtime_id = $1 AND s.row_label || s.seat_no = 'C7' AND h.changed_by LIKE 'showdown-_'
        ORDER BY h.history_id`, [t.showId]);
    expect(h.rows.map((r) => r.changed_by)).toEqual(['showdown-A', 'showdown-B']);
    expect(h.rows[0]).toMatchObject({ old_status: 'FREE', new_status: 'BOOKED' });
    expect(new Set(h.rows.map((r) => r.booking_id)).size).toBe(2);
    // DB truth: show_seat.booking_id = last writer (B)
    const ss = await t.pool.query(
      `SELECT ss.booking_id FROM show_seat ss JOIN seat s USING (seat_id)
        WHERE ss.showtime_id = $1 AND s.row_label || s.seat_no = 'C7'`, [t.showId]);
    expect(ss.rows[0].booking_id).toBe(bookings[1].booking_id);
  });
});

describe('Safe modes never double book (two-phase, interleaved)', () => {
  for (const mode of ['atomic', 'optimistic'] as const) {
    it(`${mode}: exactly one Booked and one Refused`, async () => {
      await raceManually(t, mode);
      const s = await finishRace(t);
      expect([s.customers.A.status, s.customers.B.status].sort()).toEqual(['Booked', 'Refused']);
      expect(s.seatStatus).toBe('BOOKED');
      expect(await bookingsFor(t.pool, t.showId, [1, 2])).toHaveLength(1);
      if (mode === 'optimistic') {
        expect(s.customers.B.steps).toEqual(['SELECT · v' + s.customers.B.steps[0].slice(10), expect.stringMatching(/^UPDATE · v\d+ → v\d+$/), 'version changed', 'retry · seat taken']);
        expect(s.result).toBe('One booked. B retried.');
      } else {
        expect(s.customers.B.steps).toContain('UPDATE · 0 rows');
        expect(s.result).toBe('One booked. No waiting.');
      }
    });
  }

  it('lock: B really waits on A (waitMs > 0, pg_locks shows the waiter), then is refused', async () => {
    await t.sd('/mode', { mode: 'lock' });
    await t.waitState((s) => s.mode === 'lock', 'mode');
    await t.sd('/A/begin');
    await t.waitState((s) => s.customers.A.phase === 'ready', 'A holds lock');
    await t.sd('/B/begin');
    const waiting = await t.waitState((s) => s.customers.B.phase === 'waiting', 'B waiting');
    expect(waiting.customers.B.steps).toContain('waiting on A…');
    // independent proof from the DB: B's backend is blocked by A's backend
    const pids = waiting.customers;
    const blocked = await t.pool.query('SELECT pg_blocking_pids($1) AS b', [pids.B.pid]);
    expect(blocked.rows[0].b).toEqual([pids.A.pid]);
    // lock table poller exposes a non-granted lock with blockedBy = A's pid
    const withLocks = await t.waitState((s) => s.locks.some((l) => !l.granted && l.blockedBy.includes(pids.A.pid!)), 'lock table shows waiter', 5000);
    expect(withLocks.locks.some((l) => l.granted && l.customer === 'A')).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    await t.sd('/A/confirm');
    const s = await t.waitState((x) => x.customers.A.phase === 'done' && x.customers.B.phase === 'done' && x.result !== null, 'finished');
    expect(s.customers.A.status).toBe('Booked');
    expect(s.customers.B.status).toBe('Refused');
    expect(s.customers.B.waitMs).toBeGreaterThan(0);
    expect(s.customers.B.steps).toEqual(['SELECT … FOR UPDATE', 'waiting on A…', 'lock granted', 'seat taken']);
    expect(s.result).toBe('One booked. B waited.');
    expect(await bookingsFor(t.pool, t.showId, [1, 2])).toHaveLength(1);
  });
});

describe('Single-page server-driven Run', () => {
  const expected: Record<string, string> = {
    off: 'Double booked. Lost update.', lock: 'One booked. B waited.', atomic: 'One booked. No waiting.', optimistic: 'One booked. B retried.',
  };
  for (const mode of ['off', 'lock', 'atomic', 'optimistic'] as const) {
    it(`run in ${mode} mode`, async () => {
      await t.sd('/mode', { mode });
      await t.waitState((s) => s.mode === mode && !s.running, 'mode set');
      await t.sd('/run');
      const s = await t.waitState((x) => !x.running && x.result !== null, 'run finished', 20000);
      expect(s.result).toBe(expected[mode]);
      const n = (await bookingsFor(t.pool, t.showId, [1, 2])).length;
      expect(n).toBe(mode === 'off' ? 2 : 1);
      expect(s.customers.A.sql.length).toBeGreaterThan(3);
      // reset puts the seat back
      await t.sd('/reset');
      const r = await t.waitState((x) => x.seatStatus === 'FREE' && x.customers.A.phase === 'idle' && x.result === null, 'reset');
      expect(r.customers.A.steps).toEqual([]);
      expect(await bookingsFor(t.pool, t.showId, [1, 2])).toHaveLength(0);
    });
  }
});
