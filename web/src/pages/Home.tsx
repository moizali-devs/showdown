import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as RPE } from 'react';
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
import { useWidth, dayKey } from '../lib/hooks';

const MODES: { key: ModeKey; name: string; line: string }[] = [
  { key: 'off', name: 'Off', line: 'No protection. Both win. One loses.' },
  { key: 'lock', name: 'Lock', line: 'First in line holds it. Second waits.' },
  { key: 'atomic', name: 'Atomic', line: 'One statement decides. Loser is rejected.' },
  { key: 'optimistic', name: 'Optimistic', line: 'Both try. A version check rejects one.' },
];

const HOME_SEATS: Record<string, SeatVisual> = { C7: 'conflict' };
const PINS: HallPin[] = [{ id: 'A', seat: 'C7', state: 'idle' }, { id: 'B', seat: 'C7', state: 'idle' }];
const FOCUS = ['C7'];

export default function Home() {
  const w = useWidth();
  const [xray, setXray] = useState(false);
  const [dragged, setDragged] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [films, setFilms] = useState<{ movie: Movie; times: Showtime[] }[] | null>(null);

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

  const scale = w > 1280 ? 1.25 : w > 900 ? 1.05 : w > 640 ? 0.8 : w > 460 ? 0.62 : 0.5;
  const height = w > 900 ? 720 : w > 640 ? 520 : w > 460 ? 440 : 380;

  // Hall3D owns the orbit; here we only notice that the user moved it, to offer "Reset".
  const down = useRef({ x: 0, y: 0, on: false });
  const pd = (e: RPE) => { down.current = { x: e.clientX, y: e.clientY, on: true }; };
  const pm = (e: RPE) => { const d = down.current; if (d.on && !dragged && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) setDragged(true); };
  const pu = () => { down.current.on = false; };

  return (
    <div className="page">
      <Nav />
      <div className="wrap" style={{ paddingTop: 96 }}>
        <h1 style={{ margin: 0, fontWeight: 300, fontSize: 'clamp(52px,8.4vw,120px)', lineHeight: 0.95, letterSpacing: '-0.04em' }}>Two people. One seat.</h1>
        <p style={{ margin: '28px 0 0', fontSize: 18, color: 'var(--muted)', letterSpacing: '-0.01em' }}>Watch the database decide who gets it.</p>
      </div>

      <div style={{ position: 'relative', marginTop: 24 }}>
        <div className="home-ctl">
          <button type="button" className="xray-btn" aria-pressed={xray} onClick={() => setXray(x => !x)}
            style={{ background: xray ? 'var(--ink)' : 'transparent', color: xray ? '#fff' : 'var(--ink)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: xray ? 'var(--conflict)' : 'var(--muted)' }} />X-Ray
          </button>
          <div style={{ marginTop: 20, opacity: xray ? 1 : 0, transform: `translateY(${xray ? 0 : 6}px)`, transition: 'opacity .5s ease,transform .5s ease', pointerEvents: 'none' }} aria-hidden={!xray}>
            <div className="mono" style={{ fontSize: 12, lineHeight: 1.7 }}>
              <div>UPDATE show_seat SET status = 'BOOKED'</div>
              <div>WHERE seat_id = 'C7' AND status = 'FREE';</div>
              <div style={{ color: 'var(--muted)' }}>-- A: 1 row &nbsp;·&nbsp; B: 0 rows</div>
            </div>
          </div>
        </div>

        <div onPointerDown={pd} onPointerMove={pm} onPointerUp={pu} onPointerCancel={pu} style={{ position: 'relative' }}>
          <Hall3D key={epoch} seats={HOME_SEATS} xray={xray} focus={FOCUS} pins={PINS} height={height} scale={scale}
            showOrbitHint={false} ariaLabel="Interactive 3D model of a cinema hall with seat C7 highlighted" />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 24, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, pointerEvents: 'none' }}>
            <Label>Drag to orbit</Label>
            {dragged && (
              <button type="button" onClick={() => { setEpoch(n => n + 1); setDragged(false); }}
                style={{ all: 'unset', cursor: 'pointer', pointerEvents: 'auto', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink)', borderBottom: '1px solid var(--ink)' }}>Reset</button>
            )}
          </div>
        </div>
      </div>

      <div id="films" className="wrap" style={{ paddingTop: 120 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', paddingBottom: 20 }}>
          <Label>Now showing</Label>
          <Label>Showdown Cinemas · Karachi · sample showtimes</Label>
        </div>
        <div style={{ borderTop: '1px solid var(--line)' }}>
          {(films ?? []).map(({ movie, times }) => {
            const first = times[0];
            const today = first ? times.filter(t => dayKey(t.startsAt) === dayKey(first.startsAt)).slice(0, 3) : [];
            return (
              <div key={movie.id} className="film-row home-film">
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, minWidth: 0, flex: '1 1 auto' }}>
                  <Link to={`/films/${movie.id}`} tabIndex={-1} aria-hidden="true" className="home-thumb"><FilmArt movie={movie} /></Link>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px 24px', minWidth: 0, flexWrap: 'wrap' }}>
                  <Link className="film-title" to={`/films/${movie.id}`} style={{ fontWeight: 300, fontSize: 'clamp(28px,3.2vw,40px)', letterSpacing: '-0.03em', lineHeight: 1.1 }}>{movie.title}</Link>
                  <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{movie.genre} · {movie.year}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
                  {today.map(t => <Link key={t.id} className="chip" to={`/hall/${t.id}`}>{t.label}</Link>)}
                </div>
              </div>
            );
          })}
          {films === null && <div style={{ minHeight: 94, borderBottom: '1px solid var(--line)' }} />}
        </div>
      </div>

      <div className="wrap" style={{ paddingTop: 140 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 32 }}>
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
      <Footer />
    </div>
  );
}
