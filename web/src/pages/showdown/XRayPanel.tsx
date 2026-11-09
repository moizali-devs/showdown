import { useEffect, useRef, useState } from 'react';
import type { Customer, ShowdownState, SqlLine } from '../../../../shared/types';

function Feed({ who, lines }: { who: Customer; lines: SqlLine[] }) {
  return (
    <div>
      <div className="sd-lbl" style={{ marginBottom: 8 }}>Session {who}</div>
      <div className="sd-feed" data-testid={`feed-${who}`}>
        {lines.length === 0 ? <div className="ln k-info">no statements yet</div> : null}
        {lines.map((l, i) => (
          <div key={i} className={`ln k-${l.kind}`}>
            <span>{l.text}</span>
            {l.ms != null ? <span className="ms">{l.ms.toFixed(1)} ms</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Live wait: ticks client-side while phase is 'waiting', then shows the server's final waitMs. */
function useLiveWait(phase: string, waitMs: number): number {
  const since = useRef<number | null>(null);
  const [, tick] = useState(0);
  if (phase === 'waiting' && since.current == null) since.current = performance.now();
  if (phase !== 'waiting') since.current = null;
  useEffect(() => {
    if (phase !== 'waiting') return;
    const t = window.setInterval(() => tick((n) => n + 1), 100);
    return () => window.clearInterval(t);
  }, [phase]);
  return phase === 'waiting' && since.current != null ? Math.max(waitMs, performance.now() - since.current) : waitMs;
}

export function XRayPanel({ state }: { state: ShowdownState }) {
  const { A, B } = state.customers;
  const wA = useLiveWait(A.phase, A.waitMs);
  const wB = useLiveWait(B.phase, B.waitMs);
  const fmt = (n: number | null) => (n == null ? '–' : `${Math.round(n)} ms`);
  return (
    <section className="sd-xp" aria-label="X-Ray" data-testid="xray-panel">
      <div className="sd-xp-head"><span className="sd-lbl">X-Ray · live from PostgreSQL</span><span className="sd-lbl">{state.mode}</span></div>
      <div className="sd-xp-grid">
        <Feed who="A" lines={A.sql} />
        <Feed who="B" lines={B.sql} />
      </div>
      <div style={{ marginTop: 24 }}>
        <div className="sd-lbl" style={{ marginBottom: 8 }}>pg_locks</div>
        <div className="sd-scroll">
          <table className="sd-tbl">
            <thead><tr><th>pid</th><th>customer</th><th>locktype</th><th>relation</th><th>mode</th><th>granted</th><th>blocked by</th></tr></thead>
            <tbody>
              {state.locks.length === 0 ? <tr><td colSpan={7} style={{ color: '#6B6862' }}>no locks held</td></tr> : null}
              {state.locks.map((l, i) => (
                <tr key={i} style={l.granted ? undefined : { color: '#B07416' }}>
                  <td>{l.pid}</td><td>{l.customer ?? '–'}</td><td>{l.locktype}</td><td>{l.relation ?? '–'}</td>
                  <td>{l.mode}</td><td>{l.granted ? 'yes' : 'waiting'}</td><td>{l.blockedBy.length ? l.blockedBy.join(', ') : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="sd-tim">
        <span>A wait {fmt(wA)} · total {fmt(A.totalMs)}</span>
        <span>B wait {fmt(wB)} · total {fmt(B.totalMs)}</span>
        <span>result: {state.result ?? '–'}</span>
      </div>
    </section>
  );
}
