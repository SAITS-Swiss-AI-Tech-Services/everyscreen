// Devices to capture from: Android (adb) phones and emulators, and booted iOS
// simulators (xcrun simctl, macOS only).
//
// Safe by construction: this module builds every adb/simctl command itself
// and only knows how to list devices, open a link, take a screenshot, read
// the screen, tap, swipe, type and press keys. There is no way through it to
// install, uninstall, clear app data, delete files or reboot, so an agent
// driving someone's own phone can't do those either.
//
// adb is found on PATH (or $ADB); ADB_SERVER_SOCKET / ANDROID_ADB_SERVER_PORT
// work as usual, e.g. for a phone on another machine reached over ssh -R.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UsageError } from '../core/project.ts';

export type Platform = 'android' | 'ios';
export interface Device {
  id: string;
  platform: Platform;
  name: string;
  state: string;
}
export interface Element {
  text: string;
  desc: string;
  id: string;
  cls: string;
  clickable: boolean;
  editable: boolean;
  focused: boolean;
  /** centre, in screen pixels */
  x: number;
  y: number;
  bounds: [number, number, number, number];
}

export class DeviceError extends Error {}

const ADB = process.env.ADB ?? 'adb';

function run(cmd: string, args: string[], { timeout = 30_000, binary = false } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }, (err, stdout, stderr) => {
      if (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'ENOENT') return reject(new DeviceError(`${cmd} not found: install ${cmd === 'xcrun' ? 'Xcode' : 'Android platform-tools'} or put it on PATH`));
        const msg = stderr.toString().trim() || e.message;
        return reject(new DeviceError(`${cmd} ${args.slice(0, 4).join(' ')}: ${msg.split('\n').slice(-3).join(' ')}`));
      }
      resolve(binary ? stdout : stdout);
    });
  });
}

// ------------------------------------------------------------------ list

async function androidDevices(): Promise<Device[]> {
  let out: string;
  try {
    out = (await run(ADB, ['devices', '-l'], { timeout: 15_000 })).toString();
  } catch (e) {
    if (e instanceof DeviceError && /not found/.test(e.message)) return [];
    throw e;
  }
  return out
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [id, state, ...rest] = l.split(/\s+/);
      const model = rest.find((r) => r.startsWith('model:'))?.slice(6).replace(/_/g, ' ');
      return { id, platform: 'android' as const, name: model ?? id, state };
    });
}

async function iosSimulators(): Promise<Device[]> {
  if (process.platform !== 'darwin') return [];
  try {
    const j = JSON.parse((await run('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], { timeout: 15_000 })).toString()) as { devices: Record<string, { udid: string; name: string; state: string }[]> };
    return Object.entries(j.devices).flatMap(([runtime, ds]) =>
      ds.map((d) => ({ id: d.udid, platform: 'ios' as const, name: `${d.name} (${runtime.split('.').pop()?.replace(/-/g, ' ')})`, state: d.state.toLowerCase() })),
    );
  } catch {
    return [];
  }
}

export async function listDevices(): Promise<Device[]> {
  const [a, i] = await Promise.all([androidDevices(), iosSimulators()]);
  return [...a, ...i];
}

/** The device with this id (or name), else the only usable one. */
export async function pickDevice(id?: string | null): Promise<Device> {
  const all = await listDevices();
  const usable = all.filter((d) => d.state === 'device' || d.state === 'booted');
  const want = id ?? process.env.ANDROID_SERIAL ?? null;
  if (want) {
    const d = all.find((x) => x.id === want || x.name === want);
    if (!d) throw new UsageError(`no device "${want}" (connected: ${all.map((x) => `${x.id} ${x.name}`).join(', ') || 'none'})`);
    if (!usable.includes(d)) throw new DeviceError(`device ${d.id} is ${d.state}${d.state === 'unauthorized' ? ': accept the USB debugging prompt on the phone' : ''}`);
    return d;
  }
  if (usable.length === 1) return usable[0];
  if (!usable.length) {
    const hint = all.length ? ` (${all.map((d) => `${d.id}: ${d.state}`).join(', ')})` : '';
    throw new DeviceError(`no device ready${hint}: connect an Android phone with USB debugging, start an emulator, or boot an iOS simulator`);
  }
  throw new UsageError(`several devices connected, pick one with --device: ${usable.map((d) => `${d.id} (${d.name})`).join(', ')}`);
}

// ------------------------------------------------------------------ actions

const adb = (d: Device, args: string[], opts?: { timeout?: number; binary?: boolean }) => run(ADB, ['-s', d.id, ...args], opts);
const iosOnlyLinksAndShots = (what: string) => new DeviceError(`${what} isn't supported on iOS simulators (only opening links and screenshots are); navigate in the simulator yourself`);

export async function openLink(d: Device, url: string, appId?: string | null) {
  if (!/^[a-z][a-z0-9+.-]*:\/\/\S*$/i.test(url)) throw new UsageError(`not a deep link: ${url}`);
  if (d.platform === 'ios') {
    await run('xcrun', ['simctl', 'openurl', d.id, url]);
    return;
  }
  // adb shell joins its arguments into one shell command: quote the URL
  const quoted = `'${url.replace(/'/g, `'\\''`)}'`;
  const args = ['shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', quoted];
  if (appId) {
    if (!/^[A-Za-z][\w.]*$/.test(appId)) throw new UsageError(`bad app id ${appId}`);
    args.push(appId);
  }
  const out = (await adb(d, args)).toString();
  if (/Error:|Activity not started, unable to resolve/i.test(out)) throw new DeviceError(`could not open ${url}: ${out.trim().split('\n').pop()}${appId ? ` (is ${appId} installed and does it handle this scheme?)` : ''}`);
}

export async function screenshot(d: Device): Promise<Buffer> {
  if (d.platform === 'ios') {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'everyscreen-')), 'shot.png');
    try {
      await run('xcrun', ['simctl', 'io', d.id, 'screenshot', '--type=png', tmp]);
      return fs.readFileSync(tmp);
    } finally {
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
  }
  const png = await adb(d, ['exec-out', 'screencap', '-p'], { binary: true });
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new DeviceError('screencap returned no PNG (is the screen on and unlocked?)');
  return png;
}

/**
 * Screenshot once the screen stops changing: two identical captures in a
 * row, or the last one after timeoutMs (spinners and video never settle).
 */
export async function settledScreenshot(d: Device, { timeoutMs = 4000, minWaitMs = 600 } = {}): Promise<{ png: Buffer; settled: boolean }> {
  await sleep(minWaitMs);
  const end = Date.now() + timeoutMs;
  let prev = await screenshot(d);
  while (Date.now() < end) {
    await sleep(400);
    const next = await screenshot(d);
    if (next.equals(prev)) return { png: next, settled: true };
    prev = next;
  }
  return { png: prev, settled: false };
}

const decode = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => (e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'" : String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))));

/** What's on screen (Android): every element with text, a description, an id, or that takes taps/input. */
export async function dumpScreen(d: Device): Promise<Element[]> {
  if (d.platform === 'ios') throw iosOnlyLinksAndShots('Reading the screen');
  // streamed to stdout: nothing is written on the device
  const raw = (await adb(d, ['exec-out', 'uiautomator', 'dump', '/dev/tty'], { timeout: 30_000 })).toString();
  const xml = raw.slice(raw.indexOf('<?xml'), raw.lastIndexOf('</hierarchy>') + 12);
  if (!xml.startsWith('<?xml')) throw new DeviceError(`no screen dump (is the screen on?): ${raw.slice(-200).trim()}`);
  const out: Element[] = [];
  for (const m of xml.matchAll(/<node\b([^>]*?)\/?>/g)) {
    const a: Record<string, string> = {};
    for (const am of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) a[am[1]] = decode(am[2]);
    const b = (a.bounds ?? '').match(/\d+/g)?.map(Number);
    if (!b || b.length !== 4 || b[2] <= b[0] || b[3] <= b[1]) continue;
    const el: Element = {
      text: (a.text ?? '').trim(),
      desc: (a['content-desc'] ?? '').trim(),
      id: (a['resource-id'] ?? '').trim(),
      cls: (a.class ?? '').split('.').pop() ?? '',
      clickable: a.clickable === 'true',
      editable: (a.class ?? '').includes('EditText'),
      focused: a.focused === 'true',
      x: Math.round((b[0] + b[2]) / 2),
      y: Math.round((b[1] + b[3]) / 2),
      bounds: [b[0], b[1], b[2], b[3]],
    };
    if (el.text || el.desc || el.id || el.clickable || el.editable) out.push(el);
  }
  return out;
}

export const labelOf = (e: Element) => e.text || e.desc || e.id;

/** The element matching query (exact text/description/id first, then contains). */
export async function findElement(d: Device, query: string, nth = 1): Promise<Element> {
  const els = await dumpScreen(d);
  const q = query.toLowerCase();
  const exact = els.filter((e) => [e.text, e.desc, e.id].some((v) => v.toLowerCase() === q));
  const partial = els.filter((e) => `${e.text} ${e.desc} ${e.id}`.toLowerCase().includes(q));
  const hits = exact.length ? exact : partial;
  if (!hits.length) throw new DeviceError(`nothing on screen matches "${query}" (see \`everyscreen device dump\`)`);
  if (nth < 1 || nth > hits.length) throw new UsageError(`only ${hits.length} match(es) for "${query}"`);
  return hits[nth - 1];
}

const int = (v: number, what: string) => {
  if (!Number.isInteger(v) || v < 0 || v > 20000) throw new UsageError(`bad ${what}: ${v}`);
  return String(v);
};

export async function tap(d: Device, x: number, y: number) {
  if (d.platform === 'ios') throw iosOnlyLinksAndShots('Tapping');
  await adb(d, ['shell', 'input', 'tap', int(x, 'x'), int(y, 'y')]);
}

export async function screenSize(d: Device): Promise<{ width: number; height: number }> {
  if (d.platform === 'ios') throw iosOnlyLinksAndShots('Swiping');
  const out = (await adb(d, ['shell', 'wm', 'size'])).toString();
  const m = [...out.matchAll(/(\d+)x(\d+)/g)].pop();
  if (!m) throw new DeviceError(`can't read the screen size: ${out.trim()}`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** Scroll the content: "down" shows what's further down (finger moves up). */
export async function scroll(d: Device, direction: 'up' | 'down' | 'left' | 'right', amount = 0.6) {
  const { width: w, height: h } = await screenSize(d);
  const f = Math.min(Math.max(amount, 0.1), 0.9) / 2;
  const [cx, cy] = [Math.round(w / 2), Math.round(h / 2)];
  const dy = Math.round(h * f);
  const dx = Math.round(w * f);
  const v = { down: [cx, cy + dy, cx, cy - dy], up: [cx, cy - dy, cx, cy + dy], right: [cx + dx, cy, cx - dx, cy], left: [cx - dx, cy, cx + dx, cy] }[direction];
  if (!v) throw new UsageError(`direction must be up, down, left or right`);
  await adb(d, ['shell', 'input', 'swipe', ...v.map((n) => String(n)), '300']);
}

export async function typeText(d: Device, text: string) {
  if (d.platform === 'ios') throw iosOnlyLinksAndShots('Typing');
  if (/[^\x20-\x7e]/.test(text)) throw new UsageError('adb can only type plain ASCII text');
  // `input text`: spaces as %s, shell-special characters escaped
  const safe = [...text].map((c) => (c === ' ' ? '%s' : '()<>|;&*\\~"\'`$#?[]{}!'.includes(c) ? '\\' + c : c)).join('');
  await adb(d, ['shell', 'input', 'text', safe]);
}

export const KEYS: Record<string, string> = { back: '4', home: '3', enter: '66', tab: '61', escape: '111', delete: '67', up: '19', down: '20', left: '21', right: '22' };

export async function pressKey(d: Device, name: string) {
  if (d.platform === 'ios') throw iosOnlyLinksAndShots('Pressing keys');
  const code = KEYS[name];
  if (!code) throw new UsageError(`unknown key "${name}" (${Object.keys(KEYS).join(', ')})`);
  await adb(d, ['shell', 'input', 'keyevent', code]);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
