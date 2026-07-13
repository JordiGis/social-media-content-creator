import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiTarget = `http://localhost:${process.env.PORT || 4000}`;
// SSE-friendly proxy (no buffering) hacia el backend Express.
const proxyOpts = { target: apiTarget, changeOrigin: true };

export default defineConfig({
  root: path.join(here, 'web'),
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    // Permite importar el módulo compartido src/segments.js (fuera de web/).
    fs: { allow: [here] },
    proxy: {
      '/api': proxyOpts,
      '/outputs': proxyOpts,
      '/assets': proxyOpts,
    },
  },
  build: {
    outDir: path.join(here, 'public'),
    emptyOutDir: true,
  },
});
