import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Films from './pages/Films';
import Movie from './pages/Movie';
import Hall from './pages/Hall';

// Written by other agents; lazy so a missing file never breaks the rest of the app.
const Showdown = lazy(() => import('./pages/Showdown'));
const Lab = lazy(() => import('./pages/Lab'));

function NotFound() {
  return <div className="wrap" style={{ padding: '120px 24px' }}><h1 style={{ fontWeight: 300, fontSize: 56, letterSpacing: '-0.04em', margin: 0 }}>Not found.</h1></div>;
}

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export default function App() {
  const { pathname } = useLocation();
  return (
    <>
      <ScrollTop />
      <div key={pathname} className="page-enter">
      <Suspense fallback={<div className="page" />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/films" element={<Films />} />
          <Route path="/films/:movieId" element={<Movie />} />
          <Route path="/hall/:showtimeId" element={<Hall />} />
          <Route path="/showdown" element={<Showdown />} />
          <Route path="/lab" element={<Lab />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      </div>
    </>
  );
}
