import { memo, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { shade } from './Hall3D';

type C = { t: string; f: string; s: string };
const cols = (hex: string): C => ({ t: hex, f: shade(hex, 0.88), s: shade(hex, 0.8) });
const A = cols('#2F6FEB'), B = cols('#F2730A'), CLAY: C = { t: '#DAD6CE', f: '#C5C0B6', s: '#B3ADA2' };
const INK: C = { t: '#141414', f: '#141414', s: '#141414' };

function box(list: CSSProperties[], x: number, y: number, z: number, w: number, d: number, h: number, c: C, wire: boolean) {
  const bg = (v: string): CSSProperties => (wire ? { backgroundColor: 'transparent', borderColor: 'rgba(20,20,20,.6)' } : { backgroundColor: v, borderColor: 'transparent' });
  list.push({ width: w, height: d, transform: `translate3d(${x}px,${y}px,${z + h}px)`, ...bg(c.t) });
  list.push({ width: w, height: h, transform: `translate3d(${x}px,${y + d}px,${z}px) rotateX(90deg)`, ...bg(c.f) });
  list.push({ width: d, height: h, transform: `translate3d(${x}px,${y}px,${z}px) rotateZ(90deg) rotateX(90deg)`, ...bg(c.s) });
  list.push({ width: d, height: h, transform: `translate3d(${x + w}px,${y}px,${z}px) rotateZ(90deg) rotateX(90deg)`, ...bg(c.s) });
}

export type ModeKey = 'off' | 'lock' | 'atomic' | 'optimistic';
function faces(mode: ModeKey): CSSProperties[] {
  const f: CSSProperties[] = [];
  box(f, -56, -34, -4, 112, 68, 4, CLAY, false);
  if (mode === 'off') { box(f, -30, -22, 0, 24, 24, 14, A, false); box(f, -12, -6, 0, 24, 24, 14, B, false); }
  else if (mode === 'lock') { box(f, -44, -12, 0, 24, 24, 14, A, false); box(f, -4, -22, 0, 3, 44, 24, INK, false); box(f, 22, -12, 0, 24, 24, 14, B, true); }
  else if (mode === 'atomic') { box(f, -12, -12, 0, 24, 24, 14, A, false); box(f, 12, -12, 30, 24, 24, 14, B, true); }
  else { box(f, -44, -12, 0, 24, 24, 14, A, false); box(f, -44, -12, 22, 24, 24, 14, B, true); box(f, 20, -12, 0, 24, 24, 14, B, false); }
  return f;
}

/** Tiny 3D diorama for a concurrency mode (Home "four modes"). Hover (parent .mode) turns it. */
export default memo(function ModeMini({ mode }: { mode: ModeKey }) {
  const list = useMemo(() => faces(mode), [mode]);
  return (
    <div className="mm-stage">
      <div className="mm-mini">
        {list.map((s, i) => <div key={i} className="fc" style={s} />)}
      </div>
    </div>
  );
});
