import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await startTestApp(); });
afterAll(async () => { await t.post('/api/lab/perf/indexes', { create: false }); await t.close(); });

describe('Query performance: EXPLAIN (ANALYZE, FORMAT JSON) before / after indexes', () => {
  it('creating the indexes changes the plan node of both queries', async () => {
    const before = (await t.post('/api/lab/perf/indexes', { create: false })).body;
    expect(before.indexed).toBe(false);
    expect(before.queries.map((q: any) => q.name)).toEqual(['seat_search', 'sales_report']);
    for (const q of before.queries) {
      expect(q.sql).toContain('SELECT');
      expect(q.ms).toBeGreaterThan(0);
      expect(q.plan['Plan']).toBeTruthy();
    }
    const after = (await t.post('/api/lab/perf/indexes', { create: true })).body;
    expect(after.indexed).toBe(true);
    const nodes = (r: any) => Object.fromEntries(r.queries.map((q: any) => [q.name, q.node]));
    console.log('[perf before]', nodes(before), before.queries.map((q: any) => q.ms));
    console.log('[perf after ]', nodes(after), after.queries.map((q: any) => q.ms));
    expect(nodes(before).seat_search).toMatch(/^Seq Scan on show_seat/);
    expect(nodes(after).seat_search).not.toMatch(/^Seq Scan/);
    expect(nodes(before).sales_report).toMatch(/^Seq Scan on payment/);
    expect(nodes(after).sales_report).toMatch(/Index (Only )?Scan on payment/);
    expect((await t.get('/api/lab/perf')).body.indexed).toBe(true);
    const dropped = (await t.post('/api/lab/perf/indexes', { create: false })).body;
    expect(dropped.indexed).toBe(false);
    expect(nodes(dropped)).toEqual(nodes(before));
  });
});
