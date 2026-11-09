import type { Customer, CustomerState, Mode, ShowdownState, SqlLine } from '../../../shared/types';
import { type Ctx, sleep } from './context';
import { pollLocks } from './locks';
import { LABEL_SQL, publishSeats, resetSeats, seatRef, type SeatRef } from './seats';
import { Session } from './session';

const CUSTOMER_ID: Record<Customer, number> = { A: 1, B: 2 };
const OTHER: Record<Customer, Customer> = { A: 'B', B: 'A' };
const MAX_STEPS = 4;
const MAX_SQL = 120;

class Stale extends Error {}

function blankCustomer(prev?: CustomerState): CustomerState {
  return {
    attached: prev?.attached ?? false, pid: prev?.pid ?? null, phase: 'idle',
    steps: [], status: null, sql: [], waitMs: 0, totalMs: null,
  };
}

interface Internal { startedAt: number; version: number | null; lockHeld: boolean; retried: boolean }

/**
 * The race for one showtime's demo seat. Each customer owns a dedicated session; begin/confirm are the
 * two phases of CONTRACT section 4 so a transaction can stay open between clicks (two browser windows).
 */
export class Showdown {
  state: ShowdownState;
  private sessions: Partial<Record<Customer, Session>> = {};
  private internal: Record<Customer, Internal> = { A: this.blankInternal(), B: this.blankInternal() };
  private gen = 0;
  private ref: SeatRef | null = null;
  private poll: { stop: () => void; done: () => boolean } | null = null;
  private emitQueued = false;
  private conflict = false;

  constructor(private ctx: Ctx, readonly showtimeId: number, seat = 'C7') {
    this.state = {
      showtimeId, seat, mode: 'off', running: false, seatStatus: 'FREE',
      customers: { A: blankCustomer(), B: blankCustomer() }, result: null, locks: [],
    };
  }

  private blankInternal(): Internal { return { startedAt: 0, version: null, lockHeld: false, retried: false }; }

  getState(): ShowdownState { return this.state; }

  // ---------- plumbing ----------
  private emit(): void {
    if (this.emitQueued) return;
    this.emitQueued = true;
    setImmediate(() => {
      this.emitQueued = false;
      this.ctx.bus.publish(this.showtimeId, { type: 'showdown', state: this.state });
    });
  }

  private onLine(c: Customer, line: SqlLine): void {
    const arr = this.state.customers[c].sql;
    arr.push(line);
    if (arr.length > MAX_SQL) arr.splice(0, arr.length - MAX_SQL);
    this.ctx.bus.publish(this.showtimeId, { type: 'sql', showtimeId: this.showtimeId, line });
    this.emit();
  }

  private session(c: Customer): Session {
    let s = this.sessions[c];
    if (!s) {
      s = new Session(this.ctx, `showdown-${c}`, c, c, (l) => this.onLine(c, l));
      this.sessions[c] = s;
    }
    return s;
  }

  private step(c: Customer, text: string): void {
    const st = this.state.customers[c].steps;
    if (st.length < MAX_STEPS) st.push(text);
    this.emit();
  }

  private chk(gen: number): void { if (gen !== this.gen) throw new Stale(); }

  private async getRef(): Promise<SeatRef> {
    if (!this.ref) {
      this.ref = await seatRef(this.ctx, this.showtimeId, this.state.seat);
      if (!this.ref) throw new Error(`seat ${this.state.seat} not found for showtime ${this.showtimeId}`);
    }
    return this.ref;
  }

  private activePids(): number[] {
    const out: number[] = [];
    for (const s of Object.values(this.sessions)) if (s && s.pid !== null && (s.inTx || s.busy)) out.push(s.pid);
    return out;
  }

  private ensurePolling(): void {
    if (this.poll && !this.poll.done()) return;
    this.poll = pollLocks(this.ctx, () => this.activePids(), (rows) => {
      this.state.locks = rows;
      this.ctx.bus.publish(this.showtimeId, { type: 'locks', showtimeId: this.showtimeId, rows });
      this.emit();
    });
  }

  private async refreshSeat(): Promise<void> {
    const r = await this.ctx.pool.query(
      `SELECT ss.status FROM show_seat ss JOIN seat s USING (seat_id)
        WHERE ss.showtime_id = $1 AND ${LABEL_SQL} = $2`, [this.showtimeId, this.state.seat]);
    const db = r.rows[0]?.status as 'FREE' | 'HELD' | 'BOOKED' | undefined;
    let v: ShowdownState['seatStatus'] = db ?? 'FREE';
    if (this.conflict) v = 'CONFLICT';
    else if (v === 'FREE' && this.state.mode === 'lock' && (this.internal.A.lockHeld || this.internal.B.lockHeld)) v = 'HELD';
    this.state.seatStatus = v;
    this.emit();
  }

  // ---------- public API ----------
  async attach(c: Customer): Promise<void> {
    const s = this.session(c);
    await s.connect();
    const cs = this.state.customers[c];
    cs.attached = true;
    cs.pid = s.pid;
    this.emit();
  }

  async setMode(mode: Mode): Promise<void> {
    await this.reset();
    this.state.mode = mode;
    this.emit();
  }

  /** Abort open transactions, put the seat back to FREE (version kept), cancel race bookings, clear feeds. */
  async reset(): Promise<void> {
    this.gen++;
    this.conflict = false;
    this.state.running = false;
    await Promise.all(Object.values(this.sessions).map((s) => s?.abort()));
    await resetSeats(this.ctx, this.showtimeId, [this.state.seat], [CUSTOMER_ID.A, CUSTOMER_ID.B]);
    for (const c of ['A', 'B'] as Customer[]) {
      this.state.customers[c] = blankCustomer(this.state.customers[c]);
      this.internal[c] = this.blankInternal();
    }
    this.state.result = null;
    this.state.locks = [];
    this.state.seatStatus = 'FREE';
    this.emit();
  }

  begin(c: Customer): Promise<void> {
    const cs = this.state.customers[c];
    if (cs.phase !== 'idle') return Promise.resolve();
    const gen = this.gen;
    const s = this.session(c);
    cs.attached = true;
    cs.phase = 'begun';
    this.internal[c].startedAt = performance.now();
    this.emit();
    return s.run(() => this.doBegin(c, s, gen)).catch((e) => this.fail(c, s, gen, e));
  }

  confirm(c: Customer): Promise<void> {
    const gen = this.gen;
    const s = this.session(c);
    return s.run(() => this.doConfirm(c, s, gen)).catch((e) => this.fail(c, s, gen, e));
  }

  async abort(c: Customer): Promise<void> {
    const s = this.sessions[c];
    const gen = this.gen;
    if (!s) return;
    await s.abort();
    if (gen !== this.gen) return;
    const cs = this.state.customers[c];
    if (cs.phase !== 'done') {
      cs.phase = 'done';
      cs.status = 'Refused';
      this.internal[c].lockHeld = false;
      this.step(c, 'ROLLBACK');
    }
    await this.refreshSeat();
    this.emit();
  }

  /** Server-driven single-page run: A.begin, B.begin (may block), A.confirm, B.confirm, ~500 ms pauses. */
  async run(): Promise<void> {
    if (this.state.running) return;
    await this.reset();
    const gen = this.gen;
    this.state.running = true;
    for (const c of ['A', 'B'] as Customer[]) this.state.customers[c].attached = true;
    this.emit();
    try {
      await Promise.all((['A', 'B'] as Customer[]).map((c) => this.session(c).connect().then(() => {
        this.state.customers[c].pid = this.session(c).pid;
      })));
      await sleep(300); this.chk(gen);
      await this.begin('A'); this.chk(gen);
      await sleep(500); this.chk(gen);
      const pb = this.begin('B');
      await sleep(this.state.mode === 'lock' ? 900 : 500); this.chk(gen);
      await this.confirm('A'); this.chk(gen);
      await sleep(500); this.chk(gen);
      await pb; this.chk(gen);
      await sleep(300); this.chk(gen);
      await this.confirm('B'); this.chk(gen);
      await sleep(200);
    } catch (e) {
      if (!(e instanceof Stale)) this.onLine('A', { at: Date.now(), customer: 'A', kind: 'error', text: String((e as Error).message) });
    } finally {
      if (gen === this.gen) { this.state.running = false; this.emit(); }
    }
  }

  async close(): Promise<void> {
    this.gen++;
    this.poll?.stop();
    await Promise.all(Object.values(this.sessions).map((s) => s?.close()));
    this.sessions = {};
  }

  // ---------- internals ----------
  private async fail(c: Customer, s: Session, gen: number, e: any): Promise<void> {
    if (e instanceof Stale || gen !== this.gen) return;
    const cs = this.state.customers[c];
    if (e?.code === '57014') return; // cancelled by reset
    try { await s.exec('ROLLBACK', [], { quiet: true }); } catch { /* ignore */ }
    s.inTx = false;
    this.internal[c].lockHeld = false;
    this.step(c, e?.code ? `error ${e.code}` : 'error');
    cs.phase = 'done';
    cs.status = 'Refused';
    cs.totalMs = Math.round(performance.now() - this.internal[c].startedAt);
    await this.settle();
  }

  private addWait(c: Customer, ms: number): void {
    this.state.customers[c].waitMs += Math.round(ms);
  }

  private onWaitFor(c: Customer, stepText: boolean): (names: string[]) => void {
    return (names) => {
      const cs = this.state.customers[c];
      if (cs.phase !== 'done') cs.phase = 'waiting';
      if (stepText) this.step(c, `waiting on ${names[0]?.startsWith('pid') ? 'lock' : names[0]}…`);
      this.ensurePolling();
      this.emit();
    };
  }

  private finishCustomer(c: Customer, status: 'Booked' | 'Refused'): void {
    const cs = this.state.customers[c];
    cs.phase = 'done';
    cs.status = status;
    cs.totalMs = Math.round(performance.now() - this.internal[c].startedAt);
    this.internal[c].lockHeld = false;
  }

  private async refuse(c: Customer, s: Session, gen: number, stepText: string): Promise<void> {
    this.step(c, stepText);
    this.chk(gen);
    await s.exec('ROLLBACK');
    s.inTx = false;
    this.finishCustomer(c, 'Refused');
    await this.settle();
  }

  private async doBegin(c: Customer, s: Session, gen: number): Promise<void> {
    this.chk(gen);
    const ref = await this.getRef();
    const mode = this.state.mode;
    const cs = this.state.customers[c];
    const pk = [this.showtimeId, ref.seatId];
    await s.connect();
    cs.pid = s.pid;
    await s.exec('BEGIN');
    s.inTx = true;
    this.ensurePolling();
    this.chk(gen);

    if (mode === 'atomic') { cs.phase = 'ready'; this.emit(); return; }

    if (mode === 'lock') {
      this.step(c, 'SELECT … FOR UPDATE');
      const r = await s.exec('SELECT status, version FROM show_seat WHERE showtime_id = $1 AND seat_id = $2 FOR UPDATE', pk,
        { onWait: this.onWaitFor(c, true) });
      this.chk(gen);
      this.addWait(c, r.waitMs);
      this.step(c, r.waited ? 'lock granted' : 'lock acquired');
      this.internal[c].version = r.rows[0]?.version ?? null;
      if (r.rows[0]?.status !== 'FREE') { await this.refuse(c, s, gen, 'seat taken'); return; }
      this.internal[c].lockHeld = true;
    } else {
      const r = await s.exec('SELECT status, version FROM show_seat WHERE showtime_id = $1 AND seat_id = $2', pk,
        { onWait: this.onWaitFor(c, false) });
      this.chk(gen);
      this.addWait(c, r.waitMs);
      const row = r.rows[0];
      this.internal[c].version = row?.version ?? null;
      if (row?.status !== 'FREE') { await this.refuse(c, s, gen, 'seat taken'); return; }
      this.step(c, mode === 'optimistic' ? `SELECT · v${row.version}` : 'SELECT · seat free');
    }
    cs.phase = 'ready';
    await this.refreshSeat();
  }

  private async insertBooking(c: Customer, s: Session, ref: SeatRef): Promise<number> {
    const r = await s.exec(
      "INSERT INTO booking (customer_id, showtime_id, status, total) VALUES ($1, $2, 'CONFIRMED', $3) RETURNING booking_id",
      [CUSTOMER_ID[c], this.showtimeId, ref.price]);
    return r.rows[0].booking_id;
  }

  private async commit(c: Customer, s: Session, gen: number, label = 'COMMIT'): Promise<void> {
    this.chk(gen);
    await s.exec('COMMIT');
    s.inTx = false;
    this.step(c, label);
    this.finishCustomer(c, 'Booked');
    await publishSeats(this.ctx, this.showtimeId, [this.state.seat]);
    await this.settle();
  }

  private async doConfirm(c: Customer, s: Session, gen: number): Promise<void> {
    const cs = this.state.customers[c];
    if (gen !== this.gen || cs.phase === 'done' || cs.phase === 'idle' || !s.inTx) return;
    const mode = this.state.mode;
    const ref = await this.getRef();
    const pk = [this.showtimeId, ref.seatId];
    cs.phase = 'begun';
    this.emit();
    const onWait = this.onWaitFor(c, false);
    const UPD_BOOK = `UPDATE show_seat SET status = 'BOOKED', booking_id = $1, held_until = NULL, version = version + 1
                       WHERE showtime_id = $2 AND seat_id = $3`;

    if (mode === 'off' || mode === 'lock') {
      this.chk(gen);
      const bid = await this.insertBooking(c, s, ref);
      this.chk(gen);
      const u = await s.exec(UPD_BOOK, [bid, ...pk], { onWait });
      this.addWait(c, u.waitMs);
      this.step(c, `UPDATE · ${u.rowCount} row`);
      await this.commit(c, s, gen);
      return;
    }

    if (mode === 'atomic') {
      this.chk(gen);
      const bid = await this.insertBooking(c, s, ref);
      this.chk(gen);
      this.step(c, 'UPDATE … WHERE free');
      const u = await s.exec(UPD_BOOK + " AND status = 'FREE'", [bid, ...pk], { onWait });
      this.addWait(c, u.waitMs);
      if (u.rowCount === 1) {
        this.step(c, 'UPDATE · 1 row');
        await this.commit(c, s, gen);
      } else {
        this.step(c, 'UPDATE · 0 rows');
        this.chk(gen);
        await s.exec('ROLLBACK');
        s.inTx = false;
        this.step(c, 'ROLLBACK');
        this.finishCustomer(c, 'Refused');
        await this.settle();
      }
      return;
    }

    // optimistic: UPDATE ... WHERE version = v, retry <= 3
    let v = this.internal[c].version ?? 1;
    for (let attempt = 0; attempt < 3; attempt++) {
      this.chk(gen);
      const bid = await this.insertBooking(c, s, ref);
      this.chk(gen);
      this.step(c, `UPDATE · v${v} → v${v + 1}`);
      const u = await s.exec(
        `UPDATE show_seat SET status = 'BOOKED', booking_id = $1, held_until = NULL, version = $4 + 1
          WHERE showtime_id = $2 AND seat_id = $3 AND version = $4`, [bid, ...pk, v], { onWait });
      this.addWait(c, u.waitMs);
      if (u.rowCount === 1) { await this.commit(c, s, gen, 'COMMIT · 1 row'); return; }
      this.internal[c].retried = true;
      this.step(c, 'version changed');
      this.chk(gen);
      await s.exec('ROLLBACK');
      await s.exec('BEGIN');
      const r = await s.exec('SELECT status, version FROM show_seat WHERE showtime_id = $1 AND seat_id = $2', pk);
      this.chk(gen);
      if (r.rows[0]?.status !== 'FREE') { await this.refuse(c, s, gen, 'retry · seat taken'); return; }
      v = r.rows[0].version;
    }
    await this.refuse(c, s, gen, 'retry · gave up');
  }

  /** After any customer finishes: detect double booking, compute the result line. */
  private async settle(): Promise<void> {
    const { A, B } = this.state.customers;
    const mode = this.state.mode;
    if (A.status === 'Booked' && B.status === 'Booked') {
      this.conflict = true;
      A.status = 'Double booked';
      B.status = 'Double booked';
    }
    if (A.phase === 'done' && B.phase === 'done') {
      if (this.conflict) this.state.result = 'Double booked. Lost update.';
      else {
        const winner: Customer | null = A.status === 'Booked' ? 'A' : B.status === 'Booked' ? 'B' : null;
        if (!winner) this.state.result = 'Nobody booked.';
        else {
          const loser = OTHER[winner];
          const lc = this.state.customers[loser];
          if (mode === 'lock') this.state.result = lc.waitMs > 0 ? `One booked. ${loser} waited.` : `One booked. ${loser} was refused.`;
          else if (mode === 'atomic') this.state.result = 'One booked. No waiting.';
          else if (mode === 'optimistic') this.state.result = this.internal[loser].retried ? `One booked. ${loser} retried.` : `One booked. ${loser} was refused.`;
          else this.state.result = `One booked. ${loser} was refused.`;
        }
      }
    }
    await this.refreshSeat();
    await publishSeats(this.ctx, this.showtimeId, [this.state.seat]);
  }
}

/** Registry of showdowns per showtime. */
export class ShowdownManager {
  private map = new Map<number, Showdown>();
  constructor(private ctx: Ctx) {}
  get(showtimeId: number): Showdown {
    let s = this.map.get(showtimeId);
    if (!s) { s = new Showdown(this.ctx, showtimeId); this.map.set(showtimeId, s); }
    return s;
  }
  peek(showtimeId: number): Showdown | undefined { return this.map.get(showtimeId); }
  async closeAll(): Promise<void> {
    await Promise.all([...this.map.values()].map((s) => s.close()));
    this.map.clear();
  }
}
