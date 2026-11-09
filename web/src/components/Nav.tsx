import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

export default function Nav() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const book = async () => {
    if (busy) return;
    setBusy(true);
    try { const d = await api.demo(); nav(`/hall/${d.showtimeId}`); } catch { nav('/films'); } finally { setBusy(false); }
  };
  const cls = ({ isActive }: { isActive: boolean }) => 'navlink' + (isActive ? ' on' : '');
  return (
    <div className="wrap">
      <div className="nav-bar">
        <Link to="/" style={{ fontWeight: 500, fontSize: 18, letterSpacing: '-0.02em' }}>Showdown</Link>
        <div className="nav-links">
          <NavLink to="/films" className={cls}>Films</NavLink>
          <NavLink to="/showdown" className={cls}>Showdown</NavLink>
          <NavLink to="/lab" className={cls}>Lab</NavLink>
          <button type="button" className="pill" onClick={book} style={{ padding: '0 18px' }}>Book a seat</button>
        </div>
      </div>
    </div>
  );
}
