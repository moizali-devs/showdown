import { useEffect, useMemo, useRef, useState } from 'react';
import Hall3D, { type SeatVisual } from '../../components/Hall3D';
import { labApi, type HistoryAt, type HistoryRange } from './labApi';
import { C, Exhibit, ErrorLine, mono } from './parts';

const STEP_MIN = 5;
const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' });
const VIS: Record<string, SeatVisual> = { FREE: 'free', HELD: 'held', BOOKED: 'booked' };

export default function TimeMachine({ showtimeId }: { showtimeId: number | null }) {
  const [range, setRange] = useState<HistoryRange | null>(null);
  const [step, setStep] = useState(0);
  const [snap, setSnap] = useState<HistoryAt | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reqId = useRef(0);
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640;
  const sceneS = narrow ? 0.42 : 0.7, sceneH = narrow ? 260 : 380;

  useEffect(() => {
    if (showtimeId == null) return;
    let live = true;
    labApi.history(showtimeId).then((r) => { if (live) { setRange(r); setStep(Math.floor((Date.parse(r.to) - Date.parse(r.from)) / 60000 / STEP_MIN)); } })
      .catch((e: Error) => live && setErr(e.message));
    return () => { live = false; };
  }, [showtimeId]);

  const fromMs = range ? Date.parse(range.from) : 0;
  const toMs = range ? Date.parse(range.to) : 0;
  const maxStep = Math.max(1, Math.floor((toMs - fromMs) / 60000 / STEP_MIN));
  const atMs = Math.min(toMs, fromMs + step * STEP_MIN * 60000);

  useEffect(() => {
    if (showtimeId == null || !range) return;
    const id = ++reqId.current;
    const h = window.setTimeout(() => {
      labApi.historyAt(showtimeId, new Date(atMs).toISOString())
        .then((s) => { if (id === reqId.current) { setSnap(s); setErr(null); } })
        .catch((e: Error) => id === reqId.current && setErr(e.message));
    }, 150);
    return () => clearTimeout(h);
  }, [showtimeId, range, atMs]);

  const seats = useMemo(() => {
    const m: Record<string, SeatVisual> = {};
    if (snap) for (const [k, v] of Object.entries(snap.seats)) m[k] = VIS[v] ?? 'free';
    return m;
  }, [snap]);

  return (
    <Exhibit n="03" title="Time machine" blurb="Slide through the evening; every seat remembers its history." tag="Lab 4, 5">
      <div style={{ width: "100%", maxWidth: 560, overflow: "hidden" }}>
        <Hall3D seats={seats} height={sceneH} scale={sceneS} ariaLabel="Hall model at the chosen time. Drag to orbit." />
      </div>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <input className="lab-range" type="range" min={0} max={maxStep} step={1} value={Math.min(step, maxStep)} disabled={!range}
          onChange={(e) => setStep(parseInt(e.target.value, 10))}
          aria-label={range ? `Time, ${fmtTime(fromMs)} to ${fmtTime(toMs)}` : 'Time'} style={{ width: '100%', height: 44, margin: 0 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="lab-label">{range ? fmtTime(fromMs) : ''}</span>
          <span style={{ fontSize: 15, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{range ? fmtTime(atMs) : 'Loading'}</span>
          <span className="lab-label">{range ? fmtTime(toMs) : ''}</span>
        </div>
      </div>
      {snap && (
        <div style={{ fontFamily: mono, fontSize: 11, color: C.muted, maxWidth: 440, overflowX: 'auto', whiteSpace: 'pre' }}>{snap.sql}</div>
      )}
      <ErrorLine msg={err} />
    </Exhibit>
  );
}
