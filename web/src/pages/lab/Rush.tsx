import { useEffect, useRef, useState } from 'react';
import Seat3D from '../../components/Seat3D';
import { labApi, type LabMode, type RushResult } from './labApi';
import { C, Exhibit, ErrorLine, mono } from './parts';

const MODES: { id: LabMode; label: string }[] = [
  { id: 'lock', label: 'Lock' }, { id: 'atomic', label: 'Atomic' }, { id: 'optimistic', label: 'Optimistic' }, { id: 'off', label: 'Off' },
];

export default function Rush() {
  const [mode, setMode] = useState<LabMode>('lock');
  const [phase, setPhase] = useState<0 | 1 | 2>(0); // 0 idle, 1 converging, 2 settled
  const [res, setRes] = useState<RushResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const winners = new Set(res?.bots.filter((b) => b.ok).map((b) => b.i) ?? []);
  const winner = res ? (res.bots.find((b) => b.ok)?.i ?? -1) : 17;

  const run = async () => {
    timers.current.forEach(clearTimeout); timers.current = [];
    setErr(null); setBusy(true); setPhase(1);
    try {
      const r = await labApi.rush(mode);
      setRes(r);
      timers.current.push(window.setTimeout(() => setPhase(2), 1900));
    } catch (e) { setErr((e as Error).message); setPhase(0); }
    finally { setBusy(false); }
  };

  const dots = Array.from({ length: 50 }, (_, i) => {
    const ang = (i / 50) * Math.PI * 2 + 0.31;
    const win = phase === 2 ? winners.has(i) : i === winner;
    const R = phase === 0 ? 135 : win ? 7 : 34 + (i % 4) * 7;
    const x = Math.cos(ang) * R, y = Math.sin(ang) * R;
    let bg: string = C.ink, op = 0.55, sc = 1;
    if (phase === 2) {
      if (winners.has(i)) { bg = res?.booked && res.booked > 1 ? C.red : C.green; op = 1; sc = 2; } else { bg = C.muted; op = 0.14; }
    }
    const tr = phase === 0 ? 'transform .5s ease,opacity .4s,background-color .3s' : `transform .9s cubic-bezier(.5,0,.2,1) ${i * 22}ms,opacity .6s,background-color .4s`;
    return <div key={i} aria-hidden="true" style={{ position: 'absolute', left: 177, top: 147, width: 6, height: 6, borderRadius: '50%', zIndex: 2, background: bg, opacity: op, transform: `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${sc})`, transition: tr }} />;
  });
  const fmt = (n: number, d = 1) => n.toFixed(d);
  const tried = res?.tried ?? 50, booked = res?.booked ?? 1, refused = res?.refused ?? 49;

  return (
    <Exhibit n="02" title="Rush hour" blurb="Fifty requests arrive in the same instant for one seat." tag="Lab 5">
      <div style={{ position: 'relative', width: 360, maxWidth: '100%', height: 300 }}>
        <div style={{ position: 'absolute', left: 140, top: 110, width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Seat3D state={phase === 2 ? (booked > 1 ? 'conflict' : 'booked') : 'free'} size={90} />
        </div>
        {dots}
      </div>
      <div style={{ textAlign: 'center', minHeight: 104, fontWeight: 300, fontSize: 'clamp(30px,5vw,44px)', lineHeight: 1.05, letterSpacing: '-.04em', opacity: phase === 2 ? 1 : 0, transition: 'opacity .6s' }} aria-live="polite">
        <div>{tried} tried. {booked} booked.</div>
        <div style={{ color: C.muted }}>{refused} refused</div>
      </div>
      {res && phase === 2 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 28px', justifyContent: 'center', fontFamily: mono, fontSize: 13 }}>
          <span>{fmt(res.throughputTps, 0)} <span className="lab-label">tx/s</span></span>
          <span>{fmt(res.avgResponseMs)} ms <span className="lab-label">avg response</span></span>
          <span>{fmt(res.lockWaitRatio * 100, 0)}% <span className="lab-label">lock wait</span></span>
          {res.errors > 0 && <span style={{ color: C.red }}>{res.errors} errors</span>}
        </div>
      )}
      <ErrorLine msg={err} />
      <div className="lab-seg" role="group" aria-label="Booking mode">
        {MODES.map((m) => <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>{m.label}</button>)}
      </div>
      <button type="button" className="lab-pill" onClick={run} disabled={busy}>{busy ? 'Racing' : 'Release 50'}</button>
    </Exhibit>
  );
}
