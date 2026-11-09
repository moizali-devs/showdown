import { useEffect, useRef, useState } from 'react';
import { labApi, type PerfQuery, type PerfResult } from './labApi';
import { C, Exhibit, ErrorLine, mono } from './parts';

type Name = PerfQuery['name'];
const CREATE_SQL: Record<Name, string> = {
  seat_search: 'CREATE INDEX ix_show_seat_booking ON show_seat (booking_id) WHERE booking_id IS NOT NULL;',
  sales_report: "CREATE INDEX ix_payment_paid_at ON payment (paid_at) INCLUDE (booking_id, amount) WHERE status = 'PAID';",
};
interface Measure { ms: number; node: string; rows: number }
type Store = Record<Name, { seq?: Measure; idx?: Measure }>;

const fmtMs = (ms: number) => (ms >= 10 ? ms.toFixed(1) : ms.toFixed(2)) + ' ms';

export default function Indexes() {
  const [store, setStore] = useState<Store>({ seat_search: {}, sales_report: {} });
  const [sql, setSql] = useState<Record<string, string>>({});
  const [indexed, setIndexed] = useState<boolean | null>(null);
  const [which, setWhich] = useState<Name>('seat_search');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [anim, setAnim] = useState(1);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const absorb = (p: PerfResult) => {
    setIndexed(p.indexed);
    setSql((s) => ({ ...s, ...Object.fromEntries(p.queries.map((q) => [q.name, q.sql])) }));
    setStore((s) => {
      const n = { ...s };
      p.queries.forEach((q) => {
        const m = { ms: q.ms, node: q.node, rows: q.rows };
        // Without indexes there is no index scan to show: drop the stale reading instead of keeping it.
        n[q.name] = p.indexed ? { ...n[q.name], idx: m } : { seq: m };
      });
      return n;
    });
    setAnim(0);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAnim(1), 60);
  };
  const wrap = async (fn: () => Promise<PerfResult>) => {
    setBusy(true); setErr(null);
    try { absorb(await fn()); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { void wrap(labApi.perf); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = store[which];
  const max = Math.max(cur.seq?.ms ?? 0, cur.idx?.ms ?? 0, 0.001);
  const bar = (m: Measure | undefined, color: string, dur: number) => (
    <div style={{ height: 6, background: C.line, borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ height: 6, background: color, borderRadius: 3, minWidth: m ? 2 : 0, width: m && anim ? `${Math.max(0.5, (m.ms / max) * 100)}%` : 0, transition: `width ${anim ? dur : 0}s linear` }} />
    </div>
  );
  const row = (label: string, m: Measure | undefined, color: string, key: 'seq' | 'idx') => {
    const stale = m && indexed !== null && (key === 'seq' ? indexed : false);
    return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
        <span>{label} <span style={{ fontFamily: mono, fontSize: 11, color: C.muted }}>{m?.node ?? ''}</span></span>
        <span style={{ fontFamily: mono, fontSize: 13 }}>{m ? fmtMs(m.ms) : key === 'idx' && indexed === false ? 'no index (dropped)' : 'not measured yet'}{stale && <span className="lab-label" style={{ marginLeft: 6 }}>before indexes</span>}{m && <span className="lab-label" style={{ marginLeft: 6 }}>{m.rows} rows</span>}</span>
      </div>
      {bar(m, color, key === 'seq' ? 1.2 : 0.2)}
    </div>
    );
  };

  return (
    <Exhibit n="05" title="Indexes" blurb="The same lookup, read in full or found directly." tag="Lab 3, 7" last align="stretch">
      <div style={{ maxWidth: 600, width: '100%', display: 'flex', flexDirection: 'column', gap: 26 }}>
        <div className="lab-seg" role="group" aria-label="Query" style={{ justifyContent: 'flex-start' }}>
          {(['seat_search', 'sales_report'] as Name[]).map((n) => <button key={n} type="button" aria-pressed={which === n} onClick={() => setWhich(n)}>{n.replace('_', ' ')}</button>)}
        </div>
        {row('Seq scan', cur.seq, C.ink, 'seq')}
        {row('Index scan', cur.idx, C.green, 'idx')}
        <div style={{ fontFamily: mono, fontSize: 12, lineHeight: 1.6, overflowX: 'auto', whiteSpace: 'pre', paddingBottom: 4 }}>
          {indexed === null ? '' : (indexed ? '' : '-- dropped: ') + CREATE_SQL[which]}
        </div>
        {sql[which] && <details><summary className="lab-label" style={{ cursor: 'pointer' }}>Query</summary><pre style={{ fontFamily: mono, fontSize: 12, overflowX: 'auto', margin: '8px 0 0' }}>{sql[which]}</pre></details>}
        <div className="lab-label">Indexes now: {indexed === null ? '…' : indexed ? 'created' : 'dropped'}</div>
        <ErrorLine msg={err} />
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" className="lab-ghost" disabled={busy || indexed === false} onClick={() => wrap(() => labApi.perfIndexes(false))}>Drop indexes</button>
          <button type="button" className="lab-ghost" disabled={busy || indexed === true} onClick={() => wrap(() => labApi.perfIndexes(true))}>Create indexes</button>
          <button type="button" className="lab-ghost" disabled={busy} onClick={() => wrap(labApi.perf)}>Replay</button>
        </div>
      </div>
    </Exhibit>
  );
}
