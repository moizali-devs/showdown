import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await startTestApp(); });
afterAll(async () => { await t.sd('/reset'); await t.waitState((s) => s.seatStatus === 'FREE' && s.result === null, 'reset'); await t.close(); });

describe('REST smoke', () => {
  it('health, demo, movies, movie detail', async () => {
    expect((await t.get('/api/health')).body).toEqual({ ok: true, db: 'embedded' });
    const demo = (await t.get('/api/demo')).body;
    expect(demo).toEqual({ showtimeId: t.showId, seat: 'C7' });
    const movies = (await t.get('/api/movies')).body;
    expect(movies).toHaveLength(8);
    expect(movies[0]).toHaveProperty('art.palette');
    const dune = movies.find((m: any) => m.title === 'Dune: Part Three');
    const d = (await t.get(`/api/movies/${dune.id}`)).body;
    expect(d.movie.title).toBe('Dune: Part Three');
    expect(d.showtimes.length).toBeGreaterThan(0);
    expect(d.showtimes[0]).toMatchObject({ movieTitle: 'Dune: Part Three' });
    expect((await t.get('/api/movies/99999')).status).toBe(404);
    expect((await t.get('/api/nope')).status).toBe(404);
  });

  it('showtime has 140 seats A1..J14, C7 and C8 free, J = recliner', async () => {
    const { showtime, seats } = (await t.get(`/api/showtimes/${t.showId}`)).body;
    expect(showtime.label).toBe('7:15 PM');
    expect(showtime.hall).toBe('Hall 1');
    expect(seats).toHaveLength(140);
    expect(seats[0].seat).toBe('A1');
    expect(seats[139].seat).toBe('J14');
    expect(seats.find((s: any) => s.seat === 'C7')).toMatchObject({ status: 'FREE', type: 'STANDARD', price: 1800 });
    expect(seats.find((s: any) => s.seat === 'C8').status).toBe('FREE');
    expect(seats.find((s: any) => s.seat === 'J1')).toMatchObject({ type: 'RECLINER', price: 3200 });
    expect(seats.find((s: any) => s.seat === 'A3').status).toBe('BOOKED');
  });

  it('validation errors are JSON 4xx', async () => {
    expect((await t.post(`/api/showtimes/${t.showId}/hold`, { seats: [] })).status).toBe(400);
    expect((await t.sd('/mode', { mode: 'nope' })).status).toBe(400);
    expect((await t.post(`/api/showdown/${t.showId}/Z/begin`)).status).toBe(400);
    expect((await t.post('/api/bookings/999999/pay', {})).status).toBe(404);
  });
});

describe('WebSocket', () => {
  it('ping/pong, seats broadcast after a hold, showdown state + sql + locks frames', async () => {
    const c = await t.openWs(t.showId);
    c.ws.send(JSON.stringify({ type: 'ping' }));
    await c.waitFor((m) => m.type === 'pong');

    // a hold is broadcast to every subscriber of that showtime
    const { seats } = (await t.get(`/api/showtimes/${t.showId}`)).body;
    const seat = seats.find((s: any) => s.status === 'FREE' && s.row === 'G' && s.number >= 10).seat;
    const h = await t.post(`/api/showtimes/${t.showId}/hold`, { seats: [seat] });
    const msg = await c.waitFor((m) => m.type === 'seats' && m.changes.some((x: any) => x.seat === seat && x.status === 'HELD'));
    expect(msg.showtimeId).toBe(t.showId);
    await t.post(`/api/bookings/${h.body.bookingId}/cancel`);
    await c.waitFor((m) => m.type === 'seats' && m.changes.some((x: any) => x.seat === seat && x.status === 'FREE'));

    // a different showtime's subscriber does not get it
    const other = await t.openWs(t.showId + 1);

    // showdown run streams state/sql/locks frames
    await t.sd('/mode', { mode: 'lock' });
    await t.waitState((s) => s.mode === 'lock', 'mode');
    await t.sd('/run');
    await c.waitFor((m) => m.type === 'showdown' && m.state.running === true);
    await c.waitFor((m) => m.type === 'sql' && m.line.customer === 'A' && m.line.text.includes('FOR UPDATE'));
    await c.waitFor((m) => m.type === 'locks' && m.rows.some((r: any) => !r.granted));
    await c.waitFor((m) => m.type === 'showdown' && m.state.result === 'One booked. B waited.', 15000);
    await c.waitFor((m) => m.type === 'seats' && m.changes.some((x: any) => x.seat === 'C7' && x.status === 'BOOKED'));
    expect(other.messages.filter((m) => m.type === 'seats' || m.type === 'showdown')).toHaveLength(0);
    c.ws.close(); other.ws.close();
  });
});
