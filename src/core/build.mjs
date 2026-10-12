// Builds one canvas (board): <project>/boards/<id>/board.json, which the web
// app loads at /b/<id>.
//
//   buildBoard(project, { board, device, os, resolution, title, force, demo, scan })
//
// A board is one snapshot of the app: the routes and links of the checked-out
// release of the app's source plus the captures in boards/<id>/screens/.
// title and the device (device, os, resolution) given once are kept on later
// rebuilds of the same board; pass them again to change them, or pass '' to
// clear one. Without a title the title follows the release and device.
// The default board is the release tag on the checked-out commit, else the
// branch, else "current". A board made from a tagged release is a snapshot:
// rebuilding it from a different commit is refused unless force is set.
//
// Captures: boards/<id>/screens/<screen slug>/. Every file there becomes a
// state of that screen, ordered by file name:
//   *.png *.jpg *.jpeg *.webp   still
//   *.mp4 *.webm                clip (optional <name>.poster.jpg|png beside it)
//   *.html                      HTML mockup (shown only if no capture exists)
// A leading "NN-" in the file name orders states and is dropped from the label:
// "02-validation-error.png" -> "validation error".
// Recordings that span several screens go in screens/_flows/*.mp4, described by
// screens/_flows/flows.json: { "<file>": { "title", "group", "screens": [ids] } }.
//
// Thumbnails and video posters are generated with ffmpeg (if installed) into
// thumbs/, which can be deleted at any time.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanApp } from './inventory.mjs';

export class BuildError extends Error {}

const BOARD_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

/**
 * opts.scan: false reuses the board's own routes (only captures changed).
 * Returns { board, summary, report } (report: the scan report, or null).
 */
export function buildBoard(project, opts = {}) {
const CANVAS = project.dir;
const THUMBS = project.thumbsDir;
const given = (name) => opts[name] !== undefined && opts[name] !== null;
const warnings = [];

// 1. routes: scan the source, or reuse the board's own when only captures changed
let manifest;
let report = null;
const prevFor = (id) => {
  const f = path.join(project.boardsDir, id, 'board.json');
  if (!fs.existsSync(f)) return {};
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return {};
  }
};
if (opts.scan === false) {
  if (!opts.board) throw new BuildError('a board id is needed to rebuild without scanning');
  const old = prevFor(opts.board);
  if (!old.screens) throw new BuildError(`no board "${opts.board}" to rebuild`);
  manifest = { source: old.source, groups: old.groups, screens: old.screens.map(({ media: _m, ...s }) => s), edges: old.edges };
} else {
  ({ manifest, report } = scanApp(project));
}

// 2. which board
// Default board: the release tag on this commit, else the branch, else "current".
const branch = manifest.source.branch && manifest.source.branch !== 'HEAD' ? manifest.source.branch : null;
const ID = opts.board ?? ((manifest.source.tag ?? branch ?? 'current').replace(/[^a-z0-9._-]+/gi, '-').replace(/^[^a-z0-9]+/i, '').slice(0, 80) || 'current');
if (!BOARD_ID.test(ID)) throw new BuildError(`bad board id "${ID}": letters, digits, . _ - only`);
const BOARD_DIR = path.join(project.boardsDir, ID);
const MEDIA = path.join(BOARD_DIR, 'screens');
const OUT = path.join(BOARD_DIR, 'board.json');
const prev = prevFor(ID);
// A board built from a tagged release is a snapshot: its captures belong to
// that release, so moving it to other code needs force. Other boards (a
// branch, "current") follow the code.
if (prev.source?.tag && prev.source?.commit && manifest.source.commit && prev.source.commit !== manifest.source.commit && !opts.force) {
  throw new BuildError(
    `board "${ID}" was built from ${prev.source.release ?? prev.source.commit} (${prev.source.commit.slice(0, 7)}), ` +
      `but the app's source is now at ${manifest.source.release ?? manifest.source.commit} (${manifest.source.commit.slice(0, 7)}). ` +
      `Its captures belong to the old release. Use a new board id, check out the old release, or force a rebuild.`,
  );
}
fs.mkdirSync(MEDIA, { recursive: true });
const field = (name, old) => {
  const v = given(name) ? opts[name] : (old ?? null);
  return v === '' ? null : v;
};
let device = prev.device ?? null;
if (given('device') || given('os') || given('resolution')) {
  device = { model: field('device', prev.device?.model), os: field('os', prev.device?.os), resolution: field('resolution', prev.device?.resolution) };
  if (!device.model && !device.os && !device.resolution) device = null;
}

// 3. media
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
const IMG = /\.(png|jpe?g|webp)$/i;
const VID = /\.(mp4|webm)$/i;
const HTML = /\.html?$/i;
const urlOf = (abs) => path.relative(CANVAS, abs).split(path.sep).map(encodeURIComponent).join('/');
const labelOf = (file) =>
  path
    .basename(file)
    .replace(/\.[^.]+$/, '')
    .replace(/^\d+[-_ ]*/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
// A generated file is fresh if it was made from a source of the same size and
// mtime, recorded in <dst>.src beside it (a replacement capture with an older
// mtime still counts as changed).
const stamp = (src) => {
  const st = fs.statSync(src);
  return `${st.size} ${st.mtimeMs}`;
};
const fresh = (src, dst) => {
  if (!fs.existsSync(dst)) return false;
  if (!fs.existsSync(dst + '.src')) {
    // made before stamps existed: trust mtime once, then stamp it
    const ok = fs.statSync(dst).mtimeMs >= fs.statSync(src).mtimeMs;
    if (ok) markFresh(src, dst);
    return ok;
  }
  return fs.readFileSync(dst + '.src', 'utf8') === stamp(src);
};
const markFresh = (src, dst) => fs.writeFileSync(dst + '.src', stamp(src));
let ffmpegOk = 0;
let ffmpegFailed = 0;
let latestCapture = 0;
function ffmpeg(argv, quiet = false) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...argv], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  if (r.status === 0) return true;
  if (!quiet) warnings.push(`ffmpeg failed on ${argv[argv.indexOf('-i') + 1]}: ${(r.stderr ?? '').trim().split('\n')[0] || `exit ${r.status}`}`);
  return false;
}
function thumbFor(src, key, width) {
  if (!hasFfmpeg) return null;
  const dst = path.join(THUMBS, key + `.w${width}.jpg`);
  if (!fresh(src, dst)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (!ffmpeg(['-i', src, '-vf', `scale=${width}:-2`, '-q:v', '4', dst])) {
      ffmpegFailed++;
      return null;
    }
    markFresh(src, dst);
    ffmpegOk++;
  }
  return dst;
}
function posterFor(src, key) {
  const sibling = ['.poster.jpg', '.poster.png'].map((s) => src.replace(VID, s)).find((p) => fs.existsSync(p));
  if (sibling) return sibling;
  if (!hasFfmpeg) return null;
  const dst = path.join(THUMBS, key + '.poster.jpg');
  if (!fresh(src, dst)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    // a frame slightly in, so fades from the previous screen are over; clips
    // shorter than that fall back to the first frame
    fs.rmSync(dst, { force: true });
    const ok = ffmpeg(['-ss', '0.6', '-i', src, '-frames:v', '1', '-vf', 'scale=780:-2', '-q:v', '3', dst], true) && fs.existsSync(dst);
    if (!ok && !ffmpeg(['-i', src, '-frames:v', '1', '-vf', 'scale=780:-2', '-q:v', '3', dst])) {
      ffmpegFailed++;
      return null;
    }
    markFresh(src, dst);
    ffmpegOk++;
  }
  return dst;
}
function mediaIn(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith('.') && !f.startsWith('_') && !/\.poster\.(jpe?g|png)$/i.test(f))
    .filter((f) => IMG.test(f) || VID.test(f) || HTML.test(f));
  const rank = (f) => (HTML.test(f) ? 1 : 0);
  files.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'en', { numeric: true }));
  return files.map((f) => {
    const abs = path.join(dir, f);
    const key = path.relative(CANVAS, abs); // unique across boards
    const m = { type: IMG.test(f) ? 'image' : VID.test(f) ? 'video' : 'html', label: labelOf(f) || 'state', file: path.relative(MEDIA, abs).split(path.sep).join('/'), src: urlOf(abs) };
    if (m.type !== 'html') latestCapture = Math.max(latestCapture, fs.statSync(abs).mtimeMs);
    if (m.type === 'image') {
      const t = thumbFor(abs, key, 240);
      if (t) m.thumb = urlOf(t);
    } else if (m.type === 'video') {
      const p = posterFor(abs, key);
      if (p) {
        m.poster = urlOf(p);
        const t = thumbFor(p, key + '.poster', 240);
        if (t) m.posterThumb = urlOf(t);
      }
    }
    return m;
  });
}

const screens = manifest.screens.map((s) => ({ ...s, media: s.kind === 'layout' ? [] : mediaIn(path.join(MEDIA, s.slug)) }));

let flows = [];
const flowDir = path.join(MEDIA, '_flows');
if (fs.existsSync(flowDir)) {
  const metaFile = path.join(flowDir, 'flows.json');
  let meta = {};
  if (fs.existsSync(metaFile)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    } catch (e) {
      throw new BuildError(`${metaFile} is not valid JSON: ${e.message}`);
    }
  }
  flows = mediaIn(flowDir)
    .filter((m) => m.type === 'video')
    .map((m) => {
      const base = path.basename(m.file);
      const info = meta[base] ?? {};
      return { id: base.replace(/\.[^.]+$/, ''), title: info.title ?? m.label, group: info.group ?? null, screens: info.screens ?? [], media: [m] };
    });
}

// 4. write
const frames = screens.filter((s) => s.kind !== 'layout');
const has = (t) => (s) => s.media.some((m) => m.type === t);
const stats = {
  screens: frames.length,
  captured: frames.filter((s) => has('image')(s) || has('video')(s)).length,
  withClips: frames.filter(has('video')).length,
  mockupOnly: frames.filter((s) => !has('image')(s) && !has('video')(s) && has('html')(s)).length,
  flows: flows.length,
  edges: manifest.edges.length,
};
const now = new Date().toISOString();
// An explicit --title sticks; otherwise the title is regenerated each build.
// Boards from before titleAuto existed keep their title unless it matches the
// auto one.
const base = manifest.source.tag ?? (opts.board ? ID : (branch ?? project.config.name));
const autoTitle = device?.model ? `${base} · ${device.model}` : base;
const wasAuto = prev.title === undefined || prev.title === base || prev.title === `${base} · ${prev.device?.model}`;
const titleAuto = given('title') ? opts.title === '' : (prev.titleAuto ?? wasAuto);
const data = {
  id: ID,
  title: given('title') && opts.title !== '' ? opts.title : titleAuto ? autoTitle : prev.title,
  titleAuto,
  demo: !!opts.demo || !!prev.demo,
  createdAt: prev.createdAt ?? now,
  generatedAt: now,
  capturedAt: latestCapture ? new Date(latestCapture).toISOString() : null,
  device,
  stats,
  source: manifest.source,
  groups: manifest.groups,
  screens,
  edges: manifest.edges,
  flows,
};
// Written to a temp file and renamed, so the app never reads half a board.
const tmp = `${OUT}.${process.pid}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(data) + '\n');
fs.renameSync(tmp, OUT);

// 5. summary
const slugs = new Set(screens.map((s) => s.slug));
const strayFolders = fs.readdirSync(MEDIA, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.') && !slugs.has(d.name)).map((d) => d.name);
const unknownFlowScreens = flows.flatMap((f) => f.screens.filter((id) => !screens.some((s) => s.id === id)).map((id) => `${f.id}: ${id}`));
const summary = {
  board: ID,
  file: OUT,
  title: data.title,
  release: manifest.source.release ?? null,
  commit: manifest.source.commit ?? null,
  device,
  stats,
  placeholders: stats.screens - stats.captured - stats.mockupOnly,
  ffmpeg: hasFfmpeg ? { generated: ffmpegOk, failed: ffmpegFailed } : null,
  strayFolders,
  unknownFlowScreens,
  warnings,
};
return { board: data, summary, report };
}
