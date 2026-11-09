import type { CSSProperties } from 'react';

export interface SegmentedOption<T extends string> { value: T; label: string; disabled?: boolean }
interface Props<T extends string> {
  options: SegmentedOption<T>[] | readonly T[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
  style?: CSSProperties;
}

/** Hairline pill group; the active segment is ink with white text. */
export default function Segmented<T extends string>({ options, value, onChange, ariaLabel, style }: Props<T>) {
  const opts: SegmentedOption<T>[] = (options as (SegmentedOption<T> | T)[]).map(o => (typeof o === 'string' ? { value: o, label: o } : o));
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{ display: 'inline-flex', padding: 3, gap: 2, border: '1px solid var(--line)', borderRadius: 999, ...style }}>
      {opts.map(o => {
        const on = o.value === value;
        return (
          <button
            key={o.value} type="button" role="radio" aria-checked={on} disabled={o.disabled} onClick={() => onChange(o.value)}
            style={{
              height: 30, padding: '0 16px', border: 0, borderRadius: 999, cursor: o.disabled ? 'default' : 'pointer', fontSize: 12,
              letterSpacing: '.12em', textTransform: 'uppercase', whiteSpace: 'nowrap',
              background: on ? 'var(--ink)' : 'transparent', color: on ? '#fff' : 'var(--ink)', opacity: o.disabled ? 0.35 : 1,
              transition: 'background-color .2s,color .2s',
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}
