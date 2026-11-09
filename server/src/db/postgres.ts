// Starts / stops the embedded PostgreSQL server (npm package `embedded-postgres`, no Docker).
// If DATABASE_URL is set, that server is used instead and nothing is started.
import EmbeddedPostgres from 'embedded-postgres';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

export interface StartOptions {
  /** Cluster directory (created with initdb the first time). */
  dataDir: string;
  port: number;
}
export interface RunningDatabase {
  connectionString: string;
  /** 'embedded' when we started Postgres, 'external' when DATABASE_URL was used. */
  kind: 'embedded' | 'external';
  stop(): Promise<void>;
}

const DB_NAME = 'showdown';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}
const USER = 'postgres';
const PASSWORD = 'postgres';

async function pgCtlPath(): Promise<string> {
  const os = process.platform === 'win32' ? 'windows' : process.platform;
  const mod = (await import(`@embedded-postgres/${os}-${process.arch}`)) as { pg_ctl?: string };
  if (!mod.pg_ctl) throw new Error('pg_ctl not found in embedded-postgres binaries');
  return mod.pg_ctl;
}

/** Runs pg_ctl; never throws, resolves with the exit code. */
function runPgCtl(args: string[]): Promise<number> {
  return pgCtlPath().then(
    (bin) =>
      new Promise<number>((res) => {
        const p = spawn(bin, args, { stdio: 'ignore', windowsHide: true });
        p.on('error', () => res(-1));
        p.on('exit', (code) => res(code ?? -1));
      }),
    () => -1,
  );
}

export async function startDatabase(opts: StartOptions): Promise<RunningDatabase> {
  const external = process.env.DATABASE_URL;
  if (external) {
    return { connectionString: external, kind: 'external', stop: async () => {} };
  }

  const dataDir = resolve(opts.dataDir);
  const verbose = !!process.env.DEBUG_PG;

  // A leftover postmaster.pid means the last run crashed. If an orphaned server is still alive, shut it
  // down properly; if nothing is running, remove the stale lock file so Postgres can start.
  // But if the node process that owns this cluster is still alive (e.g. `npm run dev` in another terminal),
  // refuse instead of pulling the database out from under it.
  const ownerFile = join(dataDir, 'showdown-owner.pid');
  if (existsSync(ownerFile)) {
    const owner = Number(readFileSync(ownerFile, 'utf8').trim());
    if (owner && owner !== process.pid && isAlive(owner)) {
      throw new Error(
        `The Showdown database in ${dataDir} is already in use by process ${owner} (another "npm run dev"?). ` +
          `Stop that first, or set DATABASE_URL / PG_DATA_DIR + PG_PORT to use a different server.`,
      );
    }
  }
  const pidFile = join(dataDir, 'postmaster.pid');
  if (existsSync(pidFile)) {
    await runPgCtl(['stop', '-D', dataDir, '-m', 'fast', '-w', '-t', '30']);
    if (existsSync(pidFile)) rmSync(pidFile, { force: true });
  }

  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: opts.port,
    user: USER,
    password: PASSWORD,
    persistent: true,
    postgresFlags: ['-c', 'max_connections=200'],
    onLog: verbose ? console.log : () => {},
    onError: verbose ? console.error : () => {},
  });

  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    await server.initialise();
  }
  try {
    await server.start();
  } catch (err) {
    throw new Error(`embedded Postgres failed to start on port ${opts.port} (data dir ${dataDir}): ${String(err ?? 'process exited')}`);
  }

  writeFileSync(ownerFile, String(process.pid));

  // Create the application database if it does not exist yet.
  const admin = new pg.Client({ host: '127.0.0.1', port: opts.port, user: USER, password: PASSWORD, database: 'postgres' });
  await admin.connect();
  try {
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
    if (found.rowCount === 0) await admin.query(`CREATE DATABASE ${DB_NAME}`);
  } finally {
    await admin.end();
  }

  let stopped: Promise<void> | null = null;
  const stop = () =>
    (stopped ??= (async () => {
      // embedded-postgres' own stop() hard-kills the process tree on Windows (taskkill /f), which forces crash
      // recovery on the next start. Use pg_ctl "fast" shutdown instead (aborts sessions, checkpoints, exits).
      const child = (server as unknown as { process?: { exitCode: number | null; once(e: string, f: () => void): void } }).process;
      const exited = new Promise<void>((res) => {
        if (!child || child.exitCode !== null) res();
        else child.once('exit', () => res());
      });
      await runPgCtl(['stop', '-D', dataDir, '-m', 'fast', '-w', '-t', '30']);
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([exited, new Promise<void>((r) => (timer = setTimeout(r, 15000)))]);
      clearTimeout(timer);
      // Release the child's stdio pipes (otherwise they keep the Node event loop alive) and make the library
      // forget the finished process so its exit hook does not kill anything.
      const proc = (server as unknown as { process?: import('node:child_process').ChildProcess }).process;
      proc?.stdout?.destroy();
      proc?.stderr?.destroy();
      proc?.unref();
      (server as unknown as { process?: unknown }).process = undefined;
      rmSync(ownerFile, { force: true });
    })());

  return {
    connectionString: `postgres://${USER}:${PASSWORD}@127.0.0.1:${opts.port}/${DB_NAME}`,
    kind: 'embedded',
    stop,
  };
}
