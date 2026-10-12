import { getVideo, pauseQuietly } from './playback';
import { createStore, prefs, ui, useStore } from './store';
import type { ScreenData } from './types';

// Client side of the comments / issues API (server/api.ts).

export type Kind = 'comment' | 'issue';
export type Status = 'open' | 'in_progress' | 'resolved' | 'wontfix';
export type Severity = 'low' | 'medium' | 'high' | 'critical';

export const STATUS_LABEL: Record<Status, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', wontfix: "Won't fix" };
export const SEVERITY_LABEL: Record<Severity, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
export const isOpen = (t: { status: Status }) => t.status === 'open' || t.status === 'in_progress';

export interface Thread {
  id: number;
  boardId: string;
  screenId: string;
  screenSlug: string;
  screenTitle: string;
  kind: Kind;
  status: Status;
  title: string | null;
  severity: Severity | null;
  assignee: string | null;
  x: number | null;
  y: number | null;
  mediaFile: string | null;
  mediaTime: number | null;
  release: string | null;
  commit: string | null;
  author: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  excerpt: string | null;
}
export interface Message {
  id: number;
  threadId: number;
  type: 'comment' | 'event';
  author: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
}
/** A pin being placed, before it is posted. */
export interface Draft {
  screenId: string;
  x: number | null;
  y: number | null;
  mediaFile: string | null;
  mediaTime: number | null;
}
/** What is typed into the new-thread form; kept while the pin moves around. */
export interface Compose {
  kind: Kind;
  title: string;
  severity: Severity;
  assignee: string;
  body: string;
}
const EMPTY_COMPOSE: Compose = { kind: 'comment', title: '', severity: 'medium', assignee: '', body: '' };
/** Who is posting: the Cloudflare Access identity when the server verified one. */
export interface Me {
  email: string | null;
  verified: boolean;
}

interface CommentsState {
  /** Board the threads belong to. */
  boardId: string | null;
  threads: Thread[];
  /** Threads per screen id; arrays keep their identity while unchanged. */
  byScreen: Map<string, Thread[]>;
  loaded: boolean;
  error: string | null;
  /** Comment tool: clicking a screen drops a pin. */
  placing: boolean;
  draft: Draft | null;
  compose: Compose;
  /** Thread open in the side panel. */
  openId: number | null;
  showResolved: boolean;
  author: string;
  me: Me;
  /** Ask a clip to jump to a time for a thread: { screenId, threadId, time, n } (n makes repeats distinct). */
  seek: { screenId: string; threadId: number; time: number; n: number } | null;
}

export const comments = createStore<CommentsState>({
  boardId: null,
  threads: [],
  byScreen: new Map(),
  loaded: false,
  error: null,
  placing: false,
  draft: null,
  compose: EMPTY_COMPOSE,
  openId: null,
  showResolved: prefs.get('showResolved', false),
  author: prefs.get('author', ''),
  me: { email: null, verified: false },
  seek: null,
});
export const useComments = <R,>(selector: (s: CommentsState) => R): R => useStore(comments, selector);

// ------------------------------------------------------------------ API

const API = `${import.meta.env.BASE_URL}api`;
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(API + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `${r.status} ${r.statusText}`);
  return data as T;
}
export interface ThreadDetail {
  thread: Thread;
  messages: Message[];
}

function setThreads(threads: Thread[]) {
  const prev = comments.get().byScreen;
  const next = new Map<string, Thread[]>();
  for (const t of threads) {
    if (!next.has(t.screenId)) next.set(t.screenId, []);
    next.get(t.screenId)!.push(t);
  }
  // keep old arrays when nothing on that screen changed, so frames don't re-render
  const key = (list: Thread[] | undefined) => (list ?? []).map((t) => `${t.id}:${t.updatedAt}:${t.messageCount}`).join('|');
  for (const [id, list] of next) if (key(prev.get(id)) === key(list)) next.set(id, prev.get(id)!);
  comments.set({ threads, byScreen: next, loaded: true, error: null });
}

export async function loadThreads() {
  const boardId = comments.get().boardId;
  if (!boardId) return;
  try {
    const { threads } = await call<{ threads: Thread[] }>('GET', `/threads?board=${encodeURIComponent(boardId)}`);
    if (comments.get().boardId === boardId) setThreads(threads);
  } catch (e) {
    // a late failure for a board we already left must not mark the new one loaded
    if (comments.get().boardId === boardId) comments.set({ error: (e as Error).message, loaded: true });
  }
}
function mergeThread(t: Thread) {
  // a save that finishes after switching canvas belongs to the old one
  if (t.boardId !== comments.get().boardId) return;
  const list = comments.get().threads;
  const i = list.findIndex((x) => x.id === t.id);
  setThreads(i < 0 ? [...list, t] : list.map((x) => (x.id === t.id ? t : x)));
}

export function setAuthor(name: string) {
  comments.set({ author: name });
  prefs.set('author', name);
}
/** Name to post as: the verified Access email, else the typed name. */
export const authorName = (s: Pick<CommentsState, 'me' | 'author'> = comments.get()) => (s.me.verified && s.me.email ? s.me.email : s.author.trim());
const author = () => authorName();

export async function loadMe() {
  try {
    const me = await call<Me>('GET', '/me');
    comments.set({ me: { email: me.email ?? null, verified: !!me.verified } });
  } catch {
    /* older server without /api/me: typed names only */
  }
}

export const fetchThread = (id: number) => call<ThreadDetail>('GET', `/threads/${id}`);

export async function createThread(screen: ScreenData, draft: Draft, fields: { kind: Kind; title: string; severity: Severity | null; assignee: string; body: string }, source: { release?: string | null; commit?: string | null }) {
  const boardId = comments.get().boardId;
  const d = await call<ThreadDetail>('POST', '/threads', {
    boardId,
    author: author(),
    screen: { id: screen.id, slug: screen.slug, title: screen.title },
    ...draft,
    ...fields,
    release: source.release ?? null,
    commit: source.commit ?? null,
  });
  mergeThread(d.thread);
  if (comments.get().boardId === boardId) comments.set({ draft: null, compose: EMPTY_COMPOSE, placing: false, openId: d.thread.id });
  return d;
}
export async function updateThread(id: number, patch: Partial<Pick<Thread, 'status' | 'kind' | 'title' | 'severity' | 'assignee'>>) {
  const d = await call<ThreadDetail>('PATCH', `/threads/${id}`, { author: author(), ...patch });
  mergeThread(d.thread);
  return d;
}
export async function reply(id: number, body: string) {
  const d = await call<ThreadDetail>('POST', `/threads/${id}/messages`, { author: author(), body });
  mergeThread(d.thread);
  return d;
}
export async function editMessage(mid: number, body: string) {
  const d = await call<ThreadDetail>('PATCH', `/messages/${mid}`, { author: author(), body });
  mergeThread(d.thread);
  return d;
}
export async function deleteMessage(mid: number) {
  const d = await call<ThreadDetail>('DELETE', `/messages/${mid}`, { author: author() });
  mergeThread(d.thread);
  return d;
}
export async function deleteThread(id: number) {
  await call('DELETE', `/threads/${id}`, { author: author() });
  setThreads(comments.get().threads.filter((t) => t.id !== id));
  if (comments.get().openId === id) comments.set({ openId: null });
}

// ------------------------------------------------------------------ actions

/** Show a thread: its screen's capture it was pinned on, the clip time, the panel. */
export function openThread(t: Thread, screen: ScreenData | undefined) {
  if (screen && t.mediaFile) {
    const i = screen.media.findIndex((m) => m.file === t.mediaFile);
    if (i >= 0) ui.setMedia(screen.id, i);
  }
  comments.set({
    openId: t.id,
    draft: null,
    compose: EMPTY_COMPOSE,
    seek: t.mediaTime != null ? { screenId: t.screenId, threadId: t.id, time: t.mediaTime, n: Date.now() } : null,
  });
}
export function closeThread() {
  comments.set({ openId: null, seek: null });
}

/** Start a draft pin on a screen at (x, y) in 0..1, or unpinned. What was
 * typed so far stays (clicking again moves the pin). */
export function startDraft(screen: ScreenData, x: number | null, y: number | null) {
  const m = screen.media[ui.get().mediaIdx[screen.id] ?? 0];
  const video = m?.type === 'video' ? getVideo(screen.id) : undefined;
  comments.set({
    draft: { screenId: screen.id, x, y, mediaFile: m?.file ?? null, mediaTime: video ? Math.round(video.currentTime * 10) / 10 : null },
    openId: null,
    seek: null,
  });
  if (video) pauseQuietly(video);
}
export function setCompose(patch: Partial<Compose>) {
  comments.set({ compose: { ...comments.get().compose, ...patch } });
}
/** Drop the draft, asking first if something was typed. Returns false if the viewer kept it. */
export function discardDraft() {
  const { draft, compose } = comments.get();
  if (!draft) return true;
  if ((compose.body.trim() || compose.title.trim()) && !confirm('Discard the comment you started?')) return false;
  comments.set({ draft: null, compose: EMPTY_COMPOSE });
  return true;
}

/** Threads to draw as pins on a screen showing capture `mediaFile`. */
export function visiblePins(list: Thread[] | undefined, mediaFile: string | null, showResolved: boolean) {
  return (list ?? []).filter((t) => t.x != null && t.y != null && (showResolved || isOpen(t)) && (t.mediaFile == null || t.mediaFile === mediaFile));
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
