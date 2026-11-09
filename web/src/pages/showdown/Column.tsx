import type { Customer, CustomerState } from '../../../../shared/types';

const COL = { A: '#2F6FEB', B: '#F2730A' } as const;

export function Column({ who, st, side, small }: { who: Customer; st: CustomerState; side: 'l' | 'r'; small?: boolean }) {
  const steps = [0, 1, 2, 3].map((i) => st.steps[i] ?? '');
  const sc = st.status === 'Booked' ? '#1F8A5B' : st.status === 'Double booked' ? '#E5484D' : '#141414';
  return (
    <div className={`sd-col ${side === 'r' ? 'r' : ''} ${small ? 'small' : ''}`} data-testid={`col-${who}`}>
      <div className="who sd-lbl">
        <span className="sd-dot" style={{ background: COL[who] }} />
        Customer {who}
        {small && st.phase !== 'idle' ? <span style={{ textTransform: 'none', letterSpacing: 0 }}>· {st.phase}</span> : null}
      </div>
      <div className="sd-steps">
        {steps.map((t, i) => (
          <div key={i} className={`sd-step ${t ? 'on' : ''} ${t.startsWith('waiting') ? 'wait' : ''}`}>{t || ' '}</div>
        ))}
      </div>
      <div className={`sd-status ${st.status ? 'on' : ''}`} style={{ color: sc }} data-testid={`status-${who}`}>{st.status ?? ' '}</div>
    </div>
  );
}
