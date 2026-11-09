// Dev entry: embedded Postgres -> migrate -> API + WebSocket -> Vite middleware, all on one port.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { migrate } from './db/migrate';
import { startDatabase } from './db/postgres';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT ?? 5173);

async function main() {
  const db = await startDatabase({ dataDir: process.env.PG_DATA_DIR ?? join(ROOT, '.pgdata'), port: Number(process.env.PG_PORT ?? 54329) });
  console.log(`[db] ${db.kind} PostgreSQL ready`);
  let shuttingDown = false;
  let closeApp: (() => Promise<void>) | null = null;
  let vite: { close: () => Promise<void> } | null = null;

  const shutdown = async (why: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[showdown] ${why}: shutting down...`);
    try { await vite?.close(); } catch { /* ignore */ }
    try { await closeApp?.(); } catch { /* ignore */ }
    try { await db.stop(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGBREAK', () => void shutdown('SIGBREAK'));
  process.on('uncaughtException', (e) => { console.error('[fatal]', e); void shutdown('uncaughtException'); });

  try {
    const m = await migrate(db.connectionString);
    console.log(m.seeded ? '[db] schema created and seeded' : '[db] schema up to date');

    const { app, server, close } = createApp({ connectionString: db.connectionString, db: db.kind });
    closeApp = close;

    const viteConfig = join(ROOT, 'web', 'vite.config.ts');
    if (existsSync(viteConfig)) {
      const { createServer } = await import('vite');
      const v = await createServer({
        root: join(ROOT, 'web'),
        configFile: viteConfig,
        appType: 'spa',
        server: { middlewareMode: true, hmr: { server } },
      });
      vite = v;
      app.use(v.middlewares);
    } else {
      console.warn('[web] web/vite.config.ts not found: serving the API only');
    }

    await new Promise<void>((res, rej) => { server.once('error', rej); server.listen(PORT, () => res()); });
    console.log(`[showdown] http://localhost:${PORT}  (API /api, WebSocket /ws)`);
  } catch (e) {
    console.error('[showdown] failed to start:', e);
    await shutdown('startup error');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
