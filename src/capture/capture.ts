// Capturing screens onto a board: open the screen's deep link, wait for it to
// settle, screenshot it, file it as a state of that screen.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addCaptures, stateName } from '../core/ingest.mjs';
import { type Project, UsageError } from '../core/project.ts';
import { fillLink, findScreen, readBoard, screenInfos } from '../core/queries.ts';
import { type Device, openLink, settledScreenshot } from './device.ts';

export interface CaptureOptions {
  board: string;
  slug: string;
  /** values for route parameters: { id: "ridge-loop" } */
  params?: Record<string, string>;
  /** state label, e.g. "default", "filled", "error" (default: "default") */
  state?: string;
  /** false: screenshot what's on screen now, without opening the deep link */
  link?: boolean;
  /** how long to wait for the screen to stop changing */
  settleMs?: number;
  replace?: boolean;
}

export interface CaptureResult {
  slug: string;
  file: string | null;
  link: string | null;
  settled: boolean;
  skipped: string | null;
  /** the PNG, for callers that show it (MCP) */
  png: Buffer;
}

export async function captureScreen(p: Project, d: Device, o: CaptureOptions): Promise<CaptureResult> {
  const b = readBoard(p, o.board);
  const s = findScreen(b, o.slug);
  // refuse a duplicate before touching the device
  const dir = path.join(p.boardsDir, o.board, 'screens', s.slug);
  const state = stateName(dir, o.state ?? 'default');
  const existing = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.replace(/\.[^.]+$/, '') === state && !/\.html?$/i.test(f)) : undefined;
  if (existing && !o.replace) throw new UsageError(`${s.slug}/${existing} already exists: pass replace to overwrite it, or a different state label`);
  let link: string | null = null;
  if (o.link !== false) {
    if (!s.deepLink) throw new UsageError(`screen ${s.slug} has no deep link (${s.route ? 'set "scheme" in config.json' : 'it is not a route'}): navigate to it on the device, then capture with link off (--no-link)`);
    link = fillLink(s.deepLink, o.params);
    await openLink(d, link, p.config.appId);
  }
  const { png, settled } = await settledScreenshot(d, { timeoutMs: o.settleMs ?? 4000 });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'everyscreen-'));
  try {
    const tmp = path.join(tmpDir, 'shot.png');
    fs.writeFileSync(tmp, png);
    const r = addCaptures(p, o.board, [{ file: tmp, slug: s.slug, state }], { replace: !!o.replace });
    return { slug: s.slug, file: r.filed[0]?.file ?? null, link, settled, skipped: r.skipped[0]?.reason ?? null, png };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export interface MissingResult {
  captured: { slug: string; file: string; settled: boolean }[];
  failed: { slug: string; error: string }[];
  /** screens this can't do on its own: dynamic routes, no deep link, not routes */
  needsHelp: { slug: string; reason: string; reachedFrom: string[] }[];
}

/** Captures every screen without a capture that a deep link alone can open. */
export async function captureMissing(p: Project, d: Device, o: { board: string; settleMs?: number; onProgress?: (msg: string) => void }): Promise<MissingResult> {
  const infos = screenInfos(readBoard(p, o.board)).filter((s) => s.status !== 'captured' && !['helper', 'redirect', 'system', 'dev'].includes(s.kind));
  const out: MissingResult = { captured: [], failed: [], needsHelp: [] };
  for (const s of infos) {
    if (!s.deepLink) {
      out.needsHelp.push({ slug: s.slug, reason: s.route ? 'no deep-link scheme configured' : `not a route (${s.kind}): open it on the device, then capture with link off`, reachedFrom: s.reachedFrom });
      continue;
    }
    if (s.params.length) {
      out.needsHelp.push({ slug: s.slug, reason: `needs route parameters: ${s.params.join(', ')}`, reachedFrom: s.reachedFrom });
      continue;
    }
    try {
      const r = await captureScreen(p, d, { board: o.board, slug: s.slug, settleMs: o.settleMs });
      if (r.file) {
        out.captured.push({ slug: s.slug, file: r.file, settled: r.settled });
        o.onProgress?.(`captured ${s.slug}`);
      } else {
        out.failed.push({ slug: s.slug, error: r.skipped ?? 'not filed' });
        o.onProgress?.(`skipped ${s.slug}: ${r.skipped}`);
      }
    } catch (e) {
      out.failed.push({ slug: s.slug, error: (e as Error).message });
      o.onProgress?.(`failed ${s.slug}: ${(e as Error).message}`);
    }
  }
  return out;
}
