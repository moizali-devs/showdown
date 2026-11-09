import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useXRay } from '../lib/xray';

// Shared nav. X-Ray is the only entry to the database layer: Showdown and Lab links
// appear only while it is on (or while you are already standing on one of those pages).
export default function Nav() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { on, toggle, setOn } = useXRay();
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => { setMenu(false); }, [pathname]);

  const book = async () => {
    if (busy) return;
    setBusy(true);
    setMenu(false);
    try { const d = await api.demo(); nav(`/hall/${d.showtimeId}`); } catch { nav('/films'); } finally { setBusy(false); }
  };
  const showDb = on || pathname === '/showdown' || pathname === '/lab';
  const cls = ({ isActive }: { isActive: boolean }) => 'navlink' + (isActive ? ' on' : '');

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link to="/" className="nav-logo" aria-label="Showdown Cinemas, home">
          <span className="nav-name">Showdown</span>
          <span className="nav-sub">Cinemas · Karachi</span>
        </Link>
        <div className="nav-right">
          <nav className="nav-links" aria-label="Primary">
            <NavLink to="/films" className={cls}>Films</NavLink>
            {showDb ? <NavLink to="/showdown" className={cls}>Showdown</NavLink> : null}
            {showDb ? <NavLink to="/lab" className={cls}>Lab</NavLink> : null}
          </nav>
          <button type="button" role="switch" aria-checked={on} data-testid="xray-switch"
            aria-label="X-Ray: show the database behind the cinema" className={'xsw' + (on ? ' on' : '')} onClick={toggle}>
            <span>X-Ray</span>
            <span className="xsw-track"><span className="xsw-knob" /></span>
          </button>
          <button type="button" className="pill nav-book" onClick={book}>Book a seat</button>
          <button type="button" className="nav-menu" data-testid="nav-menu" aria-label="Menu" aria-expanded={menu}
            aria-controls="nav-panel" onClick={() => setMenu((m) => !m)}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20"><path d={menu ? 'M4 4 L16 16 M16 4 L4 16' : 'M3 6 H17 M3 14 H17'} stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
          </button>
        </div>
      </div>
      <div id="nav-panel" className={'nav-panel' + (menu ? ' open' : '')} aria-hidden={!menu}>
        <div className="nav-panel-in">
          <Link to="/films" tabIndex={menu ? 0 : -1}>Films</Link>
          {showDb ? <Link to="/showdown" tabIndex={menu ? 0 : -1}>Showdown</Link> : null}
          {showDb ? <Link to="/lab" tabIndex={menu ? 0 : -1}>Lab</Link> : null}
          <button type="button" className="pill nav-panel-book" tabIndex={menu ? 0 : -1} onClick={book}>Book a seat</button>
        </div>
      </div>
      {on && pathname === '/' ? (
        <div className="nav-strip">
          <div className="nav-strip-in">
            <span><i />X-Ray on · the database behind the cinema</span>
            <button type="button" className="nav-strip-back" data-testid="strip-back" onClick={() => setOn(false)}>Back to the cinema</button>
          </div>
        </div>
      ) : null}
    </header>
  );
}
