import { useMemo, useState } from 'react';
import { analyze } from '../../lib/serializability';
import { C, Exhibit, mono } from './parts';

const W = 320, H = 210;

export default function Serializability() {
  const [text, setText] = useState('R1(A) W2(A) R2(B) W1(B)');
  const a = useMemo(() => analyze(text), [text]);

  const pos = new Map<number, [number, number]>();
  const n = a.txs.length;
  a.txs.forEach((id, i) => {
    if (n === 1) pos.set(id, [160, 105]);
    else if (n === 2) pos.set(id, [i === 0 ? 70 : 250, 105]);
    else { const ang = -Math.PI / 2 + (i / n) * Math.PI * 2; pos.set(id, [160 + Math.cos(ang) * 80, 105 + Math.sin(ang) * 76]); }
  });
  const cycEdge = new Set<string>(), cycNode = new Set<number>();
  if (a.cycle) for (let i = 0; i < a.cycle.length - 1; i++) { cycEdge.add(`${a.cycle[i]}>${a.cycle[i + 1]}`); cycNode.add(a.cycle[i]); }

  const f = (v: number) => v.toFixed(1);
  const edges = a.edges.map((e) => {
    const p = pos.get(e.from)!, q = pos.get(e.to)!;
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, px = -uy, py = ux;
    const sx = p[0] + ux * 20, sy = p[1] + uy * 20, ex = q[0] - ux * 21, ey = q[1] - uy * 21;
    const cx = (sx + ex) / 2 + px * 16, cy = (sy + ey) / 2 + py * 16;
    let tx = ex - cx, ty = ey - cy; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const bx = ex - tx * 9, by = ey - ty * 9, nx = -ty * 4.5, ny = tx * 4.5;
    return {
      key: `${e.from}>${e.to}`, label: e.kinds.join('/') + ' ' + e.items.join(','),
      d: `M ${f(sx)} ${f(sy)} Q ${f(cx)} ${f(cy)} ${f(ex)} ${f(ey)}`,
      head: `${f(ex)},${f(ey)} ${f(bx + nx)},${f(by + ny)} ${f(bx - nx)},${f(by - ny)}`,
      color: cycEdge.has(`${e.from}>${e.to}`) ? C.red : C.ink,
    };
  });

  let verdict: string, vColor = C.ink;
  if (a.errors.length) { verdict = a.errors[0]; vColor = C.red; }
  else if (!a.ops.length) { verdict = 'Type operations like R1(A) W2(A).'; vColor = C.muted; }
  else if (a.cycle) { verdict = `Not serializable. Cycle ${a.cycle.map((x) => 'T' + x).join(' → ')}.`; vColor = C.red; }
  else { verdict = `Serializable. Equivalent order ${a.order!.map((x) => 'T' + x).join(' → ')}.`; vColor = C.green; }

  return (
    <Exhibit n="04" title="Serializability" blurb="Type a schedule; a precedence graph decides if it can be reordered safely." tag="Lab 5 · Simulated · Runs in your browser">
      <label htmlFor="lab-sched" className="lab-label" style={{ width: '100%', maxWidth: 420 }}>Schedule</label>
      <input id="lab-sched" type="text" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} autoComplete="off"
        style={{ width: '100%', maxWidth: 420, boxSizing: 'border-box', height: 48, border: `1px solid ${C.ink}`, borderRadius: 999, background: C.surface, padding: '0 22px', font: `400 15px ${mono}`, color: C.ink, outline: 'none' }} />
      <div style={{ position: 'relative', width: W, maxWidth: '100%', height: H }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, pointerEvents: 'none' }} aria-hidden="true">
          {edges.map((e) => (
            <g key={e.key}><path d={e.d} fill="none" stroke={e.color} strokeWidth={1.4} /><polygon points={e.head} fill={e.color} /></g>
          ))}
        </svg>
        {a.txs.map((id) => {
          const p = pos.get(id)!, bad = cycNode.has(id);
          return <div key={id} style={{ position: 'absolute', left: p[0] - 18, top: p[1] - 18, width: 36, height: 36, boxSizing: 'border-box', borderRadius: '50%', border: `1px solid ${bad ? C.red : C.ink}`, background: C.surface, color: bad ? C.red : C.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 500 }}>T{id}</div>;
        })}
      </div>
      {edges.length > 0 && <div style={{ fontFamily: mono, fontSize: 11, color: C.muted, textAlign: 'center' }}>{a.edges.map((e) => `T${e.from}→T${e.to} (${e.kinds.join('/')} on ${e.items.join(',')})`).join('  ·  ')}</div>}
      <div style={{ minHeight: 24, textAlign: 'center', fontSize: 15, fontWeight: 500, color: vColor }} aria-live="polite">{verdict}</div>
    </Exhibit>
  );
}
