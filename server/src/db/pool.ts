import pg from 'pg';

/** Shared connection pool for the HTTP API (customer sessions use their own dedicated pg.Client). */
export function createPool(connectionString: string, max = 20): pg.Pool {
  const pool = new pg.Pool({ connectionString, max, application_name: 'showdown-web' });
  // An idle client error (e.g. server shutdown) must not crash the process.
  pool.on('error', () => {});
  return pool;
}
