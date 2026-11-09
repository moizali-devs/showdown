import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
  },
  server: { port: 5173, fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
  build: { outDir: fileURLToPath(new URL('../dist', import.meta.url)), emptyOutDir: true },
});
