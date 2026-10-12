// A everyscreen project: the .everyscreen/ folder inside an app's repo.
//
//   .everyscreen/
//     config.json          settings (see Config)
//     boards/<id>/         one canvas: board.json + screens/<slug>/ captures
//     data/board.sqlite    comments and issues (not committed)
//     thumbs/              generated thumbnails (not committed)

import fs from 'node:fs';
import path from 'node:path';

export const DIR_NAME = '.everyscreen';

export interface Config {
  /** Shown in the header, tab titles and CSV file names. */
  name: string;
  /** The app's repo (the folder with the routes folder), relative to .everyscreen/. */
  source: string;
  /** The Expo Router routes folder inside `source`. */
  appDir: string;
  /** "owner/name" on GitHub, for links to code; default: the origin remote. */
  repo: string | null;
  /** Deep-link scheme, e.g. "myapp://". */
  scheme: string | null;
  /** Android application id / iOS bundle id, for deep links during capture. */
  appId: string | null;
  skipDirs: string[];
  groupTitles: Record<string, string>;
  titles: Record<string, string>;
  sheets: { dir: string; skip: string[] } | false;
  inPlace: { file: string; title?: string; parent?: string; calls?: string[] } | null;
}

export const DEFAULTS: Config = {
  name: 'My app',
  source: '..',
  appDir: 'app',
  repo: null,
  scheme: null,
  appId: null,
  skipDirs: [],
  groupTitles: {},
  titles: {},
  sheets: { dir: 'components', skip: [] },
  inPlace: null,
};

export interface Project {
  /** The .everyscreen folder. */
  dir: string;
  configFile: string;
  config: Config;
  /** Absolute path of the app's source. */
  source: string;
  boardsDir: string;
  thumbsDir: string;
  dbFile: string;
}

export class UsageError extends Error {}

export function readConfig(file: string): Config {
  let raw: Partial<Config> = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new UsageError(`${file}: ${(e as Error).message}`);
  }
  const cfg: Config = { ...DEFAULTS, ...raw };
  if (cfg.sheets !== false) cfg.sheets = { ...(DEFAULTS.sheets as { dir: string; skip: string[] }), ...(cfg.sheets ?? {}) };
  if (cfg.scheme && !cfg.scheme.includes('://')) cfg.scheme += '://';
  return cfg;
}

export function projectAt(dir: string): Project {
  const configFile = path.join(dir, 'config.json');
  const config = readConfig(configFile);
  return {
    dir,
    configFile,
    config,
    source: path.resolve(dir, config.source),
    boardsDir: path.join(dir, 'boards'),
    thumbsDir: path.join(dir, 'thumbs'),
    dbFile: process.env.EVERYSCREEN_DB ?? path.join(dir, 'data', 'board.sqlite'),
  };
}

/** The .everyscreen folder in `from` or the nearest parent, or null. */
export function findProjectDir(from: string): string | null {
  let d = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(d, DIR_NAME, 'config.json'))) return path.join(d, DIR_NAME);
    if (path.basename(d) === DIR_NAME && fs.existsSync(path.join(d, 'config.json'))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

export function findProject(from: string): Project {
  const dir = findProjectDir(from);
  if (!dir) throw new UsageError(`no ${DIR_NAME}/ found in ${path.resolve(from)} or its parents: run \`everyscreen init\` in your app's folder first`);
  return projectAt(dir);
}

export const BOARD_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

export function boardFile(p: Project, id: string) {
  if (!BOARD_ID.test(id)) throw new UsageError(`bad board id "${id}": letters, digits, . _ - only`);
  return path.join(p.boardsDir, id, 'board.json');
}

export function listBoardIds(p: Project): string[] {
  if (!fs.existsSync(p.boardsDir)) return [];
  return fs
    .readdirSync(p.boardsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && BOARD_ID.test(d.name) && fs.existsSync(path.join(p.boardsDir, d.name, 'board.json')))
    .map((d) => d.name)
    .sort();
}

/** The board to use when none is given: the only one, else the newest built. */
export function defaultBoardId(p: Project): string {
  const ids = listBoardIds(p);
  if (!ids.length) throw new UsageError('no boards yet: run `everyscreen build` first');
  if (ids.length === 1) return ids[0];
  const mtime = (id: string) => fs.statSync(boardFile(p, id)).mtimeMs;
  return ids.sort((a, b) => mtime(b) - mtime(a))[0];
}
