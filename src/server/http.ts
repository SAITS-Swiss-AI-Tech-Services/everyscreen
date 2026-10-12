// The web app's server: the built UI, board media (/media/) and the
// comments API (/api), for one project. Used by `everyscreen serve`, and its
// middleware by the Vite dev server (ui/vite.config.ts).

import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import sirv from 'sirv';
import type { Project } from '../core/project.ts';
import { createApi } from './api.ts';

type Next = (err?: unknown) => void;
type Handler = (req: IncomingMessage, res: ServerResponse, next: Next) => void;

const notFound = (res: ServerResponse, status = 404) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(status === 400 ? 'bad request' : 'not found');
};

/**
 * /media/boards/... and /media/thumbs/..., read from the project folder on
 * every request, so a canvas built or rebuilt while the server runs shows up
 * without a restart. Nothing else in the folder (config, database) is served.
 */
export function mediaMiddleware(p: Project): Handler {
  const serve = sirv(p.dir, { dev: true, etag: true, dotfiles: false });
  const roots = [path.basename(p.boardsDir), path.basename(p.thumbsDir)];
  return (req, res) => {
    let pathname: string;
    try {
      pathname = path.posix.normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
    } catch {
      return notFound(res, 400);
    }
    if (pathname.includes('..') || pathname.includes('\\') || pathname.includes('\0') || !roots.includes(pathname.split('/')[1])) return notFound(res);
    serve(req, res, () => notFound(res));
  };
}

export function apiMiddleware(p: Project): Handler {
  return createApi({ dbFile: p.dbFile, boardsDir: p.boardsDir });
}

/** Settings for the UI, put into index.html. */
export function injectConfig(html: string, p: Project) {
  const json = JSON.stringify({ name: p.config.name }).replace(/</g, '\\u003c');
  return html.replace('</head>', `<script>window.__EVERYSCREEN__=${json}</script></head>`);
}

export interface Server {
  url: string;
  port: number;
  close: () => Promise<void>;
}

/** Tries `port`, then the next ones if taken (unless strictPort). port 0: any free port. */
export async function startServer(p: Project, { uiDir, host = '127.0.0.1', port = 4173, strictPort = false }: { uiDir: string; host?: string; port?: number; strictPort?: boolean }): Promise<Server> {
  const indexFile = path.join(uiDir, 'index.html');
  if (!fs.existsSync(indexFile)) throw new Error(`the web app is not built (${indexFile} missing)`);
  const index = injectConfig(fs.readFileSync(indexFile, 'utf8'), p);
  const assets = sirv(uiDir, { etag: true, immutable: true, dotfiles: false });
  const media = mediaMiddleware(p);
  const api = apiMiddleware(p);
  const sendIndex = (res: ServerResponse) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(index);
  };
  const strip = (req: IncomingMessage, prefix: string) => {
    req.url = req.url!.slice(prefix.length) || '/';
  };
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const done: Next = () => notFound(res);
    if (url === '/api' || url.startsWith('/api/') || url.startsWith('/api?')) {
      strip(req, '/api');
      return api(req, res, done);
    }
    if (url.startsWith('/media/')) {
      strip(req, '/media');
      return media(req, res, done);
    }
    if (url === '/' || url.startsWith('/index.html')) return sendIndex(res);
    // built assets, else the app's own routes (/b/<id>, /issues)
    assets(req, res, () => (req.method === 'GET' || req.method === 'HEAD' ? sendIndex(res) : notFound(res)));
  });

  const listen = (n: number) =>
    new Promise<number>((resolve, reject) => {
      const onError = (e: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        reject(e);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve((server.address() as { port: number }).port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(n, host);
    });
  let bound: number | null = null;
  for (let n = port, tries = 0; bound === null; n++, tries++) {
    try {
      bound = await listen(n);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || strictPort || port === 0 || tries >= 20) throw e;
    }
  }
  const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host.includes(':') ? `[${host}]` : host;
  return {
    url: `http://${shown}:${bound}`,
    port: bound,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
