// everyscreen: every screen of an Expo Router app on one reviewable canvas.
// See README.md, or `everyscreen help`.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { captureMissing, captureScreen } from './capture/capture.ts';
import { DeviceError, dumpScreen, findElement, labelOf, listDevices, openLink, pickDevice, pressKey, screenshot, scroll, tap, typeText } from './capture/device.ts';
import { buildBoard, BuildError } from './core/build.mjs';
import { addCaptures, ingestRun } from './core/ingest.mjs';
import { initProject } from './core/init.ts';
import { scanApp, ScanError } from './core/inventory.mjs';
import { defaultBoardId, findProject, type Project, UsageError } from './core/project.ts';
import { boardSummaries, fillLink, findScreen, readBoard, screenInfos } from './core/queries.ts';
import { startServer } from './server/http.ts';
import { VERSION } from './version.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const HELP = `everyscreen ${VERSION} by SAITS: every screen of an Expo Router app on one reviewable canvas

Usage: everyscreen <command> [options]

Set up
  init [dir]                 Set up .everyscreen/ in your app (detects name, scheme, app id)
  scan                       Scan routes and navigation; report what was found
  build                      Build or update a canvas from the checked-out code
                             --board <id> --device <model> --os <version> --resolution <WxH>
                             --title <text> --force (rebuild a board from another commit)
  boards                     List canvases
  screens                    List a canvas's screens with capture status (--missing)

Captures
  capture <slug>             Open the screen on a device via its deep link and screenshot it
                             --param <name=value> (route params) --state <label>
                             --no-link (screenshot what's on screen now) --replace
  capture --missing          Capture every screen without a capture that a deep link opens
  add <slug> <file>          Add a screenshot or clip you took yourself (--state, --replace)
  ingest <dir>               Add a folder of <slug>.png / <slug>--02-name.png files
  device list                Connected Android devices and booted iOS simulators
  device shot [file.png]     Screenshot whatever is on screen (not added to a canvas)
  device dump                What's on screen: text, ids, positions (Android)
  device tap <text>|<x> <y>  Tap an element by its text, or a point (--nth <n>)
  device type <text>         Type into the focused field
  device key <name>          back, home, enter, tab, escape, delete, up, down, left, right
  device scroll <direction>  up, down, left, right
  device open <url|slug>     Open a deep link (a screen slug uses the canvas's link)

Review
  serve                      Run the canvas web app (--port <n> --host <addr> --open)
  mcp                        Run as an MCP server for AI agents (stdio)

Options
  --board <id>     canvas to use (default: the only or most recently built one)
  --device <id>    device to use (default: the only one connected)
  --project <dir>  where to look for .everyscreen/ (default: current folder and parents)
  --json           machine-readable output (also for errors)
  -h, --help       this help;  -v, --version`;


const OPTIONS = {
  board: { type: 'string' },
  device: { type: 'string' },
  os: { type: 'string' },
  resolution: { type: 'string' },
  title: { type: 'string' },
  force: { type: 'boolean' },
  demo: { type: 'boolean' },
  missing: { type: 'boolean' },
  param: { type: 'string', multiple: true },
  state: { type: 'string' },
  'no-link': { type: 'boolean' },
  replace: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  nth: { type: 'string' },
  settle: { type: 'string' },
  port: { type: 'string' },
  host: { type: 'string' },
  open: { type: 'boolean' },
  name: { type: 'string' },
  scheme: { type: 'string' },
  'app-id': { type: 'string' },
  'app-dir': { type: 'string' },
  project: { type: 'string' },
  json: { type: 'boolean' },
  verbose: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

type Values = ReturnType<typeof parse>['values'];
const parse = (argv: string[]) => parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });

/** What a command returns: data for --json, and the same as text for people. */
interface Out {
  data: unknown;
  text: string;
}

const project = (v: Values): Project => findProject(v.project ?? process.cwd());
const boardOf = (p: Project, v: Values) => v.board ?? defaultBoardId(p);
const params = (v: Values) =>
  Object.fromEntries(
    (v.param ?? []).map((kv) => {
      const i = kv.indexOf('=');
      if (i < 1) throw new UsageError(`--param wants name=value, got "${kv}"`);
      return [kv.slice(0, i), kv.slice(i + 1)];
    }),
  );
const num = (s: string | undefined, what: string) => {
  if (s === undefined) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new UsageError(`${what} must be a number, got "${s}"`);
  return n;
};
const list = (xs: string[], indent = '  ') => xs.map((x) => indent + x).join('\n');
const deviceLine = (d: { model?: string | null; os?: string | null; resolution?: string | null } | null) => (d ? [d.model, d.os, d.resolution].filter(Boolean).join(', ') : 'no device set');

function buildText(s: ReturnType<typeof buildBoard>['summary']) {
  const lines = [
    `board "${s.board}" (${s.title})`,
    `  ${s.stats.screens} screens: ${s.stats.captured} captured, ${s.stats.mockupOnly} mockup only, ${s.placeholders} without a capture${s.stats.flows ? `; ${s.stats.flows} flow recording${s.stats.flows === 1 ? '' : 's'}` : ''}`,
    `  ${s.stats.edges} navigation links · device: ${deviceLine(s.device)}`,
  ];
  if (!s.ffmpeg) lines.push('  ffmpeg not found: no thumbnails or video posters');
  if (s.strayFolders.length) lines.push(`  capture folders with no matching screen: ${s.strayFolders.join(', ')}`);
  if (s.unknownFlowScreens.length) lines.push(`  flows.json lists unknown screens: ${s.unknownFlowScreens.join(', ')}`);
  for (const w of s.warnings) lines.push(`  warning: ${w}`);
  return lines.join('\n');
}

function scanText(r: ReturnType<typeof scanApp>['report'], verbose: boolean) {
  const lines = [`${path.relative(process.cwd(), r.source.path) || '.'} @ ${r.source.release ?? r.source.commit ?? 'no git'}${r.source.dirty ? ' (uncommitted changes)' : ''}`, '', 'Screens per navigator:'];
  for (const g of r.groups) lines.push(`  ${g.title.padEnd(28)} ${g.navigator.padEnd(10)} ${g.screens}`);
  lines.push('', `Links: ${r.edges.total} (${r.edges.certain} certain, ${r.edges.guessed} guessed, ${r.edges.inferred} inferred)`);
  if (r.unresolved.length) lines.push(`Router calls it couldn't follow: ${r.unresolved.length}${verbose ? '\n' + list(r.unresolved.map((u) => `${u.site}  ${u.call}`)) : ' (--verbose)'}`);
  if (r.broken.length) lines.push(`Links to routes that don't exist: ${r.broken.length}\n${list(r.broken.map((b) => `${b.site}  ${b.value}`))}`);
  if (r.unreached.length) lines.push(`Screens nothing links to: ${r.unreached.length}${verbose ? '\n' + list(r.unreached.map((u) => u.id)) : ' (--verbose)'}`);
  if (verbose && r.guessed.length) lines.push(`Guessed links:\n${list(r.guessed.map((g) => `${g.from} -> ${g.to}  @ ${g.site}`))}`);
  for (const w of r.warnings) lines.push(`warning: ${w}`);
  return lines.join('\n');
}

const STATUS_MARK = { captured: '●', mockup: '◐', missing: '○' } as const;

async function run(cmd: string, args: string[], v: Values): Promise<Out> {
  switch (cmd) {
    case 'init': {
      const r = initProject(args[0] ?? v.project ?? process.cwd(), { name: v.name, scheme: v.scheme, appId: v['app-id'], appDir: v['app-dir'] }, { force: !!v.force });
      const lines = [r.created ? `created ${path.relative(process.cwd(), r.configFile) || r.configFile}` : `already set up: ${r.configFile}`, `  name:   ${r.config.name}`, `  routes: ${r.config.appDir}`, `  scheme: ${r.config.scheme ?? '(none)'}`, `  app id: ${r.config.appId ?? '(none)'}`];
      for (const w of r.warnings) lines.push(`warning: ${w}`);
      if (r.created) lines.push('', 'Next: everyscreen build --device "<phone model>"   then   everyscreen serve');
      return { data: r, text: lines.join('\n') };
    }
    case 'scan': {
      const r = scanApp(project(v));
      return { data: r.report, text: scanText(r.report, !!v.verbose) };
    }
    case 'build': {
      const p = project(v);
      const r = buildBoard(p, { board: v.board, device: v.device, os: v.os, resolution: v.resolution, title: v.title, force: v.force, demo: v.demo });
      return { data: { ...r.summary, scan: r.report }, text: buildText(r.summary) + (r.report && (r.report.unresolved.length || r.report.broken.length) ? `\n  scan: ${r.report.unresolved.length} unfollowed router calls, ${r.report.broken.length} broken links (everyscreen scan --verbose)` : '') };
    }
    case 'boards': {
      const bs = boardSummaries(project(v));
      return { data: { boards: bs }, text: bs.length ? bs.map((b) => `${b.id.padEnd(28)} ${String(b.stats.captured).padStart(3)}/${b.stats.screens} captured   ${b.release ?? ''} ${deviceLine(b.device)}`).join('\n') : 'no boards yet: everyscreen build' };
    }
    case 'screens': {
      const p = project(v);
      const id = boardOf(p, v);
      let s = screenInfos(readBoard(p, id));
      if (v.missing) s = s.filter((x) => x.status !== 'captured');
      const counts = { captured: s.filter((x) => x.status === 'captured').length, mockup: s.filter((x) => x.status === 'mockup').length, missing: s.filter((x) => x.status === 'missing').length };
      const text = [`board "${id}"  ● captured ${counts.captured}  ◐ mockup ${counts.mockup}  ○ missing ${counts.missing}`, ...s.map((x) => `${STATUS_MARK[x.status]} ${x.slug.padEnd(34)} ${x.title.padEnd(26)} ${x.deepLink ?? `(${x.kind}, no link)`}`)].join('\n');
      return { data: { board: id, counts, screens: s }, text };
    }
    case 'add': {
      const [slug, file] = args;
      if (!slug || !file) throw new UsageError('usage: everyscreen add <slug> <file> [--state <label>] [--replace]');
      const p = project(v);
      const id = boardOf(p, v);
      const r = addCaptures(p, id, [{ file, slug, state: v.state }], { replace: !!v.replace });
      if (r.unknown.length) throw new UsageError(`no screen "${slug}" on board "${id}" (see \`everyscreen screens\`)`);
      if (r.skipped.length) throw new UsageError(`not added: ${r.skipped[0].reason}`);
      return { data: { board: id, ...r }, text: `added ${r.filed[0].file}` };
    }
    case 'ingest': {
      if (!args[0]) throw new UsageError('usage: everyscreen ingest <dir> [--replace] [--dry-run]');
      const p = project(v);
      const id = boardOf(p, v);
      const r = ingestRun(p, id, args[0], { replace: !!v.replace, dryRun: !!v['dry-run'] });
      const lines = [`${r.filed.length} file(s) ${v['dry-run'] ? 'would be added' : 'added'} to "${id}"`, list(r.filed.map((f) => f.file))];
      if (r.skipped.length) lines.push('skipped:', list(r.skipped.map((s) => `${path.basename(s.file)}: ${s.reason}`)));
      if (r.unknown.length) lines.push('no matching screen:', list(r.unknown.map((u) => path.basename(u.file))));
      return { data: { board: id, ...r }, text: lines.filter(Boolean).join('\n') };
    }
    case 'capture': {
      const p = project(v);
      const id = boardOf(p, v);
      const d = await pickDevice(v.device);
      if (v.missing) {
        const r = await captureMissing(p, d, { board: id, settleMs: num(v.settle, '--settle'), onProgress: v.json ? undefined : (m) => console.error(m) });
        const lines = [`captured ${r.captured.length}, failed ${r.failed.length}, need you ${r.needsHelp.length}`];
        if (r.failed.length) lines.push('failed:', list(r.failed.map((f) => `${f.slug}: ${f.error}`)));
        if (r.needsHelp.length) lines.push('open these on the device yourself, then `everyscreen capture <slug> --no-link`:', list(r.needsHelp.map((n) => `${n.slug}: ${n.reason}${n.reachedFrom.length ? ` (from ${n.reachedFrom.slice(0, 3).join(', ')})` : ''}`)));
        return { data: { board: id, device: d, ...r }, text: lines.join('\n') };
      }
      if (!args[0]) throw new UsageError('usage: everyscreen capture <slug> | --missing');
      const r = await captureScreen(p, d, { board: id, slug: args[0], params: params(v), state: v.state, link: !v['no-link'], settleMs: num(v.settle, '--settle'), replace: !!v.replace });
      if (!r.file) throw new UsageError(`not added: ${r.skipped}`);
      const { png: _png, ...data } = r;
      return { data: { board: id, device: d, ...data }, text: `added ${r.file}${r.settled ? '' : ' (the screen was still changing)'}` };
    }
    case 'device':
      return deviceCmd(args, v);
    case 'serve': {
      const p = project(v);
      const s = await startServer(p, { uiDir: path.join(HERE, 'ui'), host: v.host, port: num(v.port, '--port') });
      if (v.open) openBrowser(s.url);
      // runs until stopped
      return { data: { url: s.url, project: p.dir }, text: `everyscreen: ${s.url}  (${p.config.name}; Ctrl+C to stop)` };
    }
    default:
      throw new UsageError(`unknown command "${cmd}" (everyscreen help)`);
  }
}

async function deviceCmd([sub, ...rest]: string[], v: Values): Promise<Out> {
  if (sub === 'list' || !sub) {
    const ds = await listDevices();
    return { data: { devices: ds }, text: ds.length ? ds.map((d) => `${d.id.padEnd(26)} ${d.platform.padEnd(8)} ${d.state.padEnd(12)} ${d.name}`).join('\n') : 'no devices: connect an Android phone with USB debugging, start an emulator, or boot an iOS simulator' };
  }
  const d = await pickDevice(v.device);
  switch (sub) {
    case 'shot': {
      const file = path.resolve(rest[0] ?? `screen-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
      const png = await screenshot(d);
      fs.writeFileSync(file, png);
      return { data: { file, bytes: png.length }, text: `saved ${file}` };
    }
    case 'dump': {
      const els = await dumpScreen(d);
      return { data: { elements: els }, text: els.map((e, i) => `${String(i).padStart(3)} ${e.clickable ? 'T' : '-'}${e.editable ? 'E' : '-'}${e.focused ? 'F' : '-'} (${String(e.x).padStart(4)},${String(e.y).padStart(4)}) ${e.cls.slice(0, 14).padEnd(14)} ${JSON.stringify(labelOf(e).slice(0, 70))}`).join('\n') };
    }
    case 'tap': {
      if (rest.length === 2 && rest.every((r) => /^\d+$/.test(r))) {
        await tap(d, Number(rest[0]), Number(rest[1]));
        return { data: { x: Number(rest[0]), y: Number(rest[1]) }, text: `tapped (${rest[0]},${rest[1]})` };
      }
      if (!rest[0]) throw new UsageError('usage: everyscreen device tap <text> | <x> <y>');
      const el = await findElement(d, rest.join(' '), num(v.nth, '--nth') ?? 1);
      await tap(d, el.x, el.y);
      return { data: { tapped: el }, text: `tapped ${JSON.stringify(labelOf(el))} at (${el.x},${el.y})` };
    }
    case 'type':
      if (!rest.length) throw new UsageError('usage: everyscreen device type <text>');
      await typeText(d, rest.join(' '));
      return { data: { typed: rest.join(' ').length }, text: `typed ${rest.join(' ').length} characters` };
    case 'key':
      await pressKey(d, rest[0] ?? '');
      return { data: { key: rest[0] }, text: `pressed ${rest[0]}` };
    case 'scroll':
      await scroll(d, (rest[0] ?? 'down') as 'down');
      return { data: { scrolled: rest[0] ?? 'down' }, text: `scrolled ${rest[0] ?? 'down'}` };
    case 'open': {
      if (!rest[0]) throw new UsageError('usage: everyscreen device open <url|slug> [--param name=value]');
      let url = rest[0];
      let appId: string | null = null;
      if (!url.includes('://')) {
        const p = project(v);
        const s = findScreen(readBoard(p, boardOf(p, v)), url);
        if (!s.deepLink) throw new UsageError(`screen ${s.slug} has no deep link`);
        url = fillLink(s.deepLink, params(v));
        appId = p.config.appId;
      } else {
        try {
          appId = project(v).config.appId;
        } catch {
          /* a bare URL works without a project */
        }
      }
      await openLink(d, url, appId);
      return { data: { opened: url }, text: `opened ${url}` };
    }
    default:
      throw new UsageError(`unknown device command "${sub}" (list, shot, dump, tap, type, key, scroll, open)`);
  }
}

function openBrowser(url: string) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args as string[], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    /* no browser: the URL is printed */
  }
}

export async function main(argv = process.argv.slice(2)) {
  let v: Values;
  let positionals: string[];
  const wantsJson = argv.includes('--json');
  try {
    ({ values: v, positionals } = parse(argv));
  } catch (e) {
    return fail(new UsageError((e as Error).message), wantsJson);
  }
  if (v.version) return void console.log(VERSION);
  const [cmd, ...args] = positionals;
  if (!cmd || cmd === 'help' || v.help) return void console.log(HELP);
  if (cmd === 'mcp') {
    const { runMcp } = await import('./mcp.ts');
    return runMcp({ projectDir: v.project ?? process.cwd(), uiDir: path.join(HERE, 'ui') });
  }
  try {
    const out = await run(cmd, args, v);
    console.log(v.json ? JSON.stringify(out.data, null, 2) : out.text);
  } catch (e) {
    fail(e, !!v.json);
  }
}

function fail(e: unknown, json: boolean) {
  const known = e instanceof UsageError || e instanceof DeviceError || e instanceof BuildError || e instanceof ScanError;
  const kind = e instanceof UsageError ? 'usage' : e instanceof DeviceError ? 'device' : e instanceof BuildError || e instanceof ScanError ? 'project' : 'internal';
  const message = e instanceof Error ? e.message : String(e);
  if (json) console.log(JSON.stringify({ error: message, kind }, null, 2));
  else console.error(`everyscreen: ${message}`);
  if (!known && !json && process.env.DEBUG) console.error(e);
  process.exitCode = kind === 'usage' ? 2 : 1;
}

main();
