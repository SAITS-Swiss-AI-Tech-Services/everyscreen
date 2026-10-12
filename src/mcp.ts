// `everyscreen mcp`: the CLI's setup, build and capture commands as MCP tools
// (stdio), so an agent can set up a canvas and fill it with screenshots from
// a connected device, seeing the screen as it goes.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { captureMissing, captureScreen } from './capture/capture.ts';
import { dumpScreen, findElement, labelOf, listDevices, openLink, pickDevice, pressKey, screenshot, scroll, tap, typeText, KEYS } from './capture/device.ts';
import { buildBoard } from './core/build.mjs';
import { addCaptures } from './core/ingest.mjs';
import { initProject } from './core/init.ts';
import { scanApp } from './core/inventory.mjs';
import { defaultBoardId, findProject, findProjectDir, type Project } from './core/project.ts';
import { boardSummaries, fillLink, findScreen, readBoard, screenInfos } from './core/queries.ts';
import { type Server, startServer } from './server/http.ts';
import { VERSION } from './version.ts';

const INSTRUCTIONS = `everyscreen puts every screen of an Expo Router app on one canvas for review: routes and navigation come from the code, screenshots from a device.

Typical flow:
1. status: is there a .everyscreen/ project here? If not, init (in the app's root folder).
2. build_board: scans the code and creates or updates a canvas (one per release + device). Pass the device model when you know it.
3. list_devices, then capture_missing: opens every screen that has a deep link on the device and screenshots it.
4. list_screens with filter "missing" shows what's left. For each: if it needs route params, capture_screen with params (find real ids in the app's UI or code); if it has no deep link (sheets, dialogs, in-place screens), navigate there with device_open / device_tap / device_type / device_scroll, check with device_screenshot, then capture_screen with open_link false. reachedFrom names the screens that link to it.
5. Several states of one screen (empty, filled, error) are separate captures with a state label.
6. start_viewer gives a URL the user can open to review the canvas.

Notes: device actions only open links, read the screen, tap, swipe, type and press keys; nothing installs, uninstalls, clears data or reboots. iOS simulators support links and screenshots only. Prefer tapping by text; screenshot images are scaled down (the reply says how).`;

const text = (s: string) => ({ type: 'text' as const, text: s });
const json = (data: unknown) => text(JSON.stringify(data, null, 2));

/** PNG width/height from its header. */
const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

/** A smaller JPEG for the model to look at (ffmpeg), else the PNG itself. */
function preview(png: Buffer, width = 540) {
  const size = pngSize(png);
  if (size.width > width) {
    const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'png_pipe', '-i', 'pipe:0', '-vf', `scale=${width}:-2`, '-q:v', '5', '-f', 'mjpeg', 'pipe:1'], { input: png, maxBuffer: 32 * 1024 * 1024 });
    if (r.status === 0 && r.stdout.length) {
      const scale = size.width / width;
      return { image: { type: 'image' as const, data: r.stdout.toString('base64'), mimeType: 'image/jpeg' }, note: `Screen ${size.width}x${size.height}; image scaled to ${width}px wide: multiply image coordinates by ${scale.toFixed(3)} for device_tap x/y.` };
    }
  }
  return { image: { type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }, note: `Screen ${size.width}x${size.height} (image at full size).` };
}

export async function runMcp({ projectDir, uiDir }: { projectDir: string; uiDir: string }) {
  let root = path.resolve(projectDir);
  let viewer: Server | null = null;
  const project = (): Project => findProject(root);
  const board = (p: Project, id?: string) => id ?? defaultBoardId(p);

  const server = new McpServer({ name: 'everyscreen', version: VERSION }, { instructions: INSTRUCTIONS });

  // Every tool: errors become a readable tool error instead of a protocol error.
  type Content = ReturnType<typeof text> | ReturnType<typeof preview>['image'];
  const safe =
    <A,>(fn: (a: A) => Promise<Content[]> | Content[]) =>
    async (a: A) => {
      try {
        return { content: await fn(a) };
      } catch (e) {
        return { isError: true, content: [text((e as Error).message)] };
      }
    };

  const deviceArg = { device: z.string().optional().describe('Device id from list_devices; default: the only one connected') };
  const boardArg = { board: z.string().optional().describe('Canvas id; default: the only or most recently built one') };
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    'status',
    { title: 'Project status', description: 'Whether a .everyscreen/ project exists here, its config and canvases with capture progress. Start here.', inputSchema: {}, annotations: readOnly },
    safe(() => {
      const dir = findProjectDir(root);
      if (!dir) return [json({ project: null, lookedIn: root, next: 'init (in the app root, the folder with app/ and package.json)' })];
      const p = project();
      return [json({ project: p.dir, config: p.config, boards: boardSummaries(p), viewer: viewer?.url ?? null })];
    }),
  );

  server.registerTool(
    'init',
    {
      title: 'Set up a project',
      description: "Creates .everyscreen/config.json in the app's root, detecting name, routes folder, deep-link scheme and app id from app.json / app.config. Values given here win over detection.",
      inputSchema: {
        path: z.string().optional().describe("The app's root folder; default: the server's working folder"),
        name: z.string().optional(),
        scheme: z.string().optional().describe('Deep-link scheme, e.g. myapp://'),
        appId: z.string().optional().describe('Android package / iOS bundle id'),
        appDir: z.string().optional().describe('Routes folder inside the app, default app'),
        force: z.boolean().optional().describe('Overwrite an existing config.json'),
      },
    },
    safe((a) => {
      const r = initProject(a.path ? path.resolve(root, a.path) : root, { name: a.name, scheme: a.scheme, appId: a.appId, appDir: a.appDir }, { force: !!a.force });
      root = path.dirname(r.dir);
      return [json(r)];
    }),
  );

  server.registerTool(
    'scan',
    { title: 'Scan the code', description: 'Reads the routes and navigation calls without building a canvas. Reports screens per navigator, links, router calls it could not follow, broken links and unreachable screens.', inputSchema: {}, annotations: readOnly },
    safe(() => [json(scanApp(project()).report)]),
  );

  server.registerTool(
    'build_board',
    {
      title: 'Build a canvas',
      description: 'Scans the checked-out code and creates or updates a canvas (board) with the captures already filed. Device fields are remembered on later builds.',
      inputSchema: {
        ...boardArg,
        device: z.string().optional().describe('Device model shown on the canvas, e.g. "Pixel 8"'),
        os: z.string().optional(),
        resolution: z.string().optional().describe('e.g. 1080x2400'),
        title: z.string().optional(),
        force: z.boolean().optional().describe('Rebuild a board made from a different commit'),
      },
    },
    safe((a) => {
      const r = buildBoard(project(), { board: a.board, device: a.device, os: a.os, resolution: a.resolution, title: a.title, force: a.force });
      return [json({ ...r.summary, scan: r.report && { unresolved: r.report.unresolved.length, broken: r.report.broken, unreached: r.report.unreached.length, warnings: r.report.warnings } })];
    }),
  );

  server.registerTool(
    'list_screens',
    {
      title: 'List screens',
      description: 'Screens of a canvas with capture status (captured / mockup / missing), deep link, route params to fill in, source file, and reachedFrom (screens that link here).',
      inputSchema: { ...boardArg, filter: z.enum(['all', 'missing', 'captured']).optional().describe('default all') },
      annotations: readOnly,
    },
    safe((a) => {
      const p = project();
      const id = board(p, a.board);
      let s = screenInfos(readBoard(p, id));
      if (a.filter === 'missing') s = s.filter((x) => x.status !== 'captured');
      if (a.filter === 'captured') s = s.filter((x) => x.status === 'captured');
      return [json({ board: id, screens: s })];
    }),
  );

  server.registerTool(
    'list_devices',
    { title: 'List devices', description: 'Connected Android devices/emulators (adb) and booted iOS simulators.', inputSchema: {}, annotations: readOnly },
    safe(async () => [json({ devices: await listDevices() })]),
  );

  server.registerTool(
    'device_screenshot',
    { title: 'Look at the device', description: "Returns what's on the device screen now, as an image. Nothing is saved.", inputSchema: deviceArg, annotations: readOnly },
    safe(async (a) => {
      const pv = preview(await screenshot(await pickDevice(a.device)));
      return [pv.image, text(pv.note)];
    }),
  );

  server.registerTool(
    'device_elements',
    { title: 'Read the screen', description: 'Elements on the device screen (Android): text, description, id, tappable/editable, centre x/y in screen pixels.', inputSchema: deviceArg, annotations: readOnly },
    safe(async (a) => [json((await dumpScreen(await pickDevice(a.device))).map((e) => ({ label: labelOf(e), text: e.text || undefined, desc: e.desc || undefined, id: e.id || undefined, type: e.cls, tappable: e.clickable || undefined, editable: e.editable || undefined, focused: e.focused || undefined, x: e.x, y: e.y })))]),
  );

  server.registerTool(
    'device_tap',
    {
      title: 'Tap',
      description: 'Taps an element by its text/description/id (preferred), or a point in screen pixels (Android).',
      inputSchema: { ...deviceArg, text: z.string().optional(), nth: z.number().int().min(1).optional().describe('Which match, default 1'), x: z.number().int().optional(), y: z.number().int().optional() },
    },
    safe(async (a) => {
      const d = await pickDevice(a.device);
      if (a.text) {
        const el = await findElement(d, a.text, a.nth ?? 1);
        await tap(d, el.x, el.y);
        return [text(`tapped "${labelOf(el)}" at (${el.x},${el.y})`)];
      }
      if (a.x === undefined || a.y === undefined) throw new Error('give text, or x and y');
      await tap(d, a.x, a.y);
      return [text(`tapped (${a.x},${a.y})`)];
    }),
  );

  server.registerTool(
    'device_type',
    { title: 'Type text', description: 'Types into the focused field (tap it first). Plain ASCII only (Android).', inputSchema: { ...deviceArg, text: z.string() } },
    safe(async (a) => {
      await typeText(await pickDevice(a.device), a.text);
      return [text(`typed ${a.text.length} characters`)];
    }),
  );

  server.registerTool(
    'device_key',
    { title: 'Press a key', description: 'Presses a key (Android).', inputSchema: { ...deviceArg, key: z.enum(Object.keys(KEYS) as [string, ...string[]]) } },
    safe(async (a) => {
      await pressKey(await pickDevice(a.device), a.key);
      return [text(`pressed ${a.key}`)];
    }),
  );

  server.registerTool(
    'device_scroll',
    { title: 'Scroll', description: '"down" shows what is further down (Android).', inputSchema: { ...deviceArg, direction: z.enum(['up', 'down', 'left', 'right']) } },
    safe(async (a) => {
      await scroll(await pickDevice(a.device), a.direction);
      return [text(`scrolled ${a.direction}`)];
    }),
  );

  server.registerTool(
    'device_open',
    {
      title: 'Open a screen',
      description: "Opens a deep link on the device: a screen slug (uses the canvas's link, with params for [id]-style segments) or a full URL.",
      inputSchema: { ...deviceArg, ...boardArg, slug: z.string().optional(), url: z.string().optional(), params: z.record(z.string(), z.string()).optional().describe('Route params, e.g. {"id": "42"}') },
    },
    safe(async (a) => {
      const d = await pickDevice(a.device);
      let url = a.url;
      let appId: string | null = null;
      try {
        appId = project().config.appId;
      } catch {
        /* a bare URL works without a project */
      }
      if (!url) {
        if (!a.slug) throw new Error('give slug or url');
        const p = project();
        const s = findScreen(readBoard(p, board(p, a.board)), a.slug);
        if (!s.deepLink) throw new Error(`screen ${s.slug} has no deep link: navigate to it with taps`);
        url = fillLink(s.deepLink, a.params);
      }
      await openLink(d, url, appId);
      return [text(`opened ${url}`)];
    }),
  );

  server.registerTool(
    'capture_screen',
    {
      title: 'Capture a screen',
      description: 'Screenshots a screen onto the canvas: opens its deep link (unless open_link is false), waits until the screen stops changing, files the capture as a state of that screen and rebuilds the canvas. Returns the captured image.',
      inputSchema: {
        ...deviceArg,
        ...boardArg,
        slug: z.string().describe('Screen slug from list_screens'),
        params: z.record(z.string(), z.string()).optional().describe('Route params for the deep link, e.g. {"id": "42"}'),
        state: z.string().optional().describe('State label: default, empty, filled, error, ... (default "default")'),
        open_link: z.boolean().optional().describe('false: capture what is on screen now (after navigating there yourself)'),
        replace: z.boolean().optional().describe('Overwrite an existing capture of the same state'),
      },
    },
    safe(async (a) => {
      const p = project();
      const r = await captureScreen(p, await pickDevice(a.device), { board: board(p, a.board), slug: a.slug, params: a.params, state: a.state, link: a.open_link !== false, replace: a.replace });
      const pv = preview(r.png);
      const { png: _png, ...info } = r;
      return [json(info), pv.image];
    }),
  );

  server.registerTool(
    'capture_missing',
    {
      title: 'Capture all missing screens',
      description: 'Captures every screen without a capture that its deep link opens on its own. Returns what was captured, what failed, and what needs navigating by hand (route params, no deep link). Takes a few seconds per screen.',
      inputSchema: { ...deviceArg, ...boardArg },
    },
    safe(async (a) => {
      const p = project();
      return [json(await captureMissing(p, await pickDevice(a.device), { board: board(p, a.board) }))];
    }),
  );

  server.registerTool(
    'add_capture',
    {
      title: 'Add a capture file',
      description: 'Files an existing image or clip (png, jpg, webp, mp4, webm) as a state of a screen and rebuilds the canvas.',
      inputSchema: { ...boardArg, slug: z.string(), file: z.string().describe('Path to the file'), state: z.string().optional(), replace: z.boolean().optional() },
    },
    safe((a) => {
      const p = project();
      const id = board(p, a.board);
      const r = addCaptures(p, id, [{ file: path.resolve(root, a.file), slug: a.slug, state: a.state }], { replace: !!a.replace });
      if (r.unknown.length) throw new Error(`no screen "${a.slug}" on board "${id}"`);
      if (r.skipped.length) throw new Error(`not added: ${r.skipped[0].reason}`);
      return [json({ board: id, ...r })];
    }),
  );

  server.registerTool(
    'start_viewer',
    { title: 'Start the canvas viewer', description: 'Starts the web app for this project (if not running) and returns its URL for the user to open. It stops when the MCP server stops.', inputSchema: { port: z.number().int().optional().describe('Default 4173, or the next free one') } },
    safe(async (a) => {
      viewer ??= await startServer(project(), { uiDir, port: a.port ?? 4173 });
      return [text(viewer.url)];
    }),
  );

  await server.connect(new StdioServerTransport());
}
