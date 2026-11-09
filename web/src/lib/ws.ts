import { useEffect, useRef } from 'react';
import type { WsServerMsg, WsClientMsg } from '@shared/types';

type Listener = (m: WsServerMsg) => void;

/** One shared socket for the whole app, auto-reconnect with backoff, re-subscribes after reconnect. */
class Hub {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private subs = new Map<Listener, number>(); // listener -> showtimeId
  private wanted = new Map<number, number>(); // showtimeId -> refcount
  private timer: number | null = null;
  private retry = 0;
  private ping: number | null = null;
  private idle: number | null = null;

  private url() { return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`; }

  private connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    let ws: WebSocket;
    try { ws = new WebSocket(this.url()); } catch { this.schedule(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.wanted.forEach((_n, id) => this.send({ type: 'subscribe', showtimeId: id }));
      if (this.ping) window.clearInterval(this.ping);
      this.ping = window.setInterval(() => this.send({ type: 'ping' }), 25000);
    };
    ws.onmessage = ev => {
      let m: WsServerMsg;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      this.listeners.forEach(l => l(m));
    };
    ws.onclose = () => {
      if (this.ping) { window.clearInterval(this.ping); this.ping = null; }
      this.ws = null;
      if (this.listeners.size) this.schedule();
    };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  }

  private schedule() {
    if (this.timer != null) return;
    const wait = Math.min(8000, 400 * 2 ** this.retry++);
    this.timer = window.setTimeout(() => { this.timer = null; this.connect(); }, wait);
  }

  private send(m: WsClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  add(l: Listener, showtimeId: number | null) {
    if (this.idle != null) { window.clearTimeout(this.idle); this.idle = null; }
    this.listeners.add(l);
    if (showtimeId != null) {
      this.subs.set(l, showtimeId);
      this.wanted.set(showtimeId, (this.wanted.get(showtimeId) ?? 0) + 1);
      this.send({ type: 'subscribe', showtimeId });
    }
    this.connect();
    return () => {
      this.listeners.delete(l);
      const id = this.subs.get(l);
      if (id != null) {
        this.subs.delete(l);
        const n = (this.wanted.get(id) ?? 1) - 1;
        if (n <= 0) this.wanted.delete(id); else this.wanted.set(id, n);
      }
      if (!this.listeners.size) {
        // Defer teardown so a StrictMode remount / quick route change reuses the socket instead of
        // closing it while still CONNECTING (which logs a browser warning).
        if (this.idle != null) window.clearTimeout(this.idle);
        this.idle = window.setTimeout(() => {
          this.idle = null;
          if (this.listeners.size) return;
          if (this.timer != null) { window.clearTimeout(this.timer); this.timer = null; }
          if (this.ping) { window.clearInterval(this.ping); this.ping = null; }
          const w = this.ws; this.ws = null;
          if (w) {
            w.onclose = null;
            if (w.readyState === WebSocket.CONNECTING) w.onopen = () => { try { w.close(); } catch { /* ignore */ } };
            else try { w.close(); } catch { /* ignore */ }
          }
        }, 1500);
      }
    };
  }
}
const hub = new Hub();

/** Subscribe to live messages for a showtime. `onMessage` may change identity freely. Pass null to stay idle. */
export function useShowtimeSocket(showtimeId: number | null, onMessage: (m: WsServerMsg) => void) {
  const ref = useRef(onMessage);
  ref.current = onMessage;
  useEffect(() => {
    if (showtimeId == null || Number.isNaN(showtimeId)) return;
    return hub.add(m => {
      if ('showtimeId' in m && m.showtimeId !== showtimeId) return;
      if (m.type === 'showdown' && m.state.showtimeId !== showtimeId) return;
      ref.current(m);
    }, showtimeId);
  }, [showtimeId]);
}
