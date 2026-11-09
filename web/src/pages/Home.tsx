import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as RPE } from 'react';
import { Link } from 'react-router-dom';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import Label from '../components/Label';
import FilmArt from '../components/FilmArt';
import Hall3D from '../components/Hall3D';
import type { HallPin, SeatVisual } from '../components/Hall3D';
import ModeMini from '../components/ModeMini';
import type { ModeKey } from '../components/ModeMini';
import { api } from '../lib/api';
import type { Movie, Showtime } from '../lib/api';
import { useWidth, dayKey, dayLabel } from '../lib/hooks';
import { posterFor, grayPosterFor } from '../lib/posters';
import { useXRay } from '../lib/xray';
import { useReveal } from '../lib/useReveal';
import '../styles/home.css';

const MODES: { key: ModeKey; name: string; line: string }[] = [
  { key: 'off', name: 'Off', line: 'No protection. Both win. One loses.' },
  { key: 'lock', name: 'Lock', line: 'First in line holds it. Second waits.' },
  { key: 'atomic', name: 'Atomic', line: 'One statement decides. Loser is rejected.' },
  { key: 'optimistic', name: 'Optimistic', line: 'Both try. A version check rejects one.' },
];

const HOME_SEATS: Record<string, SeatVisual> = { C7: 'conflict' };
const PINS: HallPin[] = [{ id: 'A', seat: 'C7', state: 'idle' }, { id: 'B', seat: 'C7', state: 'idle' }];
const FOCUS = ['C7'];

// React 18 has no typed `inert`; spread it as an attribute.
const INERT = { inert: '' } as object;
type Row = { movie: Movie; times: Showtime[] };
const idx = (i: number): CSSProperties => ({ ['--i' as string]: i });

/** Three upcoming showtimes: the selected day first, then the following days; chips from other days get a short day prefix. */
function cardTimes(times: Showtime[], day: string | undefined, n: number): { t: Showtime; prefix: string }[] {
  const sorted = [...times].sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
  const on = day ? sorted.filter(t => dayKey(t.startsAt) === day) : [];
  const later = sorted.filter(t => (day ? dayKey(t.startsAt) > day : false));
  const rest = sorted.filter(t => !on.includes(t) && !later.includes(t));
  const pick = on.length >= n ? on : [...on, ...later, ...rest];
  return pick.slice(0, n).map(t => ({
    t,
    prefix: day && dayKey(t.startsAt) === day ? '' : new Date(t.startsAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi', weekday: 'short' }) + ' ',
  }));
}

function Poster({ movie, alt }: { movie: Movie; alt: string }) {
  const src = posterFor(movie.title);
  if (!src) return <span className="hm-fallback"><FilmArt movie={movie} /></span>;
  return (
    <>
      <img src={src} alt={alt} width={500} height={740} loading="lazy" decoding="async" />
      <img className="gray" src={grayPosterFor(movie.title) ?? src} alt="" aria-hidden="true" width={500} height={740} loading="lazy" decoding="async" />
    </>
  );
}

export default function Home() {
  const w = useWidth();
  const { on: xray } = useXRay();
  const [dragged, setDragged] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [films, setFilms] = useState<Row[] | null>(null);
  const [dayIx, setDayIx] = useState(0);

  // Layer transition: the layer we are leaving stays mounted (absolute, fading) for a moment.
  const [leaving, setLeaving] = useState<boolean | null>(null); // value of xray we are leaving
  const [sweep, setSweep] = useState(0);
  const prev = useRef(xray);
  useEffect(() => {
    if (prev.current === xray) return;
    setLeaving(prev.current);
    setSweep(n => n + 1);
    setDragged(false);
    prev.current = xray;
    const t = window.setTimeout(() => setLeaving(null), 750);
    return () => window.clearTimeout(t);
  }, [xray]);
  const animating = sweep > 0;

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const ms = await api.movies();
        const rows = await Promise.all(ms.map(async movie => {
          try { const r = await api.movie(movie.id); return { movie, times: r.showtimes }; } catch { return { movie, times: [] as Showtime[] }; }
        }));
        if (!off) setFilms(rows);
      } catch { if (!off) setFilms([]); }
    })();
    return () => { off = true; };
  }, []);

  const featured = useMemo(() => films?.find(f => /dune/i.test(f.movie.title)) ?? films?.[0] ?? null, [films]);
  const days = useMemo(() => {
    if (!featured) return [] as { key: string; label: string }[];
    const seen: { key: string; label: string }[] = [];
    for (const t of featured.times) {
      const key = dayKey(t.startsAt);
      if (!seen.some(d => d.key === key)) seen.push({ key, label: dayLabel(t.startsAt) });
      if (seen.length === 3) break;
    }
    return seen;
  }, [featured]);
  const day = days[Math.min(dayIx, Math.max(days.length - 1, 0))];
  const heroTimes = featured ? featured.times.filter(t => !day || dayKey(t.startsAt) === day.key).slice(0, 4) : [];

  const revealRef = useReveal<HTMLDivElement>(films);

  const scale = w > 1280 ? 1.25 : w > 900 ? 1.05 : w > 640 ? 0.8 : w > 460 ? 0.62 : 0.5;
  const height = w > 900 ? 720 : w > 640 ? 520 : w > 460 ? 440 : 380;

  // Hall3D owns the orbit; here we only notice that the user moved it, to offer "Reset".
  const down = useRef({ x: 0, y: 0, on: false });
  const pd = (e: RPE) => { down.current = { x: e.clientX, y: e.clientY, on: true }; };
  const pm = (e: RPE) => { const d = down.current; if (d.on && !dragged && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) setDragged(true); };
  const pu = () => { down.current.on = false; };

  const layerCls = (mode: boolean) => {
    if (leaving === mode) return 'hm-layer hm-leave';
    return 'hm-layer' + (animating ? ' hm-enter' : '');
  };
  const showCinema = !xray || leaving === false;
  const showXray = xray || leaving === true;
  const rowCount = films?.length ?? 8;

  return (
    <div className={'page' + (xray ? ' is-xray' : '')} ref={revealRef}>
      <Nav />

      <div className="hm-stage">
        {sweep > 0 && <div key={sweep} className="hm-scan" aria-hidden="true" />}

        {showCinema && (
          <div className={layerCls(false)} aria-hidden={xray || undefined} {...(xray ? INERT : {})}>
            <div className="wrap" style={{ paddingTop: 72 }}>
              {featured ? (
                <div className="hm-hero">
                  <Link className="hm-poster st" style={idx(0)} to={`/films/${featured.movie.id}`} aria-label={`${featured.movie.title}, details`}>
                    {posterFor(featured.movie.title)
                      ? <img src={posterFor(featured.movie.title)!} alt={`${featured.movie.title} poster`} width={500} height={740} decoding="async" />
                      : <FilmArt movie={featured.movie} />}
                  </Link>
                  <div style={{ paddingBottom: 8, minWidth: 0 }}>
                    <div className="hm-eyebrow st" style={idx(1)}>Featured · Screen 1</div>
                    <h1 className="hm-h1 st" style={idx(2)}><Link to={`/films/${featured.movie.id}`}>{featured.movie.title}</Link></h1>
                    <div className="st" style={{ ...idx(3), marginTop: 20, fontSize: 15, color: 'var(--muted)' }}>{featured.movie.genre} · {featured.movie.year}</div>
                    <div className="st" style={{ ...idx(4), marginTop: 56, borderTop: '1px solid var(--line)', paddingTop: 24 }}>
                      <div role="tablist" aria-label="Day" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                        {days.map((d, i) => (
                          <button key={d.key} type="button" role="tab" className="hm-tab" aria-selected={d === day} onClick={() => setDayIx(i)}>{d.label}</button>
                        ))}
                      </div>
                      <div style={{ marginTop: 20, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {heroTimes.map(t => <Link key={t.id} className="hm-chip lg" to={`/hall/${t.id}`}>{t.label}</Link>)}
                      </div>
                      <div style={{ marginTop: 36, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                        {heroTimes[0] && <Link className="hm-btn hm-press" to={`/hall/${heroTimes[0].id}`}>Book seats · {heroTimes[0].label}</Link>}
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{heroTimes[0]?.hall ?? 'Hall 1'} · 140 seats · sample showtimes</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : <div style={{ minHeight: 560 }} />}
            </div>
          </div>
        )}

        {showXray && (
          <div className={layerCls(true)} aria-hidden={!xray || undefined} {...(!xray ? INERT : {})}>
            <div className="wrap" style={{ paddingTop: 72 }}>
              <h1 className="st" style={{ ...idx(0), margin: 0, fontWeight: 300, fontSize: 'clamp(52px,8.4vw,120px)', lineHeight: 0.95, letterSpacing: '-0.04em' }}>Two people. One seat.</h1>
              <p className="st" style={{ ...idx(1), margin: '24px 0 0', fontSize: 18, color: 'var(--muted)', letterSpacing: '-0.01em' }}>Watch the database decide who gets it.</p>
            </div>

            <div className="st" style={{ ...idx(2), position: 'relative', marginTop: 24 }}>
              <div className="hm-sql">
                <div>UPDATE show_seat SET status = 'BOOKED'</div>
                <div>WHERE seat_id = 'C7' AND status = 'FREE';</div>
                <div style={{ color: 'var(--muted)' }}>-- A: 1 row &nbsp;·&nbsp; B: 0 rows</div>
              </div>
              <div className="hm-orbit" onPointerDown={pd} onPointerMove={pm} onPointerUp={pu} onPointerCancel={pu}>
                {xray && (
                  <Hall3D key={epoch} seats={HOME_SEATS} xray focus={FOCUS} pins={PINS} height={height} scale={scale}
                    showOrbitHint={false} ariaLabel="Wireframe 3D model of the cinema hall. Seat C7 is solid red: two customers want it." />
                )}
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 24, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, pointerEvents: 'none' }}>
                  <Label>Drag to orbit</Label>
                  {dragged && (
                    <button type="button" onClick={() => { setEpoch(n => n + 1); setDragged(false); }}
                      style={{ all: 'unset', cursor: 'pointer', pointerEvents: 'auto', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink)', borderBottom: '1px solid var(--ink)' }}>Reset</button>
                  )}
                </div>
              </div>
            </div>

            <div className="wrap st" style={{ ...idx(3), paddingTop: 56 }}>
              <div className="hm-doors">
                <Link className="hm-door" to="/showdown">
                  <div className="hm-eyebrow">01 · The race</div>
                  <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
                    <span style={{ fontWeight: 300, fontSize: 44, letterSpacing: '-0.03em', lineHeight: 1 }}>Showdown</span>
                    <span className="go" aria-hidden="true">→</span>
                  </div>
                  <div style={{ marginTop: 12, fontSize: 14, color: 'var(--muted)' }}>Two clicks on seat C7. Four ways to protect it.</div>
                </Link>
                <Link className="hm-door" to="/lab">
                  <div className="hm-eyebrow">02 · Five exhibits</div>
                  <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
                    <span style={{ fontWeight: 300, fontSize: 44, letterSpacing: '-0.03em', lineHeight: 1 }}>Lab</span>
                    <span className="go" aria-hidden="true">→</span>
                  </div>
                  <div style={{ marginTop: 12, fontSize: 14, color: 'var(--muted)' }}>Deadlock, rush hour, time machine, serializability, indexes.</div>
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>

      <div id="films" className="wrap" style={{ paddingTop: 120 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', paddingBottom: 20, borderBottom: '1px solid var(--line)' }}>
          <h2 style={{ margin: 0, fontWeight: 300, fontSize: 40, letterSpacing: '-0.03em', lineHeight: 1 }}>Now showing</h2>
          {xray
            ? <span key="x" className="hm-sqlhead">SELECT title, genre FROM movie; -- {rowCount} rows</span>
            : <Label>Showdown Cinemas · Karachi · sample showtimes</Label>}
        </div>
        <div className="hm-grid">
          {(films ?? []).map(({ movie, times }, i) => (
            <div key={movie.id} className="hm-card rv" style={idx(i % 4)}>
              <Link to={`/films/${movie.id}`} className="hm-art" aria-label={movie.title}><Poster movie={movie} alt={`${movie.title} poster`} /></Link>
              <Link className="hm-title" to={`/films/${movie.id}`}>{movie.title}</Link>
              <div className="hm-meta">{movie.genre} · {movie.year}</div>
              <div className="hm-times">
                {cardTimes(times, day?.key, 3).map(({ t, prefix }) => <Link key={t.id} className="hm-chip" to={`/hall/${t.id}`}>{prefix}{t.label}</Link>)}
              </div>
            </div>
          ))}
          {films === null && Array.from({ length: 8 }, (_, i) => <div key={i} className="hm-card"><div style={{ aspectRatio: '2/3', background: 'var(--clay)', borderRadius: 3, opacity: .5 }} /></div>)}
        </div>
      </div>

      {xray && (
        <div className="wrap hm-enter" style={{ paddingTop: 140 }}>
          <div className="st" style={{ ...idx(0), display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 32 }}>
            {MODES.map(m => (
              <div key={m.key} className="mode">
                <ModeMini mode={m.key} />
                <div style={{ marginTop: 20, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
                  <div style={{ fontSize: 22, fontWeight: 300, letterSpacing: '-0.02em' }}>{m.name}</div>
                  <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>{m.line}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <Footer />
    </div>
  );
}
