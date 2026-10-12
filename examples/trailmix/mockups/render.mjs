#!/usr/bin/env node
// Renders the demo canvas's "screenshots" of the invented Trailmix app: plain
// HTML mockups, captured with headless Chrome into boards/demo/screens/.
// Real canvases use real captures; this only exists so the demo has pictures.
//
//   CHROME=/path/to/chrome node examples/trailmix/mockups/render.mjs
//
// Needs Chrome or Chromium (CHROME, else `chromium` / `google-chrome` on PATH)
// and, for the clip, ffmpeg.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'examples', 'trailmix', '.everyscreen', 'boards', 'demo', 'screens');
const chrome = process.env.CHROME ?? ['chromium', 'chromium-browser', 'google-chrome'].find((c) => spawnSync('which', [c]).status === 0);
if (!chrome) {
  console.error('render: set CHROME to a Chrome or Chromium binary');
  process.exit(1);
}

const CSS = `
* { box-sizing: border-box; }
body { margin: 0; width: 390px; height: 844px; overflow: hidden; font: 16px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; background: #f6f5ef; color: #1d2a1f; position: relative; }
.status { height: 44px; display: flex; justify-content: space-between; align-items: center; padding: 0 24px; font-size: 14px; font-weight: 600; }
.pad { padding: 8px 20px; }
h1 { font-size: 30px; line-height: 1.15; margin: 8px 0 4px; letter-spacing: -.02em; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #66735f; margin: 20px 0 8px; }
.muted { color: #66735f; }
.btn { display: block; text-align: center; padding: 15px; border-radius: 14px; background: #2f6b3a; color: #fff; font-weight: 600; margin-top: 12px; }
.btn.ghost { background: transparent; color: #2f6b3a; border: 1.5px solid #2f6b3a; }
.card { background: #fff; border-radius: 18px; padding: 14px; margin: 10px 0; box-shadow: 0 1px 2px #0000000f, 0 4px 14px #00000008; display: flex; gap: 12px; align-items: center; }
.thumb { width: 64px; height: 64px; border-radius: 12px; flex: none; }
.chip { display: inline-block; padding: 6px 12px; border-radius: 99px; background: #e4e9dc; font-size: 13px; margin: 0 6px 6px 0; }
.chip.on { background: #2f6b3a; color: #fff; }
.field { background: #fff; border: 1.5px solid #d5dccd; border-radius: 12px; padding: 14px; color: #8a947f; margin-top: 10px; }
.tabbar { position: absolute; bottom: 0; left: 0; right: 0; height: 84px; background: #fff; border-top: 1px solid #e3e6dc; display: flex; justify-content: space-around; padding-top: 12px; font-size: 12px; color: #8a947f; }
.tabbar .on { color: #2f6b3a; font-weight: 700; }
.tabbar i { display: block; width: 24px; height: 24px; border-radius: 7px; background: currentColor; margin: 0 auto 4px; opacity: .8; }
.hero { height: 300px; background: linear-gradient(160deg, #8fbf7a, #2f6b3a 70%); position: relative; }
.hero svg { position: absolute; bottom: 0; left: 0; }
.stats { display: flex; gap: 10px; margin: 14px 0; }
.stat { flex: 1; background: #fff; border-radius: 14px; padding: 12px; }
.stat b { display: block; font-size: 22px; }
.stat span { font-size: 12px; color: #66735f; }
.sheet { position: absolute; left: 0; right: 0; bottom: 0; background: #fff; border-radius: 24px 24px 0 0; padding: 12px 20px 40px; box-shadow: 0 -8px 30px #0000002a; }
.grab { width: 40px; height: 5px; border-radius: 3px; background: #d5dccd; margin: 0 auto 12px; }
.scrim { position: absolute; inset: 0; background: #0b140c66; }
.row { display: flex; justify-content: space-between; padding: 14px 0; border-bottom: 1px solid #e3e6dc; }
`;
const mountains = `<svg width="390" height="140" viewBox="0 0 390 140"><path d="M0 140 L70 60 L120 100 L190 20 L260 90 L310 50 L390 110 L390 140Z" fill="#1d4a27" opacity=".55"/><path d="M0 140 L90 95 L160 125 L240 70 L330 120 L390 100 L390 140Z" fill="#f6f5ef"/></svg>`;
const status = `<div class="status"><span>9:41</span><span>●●● ▮</span></div>`;
const tabbar = (on) => `<div class="tabbar">${['Trails', 'Map', 'You'].map((t) => `<div class="${t === on ? 'on' : ''}"><i></i>${t}</div>`).join('')}</div>`;
const trailCard = (name, km, meta, c1, c2) => `<div class="card"><div class="thumb" style="background:linear-gradient(135deg,${c1},${c2})"></div><div><b>${name}</b><div class="muted">${km} km · ${meta}</div></div></div>`;
const trailsList = `${status}<div class="pad"><h1>Trails near you</h1><div class="muted">Bern · 14 trails</div><div style="margin-top:14px"><span class="chip on">All</span><span class="chip">Easy</span><span class="chip">Lakes</span><span class="chip">Filters ▾</span></div>
${trailCard('Ridge Loop', '8.4', 'moderate · 2h 30', '#9cc58a', '#2f6b3a')}${trailCard('Lake Path', '5.1', 'easy · 1h 20', '#8ec5d6', '#2f6b8a')}${trailCard('Old Mill Trail', '11.2', 'hard · 4h', '#d6b98e', '#8a5a2f')}${trailCard('Beech Wood', '3.0', 'easy · 50 min', '#b5d68e', '#4f8a2f')}</div>`;
const trailDetail = `${status}<div class="hero">${mountains}</div><div class="pad" style="margin-top:-30px;position:relative"><h1>Ridge Loop</h1><div class="muted">Gurten, Bern · moderate</div>
<div class="stats"><div class="stat"><b>8.4 km</b><span>distance</span></div><div class="stat"><b>540 m</b><span>ascent</span></div><div class="stat"><b>2:30</b><span>time</span></div></div>
<p class="muted" style="margin:0">A loop over the ridge with views of the Alps on clear days. Dogs welcome.</p><div class="btn">Start hike</div><div class="btn ghost">Share</div></div>`;

// slug -> [[file, html], ...]
const SCREENS = {
  'auth--welcome': [['01-default.png', `${status}<div class="hero" style="height:470px">${mountains}</div><div class="pad"><h1>Find your next trail</h1><p class="muted">Hand-picked hikes near you, offline maps and your stats in one place.</p><div class="btn">Get started</div></div>`]],
  'auth--sign-in': [
    ['01-empty.png', `${status}<div class="pad"><h1 style="margin-top:40px">Sign in</h1><p class="muted">We'll email you a link, no password needed.</p><div class="field">Email</div><div class="btn" style="opacity:.45">Continue</div></div>`],
    ['02-invalid-email.png', `${status}<div class="pad"><h1 style="margin-top:40px">Sign in</h1><p class="muted">We'll email you a link, no password needed.</p><div class="field" style="color:#1d2a1f;border-color:#c2412d">sam@trailmix</div><div style="color:#c2412d;font-size:14px;margin-top:6px">Enter a full email address, like sam@example.com</div><div class="btn" style="opacity:.45">Continue</div></div>`],
  ],
  tabs: [['01-default.png', `${trailsList}${tabbar('Trails')}`]],
  'tabs--explore': [['01-default.png', `${status}<div style="position:absolute;inset:44px 0 84px;background:repeating-linear-gradient(35deg,#dfe8d3 0 18px,#e8efdd 18px 36px)"><svg width="390" height="716"><path d="M40 600 C120 480 90 380 200 330 S330 180 300 80" stroke="#2f6b3a" stroke-width="5" fill="none" stroke-dasharray="2 10" stroke-linecap="round"/><circle cx="200" cy="330" r="12" fill="#2f6b3a"/><circle cx="300" cy="80" r="9" fill="#c98500"/><circle cx="90" cy="250" r="9" fill="#2f6b8a"/></svg><div class="card" style="position:absolute;left:16px;right:16px;bottom:16px;margin:0"><div class="thumb" style="background:linear-gradient(135deg,#9cc58a,#2f6b3a)"></div><div><b>Ridge Loop</b><div class="muted">1.2 km away · 8.4 km</div></div></div></div>${tabbar('Map')}`]],
  'tabs--profile': [['01-default.png', `${status}<div class="pad"><div style="width:72px;height:72px;border-radius:50%;background:#c9d8bd;margin-top:16px"></div><h1>Sam</h1><div class="stats"><div class="stat"><b>12</b><span>hikes</span></div><div class="stat"><b>148 km</b><span>walked</span></div><div class="stat"><b>6.1k m</b><span>climbed</span></div></div><div class="row"><span>Past hikes</span><span class="muted">›</span></div><div class="row"><span>Saved trails</span><span class="muted">›</span></div><div class="row"><span>Settings</span><span class="muted">›</span></div></div>${tabbar('You')}`]],
  'trail--_id_': [
    ['01-default.png', trailDetail],
    ['02-share.png', `${trailDetail}<div class="scrim"></div><div class="sheet"><div class="grab"></div><b>Share Ridge Loop</b><div class="row"><span>Copy link</span></div><div class="row"><span>Messages</span></div><div class="row" style="border:0"><span>More…</span></div></div>`],
  ],
  'hike--_id_': [['01-default.png', `${status}<div style="position:absolute;inset:44px 0 260px;background:repeating-linear-gradient(35deg,#dfe8d3 0 18px,#e8efdd 18px 36px)"><svg width="390" height="540"><path d="M60 500 C120 400 160 380 200 300" stroke="#2f6b3a" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M200 300 C260 200 300 160 320 60" stroke="#2f6b3a" stroke-width="5" fill="none" stroke-dasharray="2 10" stroke-linecap="round" opacity=".5"/><circle cx="200" cy="300" r="11" fill="#fff" stroke="#2f6b3a" stroke-width="5"/></svg></div><div class="sheet" style="box-shadow:none"><div class="muted">Ridge Loop · recording</div><div class="stats"><div class="stat"><b>3.2 km</b><span>so far</span></div><div class="stat"><b>01:04</b><span>moving</span></div><div class="stat"><b>210 m</b><span>ascent</span></div></div><div class="btn" style="background:#c2412d">Finish hike</div></div>`]],
  'hike--summary': [['01-default.png', `${status}<div class="pad" style="text-align:center"><div style="font-size:64px;margin-top:70px">⛰</div><h1>Nice one!</h1><p class="muted">You finished Ridge Loop.</p><div class="stats" style="text-align:left"><div class="stat"><b>8.4 km</b><span>distance</span></div><div class="stat"><b>2:31</b><span>time</span></div><div class="stat"><b>540 m</b><span>ascent</span></div></div><div class="btn">Done</div></div>`]],
  'sheet--filter-sheet': [['01-default.png', `${trailsList}${tabbar('Trails')}<div class="scrim"></div><div class="sheet"><div class="grab"></div><b style="font-size:20px">Filters</b><h2>Difficulty</h2><span class="chip on">Easy</span><span class="chip on">Moderate</span><span class="chip">Hard</span><h2>Distance</h2><span class="chip">&lt; 5 km</span><span class="chip on">5–10 km</span><span class="chip">10 km +</span><h2>Extras</h2><span class="chip on">Dogs allowed</span><span class="chip">Lakes</span><span class="chip">Huts</span><div class="btn">Show 9 trails</div></div>`]],
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trailmix-'));
let n = 0;
for (const [slug, states] of Object.entries(SCREENS)) {
  const dir = path.join(OUT, slug);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, body] of states) {
    const html = path.join(tmp, `${slug}-${file}.html`);
    fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`);
    const r = spawnSync(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2', '--window-size=390,844', `--screenshot=${path.join(dir, file)}`, `file://${html}`], { stdio: 'ignore' });
    if (r.status !== 0) throw new Error(`chrome failed on ${slug}/${file}`);
    n++;
  }
}

// A clip across screens (trail -> hike -> summary) for the flows row.
const flows = path.join(OUT, '_flows');
fs.mkdirSync(flows, { recursive: true });
const frames = ['trail--_id_/01-default.png', 'hike--_id_/01-default.png', 'hike--summary/01-default.png'].map((f) => path.join(OUT, f));
const inputs = frames.flatMap((f) => ['-loop', '1', '-t', '2', '-i', f]);
const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', '[0][1]xfade=transition=slideleft:duration=0.4:offset=1.6[a];[a][2]xfade=transition=slideleft:duration=0.4:offset=3.2,scale=390:-2,format=yuv420p[v]', '-map', '[v]', '-c:v', 'libx264', '-crf', '28', '-movflags', '+faststart', path.join(flows, 'start-a-hike.mp4')], { stdio: 'inherit' });
if (r.status !== 0) console.warn('render: ffmpeg failed, no clip');
fs.writeFileSync(
  path.join(flows, 'flows.json'),
  JSON.stringify({ 'start-a-hike.mp4': { title: 'Start and finish a hike', group: 'root', screens: ['/trail/[id]', '/hike/[id]', '/hike/summary'] } }, null, 2) + '\n',
);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`rendered ${n} screenshots into ${path.relative(process.cwd(), OUT)}`);
