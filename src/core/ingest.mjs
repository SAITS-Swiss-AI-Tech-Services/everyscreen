// Files captures onto a board, then rebuilds it (without rescanning the code).
//
//   addCaptures(project, board, [{ file, slug, state? }], { replace, dryRun })
//   ingestRun(project, board, runDir, { replace, dryRun })
//
// ingestRun finds captures named after screen slugs anywhere under runDir
// (Maestro nests them):
//   <slug>.png                 the screen's default state  -> screens/<slug>/01-default.png
//   <slug>--02-filled.png      a further state             -> screens/<slug>/02-filled.png
//   <slug>--02-opening.mp4     a clip                      -> screens/<slug>/02-opening.mp4
// Empty or non-image files (screens that block screenshots) are skipped. An
// existing file is kept unless replace is set.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { buildBoard, BuildError } from './build.mjs';

const MEDIA_EXT = /\.(png|jpe?g|webp|mp4|webm)$/i;
const VIDEO_EXT = /\.(mp4|webm)$/i;

function isImage(f) {
  const b = Buffer.alloc(12);
  const fd = fs.openSync(f, 'r');
  fs.readSync(fd, b, 0, 12, 0);
  fs.closeSync(fd);
  return b.subarray(0, 4).toString('hex') === '89504e47' || b.subarray(0, 3).toString('hex') === 'ffd8ff' || (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP');
}

/**
 * A PNG that is solid black: what Android's screencap gives for screens with
 * FLAG_SECURE. Filtered rows of a black image hold only filter types (0-4),
 * zeros and opaque alpha (255), so no unfiltering is needed.
 */
export function isBlackPng(f) {
  const png = fs.readFileSync(f);
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return false;
  const idat = [];
  for (let i = 8; i + 8 <= png.length; ) {
    const len = png.readUInt32BE(i);
    const type = png.toString('latin1', i + 4, i + 8);
    if (type === 'IDAT') idat.push(png.subarray(i + 8, i + 8 + len));
    if (type === 'IEND') break;
    i += 12 + len;
  }
  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return false;
  }
  for (const b of raw) if (b > 4 && b !== 255) return false;
  return raw.length > 0;
}

/** "Filled in" -> "02-filled-in": numbered after the screen's existing states, unless it starts with NN- or matches one. */
export function stateName(screenDir, label) {
  const clean =
    String(label ?? 'default')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'default';
  if (/^\d{2}-/.test(clean)) return clean;
  const existing = fs.existsSync(screenDir) ? fs.readdirSync(screenDir).filter((f) => MEDIA_EXT.test(f) || /\.html?$/i.test(f)) : [];
  const same = existing.find((f) => f.replace(/\.[^.]+$/, '').replace(/^\d+-/, '') === clean);
  if (same) return same.replace(/\.[^.]+$/, '');
  const next = existing.reduce((n, f) => Math.max(n, Number(f.match(/^(\d+)-/)?.[1] ?? 0)), 0) + 1;
  return `${String(next).padStart(2, '0')}-${clean}`;
}

function loadBoard(project, board) {
  const f = path.join(project.boardsDir, board, 'board.json');
  if (!fs.existsSync(f)) throw new BuildError(`no board "${board}": run \`everyscreen build\` first`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

/**
 * items: [{ file, slug, state? }]; state is "NN-name" or a label ("filled").
 * Returns { filed: [{ slug, file }], skipped: [{ file, reason }], unknown: [{ file, slug }], rebuilt }.
 */
export function addCaptures(project, board, items, { replace = false, dryRun = false } = {}) {
  const b = loadBoard(project, board);
  const slugs = new Set(b.screens.map((s) => s.slug));
  const screensDir = path.join(project.boardsDir, board, 'screens');
  const filed = [];
  const skipped = [];
  const unknown = [];
  for (const it of items) {
    const src = path.resolve(it.file);
    const ext = path.extname(src).toLowerCase();
    if (!slugs.has(it.slug)) {
      unknown.push({ file: src, slug: it.slug });
      continue;
    }
    if (!fs.existsSync(src) || !MEDIA_EXT.test(src)) {
      skipped.push({ file: src, reason: 'not a .png/.jpg/.webp/.mp4/.webm file' });
      continue;
    }
    if (fs.statSync(src).size < 1000 || (!VIDEO_EXT.test(ext) && !isImage(src))) {
      skipped.push({ file: src, reason: 'empty or not an image: the screen probably blocks screenshots (FLAG_SECURE)' });
      continue;
    }
    if (ext === '.png' && isBlackPng(src)) {
      skipped.push({ file: src, reason: 'all black: the screen blocks screenshots (FLAG_SECURE), or the display was off' });
      continue;
    }
    const dir = path.join(screensDir, it.slug);
    const state = stateName(dir, it.state ?? 'default');
    // the same state with another extension counts as the same capture
    const clash = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.replace(/\.[^.]+$/, '') === state && MEDIA_EXT.test(f)) : [];
    if (clash.length && !replace) {
      skipped.push({ file: src, reason: `${it.slug}/${clash[0]} already exists (replace to overwrite)` });
      continue;
    }
    const dest = path.join(dir, state + ext);
    if (!dryRun) {
      fs.mkdirSync(dir, { recursive: true });
      for (const c of clash) fs.rmSync(path.join(dir, c));
      fs.copyFileSync(src, dest);
    }
    filed.push({ slug: it.slug, file: path.relative(project.dir, dest).split(path.sep).join('/') });
  }
  const rebuilt = !dryRun && filed.length ? buildBoard(project, { board, scan: false }).summary : null;
  return { filed, skipped, unknown, rebuilt };
}

export function ingestRun(project, board, runDir, opts = {}) {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (MEDIA_EXT.test(e.name)) files.push(p);
    }
  };
  walk(path.resolve(runDir));
  const items = files.sort().map((f) => {
    const base = path.basename(f, path.extname(f));
    const m = base.match(/^(.*?)--(\d{2}-[a-z0-9-]+)$/);
    return { file: f, slug: m ? m[1] : base, state: m ? m[2] : '01-default' };
  });
  return addCaptures(project, board, items, opts);
}
