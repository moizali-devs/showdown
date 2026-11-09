import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

// Global X-Ray switch: the single entry to the "behind the scenes" database layer.
// Off by default, persisted per viewer in localStorage (storage can throw in private mode).
const KEY = 'showdown.xray';

type XRayState = { on: boolean; setOn: (v: boolean) => void; toggle: () => void };

const Ctx = createContext<XRayState>({ on: false, setOn: () => {}, toggle: () => {} });

function read(): boolean {
  try { return window.localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function XRayProvider({ children }: { children: ReactNode }) {
  const [on, setOnState] = useState<boolean>(read);
  useEffect(() => {
    try { window.localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ }
    document.documentElement.dataset.xray = on ? 'on' : 'off';
  }, [on]);
  const setOn = useCallback((v: boolean) => setOnState(v), []);
  const toggle = useCallback(() => setOnState((v) => !v), []);
  const value = useMemo(() => ({ on, setOn, toggle }), [on, setOn, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useXRay(): XRayState {
  return useContext(Ctx);
}
