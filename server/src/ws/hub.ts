import type http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { WsClientMsg, WsServerMsg } from '../../../shared/types';
import type { Bus } from '../engine/context';
import type { ShowdownManager } from '../engine/showdown';

/** WebSocket hub at /ws. Handles only /ws upgrades so Vite's HMR socket on the same server is untouched. */
export function attachHub(server: http.Server, bus: Bus, showdowns: ShowdownManager): { close: () => void } {
  const wss = new WebSocketServer({ noServer: true });
  const subs = new Map<WebSocket, number | null>();

  const onUpgrade = (req: http.IncomingMessage, socket: any, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/ws') return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  };
  server.on('upgrade', onUpgrade);

  const send = (ws: WebSocket, msg: WsServerMsg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };

  wss.on('connection', (ws) => {
    subs.set(ws, null);
    ws.on('message', (data) => {
      let msg: WsClientMsg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      if (msg.type === 'ping') send(ws, { type: 'pong' });
      else if (msg.type === 'subscribe' && Number.isInteger(msg.showtimeId)) {
        subs.set(ws, msg.showtimeId);
        const sd = showdowns.peek(msg.showtimeId);
        if (sd) send(ws, { type: 'showdown', state: sd.getState() });
      }
    });
    ws.on('close', () => subs.delete(ws));
    ws.on('error', () => subs.delete(ws));
  });

  const unsub = bus.subscribe((showtimeId, msg) => {
    const text = JSON.stringify(msg);
    for (const [ws, sid] of subs) if (sid === showtimeId && ws.readyState === WebSocket.OPEN) ws.send(text);
  });

  return {
    close: () => {
      unsub();
      server.off('upgrade', onUpgrade);
      for (const ws of subs.keys()) { try { ws.terminate(); } catch { /* ignore */ } }
      wss.close();
    },
  };
}
