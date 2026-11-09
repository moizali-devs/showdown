import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookingsFor, startTestApp, type TestApp } from './helpers';

let t: TestApp;
const BOT_IDS = Array.from({ length: 50 }, (_, i) => 4 + i);
beforeAll(async () => { t = await startTestApp(); });
afterAll(async () => { await t.post('/api/lab/rush', { bots: 1, mode: 'lock' }).catch(() => undefined); await t.close(); });

describe('Rush hour: 50 dedicated connections, one seat', () => {
  for (const mode of ['lock', 'atomic', 'optimistic'] as const) {
    it(`${mode}: exactly 1 booked, 49 refused, 0 errors`, async () => {
      const r = (await t.post('/api/lab/rush', { bots: 50, mode, seat: 'C7' })).body;
      console.log(`[rush ${mode}]`, JSON.stringify({ ...r, bots: undefined }));
      expect(r.tried).toBe(50);
      expect(r.booked).toBe(1);
      expect(r.refused).toBe(49);
      expect(r.errors).toBe(0);
      expect(r.bots).toHaveLength(50);
      expect(r.bots.filter((b: any) => b.ok)).toHaveLength(1);
      expect(r.throughputTps).toBeGreaterThan(0);
      expect(r.avgResponseMs).toBeGreaterThan(0);
      expect(r.lockWaitRatio).toBeGreaterThanOrEqual(0);
      expect(r.lockWaitRatio).toBeLessThanOrEqual(1);
      // DB truth
      expect(await bookingsFor(t.pool, t.showId, BOT_IDS)).toHaveLength(1);
      const seat = await t.pool.query(
        "SELECT ss.status FROM show_seat ss JOIN seat s USING (seat_id) WHERE ss.showtime_id = $1 AND s.row_label || s.seat_no = 'C7'", [t.showId]);
      expect(seat.rows[0].status).toBe('BOOKED');
    });
  }

  it('lock mode has a real lock-wait ratio (49 bots queued on the row lock)', async () => {
    const r = (await t.post('/api/lab/rush', { bots: 50, mode: 'lock' })).body;
    expect(r.lockWaitRatio).toBeGreaterThan(0.2);
    expect(r.bots.filter((b: any) => b.waitMs > 0).length).toBeGreaterThan(10);
  });

  it('off mode: the seat can be double booked (bookings >= 1, usually many)', async () => {
    const r = (await t.post('/api/lab/rush', { bots: 50, mode: 'off' })).body;
    console.log('[rush off]', r.booked, 'bots booked the same seat');
    expect(r.booked).toBeGreaterThanOrEqual(1);
    expect(await bookingsFor(t.pool, t.showId, BOT_IDS)).toHaveLength(r.booked);
  });

  it('releases all 50 connections afterwards', async () => {
    const r = await t.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name LIKE 'bot-%'");
    expect(r.rows[0].n).toBe(0);
  });
});
