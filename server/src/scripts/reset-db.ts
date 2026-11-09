// npm run reset-db : start Postgres (if embedded), drop + recreate schema public, migrate + seed, stop.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDatabase } from '../db/postgres';
import { migrate } from '../db/migrate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const t0 = Date.now();
const db = await startDatabase({ dataDir: process.env.PG_DATA_DIR ?? resolve(root, '.pgdata'), port: Number(process.env.PG_PORT ?? 54329) });
let code = 0;
try {
  console.log(`database: ${db.kind}`);
  await migrate(db.connectionString, { reset: true });
  console.log(`reset + migrate + seed done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (err) {
  console.error(err);
  code = 1;
} finally {
  await db.stop();
}
process.exit(code);
