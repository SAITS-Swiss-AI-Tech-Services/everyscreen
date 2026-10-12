import type { BoardFile, EdgeData, Group, ScreenData } from './types';

/** Board data and media are served from here (see vite.config.ts). */
export const MEDIA_BASE = `${import.meta.env.BASE_URL}media/`;
export const mediaUrl = (u: string | undefined) => (u ? MEDIA_BASE + u : undefined);

// Route groups come first (alphabetical, so a group sits before its
// sub-groups); these always go last, in this order.
export const GROUP_ORDER_LAST = ['in-place', 'sheets', 'root', 'flows'];

const FIXED_HUES: Record<string, string> = {
  'in-place': '#ea7412',
  sheets: '#9b51e0',
  root: '#7a7a72',
  flows: '#7a7a72',
};
// Route groups get one of these by a hash of their id, so a group keeps its
// colour across canvases and rebuilds.
const PALETTE = ['#5b5bd6', '#c98500', '#0e9a80', '#2e9d4f', '#2f6bff', '#d6409f', '#c2410c', '#0284c7'];
export const hueOf = (group: string) => {
  if (FIXED_HUES[group]) return FIXED_HUES[group];
  let h = 0;
  for (const c of group) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

export type Cat = 'forward' | 'replace' | 'drawer' | 'layout' | 'inferred' | 'back';

export const CATS: { id: Cat; label: string; color: string; on: boolean }[] = [
  { id: 'forward', label: 'Push / link / tab', color: 'var(--e-forward)', on: true },
  { id: 'replace', label: 'Replace', color: 'var(--e-replace)', on: true },
  { id: 'drawer', label: 'Drawer & sheets', color: 'var(--e-drawer)', on: true },
  { id: 'layout', label: 'Layout / global', color: 'var(--e-layout)', on: true },
  { id: 'inferred', label: 'Inferred', color: 'var(--e-inferred)', on: false },
  { id: 'back', label: 'Back', color: 'var(--e-back)', on: false },
];
export const catColor = Object.fromEntries(CATS.map((c) => [c.id, c.color])) as Record<Cat, string>;

export function catOf(e: EdgeData): Cat {
  if (e.from.startsWith('layout:')) return 'layout';
  if (e.kind === 'back') return 'back';
  if (e.certainty === 'inferred') return 'inferred';
  if (e.kind === 'drawer' || e.kind === 'sheet') return 'drawer';
  if (e.kind === 'replace') return 'replace';
  return 'forward';
}

export interface Board {
  file: BoardFile;
  nodes: ScreenData[];
  byId: Map<string, ScreenData>;
  bySlug: Map<string, ScreenData>;
  edges: EdgeData[];
  outE: Map<string, EdgeData[]>;
  inE: Map<string, EdgeData[]>;
  /** Screen id -> flow recordings that include it. */
  flowsOf: Map<string, ScreenData[]>;
  groups: Map<string, Group>;
}

export function deriveBoard(file: BoardFile): Board {
  const groups = new Map(file.groups.map((g) => [g.id, g]));
  const nodes: ScreenData[] = file.screens.map((n) => ({ ...n, media: n.media ?? [] }));
  for (const f of file.flows ?? []) {
    const gid = f.group && groups.has(f.group) ? f.group : 'flows';
    if (gid === 'flows' && !groups.has('flows')) groups.set('flows', { id: 'flows', title: 'Flow recordings', navigator: 'clips' });
    nodes.push({
      id: 'flow:' + f.id,
      slug: 'flow--' + f.id,
      kind: 'flow',
      group: gid,
      section: 'flow recordings',
      title: f.title,
      route: null,
      url: null,
      deepLink: null,
      file: null,
      component: null,
      params: [],
      flags: [],
      screens: f.screens,
      media: f.media,
    });
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const bySlug = new Map(nodes.map((n) => [n.slug, n]));
  const edges = file.edges.filter((e) => byId.has(e.from) && byId.has(e.to));
  const outE = new Map<string, EdgeData[]>();
  const inE = new Map<string, EdgeData[]>();
  for (const n of nodes) {
    outE.set(n.id, []);
    inE.set(n.id, []);
  }
  for (const e of edges) {
    outE.get(e.from)!.push(e);
    inE.get(e.to)!.push(e);
  }
  const flowsOf = new Map<string, ScreenData[]>();
  for (const n of nodes) {
    if (n.kind !== 'flow') continue;
    for (const s of n.screens ?? []) {
      if (!flowsOf.has(s)) flowsOf.set(s, []);
      flowsOf.get(s)!.push(n);
    }
  }
  return { file, nodes, byId, bySlug, edges, outE, inE, flowsOf, groups };
}

export const groupTitle = (board: Board, id: string) => board.groups.get(id)?.title ?? id;
export const isUnreached = (board: Board, n: ScreenData) => n.kind === 'screen' && !board.inE.get(n.id)?.length;
