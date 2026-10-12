// End-to-end tests of the built CLI (npm run build first) on a copy of the
// Trailmix example, with a pretend Android phone (fixtures/fake-adb).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'cli.js');
const SHOT = path.join(ROOT, 'examples/trailmix/.everyscreen/boards/demo/screens/tabs/01-default.png');
let tmp, app, adbDir;

const sb = (args, opts = {}) => {
  const r = spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd: opts.cwd ?? app, encoding: 'utf8', env: { ...process.env, ADB: path.join(ROOT, 'test/fixtures/fake-adb'), FAKE_ADB_DIR: adbDir, FAKE_ADB_SCREEN: SHOT } });
  return { code: r.status, data: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr };
};

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'everyscreen-test-'));
  app = path.join(tmp, 'app');
  adbDir = path.join(tmp, 'adb');
  fs.mkdirSync(adbDir);
  fs.cpSync(path.join(ROOT, 'examples/trailmix'), app, { recursive: true, filter: (f) => !f.includes('.everyscreen') && !f.includes('mockups') });
  const appJson = path.join(app, 'app.json');
  const j = JSON.parse(fs.readFileSync(appJson, 'utf8'));
  j.expo.android = { package: 'com.example.trailmix' };
  fs.writeFileSync(appJson, JSON.stringify(j));
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('init detects name, scheme and app id', () => {
  const r = sb(['init']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.data.created, true);
  assert.equal(r.data.config.name, 'Trailmix');
  assert.equal(r.data.config.scheme, 'trailmix://');
  assert.equal(r.data.config.appId, 'com.example.trailmix');
  assert.ok(fs.existsSync(path.join(app, '.everyscreen/.gitignore')));
  assert.equal(sb(['init']).data.created, false);
});

test('scan finds screens and links', () => {
  const r = sb(['scan']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.data.routeFiles, 11);
  assert.equal(r.data.edges.total, 16);
  assert.deepEqual(r.data.unreached.map((u) => u.id), ['/+not-found']);
});

test('build makes a board; commands find the project from a subfolder', () => {
  const r = sb(['build', '--device', 'Pixel 8']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.data.board, 'current');
  assert.equal(r.data.stats.screens, 13);
  const s = sb(['screens', '--missing'], { cwd: path.join(app, 'app') });
  assert.equal(s.data.counts.missing, 13);
});

test('capture opens the deep link and files the screenshot', () => {
  const r = sb(['capture', 'settings']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.data.file, 'boards/current/screens/settings/01-default.png');
  assert.equal(fs.readFileSync(path.join(adbDir, 'url'), 'utf8').trim(), 'trailmix://settings');
  assert.match(fs.readFileSync(path.join(adbDir, 'calls.log'), 'utf8'), /am start .* 'trailmix:\/\/settings' com\.example\.trailmix/);
  // the same state again is refused before the device is touched
  const again = sb(['capture', 'settings']);
  assert.equal(again.code, 2);
  assert.match(again.data.error, /already exists/);
  // a second state
  assert.equal(sb(['capture', 'settings', '--state', 'Dark mode']).data.file, 'boards/current/screens/settings/02-dark-mode.png');
});

test('capture fills route params, and needs them', () => {
  assert.match(sb(['capture', 'trail--_id_']).data.error, /--param id=/);
  const r = sb(['capture', 'trail--_id_', '--param', 'id=ridge loop']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.data.link, 'trailmix://trail/ridge%20loop');
});

test('capture --missing does what deep links can and lists the rest', () => {
  const r = sb(['capture', '--missing']);
  assert.equal(r.code, 0, r.stderr);
  // 7 routes a deep link opens on its own (settings and trail were captured above)
  assert.equal(r.data.captured.length, 7, JSON.stringify(r.data.failed));
  assert.deepEqual(r.data.needsHelp.map((n) => n.slug).sort(), ['hike--_id_', 'sheet--filter-sheet', 'sheet--share-sheet']);
});

/** A solid black RGBA PNG, like a screencap of a FLAG_SECURE screen. */
function blackPng(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([len, Buffer.from(type), data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 4).fill(Buffer.from([0, 0, 0, 255]))]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('a black screenshot (FLAG_SECURE) is not filed', () => {
  const f = path.join(tmp, 'black.png');
  fs.writeFileSync(f, blackPng(1080, 2400));
  assert.ok(fs.statSync(f).size > 1000);
  const r = sb(['add', 'hike--history', f, '--state', 'secure']);
  assert.equal(r.code, 2);
  assert.match(r.data.error, /all black/);
});

test('add and ingest file existing images', () => {
  const run = path.join(tmp, 'run');
  fs.mkdirSync(path.join(run, 'nested'), { recursive: true });
  fs.copyFileSync(SHOT, path.join(run, 'nested', 'sheet--share-sheet.png'));
  fs.copyFileSync(SHOT, path.join(run, 'no-such-screen.png'));
  fs.writeFileSync(path.join(run, 'hike--_id_.png'), Buffer.alloc(10));
  const r = sb(['ingest', run]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.data.filed.map((f) => f.slug), ['sheet--share-sheet']);
  assert.equal(r.data.unknown.length, 1);
  assert.match(r.data.skipped[0].reason, /empty/);
  const a = sb(['add', 'sheet--filter-sheet', SHOT, '--state', 'open']);
  assert.equal(a.code, 0, a.stderr);
});

test('device commands only send known adb commands', () => {
  assert.equal(sb(['device', 'tap', 'ridge']).data.tapped.y, 453);
  sb(['device', 'type', 'a b; rm -rf /']);
  assert.equal(sb(['device', 'key', 'reboot']).code, 2);
  const calls = fs.readFileSync(path.join(adbDir, 'calls.log'), 'utf8');
  assert.ok(calls.includes('input text a%sb\\;%srm%s-rf%s/'), calls);
  for (const bad of ['uninstall', 'pm clear', 'reboot', ' rm ', 'install ']) assert.ok(!calls.includes(bad), bad);
});

test('errors are JSON with a kind and exit code', () => {
  const r = sb(['screens'], { cwd: tmp });
  assert.equal(r.code, 2);
  assert.match(r.data.error, /everyscreen init/);
  assert.equal(sb(['frobnicate']).data.kind, 'usage');
});

test('mcp server lists its tools', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const c = new Client({ name: 'test', version: '1' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, 'mcp'], cwd: app, env: { ...process.env, ADB: path.join(ROOT, 'test/fixtures/fake-adb'), FAKE_ADB_DIR: adbDir, FAKE_ADB_SCREEN: SHOT } }));
  try {
    const names = (await c.listTools()).tools.map((t) => t.name);
    for (const n of ['status', 'init', 'build_board', 'list_screens', 'capture_screen', 'capture_missing', 'device_screenshot']) assert.ok(names.includes(n), n);
    const shot = await c.callTool({ name: 'device_screenshot', arguments: {} });
    assert.equal(shot.content[0].type, 'image');
    const bad = await c.callTool({ name: 'capture_screen', arguments: { slug: 'nope' } });
    assert.equal(bad.isError, true);
  } finally {
    await c.close();
  }
});
