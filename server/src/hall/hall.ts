import type pg from 'pg';
import type { HoldResult, PayResult } from '../../../shared/types';
import type { Ctx } from '../engine/context';
import { LABEL_SQL, publishSeats } from '../engine/seats';
import { formatSql } from '../engine/session';

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string, readonly seat?: string) { super(message); }
}

const GUEST = 3;

/** Hold seats for the Guest customer through the PL/pgSQL procedure book_seats(). */
export async function holdSeats(ctx: Ctx, showtimeId: number, seats: string[]): Promise<HoldResult> {
  if (!Array.isArray(seats) || seats.length === 0 || seats.some((s) => typeof s !== 'string' || !/^[A-J]\d{1,2}$/.test(s))) {
    throw new ApiError(400, 'seats must be a non-empty array of labels like C7', 'BAD_REQUEST');
  }
  const unique = [...new Set(seats)];
  const stmt = 'SELECT book_seats($1, $2, $3::text[], $4)';
  const params = [showtimeId, GUEST, unique, 5];
  let bookingId: number;
  try {
    const r = await ctx.pool.query(stmt, params);
    bookingId = r.rows[0].book_seats;
  } catch (e: any) {
    const m = /^(SEAT_TAKEN|SEAT_UNKNOWN):(\S+)/.exec(e?.message ?? '');
    if (m) throw new ApiError(m[1] === 'SEAT_TAKEN' ? 409 : 404, `Seat ${m[2]} is not available`, m[1], m[2]);
    if (/SHOWTIME_UNKNOWN/.test(e?.message ?? '')) throw new ApiError(404, 'Showtime not found', 'SHOWTIME_UNKNOWN');
    throw e;
  }
  const r = await ctx.pool.query(
    `SELECT b.total::float8 AS total, (SELECT max(held_until) FROM show_seat WHERE booking_id = b.booking_id) AS held_until
       FROM booking b WHERE b.booking_id = $1`, [bookingId]);
  await publishSeats(ctx, showtimeId, unique);
  return {
    bookingId,
    heldUntil: r.rows[0]?.held_until ? new Date(r.rows[0].held_until).toISOString() : null,
    total: r.rows[0]?.total ?? 0,
    sql: [formatSql(stmt, params)],
  };
}

interface HeldSeat { seat_id: number; label: string; price: number }

/**
 * Atomic payment. One transaction; each seat is wrapped in a SAVEPOINT so a failure keeps the others.
 * decline=true rolls the whole payment back, then a second transaction releases the seats.
 */
export async function payBooking(ctx: Ctx, bookingId: number, opts: { decline?: boolean; failSeat?: string }): Promise<PayResult> {
  const sql: string[] = [];
  const client: pg.PoolClient = await ctx.pool.connect();
  const q = async (text: string, params: unknown[] = []) => {
    sql.push(formatSql(text, params));
    return client.query(text, params as any[]);
  };
  let showtimeId = 0;
  let touched: string[] = [];
  try {
    const b = await ctx.pool.query('SELECT showtime_id, status FROM booking WHERE booking_id = $1', [bookingId]);
    if (!b.rows[0]) throw new ApiError(404, 'Booking not found', 'NOT_FOUND');
    if (b.rows[0].status !== 'PENDING') throw new ApiError(409, `Booking is ${b.rows[0].status}`, 'NOT_PENDING');
    showtimeId = b.rows[0].showtime_id;
    const held = await ctx.pool.query(
      `SELECT ss.seat_id, ${LABEL_SQL} AS label,
              (CASE s.seat_type WHEN 'RECLINER' THEN st.price_recliner ELSE st.price_standard END)::float8 AS price
         FROM show_seat ss JOIN seat s USING (seat_id) JOIN showtime st ON st.showtime_id = ss.showtime_id
        WHERE ss.booking_id = $1 AND ss.status = 'HELD'
        ORDER BY s.row_label, s.seat_no`, [bookingId]);
    const seats: HeldSeat[] = held.rows;
    touched = seats.map((x) => x.label);
    if (seats.length === 0) throw new ApiError(409, 'Hold expired: no held seats for this booking', 'HOLD_EXPIRED');

    await q('BEGIN');
    const pay = await q("INSERT INTO payment (booking_id, amount, status) VALUES ($1, $2, 'PENDING') RETURNING payment_id",
      [bookingId, seats.reduce((a, x) => a + x.price, 0)]);
    const paymentId: number = pay.rows[0].payment_id;
    const booked: HeldSeat[] = [];
    const released: HeldSeat[] = [];
    for (const s of seats) {
      const sp = `seat_${s.label}`;
      await q(`SAVEPOINT ${sp}`);
      const u = await q(
        `UPDATE show_seat SET status = 'BOOKED', held_until = NULL, version = version + 1
          WHERE showtime_id = $1 AND seat_id = $2 AND booking_id = $3 AND status = 'HELD'`,
        [showtimeId, s.seat_id, bookingId]);
      if (s.label === opts.failSeat || u.rowCount !== 1) {
        await q(`ROLLBACK TO SAVEPOINT ${sp}`);
        await q(`UPDATE show_seat SET status = 'FREE', booking_id = NULL, held_until = NULL, version = version + 1
                  WHERE showtime_id = $1 AND seat_id = $2 AND booking_id = $3 AND status = 'HELD'`,
          [showtimeId, s.seat_id, bookingId]);
        await q(`RELEASE SAVEPOINT ${sp}`);
        released.push(s);
      } else {
        await q(`RELEASE SAVEPOINT ${sp}`);
        booked.push(s);
      }
    }

    if (opts.decline || booked.length === 0) {
      await q('ROLLBACK');
      // second transaction: the failed payment is recorded and every seat goes back to FREE
      await q('BEGIN');
      await q(`UPDATE show_seat SET status = 'FREE', booking_id = NULL, held_until = NULL, version = version + 1
                WHERE booking_id = $1 AND status = 'HELD'`, [bookingId]);
      await q("UPDATE booking SET status = 'FAILED', total = 0 WHERE booking_id = $1", [bookingId]);
      await q("INSERT INTO payment (booking_id, amount, status) VALUES ($1, 0, 'FAILED')", [bookingId]);
      await q('COMMIT');
      await publishSeats(ctx, showtimeId, touched);
      return { status: 'FAILED', booked: [], released: touched, amount: 0, sql };
    }

    const amount = booked.reduce((a, x) => a + x.price, 0);
    await q("UPDATE payment SET status = 'PAID', amount = $2, paid_at = now() WHERE payment_id = $1", [paymentId, amount]);
    await q("UPDATE booking SET status = 'CONFIRMED', total = $2 WHERE booking_id = $1", [bookingId, amount]);
    await q('COMMIT');
    await publishSeats(ctx, showtimeId, touched);
    return {
      status: released.length ? 'PARTIAL' : 'CONFIRMED',
      booked: booked.map((x) => x.label), released: released.map((x) => x.label), amount, sql,
    };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function cancelBooking(ctx: Ctx, bookingId: number): Promise<{ released: string[] }> {
  const b = await ctx.pool.query('SELECT showtime_id, status FROM booking WHERE booking_id = $1', [bookingId]);
  if (!b.rows[0]) throw new ApiError(404, 'Booking not found', 'NOT_FOUND');
  if (b.rows[0].status !== 'PENDING') throw new ApiError(409, `Booking is ${b.rows[0].status}`, 'NOT_PENDING');
  const showtimeId = b.rows[0].showtime_id;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE show_seat ss SET status = 'FREE', booking_id = NULL, held_until = NULL, version = version + 1
         FROM seat s WHERE s.seat_id = ss.seat_id AND ss.booking_id = $1 AND ss.status = 'HELD'
       RETURNING ${LABEL_SQL} AS label`, [bookingId]);
    await client.query("UPDATE booking SET status = 'CANCELLED' WHERE booking_id = $1", [bookingId]);
    await client.query('COMMIT');
    const labels: string[] = r.rows.map((x) => x.label);
    await publishSeats(ctx, showtimeId, labels);
    return { released: labels };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally { client.release(); }
}

/** Free expired holds (release_expired_holds()) and broadcast the changes. */
export async function sweepExpired(ctx: Ctx): Promise<{ showtime_id: number; seat_label: string }[]> {
  const r = await ctx.pool.query('SELECT showtime_id, seat_label FROM release_expired_holds()');
  const byShow = new Map<number, string[]>();
  for (const x of r.rows) {
    const a = byShow.get(x.showtime_id) ?? [];
    a.push(x.seat_label);
    byShow.set(x.showtime_id, a);
  }
  for (const [sid, labels] of byShow) await publishSeats(ctx, sid, labels);
  return r.rows;
}

export function startSweeper(ctx: Ctx, everyMs = 15000): { stop: () => void } {
  const t = setInterval(() => { sweepExpired(ctx).catch(() => undefined); }, everyMs);
  t.unref();
  return { stop: () => clearInterval(t) };
}
