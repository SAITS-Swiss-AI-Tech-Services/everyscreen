import { catOf, GROUP_ORDER_LAST, type Board, type Cat } from './board';
import type { EdgeData, ScreenData } from './types';

// World units: one phone screen is 390x844, framed by a 12px bezel.
export const PW = 414;
export const PH = 868;
const COL = PW + 120; // column pitch
export const HEAD = 84; // title above a phone
export const FOOT = 84; // media strip below a phone
const LABEL = 76; // section label row
const PAD = 110; // region padding
export const PILL_W = 360;
export const PILL_H = 78;
const PILL_GAP = 40;
const REGION_GAP = 520;
const REGION_MIN_W = 1600; // room for the region title when zoomed out

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Region extends Rect {
  gid: string;
  count: number;
}
export interface SectionLabel {
  gid: string;
  text: string;
  x: number;
  y: number;
}
export interface Gutter {
  id: string;
  left: string;
  right: string;
  edges: EdgeData[];
  cat: Cat;
  d: string;
}
export interface Layout {
  pos: Map<string, Rect>;
  regions: Region[];
  sections: SectionLabel[];
  bounds: Rect;
  edgePath: Map<EdgeData, string>;
  gutters: Gutter[];
}

const isFrame = (n: ScreenData) => n.kind !== 'layout';

// Depth-first from the group's entry points (its index route, then screens
// reached from other groups), so flows read left to right. Screens nothing
// leads to come last.
function orderItems(board: Board, items: ScreenData[], groupId: string) {
  const ids = new Set(items.map((i) => i.id));
  const out = new Map(items.map((i) => [i.id, [] as string[]]));
  const indeg = new Map(items.map((i) => [i.id, 0]));
  const extIn = new Map(items.map((i) => [i.id, 0]));
  for (const e of board.edges) {
    if (e.kind === 'back' || e.from === e.to || !ids.has(e.to)) continue;
    if (ids.has(e.from)) {
      out.get(e.from)!.push(e.to);
      indeg.set(e.to, indeg.get(e.to)! + 1);
    } else if (!e.from.startsWith('layout:')) {
      extIn.set(e.to, extIn.get(e.to)! + 1);
    }
  }
  const groupRoute = '/' + groupId;
  const score = (i: ScreenData) => (i.route === groupRoute ? 0 : extIn.get(i.id) ? 1 : indeg.get(i.id) ? 2 : 3);
  const sorted = [...items].sort((a, b) => score(a) - score(b) || extIn.get(b.id)! - extIn.get(a.id)! || a.id.localeCompare(b.id));
  const rank = new Map<string, number>();
  const visit = (id: string) => {
    if (rank.has(id)) return;
    rank.set(id, rank.size);
    for (const t of [...new Set(out.get(id))].sort()) visit(t);
  };
  for (const i of sorted) if (score(i) < 3) visit(i.id);
  for (const i of sorted) visit(i.id);
  return rank;
}

export function computeLayout(board: Board): Layout {
  const pos = new Map<string, Rect>();
  const regions: Region[] = [];
  const sections: SectionLabel[] = [];
  const gids = [...board.groups.keys()].sort((a, b) => {
    const ia = GROUP_ORDER_LAST.indexOf(a);
    const ib = GROUP_ORDER_LAST.indexOf(b);
    return ia - ib || a.localeCompare(b);
  });
  let x = 0;
  for (const gid of gids) {
    const items = board.nodes.filter((n) => n.group === gid && isFrame(n));
    const pills = board.nodes.filter((n) => n.group === gid && n.kind === 'layout');
    if (!items.length && !pills.length) continue;
    const rank = orderItems(board, items, gid);
    items.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    const secMap = new Map<string, ScreenData[]>();
    for (const it of items) {
      const s = it.section ?? '';
      if (!secMap.has(s)) secMap.set(s, []);
      secMap.get(s)!.push(it);
    }
    const secs = [...secMap.entries()].sort((a, b) => {
      const fa = a[0] === 'flow recordings';
      const fb = b[0] === 'flow recordings';
      if (fa !== fb) return fa ? 1 : -1;
      return rank.get(a[1][0].id)! - rank.get(b[1][0].id)!;
    });
    const labelled = secs.length > 1 || (secs[0] !== undefined && secs[0][0] !== '');
    const maxCols = labelled ? 12 : 7;
    let y = PAD;
    if (pills.length) {
      pills.forEach((p, i) => pos.set(p.id, { x: x + PAD + i * (PILL_W + PILL_GAP), y, w: PILL_W, h: PILL_H }));
      y += PILL_H + 70;
    }
    let cols = 0;
    for (const [sec, list] of secs) {
      if (labelled) {
        sections.push({ gid, text: sec || 'screens', x: x + PAD + 4, y });
        y += LABEL;
      }
      for (let i = 0; i < list.length; i += maxCols) {
        const row = list.slice(i, i + maxCols);
        row.forEach((it, c) => pos.set(it.id, { x: x + PAD + c * COL, y: y + HEAD, w: PW, h: PH }));
        cols = Math.max(cols, row.length);
        y += HEAD + PH + FOOT + 40;
      }
      y += 30;
    }
    const w = Math.max(REGION_MIN_W, PAD * 2 + cols * COL - (COL - PW), PAD * 2 + pills.length * (PILL_W + PILL_GAP) - PILL_GAP);
    regions.push({ gid, x, y: 0, w, h: y + PAD - 70, count: items.filter((i) => i.kind !== 'flow').length });
    x += w + REGION_GAP;
  }
  const last = regions[regions.length - 1];
  const bounds = { x: 0, y: -700, w: last ? last.x + last.w : 0, h: Math.max(0, ...regions.map((r) => r.h)) + 700 };
  return { pos, regions, sections, bounds, edgePath: routeEdges(board, pos), gutters: gutterArrows(board, pos) };
}

type Side = 'l' | 'r' | 't' | 'b';
function sides(a: Rect, b: Rect): [Side, Side] {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  const xGap = Math.abs(dx) - (a.w + b.w) / 2;
  const yGap = Math.abs(dy) - (a.h + b.h) / 2;
  if (xGap > 0 && !(yGap > 0 && yGap > xGap * 2)) return dx > 0 ? ['r', 'l'] : ['l', 'r'];
  return dy > 0 ? ['b', 't'] : ['t', 'b'];
}

// Bezier routes for every edge. Edges sharing a side of a frame are spread
// along it, ordered by where the other end is, so they fan out instead of
// piling onto one point.
function routeEdges(board: Board, pos: Map<string, Rect>) {
  type End = { p: { x: number; y: number }; d: { x: number; y: number } };
  const ends = new Map<EdgeData, { a?: End; b?: End }>();
  const bySide = new Map<string, { e: EdgeData; other: Rect; end: 'a' | 'b' }[]>();
  const add = (id: string, side: Side, e: EdgeData, other: Rect, end: 'a' | 'b') => {
    const k = id + '|' + side;
    if (!bySide.has(k)) bySide.set(k, []);
    bySide.get(k)!.push({ e, other, end });
  };
  for (const e of board.edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const [sa, sb] = sides(a, b);
    add(e.from, sa, e, b, 'a');
    add(e.to, sb, e, a, 'b');
    ends.set(e, {});
  }
  for (const [k, list] of bySide) {
    const [id, side] = k.split('|') as [string, Side];
    const r = pos.get(id)!;
    const horiz = side === 'l' || side === 'r';
    list.sort((u, v) => (horiz ? u.other.y - v.other.y : u.other.x - v.other.x));
    list.forEach((it, i) => {
      const t = 0.12 + 0.76 * ((i + 1) / (list.length + 1));
      const end: End =
        side === 'r' ? { p: { x: r.x + r.w, y: r.y + r.h * t }, d: { x: 1, y: 0 } }
        : side === 'l' ? { p: { x: r.x, y: r.y + r.h * t }, d: { x: -1, y: 0 } }
        : side === 't' ? { p: { x: r.x + r.w * t, y: r.y }, d: { x: 0, y: -1 } }
        : { p: { x: r.x + r.w * t, y: r.y + r.h }, d: { x: 0, y: 1 } };
      ends.get(it.e)![it.end] = end;
    });
  }
  const paths = new Map<EdgeData, string>();
  for (const [e, { a, b }] of ends) {
    if (!a || !b) continue;
    const dist = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y);
    const c = Math.min(700, Math.max(50, dist * 0.35));
    paths.set(e, `M${a.p.x},${a.p.y} C${a.p.x + a.d.x * c},${a.p.y + a.d.y * c} ${b.p.x + b.d.x * c},${b.p.y + b.d.y * c} ${b.p.x},${b.p.y}`);
  }
  return paths;
}

// Flow mode: short straight arrows in the gap between neighbouring screens of
// a row, one per direction.
function gutterArrows(board: Board, pos: Map<string, Rect>): Gutter[] {
  const pairs = new Map<string, { l: string; r: string; fwd: EdgeData[]; rev: EdgeData[] }>();
  for (const e of board.edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b || a.y !== b.y || Math.abs(a.x - b.x) !== COL) continue;
    const [l, r] = a.x < b.x ? [e.from, e.to] : [e.to, e.from];
    const key = l + '|' + r;
    if (!pairs.has(key)) pairs.set(key, { l, r, fwd: [], rev: [] });
    pairs.get(key)![e.from === l ? 'fwd' : 'rev'].push(e);
  }
  const out: Gutter[] = [];
  for (const pr of pairs.values()) {
    const L = pos.get(pr.l)!;
    const R = pos.get(pr.r)!;
    const both = pr.fwd.length > 0 && pr.rev.length > 0;
    const mid = L.y + L.h / 2;
    for (const [list, dir] of [[pr.fwd, 1], [pr.rev, -1]] as const) {
      if (!list.length) continue;
      const y = mid + (both ? dir * -34 : 0);
      const x0 = L.x + L.w + 16;
      const x1 = R.x - 16;
      const [from, to] = dir === 1 ? [x0, x1] : [x1, x0];
      out.push({
        id: `g:${pr.l}|${pr.r}|${dir}`,
        left: pr.l,
        right: pr.r,
        edges: [...list],
        cat: catOf(list[0]),
        d: `M${from},${y} L${to},${y}`,
      });
    }
  }
  return out;
}
