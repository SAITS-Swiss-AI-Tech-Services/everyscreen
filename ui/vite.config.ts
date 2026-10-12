// Dev server for working on the web app itself: `npm run dev`. Serves the
// project in EVERYSCREEN_PROJECT (default: the Trailmix example) with the same
// /media/ and /api middleware as `everyscreen serve` (src/server/http.ts).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { findProject } from '../src/core/project.ts';
import { apiMiddleware, injectConfig, mediaMiddleware } from '../src/server/http.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));

function everyscreen(): Plugin {
  const project = findProject(process.env.EVERYSCREEN_PROJECT ?? path.join(HERE, '../examples/trailmix'));
  return {
    name: 'everyscreen',
    configureServer(server) {
      server.middlewares.use('/media', mediaMiddleware(project));
      server.middlewares.use('/api', apiMiddleware(project));
    },
    transformIndexHtml: (html) => injectConfig(html, project),
  };
}

export default defineConfig(({ command }) => ({
  root: HERE,
  // absolute: the app has nested routes (/b/<board>)
  base: '/',
  plugins: [react(), ...(command === 'serve' ? [everyscreen()] : [])],
  build: { outDir: '../dist/ui', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
}));
