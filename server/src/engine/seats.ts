import type { DbSeatStatus, SeatChange } from '../../../shared/types';
import type { Ctx } from './context';

export interface SeatRef { seatId: number; type: 'STANDARD' | 'RECLINER'; price: number }

/** SQL fragment: seat label such as C7. */
export const LABEL_SQL = "trim(s.row_label) || s.seat_no::text";

export async function seatRef(ctx: Ctx, showtimeId: number, label: string): Promise<SeatRef | null> {
  const r = await ctx.pool.query(
    `SELECT s.seat_id, s.seat_type,
            (CASE s.seat_type WHEN 'RECLINER' THEN st.price_recliner ELSE st.price_standard END)::float8 AS price
       FROM showtime st JOIN seat s ON s.hall_id = st.hall_id
      WHERE st.showtime_id = $1 AND ${LABEL_SQL} = $2`,
    [showtimeId, label],
  );
  if (!r.rows[0]) return null;
  return { seatId: r.rows[0].seat_id, type: r.rows[0].seat_type, price: r.rows[0].price };
}

/** Read current DB truth for the given seats and broadcast a `seats` frame. */
export async function publishSeats(ctx: Ctx, showtimeId: number, labels: string[]): Promise<SeatChange[]> {
  if (labels.length === 0) return [];
  const r = await ctx.pool.query(
    `SELECT ${LABEL_SQL} AS seat, ss.status, ss.booking_id, ss.held_until
       FROM show_seat ss JOIN seat s USING (seat_id)
      WHERE ss.showtime_id = $1 AND ${LABEL_SQL} = ANY($2::text[])`,
    [showtimeId, labels],
  );
  const changes: SeatChange[] = r.rows.map((x) => ({
    seat: x.seat,
    status: x.status as DbSeatStatus,
    bookingId: x.booking_id,
    heldUntil: x.held_until ? new Date(x.held_until).toISOString() : null,
  }));
  if (changes.length) ctx.bus.publish(showtimeId, { type: 'seats', showtimeId, changes });
  return changes;
}

/** Reset one seat to FREE and cancel the given customers' bookings for that showtime (used by showdown / rush / deadlock labs). */
export async function resetSeats(ctx: Ctx, showtimeId: number, labels: string[], customerIds: number[]): Promise<void> {
  await ctx.pool.query(
    `UPDATE show_seat ss SET status = 'FREE', booking_id = NULL, held_until = NULL
       FROM seat s
      WHERE s.seat_id = ss.seat_id AND ss.showtime_id = $1 AND ${LABEL_SQL} = ANY($2::text[])
        AND (ss.status <> 'FREE' OR ss.booking_id IS NOT NULL OR ss.held_until IS NOT NULL)`,
    [showtimeId, labels],
  );
  if (customerIds.length) {
    await ctx.pool.query(
      `UPDATE booking SET status = 'CANCELLED'
        WHERE showtime_id = $1 AND customer_id = ANY($2::int[]) AND status IN ('CONFIRMED', 'PENDING')`,
      [showtimeId, customerIds],
    );
  }
  await publishSeats(ctx, showtimeId, labels);
}
