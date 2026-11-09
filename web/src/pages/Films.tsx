import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import Label from '../components/Label';
import FilmArt from '../components/FilmArt';
import { api } from '../lib/api';
import type { Movie } from '../lib/api';

export default function Films() {
  const [movies, setMovies] = useState<Movie[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.movies().then(setMovies).catch(e => setErr(String(e.message ?? e)));
  }, []);
  return (
    <div className="page">
      <Nav />
      <div className="wrap fade-in" style={{ paddingTop: 72 }}>
        <h1 style={{ margin: 0, fontWeight: 300, fontSize: 'clamp(48px,7vw,96px)', lineHeight: 0.95, letterSpacing: '-0.04em' }}>Now showing.</h1>
        <p style={{ margin: '24px 0 0', fontSize: 18, color: 'var(--muted)', letterSpacing: '-0.01em' }}>Pick a film. Pick a seat.</p>
      </div>
      <div className="wrap" style={{ paddingTop: 72 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 20, gap: 16, flexWrap: 'wrap' }}>
          <Label>Showdown Cinemas · Karachi</Label>
          <Label>{movies ? `${movies.length} films` : ''}</Label>
        </div>
        <div className="rule-top" style={{ paddingTop: 40 }}>
          {err && <div role="alert" style={{ color: 'var(--muted)' }}>Could not load films. {err}</div>}
          <div className="film-grid">
            {(movies ?? []).map(m => (
              <Link key={m.id} to={`/films/${m.id}`} className="film-card" aria-label={m.title}>
                <div className="art"><FilmArt movie={m} sizes="(max-width: 520px) 90vw, 260px" /></div>
                <div style={{ marginTop: 16, fontSize: 22, fontWeight: 300, letterSpacing: '-0.02em', lineHeight: 1.15 }}>{m.title}</div>
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>{m.genre} · {m.year}</div>
              </Link>
            ))}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
