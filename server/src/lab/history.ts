import type { DbSeatStatus, HistoryAt, HistoryEvents } from '../../../shared/types';
import type { Ctx } from '../engine/context';
import { LABEL_SQL } from '../engine/seats';
import { formatSql } from '../engine/session';

export async function historyEvents(ctx: Ctx, showtimeId: number): Promise<HistoryEvents> {
  const r = await ctx.pool.query(
    `SELECT ${LABEL_SQL} AS seat, h.old_status, h.new_status, h.changed_at
       FROM seat_history h JOIN seat s USING (seat_id)
      WHERE h.showtime_id = $1 ORDER BY h.changed_at, h.history_id`, [showtimeId]);
  const events = r.rows.map((x) => ({
    seat: x.seat as string, oldStatus: x.old_status as string | null, newStatus: x.new_status as string,
    at: new Date(x.changed_at).toISOString(),
  }));
  const now = new Date();
  const from = events[0]?.at ?? new Date(now.getTime() - 75 * 60_000).toISOString();
  return { from, to: now.toISOString(), events };
}

// State of every seat at time $2: latest event at/before $2 (DISTINCT ON), else the old_status of the first event
// after $2, else the seat has never changed so its current status is its status at $2.
const AT_SQL = `
WITH last_before AS (
  SELECT DISTINCT ON (seat_id) seat_id, new_status AS status
    FROM seat_history
   WHERE showtime_id = $1 AND changed_at <= $2
   ORDER BY seat_id, changed_at DESC, history_id DESC),
first_after AS (
  SELECT DISTINCT ON (seat_id) seat_id, old_status AS status
    FROM seat_history
   WHERE showtime_id = $1 AND changed_at > $2
   ORDER BY seat_id, changed_at ASC, history_id ASC)
SELECT ${LABEL_SQL} AS seat, COALESCE(lb.status, fa.status, ss.status) AS status
  FROM show_seat ss
  JOIN seat s ON s.seat_id = ss.seat_id
  LEFT JOIN last_before lb ON lb.seat_id = ss.seat_id
  LEFT JOIN first_after fa ON fa.seat_id = ss.seat_id
 WHERE ss.showtime_id = $1
 ORDER BY s.row_label, s.seat_no`;

export async function historyAt(ctx: Ctx, showtimeId: number, t: Date): Promise<HistoryAt> {
  const r = await ctx.pool.query(AT_SQL, [showtimeId, t.toISOString()]);
  const seats: Record<string, DbSeatStatus> = {};
  for (const x of r.rows) seats[x.seat] = x.status;
  return { at: t.toISOString(), seats, sql: formatSql(AT_SQL, [showtimeId, t.toISOString()]).trim() };
}
