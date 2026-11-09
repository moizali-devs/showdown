import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent as RPointerEvent } from 'react';
import '../styles/hall3d.css';

export type SeatVisual = 'free' | 'held' | 'booked' | 'yours' | 'conflict';
export interface HallPin { id: 'A' | 'B'; seat: string; state: 'idle' | 'down' | 'wait' }
export interface Hall3DProps {
  seats: Record<string, SeatVisual>;
  xray?: boolean;
  focus?: string[];
  lifted?: string[];
  pins?: HallPin[];
  ring?: { seat: string; kind: 'held' | 'pulse' } | null;
  seatLabel?: string | null;
  onSeatClick?: (seat: string) => void;
  onSeatHover?: (seat: string | null) => void;
  interactive?: boolean;
  height?: number;
  scale?: number;
  sway?: boolean;
  shake?: boolean;
  showOrbitHint?: boolean;
  ariaLabel?: string;
}

/* ---------- colours (precomputed once, never per render) ---------- */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
const trio = (hex: string): [string, string, string] => [hex, shade(hex, 0.88), shade(hex, 0.8)];
export const SEAT_COLS: Record<SeatVisual, [string, string, string]> = {
  free: ['#DAD6CE', '#C5C0B6', '#B3ADA2'],
  held: trio('#E8A33D'),
  booked: trio('#1F8A5B'),
  conflict: trio('#E5484D'),
  yours: ['#2b2b2b', '#1a1a1a', '#0e0e0e'],
};
const EDGE: Record<SeatVisual, string> = {
  free: 'rgba(20,20,20,.35)', held: 'rgba(232,163,61,.7)', booked: 'rgba(31,138,91,.6)',
  conflict: 'rgba(229,72,77,.7)', yours: 'rgba(20,20,20,.85)',
};
export const WORD: Record<SeatVisual, string> = { free: 'free', held: 'held', booked: 'booked', yours: 'selected', conflict: 'conflict' };

interface Trio { t: CSSProperties; f: CSSProperties; s: CSSProperties }
const solid = (v: SeatVisual): Trio => ({
  t: { background: SEAT_COLS[v][0] }, f: { background: SEAT_COLS[v][1] }, s: { background: SEAT_COLS[v][2] },
});
const wire = (v: SeatVisual): Trio => {
  const e: CSSProperties = { background: 'transparent', border: '1px solid ' + EDGE[v] };
  return { t: e, f: e, s: e };
};
const VISUALS: SeatVisual[] = ['free', 'held', 'booked', 'yours', 'conflict'];
const SOLID = Object.fromEntries(VISUALS.map(v => [v, solid(v)])) as Record<SeatVisual, Trio>;
const WIRE = Object.fromEntries(VISUALS.map(v => [v, wire(v)])) as Record<SeatVisual, Trio>;

const EDGE_STYLE: CSSProperties = { background: 'transparent', border: '1px solid rgba(20,20,20,.35)' };
const SLAB = {
  top: { background: '#E6E2DA' } as CSSProperties, front: { background: '#D2CDC3' } as CSSProperties, side: { background: '#C2BDB2' } as CSSProperties,
};
const PLINTH = {
  top: { background: '#F6F5F2' } as CSSProperties, front: { background: '#DDD9D0' } as CSSProperties, side: { background: '#CFCAC0' } as CSSProperties,
};

/* Contact shadow: a 680x540 black ellipse at 18% under blur(30px), pre-blurred into a radial
   gradient (erf falloff, sigma 30px). A live filter inside the swaying 3D scene is re-applied by the
   compositor every frame (WebKit especially); a gradient is rasterised once. */
const CONTACT_SHADOW: CSSProperties = {
  position: 'absolute', left: -445, top: -385, width: 890, height: 710, transform: 'translateZ(-16px)', pointerEvents: 'none',
  background: 'radial-gradient(340px 270px at 50% 50%,rgba(0,0,0,.18) 70%,rgba(0,0,0,.179) 75.2%,rgba(0,0,0,.176) 80.2%,'
    + 'rgba(0,0,0,.168) 85.1%,rgba(0,0,0,.1514) 90.1%,rgba(0,0,0,.1245) 95%,rgba(0,0,0,.09) 100%,rgba(0,0,0,.0555) 105%,'
    + 'rgba(0,0,0,.0286) 109.9%,rgba(0,0,0,.012) 114.9%,rgba(0,0,0,.0041) 119.8%,rgba(0,0,0,.0011) 124.8%,rgba(0,0,0,0) 129.7%)',
};

/* ---------- layout ---------- */
const ROWS = 10;
export const ROW_LETTERS = 'ABCDEFGHIJ'.split('');
export interface SeatGeom { x: number; y: number; h: number; w: number; sx: number; sz: number }
export function seatGeom(label: string): SeatGeom | null {
  const r = label.charCodeAt(0) - 65;
  const k = parseInt(label.slice(1), 10) - 1;
  if (!(r >= 0 && r < ROWS) || !(k >= 0 && k < 14)) return null;
  const rec = r === 9;
  const p = rec ? 33 : 30, W = rec ? 28 : 22;
  const x = -(14 * p + 36) / 2 + k * p + (k >= 7 ? 36 : 0) + (p - W) / 2;
  return { x, y: -170 + r * 34, h: (r + 1) * 9, w: W, sx: W / 22, sz: rec ? 1.12 : 1 };
}

/* ---------- one seat ---------- */
interface SeatProps {
  id: string; x: number; sx: number; sz: number; st: SeatVisual; wire: boolean; lift: number; int: boolean;
  onPick: (id: string, kbd: boolean) => void; onHover: (id: string) => void;
}
const Seat = memo(function Seat({ id, x, sx, sz, st, wire: w, lift, int, onPick, onHover }: SeatProps) {
  const c = w ? WIRE[st] : SOLID[st];
  const style = useMemo<CSSProperties>(() => ({
    left: x, top: 3, transform: `translateZ(${lift}px) scale3d(${sx},1.05,${sz})`,
  }), [x, lift, sx, sz]);
  const a11y = int
    ? {
        role: 'button', tabIndex: 0, 'aria-label': `Seat ${id}, ${WORD[st]}`,
        onClick: () => onPick(id, false), onMouseEnter: () => onHover(id),
        onFocus: () => onHover(id),
        onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(id, true); } },
      }
    : { 'aria-hidden': true as const };
  return (
    <div className={'seat3' + (int ? ' int' : '')} data-s={st} style={style} {...a11y}>
      <div className="f3" style={{ top: 0, width: 22, height: 20, transform: 'translateZ(10px)', ...c.t }} />
      <div className="f3" style={{ width: 20, height: 10, transform: 'translate3d(0,0,10px) rotateZ(90deg) rotateX(-90deg)', ...c.s }} />
      <div className="f3" style={{ top: 20, width: 22, height: 5, transform: 'translateZ(32px)', ...c.t }} />
      <div className="f3" style={{ width: 22, height: 32, transform: 'translate3d(0,25px,32px) rotateX(-90deg)', ...c.f }} />
      <div className="f3" style={{ width: 5, height: 32, transform: 'translate3d(0,20px,32px) rotateZ(90deg) rotateX(-90deg)', ...c.s }} />
    </div>
  );
});

/* ---------- static structure (only depends on xray) ---------- */
const Plinth = memo(function Plinth({ xray }: { xray: boolean }) {
  const t = xray ? EDGE_STYLE : PLINTH.top, f = xray ? EDGE_STYLE : PLINTH.front, s = xray ? EDGE_STYLE : PLINTH.side;
  return (
    <div style={{ position: 'absolute', left: -290, top: -260, width: 580, height: 450, transformStyle: 'preserve-3d' }}>
      <div className="f3" style={{ width: 580, height: 450, ...t }} />
      <div className="f3" style={{ width: 580, height: 14, transform: 'translate3d(0,450px,0) rotateX(-90deg)', ...f }} />
      <div className="f3" style={{ width: 450, height: 14, transform: 'rotateZ(90deg) rotateX(-90deg)', ...s }} />
      <div style={{
        position: 'absolute', left: 40, top: 24, width: 500, height: 110, transform: 'translateZ(.5px)',
        background: 'radial-gradient(ellipse 60% 100% at 50% 0%,rgba(255,255,255,.95),rgba(255,255,255,0) 70%)',
        transition: 'opacity .3s', opacity: xray ? 0 : 1,
      }} />
    </div>
  );
});

const Screen = memo(function Screen({ xray }: { xray: boolean }) {
  const face = xray ? EDGE_STYLE : { background: '#FFFFFF' };
  const stand = xray ? EDGE_STYLE : { background: '#2a2a2a' };
  return (
    <>
      {[-2, -1, 0, 1, 2].map(i => (
        <div key={i} style={{
          position: 'absolute', left: i * 100, top: -238 + i * i * 4, width: 0, height: 0,
          transformStyle: 'preserve-3d', transform: `rotateZ(${6 * i}deg)`,
        }}>
          <div className="f3" style={{ left: -52, width: 104, height: 4, transform: 'translateZ(4px) rotateX(-90deg)', borderRadius: 0, ...stand }} />
          <div className="f3" style={{ left: -52, width: 104, height: 60, transform: 'translateZ(64px) rotateX(-90deg)', borderRadius: 0, ...face }} />
        </div>
      ))}
    </>
  );
});

interface RowProps {
  r: number; xray: boolean; seats: Record<string, SeatVisual>; focus: Set<string>; lifted: Set<string>;
  int: boolean; onPick: (id: string, kbd: boolean) => void; onHover: (id: string) => void;
}
const Row = memo(function Row({ r, xray, seats, focus, lifted, int, onPick, onHover }: RowProps) {
  const letter = ROW_LETTERS[r];
  const h = (r + 1) * 9;
  const y = -170 + r * 34;
  const sTop = xray ? EDGE_STYLE : SLAB.top, sFront = xray ? EDGE_STYLE : SLAB.front, sSide = xray ? EDGE_STYLE : SLAB.side;
  const out = [];
  for (let k = 0; k < 14; k++) {
    const id = letter + (k + 1);
    const g = seatGeom(id)!;
    const st = seats[id] ?? 'free';
    const lift = (st === 'yours' ? 10 : 0) + (lifted.has(id) ? 10 : 0);
    out.push(<Seat key={id} id={id} x={g.x} sx={g.sx} sz={g.sz} st={st} wire={xray && !focus.has(id)} lift={lift} int={int} onPick={onPick} onHover={onHover} />);
  }
  return (
    <div style={{ position: 'absolute', left: 0, top: y, width: 0, height: 0, transformStyle: 'preserve-3d', transform: `translateZ(${h}px)` }}>
      <div className="rise3" style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, transformStyle: 'preserve-3d', ['--d' as string]: r * 30 + 'ms' }}>
        <div className="f3" style={{ left: -260, top: 0, width: 520, height: 34, ...sTop }} />
        <div className="f3" style={{ left: -260, top: 0, width: 520, height: h, transform: 'translate3d(0,34px,0) rotateX(-90deg)', ...sFront }} />
        <div className="f3" style={{ left: -260, top: 0, width: 34, height: h, transform: 'rotateZ(90deg) rotateX(-90deg)', ...sSide }} />
        {out}
      </div>
    </div>
  );
});

/* ---------- pins / ring / label ---------- */
const PIN = {
  A: { color: '#2F6FEB', dx: -8, idle: 44, down: 10, wait: 24, lx: -18 },
  B: { color: '#F2730A', dx: 8, idle: 60, down: 10, wait: 24, lx: 9 },
} as const;

function Pin({ pin }: { pin: HallPin }) {
  const g = seatGeom(pin.seat);
  if (!g) return null;
  const P = PIN[pin.id];
  const stem = P[pin.state];
  const top = g.h + 32 * g.sz + 4;
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0, transformStyle: 'preserve-3d', transition: 'transform .45s cubic-bezier(.2,.8,.2,1)',
      transform: `translate3d(${g.x + g.w / 2 + P.dx}px,${g.y + 14}px,${top + stem}px)`,
    }}>
      <div className="h3d-unsway"><div className="h3d-bb">
        <div style={{ position: 'absolute', left: 0, top: 5, width: 1, height: stem, background: P.color, transition: 'height .45s cubic-bezier(.2,.8,.2,1)' }} />
        <div className={pin.state === 'wait' ? 'h3d-ring pulse' : 'h3d-ring'} style={{
          position: 'absolute', left: -5, top: -5, width: 10, height: 10, borderRadius: '50%', background: P.color,
        }} />
        <div style={{ position: 'absolute', left: P.lx, top: -8, fontSize: 11, fontWeight: 500, color: P.color, lineHeight: 1 }}>{pin.id}</div>
      </div></div>
    </div>
  );
}

function Ring({ ring }: { ring: NonNullable<Hall3DProps['ring']> }) {
  const g = seatGeom(ring.seat);
  if (!g) return null;
  const col = ring.kind === 'held' ? '#E8A33D' : '#141414';
  return (
    <div className={'h3d-ring' + (ring.kind === 'pulse' ? ' pulse' : '')} style={{
      position: 'absolute', left: g.x - 4, top: g.y + 3 - 4, width: g.w + 8, height: 25 + 8,
      transform: `translateZ(${g.h + 0.8}px)`, border: `2px solid ${col}`, borderRadius: 6, pointerEvents: 'none',
    }} />
  );
}

function SeatTag({ seat }: { seat: string }) {
  const g = seatGeom(seat);
  if (!g) return null;
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, transformStyle: 'preserve-3d', transform: `translate3d(${g.x + g.w / 2}px,${g.y + 14}px,${g.h + 32 * g.sz + 30}px)` }}>
      <div className="h3d-unsway"><div className="h3d-bb">
        <div style={{ position: 'absolute', left: 0, top: 0, transform: 'translate(-50%,-50%)', fontFamily: 'var(--mono)', fontSize: 11, color: '#141414', background: 'rgba(246,245,242,.9)', padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}>{seat}</div>
      </div></div>
    </div>
  );
}

/* ---------- the model ---------- */
export default function Hall3D(props: Hall3DProps) {
  const {
    seats, xray = false, focus, lifted, pins, ring, seatLabel, onSeatClick, onSeatHover,
    interactive = false, height, scale, sway = true, shake = false, showOrbitHint = true, ariaLabel,
  } = props;

  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const cur = useRef({ angle: -18, tilt: 54 });
  const drag = useRef<{ x: number; y: number; a: number; t: number } | null>(null);
  const moved = useRef(false);
  const [stopped, setStopped] = useState(false);

  // drag only touches the scene's transform string (no React render)
  const apply = useCallback(() => {
    const s = sceneRef.current;
    if (!s) return;
    const { angle, tilt } = cur.current;
    s.style.transform = `rotateX(${tilt}deg) rotateZ(${angle}deg)`;
    s.style.setProperty('--ang', angle + 'deg');
    s.style.setProperty('--tilt', tilt + 'deg');
  }, []);
  useLayoutEffect(apply, [apply]);

  // Scroll smoothness: the idle sway re-composites every face of the model each frame, so hold it
  // while the page is scrolling and while the model is off-screen (then also skip drawing it).
  // Data-attribute toggles (React never touches them) from passive listeners: no renders, no layout reads.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let timer = 0;
    const settle = () => { timer = 0; el.removeAttribute('data-scrolling'); };
    const onScroll = () => {
      if (!timer) el.setAttribute('data-scrolling', ''); else clearTimeout(timer);
      timer = window.setTimeout(settle, 160);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(es => { for (const e of es) el.toggleAttribute('data-offscreen', !e.isIntersecting); }, { rootMargin: '120px 0px' });
      io.observe(el);
    }
    return () => { window.removeEventListener('scroll', onScroll); io?.disconnect(); if (timer) clearTimeout(timer); };
  }, []);

  const cb = useRef({ onSeatClick, onSeatHover });
  cb.current = { onSeatClick, onSeatHover };
  const onPick = useCallback((id: string, kbd: boolean) => { if (kbd || !moved.current) cb.current.onSeatClick?.(id); }, []);
  const onHover = useCallback((id: string) => cb.current.onSeatHover?.(id), []);

  const focusKey = (focus ?? []).join(',');
  const liftKey = (lifted ?? []).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const focusSet = useMemo(() => new Set(focus ?? []), [focusKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const liftSet = useMemo(() => new Set(lifted ?? []), [liftKey]);

  const onDown = (e: RPointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, a: cur.current.angle, t: cur.current.tilt };
    moved.current = false;
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!moved.current) {
      if (Math.hypot(dx, dy) < 5) return;
      moved.current = true;
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
      setStopped(true);
    }
    cur.current = { angle: Math.max(-85, Math.min(25, d.a + dx * 0.3)), tilt: Math.max(45, Math.min(70, d.t - dy * 0.2)) };
    apply();
  };
  const onUp = (e: RPointerEvent) => {
    if (drag.current && moved.current) { try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ } }
    drag.current = null; // `moved` stays set until next pointerdown so the trailing click is swallowed
  };
  const onLeave = () => { if (interactive) onSeatHover?.(null); };

  const stageStyle: CSSProperties = {};
  if (height != null) (stageStyle as Record<string, string>)['--h'] = height + 'px';
  if (scale != null) (stageStyle as Record<string, string>)['--s'] = String(scale);

  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    rows.push(<Row key={r} r={r} xray={xray} seats={seats} focus={focusSet} lifted={liftSet} int={interactive} onPick={onPick} onHover={onHover} />);
  }

  return (
    <div
      ref={stageRef}
      className={'h3d' + (stopped ? ' paused' : '') + (sway ? '' : ' nosway') + (interactive ? ' int' : '')}
      style={stageStyle}
      role={interactive ? 'group' : 'img'}
      aria-label={ariaLabel ?? 'Cinema hall, rows A to J, 14 seats per row'}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onLeave}
    >
      <div className={'h3d-fit' + (shake ? ' shake' : '')}>
        <div ref={sceneRef} className="h3d-scene">
          <div className="h3d-sway">
            <div className="h3d-g">
              <div style={CONTACT_SHADOW} />
              <Plinth xray={xray} />
              {rows}
              <Screen xray={xray} />
              {ring && <Ring ring={ring} />}
              {pins?.map(p => <Pin key={p.id} pin={p} />)}
              {seatLabel && <SeatTag seat={seatLabel} />}
            </div>
          </div>
        </div>
      </div>
      {showOrbitHint && <span aria-hidden="true" className="h3d-hint">Drag to orbit</span>}
    </div>
  );
}
