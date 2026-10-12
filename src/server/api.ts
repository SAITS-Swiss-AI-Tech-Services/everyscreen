// Boards, comments and issues API, backed by SQLite (data/board.sqlite)
// and the board files in boards/<id>/board.json (written by
// tools/build.mjs). Mounted at /api by vite.config.ts for `vite` and
// `vite preview`.
//
// A board (canvas) is one snapshot of the app: a release captured on a device.
// Threads belong to a board.
//
// A thread is a pin on a screen (optionally on a specific capture and, for
// clips, at a timestamp) with a list of messages. kind 'comment' or 'issue';
// issues also carry title, severity and assignee. Every field change is logged
// as an 'event' message, so a thread shows its own history.

import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import Database from 'better-sqlite3';
import { type AccessConfig, accessConfigFromEnv, createAccessVerifier } from './access.ts';

export const KINDS = ['comment', 'issue'] as const;
export const STATUSES = ['open', 'in_progress', 'resolved', 'wontfix'] as const;
export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS threads (
  id           INTEGER PRIMARY KEY,
  screen_id    TEXT NOT NULL,
  screen_slug  TEXT NOT NULL,
  screen_title TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('comment', 'issue')),
  status       TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'resolved', 'wontfix')),
  title        TEXT,
  severity     TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  assignee     TEXT,
  x            REAL,          -- pin position, 0..1 across the screen
  y            REAL,          -- 0..1 down the screen
  media_file   TEXT,          -- capture the pin was placed on (null: any)
  media_time   REAL,          -- seconds into a clip
  release      TEXT,          -- board release when the thread was opened
  commit_sha   TEXT,
  author       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS threads_screen ON threads (screen_id);
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY,
  thread_id  INTEGER NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('comment', 'event')),
  author     TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  edited_at  TEXT
);
CREATE INDEX IF NOT EXISTS messages_thread ON messages (thread_id);
`;

type Db = Database.Database;

// Schema changes after the first version, applied in order; PRAGMA user_version
// records how many have run.
const MIGRATIONS: ((db: Db) => void)[] = [
  // 1: threads belong to a board. Existing threads go to the board named after
  // the release they were opened on.
  (db) => {
    db.exec(`ALTER TABLE threads ADD COLUMN board_id TEXT NOT NULL DEFAULT ''`);
    db.exec(`UPDATE threads SET board_id = COALESCE(release, 'unknown') WHERE board_id = ''`);
    db.exec(`CREATE INDEX IF NOT EXISTS threads_board ON threads (board_id, screen_id)`);
    db.exec(`CREATE TABLE IF NOT EXISTS board_meta (
      board_id   TEXT PRIMARY KEY,
      title      TEXT,
      notes      TEXT,
      archived   INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`);
  },
  // 2: thread numbers are quoted by people ("#12"), so never hand one out
  // twice. SQLite reuses the highest rowid after a delete; a counter doesn't.
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS id_seq (name TEXT PRIMARY KEY, value INTEGER NOT NULL)`);
    db.exec(`INSERT OR IGNORE INTO id_seq (name, value) SELECT 'threads', COALESCE(max(id), 0) FROM threads`);
  },
];

function openDb(file: string): Db {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  // wait for another process's write lock instead of failing with SQLITE_BUSY
  db.pragma('busy_timeout = 5000');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Schema and migrations under one write lock, with user_version read inside
  // it: two processes opening a fresh file at once must not both migrate.
  db.transaction(() => {
    db.exec(SCHEMA);
    const done = db.pragma('user_version', { simple: true }) as number;
    for (let v = done; v < MIGRATIONS.length; v++) {
      MIGRATIONS[v](db);
      db.pragma(`user_version = ${v + 1}`);
    }
  }).immediate();
  return db;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// ------------------------------------------------------------------ validation

type Body = Record<string, unknown>;
const now = () => new Date().toISOString();

function str(b: Body, key: string, { max = 200, required = false } = {}): string | null {
  const v = b[key];
  if (v == null || v === '') {
    if (required) throw new HttpError(400, `${key} is required`);
    return null;
  }
  if (typeof v !== 'string') throw new HttpError(400, `${key} must be a string`);
  const t = v.trim();
  if (required && !t) throw new HttpError(400, `${key} is required`);
  if (t.length > max) throw new HttpError(400, `${key} is too long (max ${max})`);
  return t || null;
}
function num(b: Body, key: string, min: number, max: number): number | null {
  const v = b[key];
  if (v == null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new HttpError(400, `${key} must be a number between ${min} and ${max}`);
  return v;
}
function oneOf<T extends readonly string[]>(b: Body, key: string, values: T): T[number] | null {
  const v = b[key];
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !values.includes(v)) throw new HttpError(400, `${key} must be one of ${values.join(', ')}`);
  return v as T[number];
}

/**
 * Who is acting: the verified Cloudflare Access email when deployed behind it
 * (see access.ts), else the name the viewer typed.
 */
function authorOf(who: string | null, b: Body): string {
  if (who) return who;
  return str(b, 'author', { max: 60, required: true })!;
}

/** Board ids and other path segments; a bad %-escape is the client's fault. */
function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    throw new HttpError(400, 'bad URL encoding');
  }
}

/**
 * Writes only from this site: a JSON body (a cross-site form or no-cors fetch
 * can't send application/json without a preflight) and, when the browser says
 * where the request comes from, the same host.
 */
function checkWrite(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (origin) {
    let host: string | null = null;
    try {
      host = new URL(origin).host.toLowerCase();
    } catch {
      // 'null' or garbage: not this site
    }
    if (!host || host !== (req.headers.host ?? '').toLowerCase()) throw new HttpError(403, 'cross-origin request refused');
  }
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'Content-Type must be application/json');
}

async function readJson(req: IncomingMessage): Promise<Body> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 100_000) throw new HttpError(413, 'body too large');
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v as Body;
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

// ------------------------------------------------------------------ rows

interface ThreadRow {
  id: number;
  board_id: string;
  screen_id: string;
  screen_slug: string;
  screen_title: string;
  kind: string;
  status: string;
  title: string | null;
  severity: string | null;
  assignee: string | null;
  x: number | null;
  y: number | null;
  media_file: string | null;
  media_time: number | null;
  release: string | null;
  commit_sha: string | null;
  author: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
  first_body?: string | null;
}
interface MessageRow {
  id: number;
  thread_id: number;
  type: string;
  author: string;
  body: string;
  created_at: string;
  edited_at: string | null;
}

const threadJson = (r: ThreadRow) => ({
  id: r.id,
  boardId: r.board_id,
  screenId: r.screen_id,
  screenSlug: r.screen_slug,
  screenTitle: r.screen_title,
  kind: r.kind,
  status: r.status,
  title: r.title,
  severity: r.severity,
  assignee: r.assignee,
  x: r.x,
  y: r.y,
  mediaFile: r.media_file,
  mediaTime: r.media_time,
  release: r.release,
  commit: r.commit_sha,
  author: r.author,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  messageCount: r.message_count ?? 0,
  excerpt: r.first_body ? r.first_body.slice(0, 200) : null,
});
const messageJson = (m: MessageRow) => ({
  id: m.id,
  threadId: m.thread_id,
  type: m.type,
  author: m.author,
  body: m.body,
  createdAt: m.created_at,
  editedAt: m.edited_at,
});

const THREAD_SELECT = `
  SELECT t.*,
    (SELECT count(*) FROM messages m WHERE m.thread_id = t.id AND m.type = 'comment') AS message_count,
    (SELECT body FROM messages m WHERE m.thread_id = t.id AND m.type = 'comment' ORDER BY m.id LIMIT 1) AS first_body
  FROM threads t`;

// ------------------------------------------------------------------ boards

const BOARD_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

interface BoardFileMeta {
  id: string;
  title: string;
  demo: boolean;
  createdAt: string;
  generatedAt: string;
  capturedAt: string | null;
  device: { model: string | null; os: string | null; resolution: string | null } | null;
  stats: Record<string, number>;
  source: { repo?: string; commit?: string | null; release?: string | null; branch?: string | null; dirty?: boolean };
  preview: string[];
}

// board.json files are ~100 KB; keep the parsed summary until the file changes.
const boardCache = new Map<string, { mtimeMs: number; meta: BoardFileMeta }>();
function readBoard(boardsDir: string, id: string): BoardFileMeta | null {
  const file = path.join(boardsDir, id, 'board.json');
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const hit = boardCache.get(id);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.meta;
  let b: any;
  const preview: string[] = [];
  try {
    b = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof b !== 'object' || b === null || Array.isArray(b)) throw new Error('not an object');
    // up to 6 captures to preview on the dashboard card
    for (const s of b.screens ?? []) {
      const m = (s?.media ?? []).find((x: { type: string }) => x?.type !== 'html');
      const u = m?.thumb ?? m?.posterThumb ?? (m?.type === 'image' ? m.src : null);
      if (u) preview.push(u);
      if (preview.length >= 6) break;
    }
  } catch (e) {
    // likely mid-write by tools/build.mjs: keep the last good summary (not
    // cached under the new mtime, so the next request tries again)
    console.warn(`[api] ${file}: ${e instanceof Error ? e.message : e}${hit ? ' (using the last good copy)' : ' (skipped)'}`);
    return hit?.meta ?? null;
  }
  const meta: BoardFileMeta = {
    id: b.id ?? id,
    title: b.title ?? id,
    demo: !!b.demo,
    createdAt: b.createdAt ?? b.generatedAt ?? st.mtime.toISOString(),
    generatedAt: b.generatedAt ?? st.mtime.toISOString(),
    capturedAt: b.capturedAt ?? null,
    device: b.device ?? null,
    stats: b.stats ?? {},
    source: { repo: b.source?.repo, commit: b.source?.commit ?? null, release: b.source?.release ?? null, branch: b.source?.branch ?? null, dirty: !!b.source?.dirty },
    preview,
  };
  boardCache.set(id, { mtimeMs: st.mtimeMs, meta });
  return meta;
}
function boardIds(boardsDir: string) {
  if (!fs.existsSync(boardsDir)) return [];
  return fs
    .readdirSync(boardsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && BOARD_ID.test(d.name) && fs.existsSync(path.join(boardsDir, d.name, 'board.json')))
    .map((d) => d.name);
}

// ------------------------------------------------------------------ handlers

const LABELS: Record<string, string> = { in_progress: 'in progress', wontfix: "won't fix" };
const label = (v: unknown) => (v == null || v === '' ? 'none' : (LABELS[String(v)] ?? String(v)));

function handlers(db: Db, boardsDir: string) {
  const requireBoard = (id: string | null) => {
    if (!id || !BOARD_ID.test(id) || !fs.existsSync(path.join(boardsDir, id, 'board.json'))) throw new HttpError(400, `unknown board "${id ?? ''}"`);
    return id;
  };
  const getThread = (id: number) => {
    const t = db.prepare(`${THREAD_SELECT} WHERE t.id = ?`).get(id) as ThreadRow | undefined;
    if (!t) throw new HttpError(404, 'thread not found');
    return t;
  };
  const addMessage = db.prepare('INSERT INTO messages (thread_id, type, author, body, created_at) VALUES (?, ?, ?, ?, ?)');
  const nextThreadId = db.prepare(`UPDATE id_seq SET value = value + 1 WHERE name = 'threads' RETURNING value`);
  const touch = db.prepare('UPDATE threads SET updated_at = ? WHERE id = ?');

  return {
    listBoards() {
      const counts = db
        .prepare(
          `SELECT board_id, kind, status, severity, count(*) AS n, max(updated_at) AS last
           FROM threads GROUP BY board_id, kind, status, severity`,
        )
        .all() as { board_id: string; kind: string; status: string; severity: string | null; n: number; last: string }[];
      const metaRows = db.prepare('SELECT * FROM board_meta').all() as { board_id: string; title: string | null; notes: string | null; archived: number }[];
      const overrides = new Map(metaRows.map((m) => [m.board_id, m]));
      const boards = boardIds(boardsDir).flatMap((id) => {
        const b = readBoard(boardsDir, id);
        if (!b) return [];
        const mine = counts.filter((c) => c.board_id === id);
        const open = mine.filter((c) => c.status === 'open' || c.status === 'in_progress');
        const sum = (list: typeof mine) => list.reduce((a, c) => a + c.n, 0);
        const bySeverity: Record<string, number> = {};
        for (const c of open.filter((c) => c.kind === 'issue')) bySeverity[c.severity ?? 'none'] = (bySeverity[c.severity ?? 'none'] ?? 0) + c.n;
        const o = overrides.get(id);
        return [
          {
            ...b,
            title: o?.title || b.title,
            notes: o?.notes ?? null,
            archived: !!o?.archived,
            threads: {
              total: sum(mine),
              openIssues: sum(open.filter((c) => c.kind === 'issue')),
              openComments: sum(open.filter((c) => c.kind === 'comment')),
              resolved: sum(mine.filter((c) => c.status === 'resolved' || c.status === 'wontfix')),
              bySeverity,
              lastActivity: mine.reduce<string | null>((a, c) => (!a || c.last > a ? c.last : a), null),
            },
          },
        ];
      });
      boards.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
      return { boards };
    },

    updateBoard(id: string, b: Body) {
      requireBoard(id);
      const cur = (db.prepare('SELECT * FROM board_meta WHERE board_id = ?').get(id) as { title: string | null; notes: string | null; archived: number } | undefined) ?? { title: null, notes: null, archived: 0 };
      const title = 'title' in b ? str(b, 'title', { max: 120 }) : cur.title;
      const notes = 'notes' in b ? str(b, 'notes', { max: 2000 }) : cur.notes;
      const archived = 'archived' in b ? (b.archived === true ? 1 : b.archived === false ? 0 : (() => { throw new HttpError(400, 'archived must be true or false'); })()) : cur.archived;
      db.prepare(
        `INSERT INTO board_meta (board_id, title, notes, archived, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (board_id) DO UPDATE SET title = excluded.title, notes = excluded.notes, archived = excluded.archived, updated_at = excluded.updated_at`,
      ).run(id, title, notes, archived, now());
      return this.listBoards().boards.find((x) => x.id === id);
    },

    listThreads(q: URLSearchParams) {
      const board = q.get('board');
      const screen = q.get('screen');
      const where: string[] = [];
      const params: string[] = [];
      if (board) (where.push('t.board_id = ?'), params.push(board));
      if (screen) (where.push('t.screen_id = ?'), params.push(screen));
      const rows = db.prepare(`${THREAD_SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY t.id`).all(...params) as ThreadRow[];
      return { threads: rows.map(threadJson) };
    },

    getThread(id: number) {
      const t = getThread(id);
      const msgs = db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY id').all(id) as MessageRow[];
      return { thread: threadJson(t), messages: msgs.map(messageJson) };
    },

    createThread(who: string | null, b: Body) {
      const author = authorOf(who, b);
      const boardId = requireBoard(str(b, 'boardId', { max: 81, required: true }));
      const body = str(b, 'body', { max: 5000, required: true })!;
      const kind = oneOf(b, 'kind', KINDS) ?? 'comment';
      const screen = (b.screen ?? {}) as Body;
      const ts = now();
      const create = db.transaction(() => {
        const r = db
          .prepare(
            `INSERT INTO threads (id, board_id, screen_id, screen_slug, screen_title, kind, status, title, severity, assignee, x, y, media_file, media_time, release, commit_sha, author, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            (nextThreadId.get() as { value: number }).value,
            boardId,
            str(screen, 'id', { required: true }),
            str(screen, 'slug', { required: true }),
            str(screen, 'title', { required: true }),
            kind,
            str(b, 'title', { max: 200 }),
            kind === 'issue' ? oneOf(b, 'severity', SEVERITIES) : null,
            str(b, 'assignee', { max: 60 }),
            num(b, 'x', 0, 1),
            num(b, 'y', 0, 1),
            str(b, 'mediaFile', { max: 400 }),
            num(b, 'mediaTime', 0, 86_400),
            str(b, 'release', { max: 100 }),
            str(b, 'commit', { max: 64 }),
            author,
            ts,
            ts,
          );
        const id = Number(r.lastInsertRowid);
        addMessage.run(id, 'comment', author, body, ts);
        return id;
      });
      return this.getThread(create());
    },

    updateThread(who: string | null, id: number, b: Body) {
      const author = authorOf(who, b);
      // read, compare and write under one write lock, so two concurrent
      // PATCHes can't both log a change from the same old value
      db.transaction(() => {
        const t = getThread(id);
        const changes: [column: string, value: unknown, event: string][] = [];
        if ('status' in b) {
          const v = oneOf(b, 'status', STATUSES);
          if (!v) throw new HttpError(400, 'status is required');
          if (v !== t.status) changes.push(['status', v, `changed status to ${label(v)}`]);
        }
        let kind = t.kind;
        if ('kind' in b) {
          const v = oneOf(b, 'kind', KINDS);
          if (!v) throw new HttpError(400, 'kind is required');
          if (v !== t.kind) changes.push(['kind', v, v === 'issue' ? 'turned this into an issue' : 'turned this into a comment']);
          kind = v;
        }
        if ('title' in b) {
          const v = str(b, 'title', { max: 200 });
          if (v !== t.title) changes.push(['title', v, v ? `renamed it to “${v}”` : 'removed the title']);
        }
        // only issues have a severity; turning an issue into a comment drops it
        if ('severity' in b) {
          const v = oneOf(b, 'severity', SEVERITIES);
          if (v && kind !== 'issue') throw new HttpError(400, 'only issues have a severity');
          if (kind === 'issue' && v !== t.severity) changes.push(['severity', v, `set severity to ${label(v)}`]);
        }
        if (kind === 'comment' && t.kind !== 'comment' && t.severity) changes.push(['severity', null, 'removed the severity']);
        if ('assignee' in b) {
          const v = str(b, 'assignee', { max: 60 });
          if (v !== t.assignee) changes.push(['assignee', v, v ? `assigned it to ${v}` : 'unassigned it']);
        }
        // the pin moves as a whole: both numbers, or both null to unpin
        if ('x' in b || 'y' in b) {
          if (!('x' in b && 'y' in b)) throw new HttpError(400, 'x and y must be sent together');
          const x = num(b, 'x', 0, 1);
          const y = num(b, 'y', 0, 1);
          if ((x === null) !== (y === null)) throw new HttpError(400, 'x and y must both be numbers or both null');
          if (x !== t.x || y !== t.y) changes.push(['x', x, x === null ? 'unpinned it' : 'moved the pin'], ['y', y, '']);
        }
        if (!changes.length) return;
        const ts = now();
        for (const [col, v] of changes) db.prepare(`UPDATE threads SET ${col} = ? WHERE id = ?`).run(v, id);
        touch.run(ts, id);
        for (const [, , ev] of changes) if (ev) addMessage.run(id, 'event', author, ev, ts);
      }).immediate();
      return this.getThread(id);
    },

    deleteThread(who: string | null, id: number, b: Body) {
      const author = authorOf(who, b);
      db.transaction(() => {
        const t = getThread(id);
        if (t.author !== author) throw new HttpError(403, 'you can only delete your own threads');
        db.prepare('DELETE FROM threads WHERE id = ?').run(id);
      }).immediate();
      return { ok: true };
    },

    addReply(who: string | null, id: number, b: Body) {
      const author = authorOf(who, b);
      const body = str(b, 'body', { max: 5000, required: true })!;
      getThread(id);
      const ts = now();
      db.transaction(() => {
        addMessage.run(id, 'comment', author, body, ts);
        touch.run(ts, id);
      })();
      return this.getThread(id);
    },

    // Edits and deletes touch the thread too: viewers poll on updated_at.
    editMessage(who: string | null, mid: number, b: Body) {
      const author = authorOf(who, b);
      const body = str(b, 'body', { max: 5000, required: true })!;
      const threadId = db.transaction(() => {
        const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(mid) as MessageRow | undefined;
        if (!m || m.type !== 'comment') throw new HttpError(404, 'message not found');
        if (m.author !== author) throw new HttpError(403, 'you can only edit your own messages');
        const ts = now();
        db.prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?').run(body, ts, mid);
        touch.run(ts, m.thread_id);
        return m.thread_id;
      }).immediate();
      return this.getThread(threadId);
    },

    deleteMessage(who: string | null, mid: number, b: Body) {
      const author = authorOf(who, b);
      const threadId = db.transaction(() => {
        const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(mid) as MessageRow | undefined;
        if (!m || m.type !== 'comment') throw new HttpError(404, 'message not found');
        if (m.author !== author) throw new HttpError(403, 'you can only delete your own messages');
        const first = db.prepare("SELECT id FROM messages WHERE thread_id = ? AND type = 'comment' ORDER BY id LIMIT 1").get(m.thread_id) as { id: number };
        if (first.id === mid) throw new HttpError(400, 'delete the whole thread instead of its first message');
        db.prepare('DELETE FROM messages WHERE id = ?').run(mid);
        touch.run(now(), m.thread_id);
        return m.thread_id;
      }).immediate();
      return this.getThread(threadId);
    },
  };
}

// ------------------------------------------------------------------ router

type Next = (err?: unknown) => void;

const WRITES = ['POST', 'PATCH', 'DELETE', 'PUT'];

/**
 * access: Cloudflare Access settings (default: CF_ACCESS_TEAM_DOMAIN and
 * CF_ACCESS_AUD from the environment; null turns it off). When set, every
 * route but /health and /me needs a valid Access token (401 otherwise) and
 * the token's email is the author.
 */
export function createApi({ dbFile, boardsDir, access = accessConfigFromEnv() }: { dbFile: string; boardsDir: string; access?: AccessConfig | null }) {
  let h: ReturnType<typeof handlers> | null = null;
  const api = () => (h ??= handlers(openDb(dbFile), boardsDir));
  const verify = access ? createAccessVerifier(access) : null;

  return async function apiMiddleware(req: IncomingMessage, res: ServerResponse, _next: Next) {
    const method = req.method ?? 'GET';
    const send = (status: number, data: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(data));
    };
    // Errors never go to next(): Vite would show its overlay, with a stack
    // trace, in every open tab. Bad input is an HttpError; anything else is a
    // bug, logged here and a bare 500 to the client.
    try {
      const url = new URL(req.url ?? '/', 'http://local');
      const parts = url.pathname.split('/').filter(Boolean).map(decodeSegment); // mounted at /api
      if (parts[0] === 'health') return send(200, { ok: true });

      const token = req.headers['cf-access-jwt-assertion'];
      const who = verify ? await verify(typeof token === 'string' ? token : undefined) : null;
      if (parts[0] === 'me' && parts.length === 1 && method === 'GET') return send(200, { email: who, verified: !!who });
      if (verify && !who) throw new HttpError(401, 'Cloudflare Access login required');
      if (WRITES.includes(method)) checkWrite(req);

      const id = parts[1] != null ? Number(parts[1]) : NaN;
      const needId = () => {
        if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'bad id');
        return id;
      };
      if (parts[0] === 'boards') {
        if (parts.length === 1 && method === 'GET') return send(200, api().listBoards());
        if (parts.length === 2 && method === 'PATCH') return send(200, api().updateBoard(parts[1], await readJson(req)));
      }
      if (parts[0] === 'threads') {
        if (parts.length === 1 && method === 'GET') return send(200, api().listThreads(url.searchParams));
        if (parts.length === 1 && method === 'POST') return send(201, api().createThread(who, await readJson(req)));
        if (parts.length === 2 && method === 'GET') return send(200, api().getThread(needId()));
        if (parts.length === 2 && method === 'PATCH') return send(200, api().updateThread(who, needId(), await readJson(req)));
        if (parts.length === 2 && method === 'DELETE') return send(200, api().deleteThread(who, needId(), await readJson(req)));
        if (parts.length === 3 && parts[2] === 'messages' && method === 'POST') return send(201, api().addReply(who, needId(), await readJson(req)));
      }
      if (parts[0] === 'messages' && parts.length === 2) {
        if (method === 'PATCH') return send(200, api().editMessage(who, needId(), await readJson(req)));
        if (method === 'DELETE') return send(200, api().deleteMessage(who, needId(), await readJson(req)));
      }
      return send(404, { error: 'not found' });
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      console.error(`[api] ${method} ${req.url}:`, e);
      if (res.headersSent) return res.end();
      send(500, { error: 'internal error' });
    }
  };
}
