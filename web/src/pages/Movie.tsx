import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import Label from '../components/Label';
import FilmArt from '../components/FilmArt';
import { api, rs } from '../lib/api';
import type { Movie as MovieT, Showtime } from '../lib/api';
import { dayKey, dayLabel } from '../lib/hooks';

export default function Movie() {
  const { movieId } = useParams();
  const [data, setData] = useState<{ movie: MovieT; showtimes: Showtime[] } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setData(null); setErr('');
    api.movie(Number(movieId)).then(setData).catch(e => setErr(String(e.message ?? e)));
  }, [movieId]);

  const days = useMemo(() => {
    const m = new Map<string, Showtime[]>();
    (data?.showtimes ?? []).forEach(s => { const k = dayKey(s.startsAt); (m.get(k) ?? m.set(k, []).get(k)!).push(s); });
    return [...m.entries()].map(([k, list]) => ({ k, label: dayLabel(list[0].startsAt), list }));
  }, [data]);

  return (
    <div className="page">
      <Nav />
      <div className="wrap fade-in" style={{ paddingTop: 24 }}>
        <Link to="/films" className="back">← Films</Link>
        {err && <div role="alert" style={{ marginTop: 40, color: 'var(--muted)' }}>Could not load this film. {err}</div>}
        {data && (
          <div className="movie-grid" style={{ marginTop: 40 }}>
            <FilmArt movie={data.movie} />
            <div>
              <Label>{data.movie.genre} · {data.movie.year}</Label>
              <h1 style={{ margin: '16px 0 0', fontWeight: 300, fontSize: 'clamp(40px,6vw,88px)', lineHeight: 0.95, letterSpacing: '-0.04em' }}>{data.movie.title}</h1>
              <div style={{ marginTop: 56 }}>
                <Label as="div" style={{ paddingBottom: 12 }}>Showtimes</Label>
                <div className="rule-top">
                  {days.length === 0 && <div style={{ padding: '18px 0', color: 'var(--muted)' }}>No upcoming shows.</div>}
                  {days.map(d => (
                    <div key={d.k} className="day-row">
                      <span className="d">{d.label}</span>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {d.list.map(s => (
                          <Link key={s.id} to={`/hall/${s.id}`} className="chip" style={{ height: 36, gap: 10 }} aria-label={`${s.label}, ${s.hall}, ${s.free} seats free`}>
                            <span>{s.label}</span>
                            <span style={{ color: 'inherit', opacity: 0.55 }}>{s.hall.replace('Hall ', 'H')} · {s.free}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {data.showtimes[0] && (
                  <div style={{ marginTop: 20, fontSize: 12, color: 'var(--muted)' }}>
                    {rs(data.showtimes[0].priceStandard)} standard · {rs(data.showtimes[0].priceRecliner)} recliner
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
