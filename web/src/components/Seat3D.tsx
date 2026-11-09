import { memo } from 'react';
import type { CSSProperties } from 'react';
import { SEAT_COLS } from './Hall3D';
import type { SeatVisual } from './Hall3D';
import '../styles/hall3d.css';

export interface Seat3DProps {
  state: SeatVisual;
  /** stage height in px (default 160) */
  size?: number;
  /** false = wireframe (X-Ray) */
  solid?: boolean;
  /** lift above its tile in px (default: 30 when state is 'yours', else 0) */
  lift?: number;
  sway?: boolean;
  ariaLabel?: string;
}

type Kind = 'top' | 'front' | 'side';
function face(kind: Kind, x: number, y: number, W: number, D: number, H: number, color: string, wire: boolean): CSSProperties {
  const fill: CSSProperties = wire ? { background: 'transparent', border: '1px solid #141414' } : { background: color };
  const common: CSSProperties = { position: 'absolute', boxSizing: 'border-box', borderRadius: 3, ...fill };
  if (kind === 'top') return { ...common, left: x, top: y, width: W, height: D, transform: `translateZ(${H}px)` };
  if (kind === 'front') return { ...common, left: x, top: y + D, width: W, height: H, transformOrigin: 'top', transform: 'rotateX(90deg)' };
  return { ...common, left: x, top: y, width: H, height: D, transformOrigin: 'left', transform: 'rotateY(-90deg)' };
}

const Seat3D = memo(function Seat3D({ state, size = 160, solid = true, lift, sway = false, ariaLabel }: Seat3DProps) {
  const wire = !solid;
  const [top, front, side] = SEAT_COLS[state];
  const lf = lift ?? (state === 'yours' ? 30 : 0);
  const tile = 8;
  const clay = SEAT_COLS.free;
  const scale = size / 230;
  return (
    <div
      role="img" aria-label={ariaLabel ?? `Seat, ${state}`}
      style={{ position: 'relative', height: size, width: '100%', perspective: 2200, perspectiveOrigin: '50% 30%' }}
    >
      <div
        style={{
          position: 'absolute', left: '50%', top: '60%', width: 0, height: 0, transformStyle: 'preserve-3d',
          transform: `rotateX(58deg) rotateZ(-18deg) scale(${scale})`,
          ['--sc' as string]: scale,
          ...(sway ? { animation: 'seat3sway 14s ease-in-out infinite alternate' } : null),
        }}
      >
        <div style={{ position: 'absolute', left: -48, top: -52, width: 96, height: 105, transformStyle: 'preserve-3d' }}>
          <div style={{ position: 'absolute', left: -6, top: 4, width: 108, height: 109, background: '#141414', opacity: 0.18, borderRadius: 14, filter: 'blur(14px)' }} />
          <div style={face('top', 0, 0, 96, 105, tile, clay[0], wire)} />
          <div style={face('front', 0, 0, 96, 105, tile, clay[1], wire)} />
          <div style={face('side', 0, 0, 96, 105, tile, clay[2], wire)} />
          <div style={{
            position: 'absolute', left: 20, top: 20, width: 56, height: 70, background: '#141414', borderRadius: 8,
            filter: `blur(${lf ? 10 : 4}px)`, opacity: lf ? 0.3 : wire ? 0 : 0.14, transform: `translateZ(${tile + 0.5}px)`,
          }} />
          <div style={{
            position: 'absolute', left: 0, top: 0, width: 96, height: 105, transformStyle: 'preserve-3d',
            transform: `translateZ(${tile + lf}px)`, transition: 'transform 300ms cubic-bezier(.2,.8,.2,1)',
          }}>
            <div style={face('top', 15, 30, 66, 60, 30, top, wire)} />
            <div style={face('front', 15, 30, 66, 60, 30, front, wire)} />
            <div style={face('side', 15, 30, 66, 60, 30, side, wire)} />
            <div style={face('top', 15, 15, 66, 15, 66, top, wire)} />
            <div style={face('front', 15, 15, 66, 15, 66, front, wire)} />
            <div style={face('side', 15, 15, 66, 15, 66, side, wire)} />
          </div>
        </div>
      </div>
    </div>
  );
});

export default Seat3D;
