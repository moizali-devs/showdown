// Vercel Node function (Fluid Compute): the Express API + the /ws WebSocket server on one http.Server.
// Uses a DIRECT (unpooled) Neon connection: transactions stay open across requests and row locks are per-session.
import { randomBytes } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { createApp } from './_app.mjs';

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!connectionString) throw new Error('No database URL: set DATABASE_URL_UNPOOLED');

const INSTANCE = randomBytes(3).toString('hex');
const KEEP_ALIVE_MS = Number(process.env.KEEP_ALIVE_MS) || 12000;

const { server } = createApp({ connectionString, db: 'external', sweepEveryMs: 15000 });

// Race/lab jobs keep running after their 202 response; keep this instance alive for them (best effort),
// and expose which instance served a request so instance splits can be diagnosed.
server.prependListener('request', (req, res) => {
  res.setHeader('x-instance', INSTANCE);
  if (req.method === 'POST') waitUntil(new Promise<void>((r) => setTimeout(r, KEEP_ALIVE_MS)));
});

export default server;
