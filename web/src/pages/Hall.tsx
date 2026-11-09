import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { DbSeatStatus, SeatInfo, Showtime } from '@shared/types';
import Hall3D from '../components/Hall3D';
import type { SeatVisual } from '../components/Hall3D';
import Label from '../components/Label';
import Nav from '../components/Nav';
import { useXRay } from '../lib/xray';
import { api, ApiError, rs } from '../lib/api';
import { useShowtimeSocket } from '../lib/ws';

interface Cell { status: DbSeatStatus; heldUntil: string | null; bookingId: number | null; type: 'STANDARD' | 'RECLINER'; price: number }
interface Hold { bookingId: number; until: number; total: number; seats: string[] }

const order = (a: string, b: string) => (a.charCodeAt(0) * 100 + parseInt(a.slice(1), 10)) - (b.charCodeAt(0) * 100 + parseInt(b.slice(1), 10));
const clock = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const HOLD_SECS = 300;

export default function Hall() {
  const id = Number(useParams().showtimeId);
  const [showtime, setShowtime] = useState<Showtime | null>(null);
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const [loadErr, setLoadErr] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [hold, setHold] = useState<Hold | null>(null);
  const [busy, setBusy] = useState<'hold' | 'pay' | null>(null);
  const [done, setDone] = useState(false);
  const [note, setNote] = useState('');
  const { on: xray } = useXRay();
  const [hover, setHover] = useState<string | null>(null);
  const [last, setLast] = useState('C7');
  const [sql, setSql] = useState<string[]>([]);
  const [decline, setDecline] = useState(false);
  const [failSeat, setFailSeat] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const live = useRef({ sel, hold, busy });
  live.current = { sel, hold, busy };

  const load = useCallback(async () => {
    try {
      const r = await api.showtime(id);
      setShowtime(r.showtime);
      const m: Record<string, Cell> = {};
      r.seats.forEach((s: SeatInfo) => { m[s.seat] = { status: s.status, heldUntil: s.heldUntil, bookingId: s.bookingId, type: s.type, price: s.price }; });
      setCells(m);
      setLoadErr('');
    } catch (e) { setLoadErr((e as Error).message); }
  }, [id]);

  useEffect(() => {
    setSel([]); setHold(null); setDone(false); setNote(''); setSql([]); setShowtime(null); setCells({});
    load();
  }, [id, load]);

  const expire = useCallback(() => {
    setHold(null); setSel([]); setNote('Hold expired. Seats released.');
    load();
  }, [load]);

  // hold clock
  useEffect(() => {
    if (!hold) return;
    const t = window.setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= hold.until && live.current.busy !== 'pay') expire();
    }, 250);
    return () => window.clearInterval(t);
  }, [hold, expire]);

  // live seat updates from other clients
  useShowtimeSocket(Number.isNaN(id) ? null : id, m => {
    if (m.type !== 'seats') return;
    setCells(prev => {
      const next = { ...prev };
      m.changes.forEach(c => { if (next[c.seat]) next[c.seat] = { ...next[c.seat], status: c.status, heldUntil: c.heldUntil, bookingId: c.bookingId }; });
      return next;
    });
    const { sel: cs, hold: ch, busy: cb } = live.current;
    if (!ch) {
      const lost = m.changes.filter(c => c.status !== 'FREE' && cs.includes(c.seat)).map(c => c.seat);
      if (lost.length) {
        setSel(s => s.filter(x => !lost.includes(x)));
        setNote(`${lost.join(', ')} ${lost.length > 1 ? 'were' : 'was'} just taken.`);
      }
    } else if (cb !== 'pay') {
      const freed = m.changes.some(c => c.status === 'FREE' && c.bookingId == null && ch.seats.includes(c.seat));
      if (freed) expire();
    }
  });

  const visual = useMemo(() => {
    const v: Record<string, SeatVisual> = {};
    const mine = hold ? hold.seats : sel;
    for (const [label, c] of Object.entries(cells)) {
      if (mine.includes(label)) v[label] = hold && done ? 'booked' : 'yours';
      else if (c.status === 'BOOKED') v[label] = 'booked';
      else if (c.status === 'HELD') v[label] = 'held';
    }
    return v;
  }, [cells, sel, hold, done]);

  const priceOf = (label: string) => cells[label]?.price ?? (label[0] === 'J' ? showtime?.priceRecliner ?? 3200 : showtime?.priceStandard ?? 1800);
  const picked = hold ? hold.seats : sel;
  const total = hold ? hold.total : sel.reduce((a, s) => a + priceOf(s), 0);

  const pick = (label: string) => {
    setLast(label);
    if (busy) return;
    const c = cells[label];
    if (hold && !done) { setNote('Release your hold to change seats.'); return; }
    if (done) { setDone(false); setHold(null); setSel([]); setSql([]); setNote(''); }
    if (!c) return;
    if (c.status === 'BOOKED') { setNote(`${label} is already booked.`); return; }
    if (c.status === 'HELD') { setNote(`${label} is held by someone else.`); return; }
    setSel(s => (s.includes(label) ? s.filter(x => x !== label) : [...s, label].sort(order)));
    setNote('');
  };

  const doHold = async () => {
    if (!sel.length || busy) return;
    setBusy('hold'); setNote('');
    try {
      const r = await api.hold(id, sel);
      const until = r.heldUntil ? new Date(r.heldUntil).getTime() : Date.now() + HOLD_SECS * 1000;
      setNow(Date.now());
      setHold({ bookingId: r.bookingId, until, total: r.total, seats: sel });
      setSql(r.sql);
      setDecline(false); setFailSeat('');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SEAT_TAKEN') {
        const s = e.seat ?? '';
        setSel(cur => cur.filter(x => x !== s));
        setNote(`${s || 'A seat'} was just taken. Nothing was held.`);
        setSql([`ERROR  SEAT_TAKEN:${s}`, 'ROLLBACK;  -- whole hold undone']);
        load();
      } else setNote((e as Error).message);
    } finally { setBusy(null); }
  };

  const doPay = async () => {
    if (!hold || busy || done) return;
    setBusy('pay'); setNote('');
    try {
      const r = await api.pay(hold.bookingId, { decline: decline || undefined, failSeat: failSeat || undefined });
      setSql(r.sql);
      setCells(prev => {
        const n = { ...prev };
        r.booked.forEach(s => { if (n[s]) n[s] = { ...n[s], status: 'BOOKED', heldUntil: null }; });
        r.released.forEach(s => { if (n[s]) n[s] = { ...n[s], status: 'FREE', heldUntil: null, bookingId: null }; });
        return n;
      });
      if (r.status === 'CONFIRMED') {
        setHold({ ...hold, seats: r.booked, total: r.amount }); setDone(true); setNote('');
      } else if (r.status === 'PARTIAL') {
        setHold({ ...hold, seats: r.booked, total: r.amount }); setDone(true);
        setNote(`${r.booked.join(', ')} booked. ${r.released.join(', ')} rolled back to its savepoint and released.`);
      } else {
        setHold(null); setSel([]); setNote('Card declined. Whole payment rolled back, seats released.');
      }
    } catch (e) { setNote((e as Error).message); load(); }
    finally { setBusy(null); }
  };

  const release = async () => {
    if (!hold || busy || done) return;
    const b = hold.bookingId;
    setHold(null); setSel([]); setNote('Hold released.');
    try { await api.cancel(b); } catch { /* sweeper will free it */ }
    load();
  };

  const remaining = hold ? hold.until - now : HOLD_SECS * 1000;
  const hasPick = picked.length > 0;
  const canAct = hasPick && !busy && !done;
  const payLabel = done ? 'Booked.' : busy === 'pay' ? 'Paying…' : busy === 'hold' ? 'Holding…' : hold ? `Pay ${rs(hold.total)}` : 'Hold & pay';
  const focus = useMemo(() => [last, ...picked], [last, picked]);
  const info = hover ? (() => {
    const c = cells[hover];
    return hover + ' · ' + (c?.status === 'BOOKED' ? 'Booked' : c?.status === 'HELD' ? 'Held' : rs(priceOf(hover)));
  })() : ' ';

  const shown = sql.slice(-5);
  const sqlLines = shown.length ? shown : ['-- hold a seat to see its SQL'];

  if (loadErr && !showtime) {
    return <div className="page"><Nav /><div className="hall-wrap"><Link className="back" to="/films">← Films</Link><p role="alert" style={{ marginTop: 40, color: 'var(--muted)' }}>Could not load this showtime. {loadErr}</p></div></div>;
  }

  return (
    <div className="page">
      <Nav />
      <div className="hall-wrap">
        <div className="hall-head">
          <Link className="back" to={showtime ? `/films/${showtime.movieId}` : '/films'}>← Films</Link>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{showtime?.movieTitle ?? ' '}</h1>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{showtime ? `${showtime.hall} · ${showtime.label}` : ' '}</span>
          <span style={{ flex: '1 1 0' }} />
          <Label>Hold</Label>
          <span aria-label="Hold time remaining" className="mono" style={{ fontSize: 15, minWidth: 36, color: hold ? 'var(--ink)' : 'var(--muted)' }}>{clock(remaining)}</span>
        </div>

        <div className="hall-cols">
          <div className="hall-stage">
            <div style={{ position: 'relative' }}>
              <Hall3D
                seats={visual} xray={xray} focus={focus} interactive onSeatClick={pick} onSeatHover={setHover}
                ariaLabel="Choose a seat. Rows A to J, 14 seats per row, row J recliners."
              />
            </div>
            <div aria-live="polite" style={{ height: 22, marginTop: 8, fontSize: 13, letterSpacing: '.01em' }}>{info}</div>
            <div className="sqlb" style={{ opacity: xray ? 1 : 0, pointerEvents: xray ? 'auto' : 'none' }} aria-hidden={!xray}>
              {sqlLines.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>

          <div className="hall-side">
            <Label as="div" style={{ paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>Your seats</Label>
            {hasPick ? (
              <div>
                {picked.map(s => (
                  <div key={s} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--line)', fontSize: 15 }}>
                    <span>{s}</span><span style={{ color: 'var(--muted)' }}>{rs(priceOf(s))}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: '10px 0', borderBottom: '1px solid var(--line)', fontSize: 15, color: 'var(--muted)' }}>None yet</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '20px 0 18px' }}>
              <Label>Total</Label>
              <span style={{ fontSize: 36, fontWeight: 300, letterSpacing: '-0.03em', lineHeight: 1 }}>{rs(total)}</span>
            </div>
            <button type="button" className="payb" aria-disabled={!canAct} onClick={() => (hold ? doPay() : doHold())}
              style={{ opacity: canAct || done ? 1 : 0.3, cursor: canAct ? 'pointer' : 'default' }}>{payLabel}</button>

            {hold && !done && (
              <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 18px' }}>
                <button type="button" className="linkb" aria-pressed={decline} onClick={() => setDecline(d => !d)}>Decline card</button>
                {hold.seats.length > 1 && (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
                    Fail seat
                    <select value={failSeat} onChange={e => setFailSeat(e.target.value)} disabled={decline}
                      style={{ font: 'inherit', fontSize: 12, color: 'var(--ink)', background: 'transparent', border: '1px solid var(--line)', borderRadius: 999, height: 26, padding: '0 8px' }}>
                      <option value="">none</option>
                      {hold.seats.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                )}
                <button type="button" className="linkb" onClick={release}>Release</button>
              </div>
            )}
            <div aria-live="polite" style={{ minHeight: 36, marginTop: 12, fontSize: 12, lineHeight: '18px' }}>{note}</div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 20px', marginTop: 28, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
              {([
                ['Free', 'var(--clay)', 'inset 0 0 0 1px var(--clay-shade)'], ['Held', 'var(--held)', 'none'],
                ['Booked', 'var(--booked)', 'none'], ['Yours', 'var(--ink)', 'none'],
              ] as const).map(([n, bg, sh]) => (
                <span key={n} className="label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <i style={{ display: 'block', width: 10, height: 10, borderRadius: 2, background: bg, boxShadow: sh }} />{n}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
