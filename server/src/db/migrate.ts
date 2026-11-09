// Applies db/01_schema.sql, 02_functions.sql, 03_seed.sql in order. Safe to run repeatedly:
// schema + functions are create-if-missing / create-or-replace; the seed runs only while `movie` is empty.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import pg from 'pg';

export const DB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'db');
const LOCK_KEY = 727001; // advisory lock so two processes never migrate at once

export interface MigrateOptions {
  /** Drop and recreate schema public first (full reset). */
  reset?: boolean;
}

export function readSqlFile(...parts: string[]): string {
  return readFileSync(join(DB_DIR, ...parts), 'utf8');
}

export async function migrate(connectionString: string, opts: MigrateOptions = {}): Promise<{ seeded: boolean }> {
  const client = new pg.Client({ connectionString, application_name: 'showdown-migrate' });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    if (opts.reset) {
      await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    }
    await client.query(readSqlFile('01_schema.sql'));
    await client.query(readSqlFile('02_functions.sql'));
    const { rows } = await client.query('SELECT EXISTS (SELECT 1 FROM movie) AS has_data');
    let seeded = false;
    if (!rows[0].has_data) {
      await client.query(readSqlFile('03_seed.sql'));
      await client.query('VACUUM ANALYZE'); // statistics + visibility map (index-only scans)
      seeded = true;
    }
    return { seeded };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    await client.end();
  }
}
