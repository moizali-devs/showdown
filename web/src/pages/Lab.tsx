import { useEffect, useState } from 'react';
import { labApi } from './lab/labApi';
import { LAB_CSS, Label } from './lab/parts';
import Deadlock from './lab/Deadlock';
import Rush from './lab/Rush';
import TimeMachine from './lab/TimeMachine';
import Serializability from './lab/Serializability';
import Indexes from './lab/Indexes';
import { Link } from 'react-router-dom';
import Nav from '../components/Nav';
import { useXRay } from '../lib/xray';
import Footer from '../components/Footer';

// Nav and Footer are expected from the app shell (FE-CORE App.tsx); this page renders only the exhibits.
export default function Lab() {
  const { setOn: setXRay } = useXRay();
  const [showtimeId, setShowtimeId] = useState<number | null>(null);
  useEffect(() => { labApi.demo().then((d) => setShowtimeId(d.showtimeId)).catch(() => setShowtimeId(null)); }, []);
  return (
    <div style={{ background: 'var(--ground, #ECEAE5)', color: 'var(--ink, #141414)', fontFamily: 'Geist, system-ui, sans-serif', fontSize: 15, overflow: 'hidden' }}>
      <style>{LAB_CSS}</style>
      <Nav />
      <div style={{ padding: '24px clamp(20px,5.5vw,80px) 56px', maxWidth: 1280, margin: '0 auto', boxSizing: 'border-box' }}>
        <Link to="/" className="lab-back" data-testid="back-to-cinema" onClick={() => setXRay(false)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted, #6B6862)' }}><span aria-hidden="true">←</span>Back to the cinema</Link>
        <div style={{ marginTop: 16 }}><Label>The Lab</Label></div>
        <h1 style={{ margin: '14px 0 0', fontWeight: 300, fontSize: 'clamp(52px,9vw,96px)', lineHeight: 0.95, letterSpacing: '-.04em' }}>Five exhibits.</h1>
      </div>
      <Deadlock />
      <Rush />
      <TimeMachine showtimeId={showtimeId} />
      <Serializability />
      <Indexes />
      <Footer />
    </div>
  );
}
