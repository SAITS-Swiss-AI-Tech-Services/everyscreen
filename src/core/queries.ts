// Read-only views of a project's boards, shared by the CLI and the MCP server.

import fs from 'node:fs';
import { boardFile, listBoardIds, type Project, UsageError } from './project.ts';

interface Media {
  type: 'image' | 'video' | 'html';
  label: string;
  file: string;
}
interface BoardScreen {
  id: string;
  slug: string;
  route: string | null;
  url: string | null;
  deepLink: string | null;
  file: string | null;
  group: string;
  title: string;
  kind: string;
  dynamic: boolean;
  params: string[];
  media: Media[];
}
export interface BoardJson {
  id: string;
  title: string;
  createdAt: string;
  generatedAt: string;
  capturedAt: string | null;
  device: { model: string | null; os: string | null; resolution: string | null } | null;
  stats: { screens: number; captured: number; withClips: number; mockupOnly: number; flows: number; edges: number };
  source: { repo?: string | null; commit?: string | null; release?: string | null; branch?: string | null; dirty?: boolean };
  screens: BoardScreen[];
  edges: { from: string; to: string; kind: string }[];
}

export function readBoard(p: Project, id: string): BoardJson {
  const f = boardFile(p, id);
  if (!fs.existsSync(f)) throw new UsageError(`no board "${id}"${listBoardIds(p).length ? ` (boards: ${listBoardIds(p).join(', ')})` : ': run `everyscreen build` first'}`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function boardSummaries(p: Project) {
  return listBoardIds(p).map((id) => {
    const b = readBoard(p, id);
    return { id, title: b.title, release: b.source.release ?? null, commit: b.source.commit?.slice(0, 7) ?? null, device: b.device, stats: b.stats, generatedAt: b.generatedAt, capturedAt: b.capturedAt };
  });
}

export type CaptureStatus = 'captured' | 'mockup' | 'missing';

export interface ScreenInfo {
  slug: string;
  id: string;
  title: string;
  group: string;
  kind: string;
  route: string | null;
  deepLink: string | null;
  /** route parameters to fill in before the deep link works ("[id]") */
  params: string[];
  file: string | null;
  status: CaptureStatus;
  states: string[];
  /** screens with an arrow to this one: how to reach it by tapping */
  reachedFrom: string[];
}

export function screenInfos(b: BoardJson): ScreenInfo[] {
  const bySlug = new Map(b.screens.map((s) => [s.id, s.slug]));
  return b.screens
    .filter((s) => s.kind !== 'layout')
    .map((s) => {
      const real = s.media.filter((m) => m.type !== 'html');
      return {
        slug: s.slug,
        id: s.id,
        title: s.title,
        group: s.group,
        kind: s.kind,
        route: s.route,
        deepLink: s.deepLink,
        params: s.dynamic ? s.params : [],
        file: s.file,
        status: real.length ? 'captured' : s.media.length ? 'mockup' : 'missing',
        states: s.media.map((m) => m.file.split('/').pop()!),
        reachedFrom: [...new Set(b.edges.filter((e) => e.to === s.id && !e.from.startsWith('layout:')).map((e) => bySlug.get(e.from) ?? e.from))],
      } satisfies ScreenInfo;
    });
}

export function findScreen(b: BoardJson, slugOrId: string) {
  const s = b.screens.find((x) => x.slug === slugOrId || x.id === slugOrId);
  if (!s) throw new UsageError(`no screen "${slugOrId}" on board "${b.id}" (use the slug from \`everyscreen screens\`)`);
  return s;
}

/** Deep link with route parameters filled in: "myapp://trail/[id]" + { id: "x" }. */
export function fillLink(link: string, params: Record<string, string> = {}) {
  const out = link.replace(/\[(?:\.\.\.)?([^\]]+)\]/g, (m, k: string) => (params[k] !== undefined ? encodeURIComponent(params[k]) : m));
  const missing = [...out.matchAll(/\[(?:\.\.\.)?([^\]]+)\]/g)].map((m) => m[1]);
  if (missing.length) throw new UsageError(`the deep link ${link} needs ${missing.map((k) => `--param ${k}=<value>`).join(' ')}`);
  return out;
}
