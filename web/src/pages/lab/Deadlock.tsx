import { useEffect, useRef, useState } from 'react';
import Seat3D from '../../components/Seat3D';
import { labApi, type DeadlockResult } from './labApi';
import { C, Exhibit, ErrorLine, mono } from './parts';

const TIMES_LOOP = [300, 1100, 1900, 2700, 3500, 4800];
const TIMES_ORDERED = [300, 1100, 1900];

export default function Deadlock() {
  const [ordered, setOrdered] = useState(false);
  const [stage, setStage] = useState(0);
  const [res, setRes] = useState<DeadlockResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clear, []);

  const run = async () => {
    clear(); setStage(0); setRes(null); setErr(null); setBusy(true);
    try {
      const r = await labApi.deadlock(ordered);
      setRes(r);
      (r.deadlock ? TIMES_LOOP : TIMES_ORDERED).forEach((ms, i) => timers.current.push(window.setTimeout(() => setStage(i + 1), ms)));
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const toggle = () => { clear(); setOrdered((o) => !o); setStage(0); setRes(null); setErr(null); };

  const o = ordered, dl = stage;
  const victim = res?.victim ?? 'B';
  const looped = !o && dl >= 5 && !!res?.deadlock;
  const aborted = !o && dl >= 6;
  const aOff = dl >= 3 ? 0 : 1;
  const bOff = o ? (dl >= 2 ? 0 : 1) : (dl >= 4 ? 0 : 1);
  const aCol = o ? C.a : looped ? C.red : C.ink;
  const bCol = o ? C.b : looped ? C.red : C.ink;
  const fade = (who: 'A' | 'B') => (aborted && victim === who ? 0.15 : 1);
  const path = (col: string, off: number, op: number) => ({
    fill: 'none', stroke: col, strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeDasharray: 1, strokeDashoffset: off,
    opacity: off ? 0 : op, transition: 'stroke-dashoffset .8s ease,stroke .3s,opacity .4s',
  });
  const head = (col: string, off: number, op: number) => ({ fill: col, opacity: off ? 0 : op, transition: 'opacity .2s .6s,fill .3s' });
  const c7held = dl >= 1, c8held = o ? dl >= 3 : dl >= 2 && !aborted;
  const node = (left: number, top: number, bg: string, who: 'A' | 'B') => (
    <div className={aborted && victim === who ? 'lab-shake' : undefined} aria-label={`Customer ${who}`}
      style={{ position: 'absolute', left, top, width: 36, height: 36, borderRadius: '50%', background: bg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 500, opacity: fade(who), transition: 'opacity .4s' }}>{who}</div>
  );
  let text = '';
  let textColor = C.ink;
  if (looped) { text = `Deadlock. ${victim} aborted.`; textColor = C.red; }
  if (o && dl >= 3) text = res?.result && !res.deadlock ? res.result : 'No loop. B waits.';

  const shown = res ? res.timeline.slice(0, Math.max(0, Math.min(res.timeline.length, dl + (o ? 0 : 0) + 1))) : [];

  return (
    <Exhibit n="01" title="Deadlock" blurb="Each customer holds one seat and reaches for the other's." tag="Lab 4, 5">
      <div style={{ position: 'relative', width: 360, maxWidth: '100%', height: 250 }}>
        <svg viewBox="0 0 360 250" style={{ position: 'absolute', left: 0, top: 0, width: 360, height: 250, overflow: 'visible' }} aria-hidden="true">
          <line x1="90" y1="46" x2="90" y2="84" style={{ stroke: C.a, strokeWidth: 1.2, opacity: c7held ? 1 : 0, transition: 'opacity .3s' }} />
          <line x1="270" y1="204" x2="270" y2="166" style={{ stroke: C.b, strokeWidth: 1.2, opacity: !o && dl >= 2 ? fade('B') : 0, transition: 'opacity .3s' }} />
          <path d="M 108 30 C 200 30, 220 60, 252 95" pathLength={1} style={path(aCol, aOff, fade('A'))} />
          <polygon points="252,95 243.7,91.8 249.5,86.4" style={head(aCol, aOff, fade('A'))} />
          <path d="M 252 222 C 160 222, 140 190, 108 158" pathLength={1} style={path(bCol, bOff, fade('B'))} />
          <polygon points="108,158 116.5,160.9 110.9,166.5" style={head(bCol, bOff, fade('B'))} />
        </svg>
        {node(72, 10, C.a, 'A')}
        {node(252, 204, C.b, 'B')}
        <div className={aborted && victim === 'A' ? 'lab-shake' : undefined} style={{ position: 'absolute', left: 50, top: 85, width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Seat3D state={looped ? 'conflict' : c7held ? 'held' : 'free'} size={90} />
        </div>
        <div className={aborted && victim === 'B' ? 'lab-shake' : undefined} style={{ position: 'absolute', left: 230, top: 85, width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Seat3D state={looped ? 'conflict' : c8held ? 'held' : 'free'} size={90} />
        </div>
        <div className="lab-label" style={{ position: 'absolute', left: 60, top: 176, width: 60, textAlign: 'center' }}>C7</div>
        <div className="lab-label" style={{ position: 'absolute', left: 240, top: 76, width: 60, textAlign: 'center' }}>C8</div>
      </div>
      <div style={{ minHeight: 24, fontSize: 17, fontWeight: 500, color: textColor, textAlign: 'center' }} aria-live="polite">
        {text}
        {looped && res?.code && <span style={{ fontFamily: mono, fontSize: 13, marginLeft: 10, color: C.muted }}>{res.code}</span>}
      </div>
      {shown.length > 0 && (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, fontFamily: mono, fontSize: 12, color: C.muted, display: 'grid', gap: 2, maxWidth: 360 }}>
          {shown.map((t, i) => (
            <li key={i}><span style={{ color: t.customer === 'A' ? C.a : C.b }}>{t.customer}</span> {t.text}</li>
          ))}
        </ol>
      )}
      <ErrorLine msg={err} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 28px', alignItems: 'center', justifyContent: 'center' }}>
        <button type="button" className="lab-pill" onClick={run} disabled={busy}>{busy ? 'Running' : 'Run'}</button>
        <button type="button" className="lab-sw" role="switch" aria-checked={o} onClick={toggle}>
          <span style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, borderRadius: 11, background: o ? C.ink : C.line, transition: 'background .2s' }}>
            <span style={{ position: 'absolute', top: 3, left: o ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
          </span>
          Lock in seat order
        </button>
      </div>
    </Exhibit>
  );
}
