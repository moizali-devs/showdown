import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers';

let t: TestApp;
const used: string[] = [];
beforeAll(async () => { t = await startTestApp(); });
afterAll(async () => {
  if (used.length) {
    await t.pool.query(
      `UPDATE show_seat ss SET status = 'FREE', booking_id = NULL, held_until = NULL
         FROM seat s WHERE s.seat_id = ss.seat_id AND ss.showtime_id = $1 AND s.row_label || s.seat_no = ANY($2::text[])`,
      [t.showId, used]);
  }
  await t.close();
});

describe('seat_history trigger and time machine', () => {
  it('trigger writes a history row per status change, with changed_by = application_name', async () => {
    const { body } = await t.get(`/api/showtimes/${t.showId}`);
    const seat = body.seats.find((s: any) => s.status === 'FREE' && s.row === 'I' && s.number >= 10).seat as string;
    used.push(seat);
    const before = (await t.pool.query('SELECT count(*)::int AS n FROM seat_history WHERE showtime_id = $1', [t.showId])).rows[0].n;
    const h = await t.post(`/api/showtimes/${t.showId}/hold`, { seats: [seat] });
    await t.post(`/api/bookings/${h.body.bookingId}/pay`, {});
    const rows = (await t.pool.query(
      `SELECT h.old_status, h.new_status, h.booking_id, h.changed_by FROM seat_history h JOIN seat s USING (seat_id)
        WHERE h.showtime_id = $1 AND s.row_label || s.seat_no = $2 ORDER BY h.history_id DESC LIMIT 2`, [t.showId, seat])).rows.reverse();
    expect(rows.map((r) => [r.old_status, r.new_status])).toEqual([['FREE', 'HELD'], ['HELD', 'BOOKED']]);
    expect(rows[0].booking_id).toBe(h.body.bookingId);
    expect(rows[0].changed_by).toBe('showdown-admin');
    const after = (await t.pool.query('SELECT count(*)::int AS n FROM seat_history WHERE showtime_id = $1', [t.showId])).rows[0].n;
    expect(after - before).toBe(2);
  });

  it('GET /lab/history lists events; /at rebuilds the hall at a past time with DISTINCT ON', async () => {
    const { body: ev } = await t.get(`/api/lab/history/${t.showId}`);
    expect(ev.events.length).toBeGreaterThan(10);
    expect(new Date(ev.from).getTime()).toBeLessThan(new Date(ev.to).getTime());
    const first = ev.events[0];

    // just before the first event, that seat has its old status
    const early = (await t.get(`/api/lab/history/${t.showId}/at?t=${new Date(new Date(first.at).getTime() - 1000).toISOString()}`)).body;
    expect(Object.keys(early.seats)).toHaveLength(140);
    expect(early.sql).toContain('DISTINCT ON');
    expect(early.seats[first.seat]).toBe(first.oldStatus ?? 'FREE');

    // at "now" the rebuilt hall equals the live hall (expired holds aside)
    const now = (await t.get(`/api/lab/history/${t.showId}/at?t=${new Date(Date.now() + 1000).toISOString()}`)).body;
    const live = (await t.pool.query(
      `SELECT s.row_label || s.seat_no AS seat, ss.status FROM show_seat ss JOIN seat s USING (seat_id) WHERE ss.showtime_id = $1`, [t.showId])).rows;
    for (const r of live) expect(now.seats[r.seat], r.seat).toBe(r.status);

    // slider moves: hall at the first event differs from "now" somewhere
    const diff = Object.keys(now.seats).filter((k) => now.seats[k] !== early.seats[k]);
    expect(diff.length).toBeGreaterThan(5);
    expect((await t.get(`/api/lab/history/${t.showId}/at?t=nope`)).status).toBe(400);
  });
});
