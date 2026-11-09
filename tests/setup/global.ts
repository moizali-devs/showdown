// vitest globalSetup: own embedded Postgres cluster (.pgdata-test, port 54331) so tests can run while `npm run dev` is up.
// Migrates with reset, publishes the connection string via vitest `provide` AND env TEST_DATABASE_URL, stops cleanly.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GlobalSetupContext } from 'vitest/node';
import { startDatabase, type RunningDatabase } from '../../server/src/db/postgres';
import { migrate } from '../../server/src/db/migrate';

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
let db: RunningDatabase | undefined;

export default async function setup({ provide }: GlobalSetupContext) {
  // Tests always use their own cluster, even if DATABASE_URL is set for dev, unless TEST_DATABASE_URL is given.
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) {
    await migrate(explicit, { reset: true });
    provide('testDatabaseUrl', explicit);
    return async () => {};
  }
  const savedUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    db = await startDatabase({ dataDir: resolve(root, '.pgdata-test'), port: 54331 });
  } finally {
    if (savedUrl !== undefined) process.env.DATABASE_URL = savedUrl;
  }
  await migrate(db.connectionString, { reset: true });
  process.env.TEST_DATABASE_URL = db.connectionString;
  provide('testDatabaseUrl', db.connectionString);

  return async () => {
    await db?.stop();
  };
}
