import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Customer, CustomerState, Mode, SeatInfo, ShowdownState } from '../../../shared/types';
import Hall3D from '../components/Hall3D';
import type { HallPin, SeatVisual } from '../components/Hall3D';
import { useShowtimeSocket } from '../lib/ws';
import { sdApi } from './showdown/api';
import { Column } from './showdown/Column';
import { XRayPanel } from './showdown/XRayPanel';
import './showdown/showdown.css';

const MODES: [Mode, string][] = [['off', 'Off'], ['lock', 'Lock'], ['atomic', 'Atomic'], ['optimistic', 'Optimistic']];
const SEAT = 'C7';

const emptyC = (): CustomerState => ({ attached: false, pid: null, phase: 'idle', steps: [], status: null, sql: [], waitMs: 0, totalMs: null });
const emptyState = (id: number): ShowdownState => ({
  showtimeId: id, seat: SEAT, mode: 'off', running: false, seatStatus: 'FREE',
  customers: { A: emptyC(), B: emptyC() }, result: null, locks: [],
});

function useWidth() {
  const [w, setW] = useState(typeof window === 'undefined' ? 1440 : window.innerWidth);
  useEffect(() => {
    const f = () => setW(window.innerWidth);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return w;
}

function pinState(c: CustomerState): HallPin['state'] {
  if (c.phase === 'waiting') return 'wait';
  if (c.phase === 'begun' || c.phase === 'ready') return 'down';
  if (c.phase === 'done' && (c.status === 'Booked' || c.status === 'Double booked')) return 'down';
  return 'idle';
}

export default function Showdown() {
  const [sp] = useSearchParams();
  const cp = sp.get('customer')?.toUpperCase();
  const me: Customer | null = cp === 'A' || cp === 'B' ? cp : null;
  const showParam = Number(sp.get('show')) || null;
  const [showId, setShowId] = useState<number | null>(showParam);
  const [state, setState] = useState<ShowdownState | null>(null);
  const [bg, setBg] = useState<Record<string, SeatVisual>>({});
  const [xrayOpen, setXrayOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const width = useWidth();

  useEffect(() => {
    if (showId) return;
    sdApi.demo().then((d) => setShowId(d.showtimeId)).catch((e) => setErr(String(e.message ?? e)));
  }, [showId]);

  const refetch = useCallback(() => {
    if (!showId) return;
    sdApi.state(showId).then(setState).catch(() => undefined);
  }, [showId]);

  useEffect(() => {
    if (!showId) return;
    refetch();
    sdApi.seats(showId).then((r) => {
      const m: Record<string, SeatVisual> = {};
      for (const s of r.seats as SeatInfo[]) {
        if (s.status === 'BOOKED') m[s.seat] = 'booked';
        else if (s.status === 'HELD') m[s.seat] = 'held';
      }
      setBg(m);
    }).catch(() => undefined);
    if (me) sdApi.act(showId, me, 'attach').catch(() => undefined);
  }, [showId, me, refetch]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useShowtimeSocket(showId, (msg: any) => {
    if (!msg) return;
    if (msg.type === 'showdown') {
      if (msg.state.showtimeId === showId) setState(msg.state);
    } else if (msg.type === 'seats' && msg.showtimeId === showId) {
      setBg((prev) => {
        const n = { ...prev };
        for (const c of msg.changes) {
          if (c.seat === SEAT) continue;
          if (c.status === 'BOOKED') n[c.seat] = 'booked';
          else if (c.status === 'HELD') n[c.seat] = 'held';
          else delete n[c.seat];
        }
        return n;
      });
    } else if (msg.type === 'locks' && msg.showtimeId === showId) {
      setState((s) => (s ? { ...s, locks: msg.rows } : s));
    }
  });

  const st = state ?? emptyState(showId ?? 0);
  const act = (fn: () => Promise<unknown>) => () => {
    setErr(null);
    fn().then(() => setTimeout(refetch, 400)).catch((e) => setErr(String(e.message ?? e)));
  };
  const busy = st.running;

  const seats = useMemo(() => {
    const m: Record<string, SeatVisual> = { ...bg };
    delete m[SEAT];
    if (st.seatStatus === 'BOOKED') m[SEAT] = 'booked';
    else if (st.seatStatus === 'CONFLICT') m[SEAT] = 'conflict';
    else if (st.seatStatus === 'HELD') m[SEAT] = 'held';
    return m;
  }, [bg, st.seatStatus]);

  const pins: HallPin[] = [
    { id: 'A', seat: SEAT, state: pinState(st.customers.A) },
    { id: 'B', seat: SEAT, state: pinState(st.customers.B) },
  ];
  const showXray = busy || xrayOpen;
  const ring = st.seatStatus === 'CONFLICT' ? { seat: SEAT, kind: 'pulse' as const }
    : st.seatStatus === 'HELD' ? { seat: SEAT, kind: 'held' as const } : null;
  const mobile = width <= 1100;

  let result = me ? 'Pick a mode. Begin, then Confirm.' : 'Pick a mode. Press Run.';
  if (st.result) result = st.result;
  else if (busy) result = ' ';

  const mine = me ? st.customers[me] : null;
  const canBegin = !!mine && mine.phase === 'idle';
  const canConfirm = !!mine && (mine.phase === 'begun' || mine.phase === 'ready');
  const canAbort = !!mine && (mine.phase === 'begun' || mine.phase === 'waiting' || mine.phase === 'ready');

  return (
    <div className="sd">
      <div className="sd-pad">
        <div className="sd-top sd-lbl"><span>Showdown{me ? ` · Window ${me}` : ''}</span><span>Seat {SEAT}</span></div>
        <h1>Two clicks. One seat.</h1>

        <div className="sd-ctl">
          <div className="sd-seg" role="group" aria-label="Concurrency mode">
            {MODES.map(([m, label]) => (
              <button key={m} type="button" className={st.mode === m ? 'on' : ''} aria-pressed={st.mode === m} disabled={busy || !showId}
                onClick={act(() => sdApi.mode(showId!, m))}>{label}</button>
            ))}
          </div>
          {me ? (
            <>
              <button type="button" className="sd-run" disabled={!canBegin} onClick={act(() => sdApi.act(showId!, me, 'begin'))}>Begin</button>
              <button type="button" className="sd-run" disabled={!canConfirm} onClick={act(() => sdApi.act(showId!, me, 'confirm'))}>Confirm</button>
              <button type="button" className="sd-run ghost" disabled={!canAbort} onClick={act(() => sdApi.act(showId!, me, 'abort'))}>Abort</button>
            </>
          ) : (
            <button type="button" className="sd-run" disabled={busy || !showId} onClick={act(() => sdApi.run(showId!))}>Run</button>
          )}
          <button type="button" className="sd-txt" disabled={!showId} onClick={act(() => sdApi.reset(showId!))}>Reset</button>
          <button type="button" className="sd-txt" aria-pressed={showXray} onClick={() => setXrayOpen((v) => !v)}>X-Ray</button>
        </div>
        {err ? <div role="alert" style={{ marginTop: 12, color: '#B83A3E', fontSize: 13 }}>{err}</div> : null}

        <div className="sd-grid">
          <Column who="A" st={st.customers.A} side="l" small={me === 'B'} />
          <div className="sd-model">
            <div className="sd-xr sd-lbl" style={{ opacity: st.running ? 1 : 0 }}>X-Ray</div>
            <Hall3D
              seats={seats}
              xray={st.running}
              focus={[SEAT]}
              lifted={st.seatStatus === 'FREE' ? [] : [SEAT]}
              pins={pins}
              ring={ring}
              seatLabel={SEAT}
              height={mobile ? 400 : 520}
              scale={width <= 460 ? 0.44 : width <= 860 ? 0.8 : width <= 1100 ? 0.95 : 1.0}
              ariaLabel="3D model of a cinema hall. Seat C7 is highlighted."
            />
          </div>
          <Column who="B" st={st.customers.B} side="r" small={me === 'A'} />
        </div>

        <p aria-live="polite" className="sd-result" style={{ color: st.result ? '#141414' : '#6B6862' }} data-testid="result">{result}</p>
        {me && mine?.phase === 'waiting' ? <p className="sd-lbl" style={{ marginTop: 8 }}>Waiting on the other window…</p> : null}

        {showXray ? <XRayPanel state={st} /> : null}

        <p className="sd-credit">ADBMS · SEN-410 · Bahria University Karachi — Moiz Ali, Ayesha Aleem, Zainab Fatima</p>
      </div>
    </div>
  );
}
