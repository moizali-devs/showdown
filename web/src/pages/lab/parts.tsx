import type { CSSProperties, ReactNode } from 'react';

export const C = {
  ink: 'var(--ink, #141414)', muted: 'var(--muted, #6B6862)', line: 'var(--line, #D6D2CA)', surface: 'var(--surface, #F6F5F2)',
  red: 'var(--conflict, #E5484D)', green: 'var(--booked, #1F8A5B)', amber: 'var(--held, #E8A33D)',
  a: 'var(--cust-a, #2F6FEB)', b: 'var(--cust-b, #F2730A)',
};
export const mono = "'Geist Mono', ui-monospace, monospace";

export const LAB_CSS = `
.lab-label{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${C.muted}}
.lab-ttl{margin:0;font-weight:300;font-size:clamp(40px,6vw,56px);line-height:.95;letter-spacing:-.04em}
.lab-pill{background:${C.ink};color:#fff;border:0;border-radius:999px;min-height:44px;padding:0 26px;font:500 14px Geist,system-ui,sans-serif;cursor:pointer;transition:background .2s}
.lab-pill:hover:not(:disabled){background:#3a3a3a}
.lab-pill:disabled{opacity:.5;cursor:default}
.lab-ghost{background:transparent;color:${C.ink};border:1px solid ${C.ink};border-radius:999px;min-height:44px;padding:0 22px;font:500 14px Geist,system-ui,sans-serif;cursor:pointer}
.lab-ghost:hover:not(:disabled){background:${C.ink};color:#fff}
.lab-ghost:disabled{opacity:.5;cursor:default}
.lab-sw{display:inline-flex;align-items:center;gap:12px;min-height:44px;background:transparent;border:0;padding:0;cursor:pointer;font:400 14px Geist,system-ui,sans-serif;color:${C.ink}}
.lab-pill:focus-visible,.lab-ghost:focus-visible,.lab-sw:focus-visible,.lab-seg button:focus-visible{outline:2px solid ${C.ink};outline-offset:3px}
.lab-seg{display:inline-flex;gap:4px;flex-wrap:wrap;justify-content:center}
.lab-seg button{min-height:32px;padding:0 12px;border-radius:999px;border:1px solid ${C.line};background:transparent;font:400 12px Geist,system-ui,sans-serif;color:${C.muted};cursor:pointer}
.lab-seg button[aria-pressed=true]{background:${C.ink};border-color:${C.ink};color:#fff}
.lab-range{accent-color:${C.ink}}
@keyframes lab-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}
.lab-shake{animation:lab-shake .5s ease 2}
@media (prefers-reduced-motion: reduce){.lab-shake{animation:none}*{transition-duration:0s !important;transition-delay:0s !important}}
`;

export function Label({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="lab-label" style={style}>{children}</div>;
}

export function Exhibit(props: {
  n: string; title: string; blurb: string; tag: ReactNode; last?: boolean; children: ReactNode; align?: 'center' | 'stretch';
}) {
  return (
    <section style={{ borderTop: `1px solid ${C.line}`, borderBottom: props.last ? `1px solid ${C.line}` : undefined }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '56px clamp(20px,5.5vw,80px)', boxSizing: 'border-box', display: 'flex', flexWrap: 'wrap', gap: '48px 64px', alignItems: 'center' }}>
        <div style={{ flex: '1 1 340px', minWidth: 0 }}>
          <Label>{props.n}</Label>
          <h2 className="lab-ttl" style={{ marginTop: 14 }}>{props.title}</h2>
          <p style={{ margin: '20px 0 22px', maxWidth: '30ch', color: C.muted, lineHeight: 1.5 }}>{props.blurb}</p>
          <Label>{props.tag}</Label>
        </div>
        <div style={{ flex: '1.3 1 400px', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: props.align === 'stretch' ? 'stretch' : 'center', gap: 18 }}>
          {props.children}
        </div>
      </div>
    </section>
  );
}

export function ErrorLine({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div role="alert" style={{ color: C.red, fontSize: 13, textAlign: 'center' }}>{msg}</div>;
}
