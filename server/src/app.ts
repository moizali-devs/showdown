import express from 'express';
import http from 'node:http';
import { createCtx, type Ctx } from './engine/context';
import { ShowdownManager } from './engine/showdown';
import { startSweeper } from './hall/hall';
import { createRouter } from './http/routes';
import { attachHub } from './ws/hub';

export interface AppOptions {
  connectionString: string;
  /** reported by /api/health; default: 'external' when DATABASE_URL is set */
  db?: 'embedded' | 'external';
  sweepEveryMs?: number;
}
export interface App {
  server: http.Server;
  /** the Express app (main.ts mounts Vite after the /api routes) */
  app: express.Express;
  ctx: Ctx;
  showdowns: ShowdownManager;
  close: () => Promise<void>;
}

/** Builds API + WebSocket on one http.Server. Does not listen and does not start Vite. */
export function createApp(opts: AppOptions): App {
  const ctx = createCtx(opts.connectionString, opts.db ?? (process.env.DATABASE_URL ? 'external' : 'embedded'));
  const showdowns = new ShowdownManager(ctx);
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', createRouter(ctx, showdowns));
  const server = http.createServer(app);
  const hub = attachHub(server, ctx.bus, showdowns);
  const sweeper = startSweeper(ctx, opts.sweepEveryMs ?? 15000);

  let closed: Promise<void> | null = null;
  const close = () => (closed ??= (async () => {
    sweeper.stop();
    hub.close();
    await showdowns.closeAll();
    // any other dedicated client (rush/deadlock leftovers)
    await Promise.all([...ctx.clients].map((c) => c.end().catch(() => undefined)));
    ctx.clients.clear();
    await ctx.pool.end().catch(() => undefined);
    if (server.listening) {
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    }
  })());

  return { server, app, ctx, showdowns, close };
}
