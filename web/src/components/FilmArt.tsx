import { memo } from 'react';
import type { ReactNode } from 'react';
import type { Movie } from '@shared/types';

/** Original abstract art per film (pure SVG, no posters, no runtimes/cast). 300 x 400 viewBox. */
const MOTIFS = ['dune', 'sail', 'ring', 'shield', 'web', 'planet', 'blocks', 'cape'] as const;
type Motif = (typeof MOTIFS)[number];

const BY_TITLE: [RegExp, Motif][] = [
  [/odyssey/i, 'sail'], [/dune/i, 'dune'], [/avengers/i, 'shield'], [/hunger/i, 'ring'],
  [/spider/i, 'web'], [/hail mary/i, 'planet'], [/toy story/i, 'blocks'], [/supergirl/i, 'cape'],
];
const ALIAS: Record<string, Motif> = {
  odyssey: 'sail', ship: 'sail', wave: 'sail', desert: 'dune', sand: 'dune', arc: 'ring', flame: 'ring', mockingjay: 'ring',
  avengers: 'shield', burst: 'shield', star: 'shield', spider: 'web', net: 'web', space: 'planet', orbit: 'planet',
  toy: 'blocks', brick: 'blocks', bricks: 'blocks', super: 'cape', swoosh: 'cape',
};

function pick(movie: Pick<Movie, 'title' | 'art'>): Motif {
  const m = String(movie.art?.motif ?? '').toLowerCase();
  if ((MOTIFS as readonly string[]).includes(m)) return m as Motif;
  if (ALIAS[m]) return ALIAS[m];
  for (const [re, k] of BY_TITLE) if (re.test(movie.title)) return k;
  let h = 0;
  for (const c of movie.title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return MOTIFS[h % MOTIFS.length];
}

function art(m: Motif, p: string[]): ReactNode {
  const [c0, c1, c2, c3] = p;
  switch (m) {
    case 'dune':
      return (<>
        <circle cx="210" cy="130" r="58" fill={c3} opacity=".9" />
        <path d="M0 250 Q80 200 170 240 T300 215 V400 H0Z" fill={c2} />
        <path d="M0 300 Q90 250 190 290 T300 270 V400 H0Z" fill={c1} />
        <path d="M0 350 Q110 310 210 345 T300 330 V400 H0Z" fill={c0} />
      </>);
    case 'sail':
      return (<>
        <circle cx="150" cy="150" r="70" fill={c3} opacity=".85" />
        <path d="M150 120 V270 L215 270 Z" fill={c2} />
        <path d="M144 135 V270 L95 270 Z" fill={c1} />
        <path d="M80 280 H220 L205 300 H95Z" fill={c0} />
        {[300, 330, 360].map((y, i) => <path key={y} d={`M0 ${y} Q40 ${y - 14} 75 ${y} T150 ${y} T225 ${y} T300 ${y} V400 H0Z`} fill={[c1, c2, c0][i]} opacity={0.55 + i * 0.2} />)}
      </>);
    case 'ring':
      return (<>
        {[110, 85, 60, 35].map((r, i) => <circle key={r} cx="150" cy="190" r={r} fill="none" stroke={[c1, c2, c3, c1][i]} strokeWidth={i === 3 ? 10 : 5} />)}
        <path d="M60 330 L240 60" stroke={c3} strokeWidth="4" />
        <path d="M240 60 l-6 22 m6 -22 l-22 6" stroke={c3} strokeWidth="4" fill="none" />
      </>);
    case 'shield':
      return (<>
        <circle cx="150" cy="190" r="100" fill={c1} />
        <circle cx="150" cy="190" r="72" fill={c0} />
        <circle cx="150" cy="190" r="44" fill={c2} />
        <path d="M150 150 L160 182 L194 182 L166 202 L176 234 L150 214 L124 234 L134 202 L106 182 L140 182Z" fill={c3} />
      </>);
    case 'web':
      return (<>
        {Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6; return <line key={i} x1="150" y1="200" x2={150 + Math.cos(a) * 190} y2={200 + Math.sin(a) * 190} stroke={c2} strokeWidth="1.5" />; })}
        {[30, 65, 100, 135].map((r, k) => <polygon key={r} fill="none" stroke={c1} strokeWidth="2" points={Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6; return `${150 + Math.cos(a) * r},${200 + Math.sin(a) * r * (1 - k * 0.02)}`; }).join(' ')} />)}
        <circle cx="150" cy="200" r="14" fill={c3} />
      </>);
    case 'planet':
      return (<>
        {Array.from({ length: 14 }, (_, i) => <circle key={i} cx={(i * 97) % 300} cy={(i * 53) % 200} r={i % 3 ? 1.5 : 2.5} fill={c3} opacity=".8" />)}
        <circle cx="150" cy="210" r="78" fill={c1} />
        <path d="M90 180 Q150 150 210 190 Q160 170 100 210Z" fill={c2} opacity=".6" />
        <ellipse cx="150" cy="210" rx="130" ry="26" fill="none" stroke={c3} strokeWidth="3" transform="rotate(-18 150 210)" />
        <circle cx="258" cy="168" r="9" fill={c0} />
      </>);
    case 'blocks':
      return (<>
        {[[40, 280, 100, 80, c1], [140, 280, 100, 80, c2], [90, 200, 100, 80, c3], [190, 200, 70, 80, c1], [60, 120, 100, 80, c2]].map(([x, y, w, h, c], i) => (
          <g key={i}><rect x={x as number} y={y as number} width={w as number} height={h as number} rx="6" fill={c as string} />
            <circle cx={(x as number) + (w as number) / 2} cy={(y as number) + 12} r="6" fill={c0} opacity=".5" /></g>
        ))}
      </>);
    default: // cape
      return (<>
        <path d="M60 60 Q250 90 240 230 Q230 330 120 360 Q190 260 130 190 Q90 130 60 60Z" fill={c1} />
        <path d="M60 60 Q190 120 170 230 Q160 300 120 360 Q190 260 130 190 Q90 130 60 60Z" fill={c2} opacity=".8" />
        <circle cx="210" cy="90" r="28" fill={c3} />
      </>);
  }
}

const DEFAULT_PAL = ['#C5C0B6', '#9A948A', '#6F6A62', '#F6F5F2'];

function FilmArt({ movie, ratio = '3 / 4', className }: { movie: Pick<Movie, 'title' | 'art'>; ratio?: string; className?: string }) {
  const pal = [...(movie.art?.palette ?? []), ...DEFAULT_PAL].slice(0, 4);
  const motif = pick(movie);
  return (
    <div className={className} role="img" aria-label={`${movie.title} artwork`} style={{ aspectRatio: ratio, background: pal[0], overflow: 'hidden', borderRadius: 3, position: 'relative' }}>
      <svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" style={{ display: 'block' }} aria-hidden="true">
        <rect width="300" height="400" fill={pal[0]} />
        {art(motif, pal)}
      </svg>
    </div>
  );
}
export default memo(FilmArt);
