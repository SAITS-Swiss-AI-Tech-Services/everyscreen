// `everyscreen init`: finds the Expo Router app in a folder and writes
// .everyscreen/config.json with what it could detect.

import fs from 'node:fs';
import path from 'node:path';
import { type Config, DEFAULTS, DIR_NAME, UsageError } from './project.ts';

export interface Detected {
  appDir: string | null;
  name: string | null;
  scheme: string | null;
  appId: string | null;
  expoRouter: boolean;
}

const readJson = (f: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

export function detectApp(root: string): Detected {
  const pkg = readJson(path.join(root, 'package.json')) as { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null;
  const expoRouter = !!(pkg?.dependencies?.['expo-router'] ?? pkg?.devDependencies?.['expo-router']);
  const appDir = ['app', 'src/app'].find((d) => fs.existsSync(path.join(root, d)) && fs.readdirSync(path.join(root, d)).some((f) => /^_layout\.(tsx?|jsx?)$/.test(f) || /\.(tsx?|jsx?)$/.test(f))) ?? null;

  const appJson = readJson(path.join(root, 'app.json')) as { expo?: Record<string, unknown> } | null;
  const expo = appJson?.expo ?? null;
  let name = str(expo?.name);
  const schemeRaw = expo?.scheme;
  let scheme = Array.isArray(schemeRaw) ? str(schemeRaw[0]) : str(schemeRaw);
  let appId = str((expo?.android as Record<string, unknown> | undefined)?.package) ?? str((expo?.ios as Record<string, unknown> | undefined)?.bundleIdentifier);
  // app.config.(ts|js): best effort, literal values only
  const dyn = ['app.config.ts', 'app.config.js', 'app.config.mjs'].map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
  if (dyn) {
    const src = fs.readFileSync(dyn, 'utf8');
    const lit = (key: string) => src.match(new RegExp(`\\b${key}\\s*:\\s*['"\`]([^'"\`$]+)['"\`]`))?.[1] ?? null;
    name ??= lit('name');
    scheme ??= lit('scheme');
    appId ??= lit('package') ?? lit('bundleIdentifier');
  }
  name ??= str(pkg?.name);
  return { appDir, name, scheme: scheme ? scheme.replace(/:\/\/$/, '') + '://' : null, appId, expoRouter };
}

export interface InitResult {
  created: boolean;
  dir: string;
  configFile: string;
  config: Config;
  detected: Detected;
  warnings: string[];
}

/** overrides: values given on the command line win over detection. */
export function initProject(root: string, overrides: Partial<Config> = {}, { force = false } = {}): InitResult {
  const appRoot = path.resolve(root);
  const dir = path.join(appRoot, DIR_NAME);
  const configFile = path.join(dir, 'config.json');
  const detected = detectApp(appRoot);
  const warnings: string[] = [];
  if (fs.existsSync(configFile) && !force) {
    return { created: false, dir, configFile, config: JSON.parse(fs.readFileSync(configFile, 'utf8')), detected, warnings: ['already initialized (pass --force to overwrite config.json)'] };
  }
  if (!detected.appDir && !overrides.appDir) throw new UsageError(`no Expo Router routes folder (app/ or src/app/) in ${appRoot}: run init in your app's folder, or pass --app-dir`);
  if (!detected.expoRouter) warnings.push('expo-router is not in package.json: everyscreen only understands Expo Router apps');
  if (!detected.scheme && !overrides.scheme) warnings.push('no deep-link scheme found (app.json expo.scheme): screens get no deep links, so capture can only screenshot what is on the device. Set "scheme" in config.json');
  if (!detected.appId && !overrides.appId) warnings.push('no app id found (expo.android.package / expo.ios.bundleIdentifier): deep links open in whatever app handles them');

  // only what differs from the defaults, so config.json stays short
  const config: Partial<Config> = {
    name: overrides.name ?? detected.name ?? path.basename(appRoot),
    source: '..',
    ...((overrides.appDir ?? detected.appDir) !== DEFAULTS.appDir ? { appDir: overrides.appDir ?? detected.appDir! } : {}),
    scheme: overrides.scheme ?? detected.scheme,
    appId: overrides.appId ?? detected.appId,
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
  const ignore = path.join(dir, '.gitignore');
  if (!fs.existsSync(ignore)) {
    fs.writeFileSync(ignore, '# comments and issues (SQLite), generated thumbnails\ndata/\nthumbs/\n');
  }
  return { created: true, dir, configFile, config: { ...DEFAULTS, ...config } as Config, detected, warnings };
}
