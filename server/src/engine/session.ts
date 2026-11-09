import pg from 'pg';
import type { SqlLine } from '../../../shared/types';
import { type Ctx, mkLine } from './context';

export interface ExecResult { rows: any[]; rowCount: number; ms: number; waited: boolean; waitMs: number }
export interface ExecOpts { onWait?: (blockerLabels: string[]) => void; quiet?: boolean; waitThresholdMs?: number }

/** Inline $n params for display only (the real statement is parameterised). */
export function formatSql(sql: string, params: unknown[] = []): string {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return flat.replace(/\$(\d+)/g, (_, n) => {
    const v = params[Number(n) - 1];
    if (v === null || v === undefined) return 'NULL';
    return typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
  });
}

/**
 * One customer = one dedicated pg.Client (its own backend process), so FOR UPDATE waits,
 * deadlocks (40P01) and pg_locks are real. Operations are serialised through a promise queue.
 */
export class Session {
  client: pg.Client | null = null;
  pid: number | null = null;
  inTx = false;
  /** in-flight statement (for cancel on reset) */
  busy = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private ctx: Ctx,
    readonly appName: string,
    readonly label: string,
    private who: SqlLine['customer'],
    private emit: (line: SqlLine) => void,
  ) {}

  async connect(): Promise<void> {
    if (this.client) return;
    const c = new pg.Client({ connectionString: this.ctx.connectionString, application_name: this.appName });
    c.on('error', () => { if (this.client === c) { this.client = null; this.inTx = false; } });
    await c.connect();
    const r = await c.query('SELECT pg_backend_pid() AS pid');
    this.client = c;
    this.pid = r.rows[0].pid;
    this.ctx.clients.add(c);
    this.ctx.pids.set(this.pid!, this.label);
  }

  /** run fn after all previously queued ops on this session (strictly serial). */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  info(text: string): void { this.emit(mkLine(this.who, 'info', text)); }

  async exec(sql: string, params: unknown[] = [], opts: ExecOpts = {}): Promise<ExecResult> {
    await this.connect();
    const client = this.client!;
    const text = formatSql(sql, params);
    const head = text.slice(0, 12).toUpperCase();
    const isCommit = head.startsWith('COMMIT');
    const isRollback = head.startsWith('ROLLBACK');
    if (!opts.quiet && !isCommit && !isRollback) this.emit(mkLine(this.who, 'stmt', text));
    const t0 = performance.now();
    let done = false;
    let waited = false;
    let waitAt = 0;
    const threshold = opts.waitThresholdMs ?? 150;
    const timer = setInterval(async () => {
      if (done || waited || this.pid === null) return;
      try {
        const r = await this.ctx.pool.query('SELECT pg_blocking_pids($1) AS b', [this.pid]);
        const blockers: number[] = r.rows[0].b;
        if (done || waited || blockers.length === 0) return;
        waited = true;
        waitAt = performance.now();
        const names = blockers.map((p) => this.ctx.pids.get(p) ?? `pid ${p}`);
        if (!opts.quiet) this.emit(mkLine(this.who, 'wait', `waiting for lock held by ${names.join(', ')}`));
        opts.onWait?.(names);
      } catch { /* admin check failed: ignore */ }
    }, threshold);
    this.busy = true;
    try {
      const res = await client.query(sql, params as any[]);
      done = true;
      const ms = performance.now() - t0;
      if (!opts.quiet) {
        if (waited) this.emit(mkLine(this.who, 'grant', `lock granted after ${Math.round(ms)} ms`, { ms }));
        if (isCommit) this.emit(mkLine(this.who, 'commit', 'COMMIT', { ms }));
        else if (isRollback) this.emit(mkLine(this.who, 'rollback', 'ROLLBACK', { ms }));
        else if (!head.startsWith('BEGIN') && !head.startsWith('SET')) this.emit(mkLine(this.who, 'result', summarize(res), { ms }));
      }
      return { rows: res.rows ?? [], rowCount: res.rowCount ?? 0, ms, waited, waitMs: waited ? ms : 0 };
    } catch (e: any) {
      done = true;
      const ms = performance.now() - t0;
      if (!opts.quiet) this.emit(mkLine(this.who, 'error', `${e.code ?? 'ERR'} ${e.message}`, { ms, code: e.code }));
      e.waited = waited;
      e.ms = ms;
      throw e;
    } finally {
      clearInterval(timer);
      this.busy = false;
    }
  }

  /** Cancel an in-flight (blocked) statement from the admin side. */
  async cancelInflight(): Promise<void> {
    if (this.busy && this.pid !== null) {
      try { await this.ctx.pool.query('SELECT pg_cancel_backend($1)', [this.pid]); } catch { /* ignore */ }
    }
  }

  /** Roll back an open transaction (after cancelling anything in flight). */
  async abort(): Promise<void> {
    await this.cancelInflight();
    await this.run(async () => {
      if (this.client && this.inTx) {
        try { await this.exec('ROLLBACK', [], { quiet: true }); } catch { /* already gone */ }
      }
      this.inTx = false;
    });
  }

  async close(): Promise<void> {
    const c = this.client;
    this.client = null;
    if (this.pid !== null) this.ctx.pids.delete(this.pid);
    if (c) { this.ctx.clients.delete(c); try { await c.end(); } catch { /* ignore */ } }
  }
}

function summarize(res: pg.QueryResult): string {
  if (res.command === 'SELECT') {
    if (res.rowCount === 0) return '0 rows';
    const s = Object.entries(res.rows[0]).map(([k, v]) => `${k}=${v}`).join(', ');
    return res.rowCount === 1 ? s : `${res.rowCount} rows · ${s}`;
  }
  return `${res.command} ${res.rowCount ?? 0}`;
}
