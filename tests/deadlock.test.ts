import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await startTestApp(); });
afterAll(async () => { await t.close(); });

describe('Deadlock lab', () => {
  it('unordered locking: Postgres detects 40P01 and aborts one victim', async () => {
    for (let i = 0; i < 3; i++) {
      const r = (await t.post('/api/lab/deadlock', { ordered: false })).body;
      expect(r.deadlock).toBe(true);
      expect(r.code).toBe('40P01');
      expect(['A', 'B']).toContain(r.victim);
      expect(r.edges).toEqual(expect.arrayContaining([
        { from: 'A', to: 'B', seat: 'C8' }, { from: 'B', to: 'A', seat: 'C7' },
      ]));
      expect(r.timeline.some((e: any) => e.text.includes('40P01'))).toBe(true);
      expect(r.result).toMatch(/Deadlock detected/);
    }
  });

  it('ordered locking (C7 then C8 for both): no deadlock, B waits for A', async () => {
    for (let i = 0; i < 3; i++) {
      const r = (await t.post('/api/lab/deadlock', { ordered: true })).body;
      expect(r.deadlock).toBe(false);
      expect(r.victim).toBeNull();
      expect(r.code).toBeNull();
      expect(r.edges).toEqual([{ from: 'B', to: 'A', seat: 'C7' }]);
      expect(r.timeline.filter((e: any) => e.text === 'COMMIT')).toHaveLength(2);
    }
  });

  it('leaves no lingering connections', async () => {
    const r = await t.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name LIKE 'lab-%'");
    expect(r.rows[0].n).toBe(0);
  });
});
