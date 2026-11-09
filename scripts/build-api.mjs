// Bundles the Express + ws server into api/_app.mjs so the Vercel function needs no TS/extensionless resolution.
import { build } from 'esbuild';
await build({
  entryPoints: ['server/src/app.ts'],
  outfile: 'api/_app.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['pg-native', 'bufferutil', 'utf-8-validate', 'embedded-postgres', 'vite'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
