import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PerfQuery, PerfResult } from '../../../shared/types';
import type { Ctx } from '../engine/context';

// Source layout: server/src/lab -> ../../../db. Bundled (Vercel function): api/_app.mjs -> <cwd>/db (includeFiles).
const DB_DIR = [join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'db'), join(process.cwd(), 'db')]
  .find((d) => existsSync(join(d, 'perf_indexes.sql'))) ?? join(process.cwd(), 'db');
const read = (...p: string[]) => readFileSync(join(DB_DIR, ...p), 'utf8');

const QUERIES: { name: PerfQuery['name']; file: string }[] = [
  { name: 'seat_search', file: 'seat_search.sql' },
  { name: 'sales_report', file: 'sales_report.sql' },
];

/** Tables that perf_indexes.sql indexes (the "after" state), e.g. show_seat, payment. */
function indexedTables(): string[] {
  return [...read('perf_indexes.sql').matchAll(/\bON\s+(\w+)\s*\(/gi)].map((m) => m[1]);
}

/**
 * The scan node worth showing: the scan on a table that perf_indexes.sql targets (largest actual time x loops),
 * else the most expensive scan overall. Example: "Seq Scan on show_seat" -> "Index Scan on show_seat".
 */
export function dominantScan(plan: any, preferTables: string[] = []): string {
  const scans: { label: string; rel: string | undefined; cost: number }[] = [];
  const walk = (n: any) => {
    if (!n) return;
    if (typeof n['Node Type'] === 'string' && /Scan/.test(n['Node Type'])) {
      const rel = n['Relation Name'] as string | undefined;
      scans.push({
        label: rel ? `${n['Node Type']} on ${rel}` : n['Node Type'], rel,
        cost: (n['Actual Total Time'] ?? 0) * (n['Actual Loops'] ?? 1),
      });
    }
    for (const c of n.Plans ?? []) walk(c);
  };
  walk(plan);
  const pool = scans.filter((x) => x.rel && preferTables.includes(x.rel));
  const pick = (pool.length ? pool : scans).sort((a, b) => b.cost - a.cost)[0];
  return pick?.label ?? plan?.['Node Type'] ?? 'unknown';
}

async function indexesPresent(ctx: Ctx): Promise<boolean> {
  const names = [...read('perf_indexes.sql').matchAll(/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)].map((m) => m[1]);
  if (names.length === 0) return false;
  const r = await ctx.pool.query('SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = $1 AND indexname = ANY($2::text[])', ['public', names]);
  return r.rows[0].n === names.length;
}

export async function perfReport(ctx: Ctx): Promise<PerfResult> {
  const queries: PerfQuery[] = [];
  for (const q of QUERIES) {
    const sql = read('queries', q.file).trim().replace(/;\s*$/, '');
    const r = await ctx.pool.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`);
    const doc = r.rows[0]['QUERY PLAN'][0];
    const plan = doc.Plan;
    queries.push({
      name: q.name, sql: read('queries', q.file).trim(), node: dominantScan(plan, indexedTables()),
      ms: Math.round(((doc['Execution Time'] ?? 0) + (doc['Planning Time'] ?? 0)) * 100) / 100,
      rows: plan['Actual Rows'] ?? 0, plan: doc,
    });
  }
  return { indexed: await indexesPresent(ctx), queries };
}

export async function setIndexes(ctx: Ctx, create: boolean): Promise<PerfResult> {
  await ctx.pool.query(read(create ? 'perf_indexes.sql' : 'perf_drop_indexes.sql'));
  return perfReport(ctx);
}
