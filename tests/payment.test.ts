import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sweepExpired } from '../server/src/hall/hall';
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

async function freeSeats(n: number): Promise<string[]> {
  const { body } = await t.get(`/api/showtimes/${t.showId}`);
  const free = body.seats.filter((s: any) => s.status === 'FREE' && ['F', 'G', 'H'].includes(s.row) && s.number >= 5 && s.seat !== 'C7' && !used.includes(s.seat)).map((s: any) => s.seat);
  const pick = free.slice(0, n);
  used.push(...pick);
  return pick;
}
const statusOf = async (labels: string[]) => {
  const r = await t.pool.query(
    `SELECT s.row_label || s.seat_no AS seat, ss.status, ss.booking_id FROM show_seat ss JOIN seat s USING (seat_id)
      WHERE ss.showtime_id = $1 AND s.row_label || s.seat_no = ANY($2::text[]) ORDER BY s.seat_no`, [t.showId, labels]);
  return Object.fromEntries(r.rows.map((x) => [x.seat, x]));
};

describe('Hold', () => {
  it('holds seats via book_seats() and rejects a second hold with 409 SEAT_TAKEN', async () => {
    const seats = await freeSeats(2);
    const h = await t.post(`/api/showtimes/${t.showId}/hold`, { seats });
    expect(h.status).toBe(200);
    expect(h.body.bookingId).toBeGreaterThan(0);
    expect(h.body.total).toBe(3600);
    expect(new Date(h.body.heldUntil).getTime()).toBeGreaterThan(Date.now());
    expect(h.body.sql[0]).toContain('book_seats');
    expect(Object.values(await statusOf(seats)).map((x: any) => x.status)).toEqual(['HELD', 'HELD']);

    const again = await t.post(`/api/showtimes/${t.showId}/hold`, { seats: [seats[1]] });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'SEAT_TAKEN', seat: seats[1] });
    // all-or-nothing: a cart with one taken seat holds nothing
    const [fresh] = await freeSeats(1);
    const mixed = await t.post(`/api/showtimes/${t.showId}/hold`, { seats: [fresh, seats[0]] });
    expect(mixed.status).toBe(409);
    expect((await statusOf([fresh]))[fresh].status).toBe('FREE');
    await t.post(`/api/bookings/${h.body.bookingId}/cancel`);
    expect(Object.values(await statusOf(seats)).map((x: any) => x.status)).toEqual(['FREE', 'FREE']);
  });

  it('expiry sweeper frees stale holds and cancels their PENDING booking', async () => {
    const seats = await freeSeats(1);
    const h = await t.post(`/api/showtimes/${t.showId}/hold`, { seats });
    await t.pool.query("UPDATE show_seat SET held_until = now() - interval '1 minute' WHERE booking_id = $1", [h.body.bookingId]);
    const freed = await sweepExpired(t.app.ctx);
    expect(freed.map((x) => x.seat_label)).toContain(seats[0]);
    expect((await statusOf(seats))[seats[0]].status).toBe('FREE');
    const b = await t.pool.query('SELECT status FROM booking WHERE booking_id = $1', [h.body.bookingId]);
    expect(b.rows[0].status).toBe('CANCELLED');
  });
});

describe('Atomic payment', () => {
  it('failSeat: SAVEPOINT rolls back only that seat, the others are paid', async () => {
    const seats = await freeSeats(3);
    const h = await t.post(`/api/showtimes/${t.showId}/hold`, { seats });
    const p = await t.post(`/api/bookings/${h.body.bookingId}/pay`, { failSeat: seats[1] });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ status: 'PARTIAL', booked: [seats[0], seats[2]], released: [seats[1]], amount: 3600 });
    expect(p.body.sql.some((s: string) => s.startsWith('SAVEPOINT'))).toBe(true);
    expect(p.body.sql.some((s: string) => s.startsWith('ROLLBACK TO SAVEPOINT'))).toBe(true);
    const st = await statusOf(seats);
    expect(st[seats[0]].status).toBe('BOOKED');
    expect(st[seats[1]].status).toBe('FREE');
    expect(st[seats[2]].status).toBe('BOOKED');
    const pay = await t.pool.query('SELECT status, amount::float8 AS amount FROM payment WHERE booking_id = $1', [h.body.bookingId]);
    expect(pay.rows).toEqual([{ status: 'PAID', amount: 3600 }]);
    const bk = await t.pool.query('SELECT status, total::float8 AS total FROM booking WHERE booking_id = $1', [h.body.bookingId]);
    expect(bk.rows[0]).toEqual({ status: 'CONFIRMED', total: 3600 });
  });

  it('plain pay confirms everything', async () => {
    const seats = await freeSeats(2);
    const h = await t.post(`/api/showtimes/${t.showId}/hold`, { seats });
    const p = await t.post(`/api/bookings/${h.body.bookingId}/pay`, {});
    expect(p.body).toMatchObject({ status: 'CONFIRMED', booked: seats, released: [], amount: 3600 });
    expect(Object.values(await statusOf(seats)).map((x: any) => x.status)).toEqual(['BOOKED', 'BOOKED']);
    // paying twice is rejected
    expect((await t.post(`/api/bookings/${h.body.bookingId}/pay`, {})).status).toBe(409);
  });

  it('decline: the whole payment rolls back and every seat is released', async () => {
    const seats = await freeSeats(2);
    const h = await t.post(`/api/showtimes/${t.showId}/hold`, { seats });
    const p = await t.post(`/api/bookings/${h.body.bookingId}/pay`, { decline: true });
    expect(p.body).toMatchObject({ status: 'FAILED', booked: [], released: seats, amount: 0 });
    expect(p.body.sql.filter((s: string) => s === 'ROLLBACK')).toHaveLength(1);
    expect(Object.values(await statusOf(seats)).map((x: any) => [x.status, x.booking_id])).toEqual([['FREE', null], ['FREE', null]]);
    const bk = await t.pool.query('SELECT status FROM booking WHERE booking_id = $1', [h.body.bookingId]);
    expect(bk.rows[0].status).toBe('FAILED');
    const pay = await t.pool.query('SELECT status FROM payment WHERE booking_id = $1', [h.body.bookingId]);
    expect(pay.rows.map((r) => r.status)).toEqual(['FAILED']); // the PENDING insert was rolled back
  });
});
