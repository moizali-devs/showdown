import express, { type NextFunction, type Request, type Response } from 'express';
import type { Customer, Mode, Movie, SeatInfo, Showtime } from '../../../shared/types';
import { type Ctx, demoShowtimeId } from '../engine/context';
import { LABEL_SQL } from '../engine/seats';
import type { ShowdownManager } from '../engine/showdown';
import { ApiError, cancelBooking, holdSeats, payBooking } from '../hall/hall';
import { runDeadlock } from '../lab/deadlock';
import { historyAt, historyEvents } from '../lab/history';
import { perfReport, setIndexes } from '../lab/perf';
import { runRush } from '../lab/rush';

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

const MODES: Mode[] = ['off', 'lock', 'atomic', 'optimistic'];

const SHOWTIME_SQL = `
  SELECT st.showtime_id AS id, st.movie_id, m.title AS movie_title, h.name AS hall, st.starts_at,
         to_char(st.starts_at AT TIME ZONE 'Asia/Karachi', 'FMHH12:MI AM') AS label,
         st.price_standard::float8 AS price_standard, st.price_recliner::float8 AS price_recliner,
         (SELECT count(*)::int FROM show_seat ss WHERE ss.showtime_id = st.showtime_id
             AND (ss.status = 'FREE' OR (ss.status = 'HELD' AND ss.held_until < now()))) AS free
    FROM showtime st JOIN movie m USING (movie_id) JOIN hall h USING (hall_id)`;

const toShowtime = (x: any): Showtime => ({
  id: x.id, movieId: x.movie_id, movieTitle: x.movie_title, hall: x.hall, startsAt: new Date(x.starts_at).toISOString(),
  label: x.label, priceStandard: x.price_standard, priceRecliner: x.price_recliner, free: x.free,
});

export function createRouter(ctx: Ctx, showdowns: ShowdownManager): express.Router {
  const r = express.Router();
  r.use(express.json());

  r.get('/health', (_req, res) => { res.json({ ok: true, db: ctx.dbKind }); });

  r.get('/movies', wrap(async (_req, res) => {
    const q = await ctx.pool.query('SELECT movie_id, title, genre, release_year, art FROM movie ORDER BY movie_id');
    const movies: Movie[] = q.rows.map((x) => ({ id: x.movie_id, title: x.title, genre: x.genre, year: x.release_year, art: x.art }));
    res.json(movies);
  }));

  r.get('/movies/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    const m = await ctx.pool.query('SELECT movie_id, title, genre, release_year, art FROM movie WHERE movie_id = $1', [id]);
    if (!m.rows[0]) throw new ApiError(404, 'Movie not found', 'NOT_FOUND');
    const x = m.rows[0];
    const s = await ctx.pool.query(`${SHOWTIME_SQL} WHERE st.movie_id = $1 AND st.starts_at >= now() ORDER BY st.starts_at`, [id]);
    res.json({ movie: { id: x.movie_id, title: x.title, genre: x.genre, year: x.release_year, art: x.art }, showtimes: s.rows.map(toShowtime) });
  }));

  r.get('/demo', wrap(async (_req, res) => { res.json({ showtimeId: await demoShowtimeId(ctx), seat: 'C7' }); }));

  r.get('/showtimes/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    const s = await ctx.pool.query(`${SHOWTIME_SQL} WHERE st.showtime_id = $1`, [id]);
    if (!s.rows[0]) throw new ApiError(404, 'Showtime not found', 'NOT_FOUND');
    const showtime = toShowtime(s.rows[0]);
    const q = await ctx.pool.query(
      `SELECT ${LABEL_SQL} AS seat, trim(s.row_label) AS row, s.seat_no, s.seat_type,
              CASE WHEN ss.status = 'HELD' AND ss.held_until < now() THEN 'FREE' ELSE ss.status END AS status,
              ss.held_until, ss.booking_id
         FROM show_seat ss JOIN seat s USING (seat_id)
        WHERE ss.showtime_id = $1 ORDER BY s.row_label, s.seat_no`, [id]);
    const seats: SeatInfo[] = q.rows.map((x) => ({
      seat: x.seat, row: x.row, number: x.seat_no, type: x.seat_type, status: x.status,
      heldUntil: x.status === 'HELD' && x.held_until ? new Date(x.held_until).toISOString() : null,
      bookingId: x.status === 'FREE' ? null : x.booking_id,
      price: x.seat_type === 'RECLINER' ? showtime.priceRecliner : showtime.priceStandard,
    }));
    res.json({ showtime, seats });
  }));

  r.post('/showtimes/:id/hold', wrap(async (req, res) => {
    res.json(await holdSeats(ctx, Number(req.params.id), req.body?.seats));
  }));

  r.post('/bookings/:id/pay', wrap(async (req, res) => {
    res.json(await payBooking(ctx, Number(req.params.id), { decline: !!req.body?.decline, failSeat: req.body?.failSeat }));
  }));

  r.post('/bookings/:id/cancel', wrap(async (req, res) => {
    res.json(await cancelBooking(ctx, Number(req.params.id)));
  }));

  // ---- showdown ----
  const sd = (req: Request) => {
    const id = Number(req.params.showtimeId);
    if (!Number.isInteger(id)) throw new ApiError(400, 'bad showtime id', 'BAD_REQUEST');
    return showdowns.get(id);
  };
  const cust = (req: Request): Customer => {
    const c = String(req.params.customer).toUpperCase();
    if (c !== 'A' && c !== 'B') throw new ApiError(400, 'customer must be A or B', 'BAD_REQUEST');
    return c;
  };
  const accepted = (res: Response, job: Promise<unknown>) => {
    job.catch((e) => console.error('[showdown]', e?.message ?? e));
    res.status(202).json({ accepted: true });
  };

  r.get('/showdown/:showtimeId', wrap(async (req, res) => { res.json(sd(req).getState()); }));
  r.post('/showdown/:showtimeId/mode', wrap(async (req, res) => {
    const mode = req.body?.mode as Mode;
    if (!MODES.includes(mode)) throw new ApiError(400, 'mode must be off|lock|atomic|optimistic', 'BAD_REQUEST');
    accepted(res, sd(req).setMode(mode));
  }));
  r.post('/showdown/:showtimeId/reset', wrap(async (req, res) => { accepted(res, sd(req).reset()); }));
  r.post('/showdown/:showtimeId/run', wrap(async (req, res) => { accepted(res, sd(req).run()); }));
  r.post('/showdown/:showtimeId/:customer/attach', wrap(async (req, res) => { accepted(res, sd(req).attach(cust(req))); }));
  r.post('/showdown/:showtimeId/:customer/begin', wrap(async (req, res) => { accepted(res, sd(req).begin(cust(req))); }));
  r.post('/showdown/:showtimeId/:customer/confirm', wrap(async (req, res) => { accepted(res, sd(req).confirm(cust(req))); }));
  r.post('/showdown/:showtimeId/:customer/abort', wrap(async (req, res) => { accepted(res, sd(req).abort(cust(req))); }));

  // ---- lab ----
  r.post('/lab/deadlock', wrap(async (req, res) => { res.json(await runDeadlock(ctx, !!req.body?.ordered)); }));
  r.post('/lab/rush', wrap(async (req, res) => {
    const mode = (req.body?.mode ?? 'lock') as Mode;
    if (!MODES.includes(mode)) throw new ApiError(400, 'bad mode', 'BAD_REQUEST');
    res.json(await runRush(ctx, { bots: req.body?.bots, mode, seat: req.body?.seat }));
  }));
  r.get('/lab/history/:showtimeId', wrap(async (req, res) => { res.json(await historyEvents(ctx, Number(req.params.showtimeId))); }));
  r.get('/lab/history/:showtimeId/at', wrap(async (req, res) => {
    const t = new Date(String(req.query.t ?? ''));
    if (Number.isNaN(t.getTime())) throw new ApiError(400, 'query param t must be an ISO timestamp', 'BAD_REQUEST');
    res.json(await historyAt(ctx, Number(req.params.showtimeId), t));
  }));
  r.get('/lab/perf', wrap(async (_req, res) => { res.json(await perfReport(ctx)); }));
  r.post('/lab/perf/indexes', wrap(async (req, res) => { res.json(await setIndexes(ctx, !!req.body?.create)); }));

  // errors
  r.use((_req, res) => { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); });
  r.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) { res.status(err.status).json({ error: err.message, code: err.code, seat: err.seat }); return; }
    if (err?.type === 'entity.parse.failed') { res.status(400).json({ error: 'Invalid JSON', code: 'BAD_REQUEST' }); return; }
    console.error('[api]', err?.message ?? err);
    res.status(500).json({ error: err?.message ?? 'Internal error', code: err?.code });
  });
  return r;
}
