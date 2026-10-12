// Route inventory for an Expo Router app: screens, navigator groups, and
// navigation edges found in the source.
//
//   scanApp(project) -> { manifest, report }
//
// No dependencies: a small tokenizer finds string literals and comments, a
// regex-level import graph attributes navigation calls in components/hooks to
// the screens (or layouts / in-place screens) that render them.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export class ScanError extends Error {}

/** project: { config, source } (see project.ts). Throws ScanError. */
export function scanApp(project) {
const CONFIG = project.config;
const REPO = project.source;
const APP = path.join(REPO, CONFIG.appDir);
const SCHEME = CONFIG.scheme;
const warnings = [];
if (!fs.existsSync(APP)) {
  throw new ScanError(`no routes folder at ${APP}: set "source" and "appDir" in ${project.configFile ?? 'config.json'}`);
}

const rel = (f) => path.relative(REPO, f).split(path.sep).join('/');

// Filesystem-safe name per screen, used for boards/<id>/screens/<slug>/
// media folders and capture file names: '/(tabs)/documents/[id]' ->
// 'tabs--documents--_id_', 'drawer:grid' -> 'drawer--grid'.
const slugOf = (id) =>
  id
    .replace(/^(drawer|layout|sheet):/, '$1/')
    .replace(/^\//, '')
    .replace(/[()+]/g, '')
    .replace(/\[([^\]]+)\]/g, '_$1_')
    .replace(/\//g, '--') || 'root';

// ---------------------------------------------------------------- files

const SKIP_DIRS = new Set(['node_modules', 'e2e', '__tests__', 'docs', 'assets', 'plugins', 'android', 'ios', 'dist', ...CONFIG.skipDirs]);
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(p, out);
    } else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.d\.ts$/.test(e.name) && !/\.test\./.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}
const allFiles = walk(REPO);
const fileSet = new Set(allFiles);

// ---------------------------------------------------------------- tokenizer

// Returns { masked, lits }. `masked` has the same length as src with comments
// blanked and string/template/regex contents replaced by '_', so bracket
// matching and regexes can run on it safely. `lits` lists string and template
// literals; template expressions become '\u0001' in `value`.
function scan(src) {
  const n = src.length;
  const m = src.split('');
  const lits = [];
  const blank = (a, b, ch = ' ') => {
    for (let k = a; k < b; k++) if (m[k] !== '\n') m[k] = ch;
  };
  const prevSigAt = (i) => {
    let k = i - 1;
    while (k >= 0 && /\s/.test(m[k])) k--;
    return k;
  };
  const prevSig = (i) => {
    const k = prevSigAt(i);
    return k < 0 ? '' : m[k];
  };
  // The word ending right before i, only if it is a whole identifier
  // ('total_in' is not 'in').
  const prevWord = (i) => {
    const s = m.slice(Math.max(0, i - 32), i).join('');
    return s.match(/(?<![\w$])([A-Za-z]+)\s*$/)?.[1] ?? '';
  };
  // '/' after ')' or '}' starts a regex only if the bracket closed an
  // if/while/for head or a block statement; after a call, an object or a JSX
  // expression ({done}/{total}) it is division or JSX text.
  const regexAfterClose = new Set(); // indexes of such ')' and '}'

  // Scans code from i. If inTemplateExpr, stops after the matching '}'.
  function code(i, inTemplateExpr) {
    let depth = 0;
    const parens = []; // per open '(': is it an if/while/for head?
    const braces = []; // per open '{': is it a block statement?
    while (i < n) {
      const c = src[i];
      const d = src[i + 1];
      if (c === '/' && d === '/') {
        const e = src.indexOf('\n', i);
        const end = e < 0 ? n : e;
        blank(i, end);
        i = end;
        continue;
      }
      if (c === '/' && d === '*') {
        const e = src.indexOf('*/', i + 2);
        const end = e < 0 ? n : e + 2;
        blank(i, end);
        i = end;
        continue;
      }
      // A quote glued to a word is an apostrophe in JSX text (It's, don't):
      // in code a string never directly follows an identifier.
      if ((c === '"' || c === "'") && /[\w$]/.test(src[i - 1] ?? '')) {
        i++;
        continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        let val = '';
        let ok = false;
        while (j < n) {
          const ch = src[j];
          if (ch === '\\') {
            val += src[j + 1];
            j += 2;
            continue;
          }
          if (ch === c) {
            ok = true;
            break;
          }
          if (ch === '\n') break;
          val += ch;
          j++;
        }
        if (ok) {
          lits.push({ value: val, start: i, end: j + 1 });
          blank(i + 1, j, '_');
          i = j + 1;
        } else {
          i++; // stray quote, e.g. an apostrophe in JSX text
        }
        continue;
      }
      if (c === '`') {
        i = template(i);
        continue;
      }
      if (c === '/') {
        const k = prevSigAt(i);
        const p = k < 0 ? '' : m[k];
        const w = prevWord(i);
        const regexStart =
          p === '' || '(,=:[!&|?{;+-*%~^'.includes(p) || ((p === ')' || p === '}') && regexAfterClose.has(k)) || ['return', 'typeof', 'case', 'in', 'of', 'void', 'delete'].includes(w);
        if (regexStart) {
          let j = i + 1;
          let cls = false;
          let ok = false;
          while (j < n && src[j] !== '\n') {
            const ch = src[j];
            if (ch === '\\') {
              j += 2;
              continue;
            }
            if (ch === '[') cls = true;
            else if (ch === ']') cls = false;
            else if (ch === '/' && !cls) {
              ok = true;
              break;
            }
            j++;
          }
          if (ok) {
            blank(i + 1, j, '_');
            i = j + 1;
            continue;
          }
        }
        i++;
        continue;
      }
      if (c === '(') {
        parens.push(['if', 'while', 'for', 'with'].includes(prevWord(i)));
      } else if (c === ')') {
        if (parens.pop()) regexAfterClose.add(i);
      } else if (c === '{') {
        const k = prevSigAt(i);
        const p = k < 0 ? '' : m[k];
        braces.push(p === ')' || p === ';' || (p === '>' && m[k - 1] === '=') || ['else', 'try', 'finally', 'do'].includes(prevWord(i)));
      } else if (c === '}') {
        if (inTemplateExpr && depth === 0) return i + 1;
        if (braces.pop()) regexAfterClose.add(i);
      }
      if (inTemplateExpr) {
        if (c === '{') depth++;
        else if (c === '}') depth--;
      }
      i++;
    }
    return i;
  }

  function template(i) {
    const start = i;
    let j = i + 1;
    let val = '';
    while (j < n) {
      const ch = src[j];
      if (ch === '\\') {
        val += src[j + 1];
        blank(j, j + 2, '_');
        j += 2;
        continue;
      }
      if (ch === '`') break;
      if (ch === '$' && src[j + 1] === '{') {
        val += '\u0001';
        j = code(j + 2, true);
        continue;
      }
      val += ch;
      if (ch !== '\n') m[j] = '_';
      j++;
    }
    lits.push({ value: val, start, end: j + 1, template: true });
    return j + 1;
  }

  code(0, false);
  lits.sort((a, b) => a.start - b.start);
  return { masked: m.join(''), lits };
}

function lineStarts(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return starts;
}
function lineOf(starts, pos) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

// ---------------------------------------------------------------- parse all files

const files = new Map(); // abs path -> info
for (const f of allFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const { masked, lits } = scan(src);
  files.set(f, { file: f, src, masked, lits, starts: lineStarts(src) });
}

const EXTS = ['.tsx', '.ts', '.native.tsx', '.native.ts', '.ios.tsx', '.ios.ts', '.jsx', '.js'];
function resolveModule(from, spec) {
  let base;
  if (spec.startsWith('@/')) base = path.join(REPO, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null;
  const cands = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => path.join(base, 'index' + e))];
  return cands.find((c) => fileSet.has(c)) ?? null;
}

function parseSpecifiers(list) {
  // "a, type B, c as d" -> [{ imported: 'a', local: 'a' }, { imported: 'c', local: 'd' }]
  return list
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('type '))
    .map((s) => {
      const [imported, local] = s.split(/\s+as\s+/);
      return { imported: imported.trim(), local: (local ?? imported).trim() };
    });
}

// Imports, re-exports and declared exports per file.
for (const info of files.values()) {
  const { masked, lits, file } = info;
  info.imports = []; // { target, names: [..] | '*' , spec }
  info.starExports = []; // targets
  info.namedReexports = new Map(); // exported name -> { target, name }
  info.exportsDeclared = new Set();
  info.specs = new Set();
  for (const L of lits) {
    if (L.template) continue;
    const pre = masked.slice(Math.max(0, L.start - 400), L.start);
    let mm;
    if (/\bfrom\s*$/.test(pre)) {
      const kw = Math.max(pre.lastIndexOf('import'), pre.lastIndexOf('export'));
      if (kw < 0) continue;
      const clause = pre.slice(kw).replace(/\s*from\s*$/, '');
      const target = resolveModule(file, L.value);
      info.specs.add(L.value);
      if (clause.startsWith('export')) {
        if (/^export\s+type\b/.test(clause) || !target) continue;
        if ((mm = clause.match(/^export\s*\*\s*as\s+([\w$]+)/))) info.exportsDeclared.add(mm[1]);
        else if (/^export\s*\*/.test(clause)) info.starExports.push(target);
        else if ((mm = clause.match(/^export\s*\{([^}]*)\}/)))
          for (const s of parseSpecifiers(mm[1])) info.namedReexports.set(s.local, { target, name: s.imported });
        continue;
      }
      if (/^import\s+type\b/.test(clause) || !target) continue;
      const body = clause.replace(/^import\s+/, '');
      const specs = []; // { imported, local }
      if ((mm = body.match(/\*\s*as\s+([\w$]+)/))) specs.push({ imported: '*', local: mm[1] });
      if ((mm = body.match(/\{([^}]*)\}/))) specs.push(...parseSpecifiers(mm[1]));
      if ((mm = body.trim().match(/^([\w$]+)\s*(,|$)/))) specs.push({ imported: 'default', local: mm[1] });
      if (specs.length === 0 && /\{[^}]*\}/.test(body)) continue; // type-only specifiers
      info.imports.push({ target, specs, spec: L.value });
    } else if (/\bimport\s*$/.test(pre) || /\b(import|require)\s*\(\s*$/.test(pre)) {
      const target = resolveModule(file, L.value);
      info.specs.add(L.value);
      if (target) info.imports.push({ target, specs: [{ imported: '*', local: null }], spec: L.value });
    }
  }
  const declRe = /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|enum)\s+([\w$]+)/g;
  let d;
  while ((d = declRe.exec(masked))) info.exportsDeclared.add(d[1]);
  if (/\bexport\s+default\b/.test(masked)) info.exportsDeclared.add('default');
  const localRe = /\bexport\s*\{([^}]*)\}(?!\s*from)/g;
  while ((d = localRe.exec(masked))) for (const s of parseSpecifiers(d[1])) info.exportsDeclared.add(s.local);

  // Top-level declarations (column 0, as prettier writes them), used to
  // narrow attribution to the exported symbol that contains a navigation.
  info.decls = [];
  const topRe = /^(export\s+)?(default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([\w$]+)/gm;
  while ((d = topRe.exec(masked))) {
    const name = d[3];
    const exported = d[2] ? ['default', name] : d[1] || info.exportsDeclared.has(name) ? [name] : [];
    info.decls.push({ name, start: d.index, exported });
  }
  info.decls.forEach((dc, i) => (dc.end = info.decls[i + 1]?.start ?? masked.length));
}

// Exported names of `info` whose declarations (transitively, within the file)
// use any of the given local identifiers or declaration names. '*' if the use
// is outside any declaration.
function taintedExports(info, seeds) {
  const tainted = new Set(seeds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const dc of info.decls) {
      if (tainted.has(dc.name)) continue;
      const text = info.masked.slice(dc.start, dc.end);
      for (const t of tainted) {
        if (new RegExp(`(?<![\\w$.])${t.replace(/\$/g, '\\$')}\\b`).test(text)) {
          tainted.add(dc.name);
          changed = true;
          break;
        }
      }
    }
  }
  const out = new Set();
  for (const dc of info.decls) if (tainted.has(dc.name)) for (const e of dc.exported) out.add(e);
  return out;
}
const declAt = (info, pos) => info.decls.findLast((dc) => dc.start <= pos && pos < dc.end) ?? null;

// Which file actually defines `name` when imported from `file` (follows barrels).
function resolveName(file, name, seen = new Set()) {
  if (seen.has(file)) return null;
  seen.add(file);
  const info = files.get(file);
  if (!info) return null;
  if (info.exportsDeclared.has(name)) return file;
  const re = info.namedReexports.get(name);
  if (re) return resolveName(re.target, re.name, seen) ?? re.target;
  for (const t of info.starExports) {
    const r = resolveName(t, name, seen);
    if (r) return r;
  }
  return null;
}
function wholeModule(file, out = new Set()) {
  if (out.has(file)) return out;
  out.add(file);
  const info = files.get(file);
  for (const t of info?.starExports ?? []) wholeModule(t, out);
  for (const r of info?.namedReexports.values() ?? []) wholeModule(r.target, out);
  return out;
}

// Reverse dependency graph, barrels resolved by imported name:
// rev: defining file -> importer -> [{ imported, local }]
const rev = new Map();
function addRev(target, importer, spec) {
  if (!rev.has(target)) rev.set(target, new Map());
  const m = rev.get(target);
  if (!m.has(importer)) m.set(importer, []);
  m.get(importer).push(spec);
}
for (const info of files.values()) {
  for (const imp of info.imports) {
    for (const s of imp.specs) {
      if (s.imported === '*') for (const t of wholeModule(imp.target)) addRev(t, info.file, s);
      else addRev(resolveName(imp.target, s.imported) ?? imp.target, info.file, s);
    }
  }
}

// ---------------------------------------------------------------- routes

const layouts = new Map(); // app-relative dir ('' for root) -> { id, file, navigator }
const routeFiles = [];
for (const f of allFiles) {
  if (!f.startsWith(APP + path.sep)) continue;
  const r = path.relative(APP, f).split(path.sep).join('/');
  const base = path.basename(r).replace(/\.(tsx?|jsx?)$/, '');
  const dir = path.dirname(r) === '.' ? '' : path.dirname(r);
  if (base === '_layout') {
    const masked = files.get(f).masked;
    const navigator = /<Tabs\b/.test(masked) ? 'Tabs' : /<Stack\b/.test(masked) ? 'Stack' : /<Drawer\b/.test(masked) ? 'Drawer' : 'Slot';
    layouts.set(dir, { dir, file: f, navigator });
  } else if (!base.startsWith('+html') && !base.startsWith('+native-intent') && !base.startsWith('+api')) {
    routeFiles.push({ f, r, base, dir });
  }
}
const groupIdOf = (dir) => (dir === '' ? 'root' : dir);
function navigatorDir(dir) {
  let d = dir;
  for (;;) {
    if (layouts.has(d)) return d;
    if (d === '') return '';
    d = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '';
  }
}

const titleOverrides = CONFIG.titles;
const humanize = (s) =>
  s
    .replace(/^\[(.+)\]$/, '$1 detail')
    .split(/[-_]/)
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');

const screens = [];
const screenByFile = new Map();
for (const { f, r, base, dir } of routeFiles) {
  const parts = r.replace(/\.(tsx?|jsx?)$/, '').split('/');
  if (parts[parts.length - 1] === 'index') parts.pop();
  const route = '/' + parts.join('/');
  const url = '/' + parts.filter((p) => !/^\(.*\)$/.test(p)).join('/');
  const navDir = navigatorDir(dir);
  const section = path.relative(navDir || '.', dir || '.').split(path.sep).join('/');
  const info = files.get(f);
  const component = info.masked.match(/\bexport\s+default\s+(?:function\s+)?([\w$]+)/)?.[1] ?? null;
  const hasDefault = /\bexport\s+default\b/.test(info.masked);
  const flags = [];
  let kind = 'screen';
  if (base === '+not-found') kind = 'system';
  else if (base.startsWith('_')) kind = 'helper';
  else if (/^\s*return\s*<Redirect\b/m.test(info.masked) && !/<(View|Screen|ScrollView|Text)\b/.test(info.masked)) kind = 'redirect';
  else if (/ui-test/.test(base)) kind = 'dev';
  if (!hasDefault) flags.push('no-default-export');
  const params = [];
  const pm = info.masked.match(/useLocalSearchParams\s*<\s*\{([^}]*)\}/);
  if (pm) for (const k of pm[1].matchAll(/([\w$]+)\??\s*:/g)) params.push(k[1]);
  for (const seg of parts) {
    const dm = seg.match(/^\[(?:\.\.\.)?(.+)\]$/);
    if (dm && !params.includes(dm[1])) params.unshift(dm[1]);
  }
  const lastSeg = parts.filter((p) => !/^\(.*\)$/.test(p)).pop() ?? '';
  const autoTitle = lastSeg ? humanize(lastSeg) : humanize(parts[parts.length - 1]?.replace(/[()]/g, '') || 'index');
  const s = {
    id: route,
    slug: slugOf(route),
    route,
    url,
    deepLink: SCHEME ? SCHEME + url.slice(1) : null,
    file: rel(f),
    group: groupIdOf(navDir),
    section: section === '' || section === '.' ? null : section,
    title: titleOverrides[route] ?? autoTitle,
    component,
    kind,
    dynamic: parts.some((p) => /^\[.*\]$/.test(p)),
    params,
    flags,
  };
  screens.push(s);
  screenByFile.set(f, s);
}
for (const s of screens) {
  const same = screens.filter((o) => o !== s && o.url === s.url);
  if (same.length) s.flags.push('url-shared-with:' + same.map((o) => o.route).join(','));
}

// ---------------------------------------------------------------- in-place screens (non-route)

// Optional (config `inPlace`): one component that swaps its content by name,
// e.g. a bottom sheet with its own little stack:
//   switch (screen) { case 'grid': return <Grid />; case 'water': return <WaterForm /> }
// Every `case '<name>': return <Component` becomes a screen, and calls named in
// `inPlace.calls` with one of those names as argument become arrows to it.
const IN_PLACE = CONFIG.inPlace;
const IN_PLACE_GROUP = 'in-place';
const drawerFile = IN_PLACE?.file ? allFiles.find((f) => rel(f) === IN_PLACE.file) : null;
if (IN_PLACE?.file && !drawerFile) warnings.push(`inPlace.file ${IN_PLACE.file} not found in ${REPO}`);
const drawerCalls = (IN_PLACE?.calls ?? []).filter((c) => /^[A-Za-z_$][\w$]*$/.test(c));
const drawer = new Map(); // name -> node
const drawerByFile = new Map();
if (drawerFile) {
  const info = files.get(drawerFile);
  // Map imported component names to files.
  const compToFile = new Map();
  const importRe = /import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g;
  let mm;
  while ((mm = importRe.exec(info.src))) {
    const target = resolveModule(drawerFile, mm[3]);
    for (const s of parseSpecifiers(mm[1])) if (target) compToFile.set(s.local, target);
  }
  const caseRe = /case\s+'([\w-]+)'\s*:\s*return\s*<([\w$]+)/g;
  while ((mm = caseRe.exec(info.src))) {
    const f = compToFile.get(mm[2]) ?? null;
    const name = mm[1];
    const node = {
      id: 'drawer:' + name,
      slug: slugOf('drawer:' + name),
      route: null,
      url: null,
      deepLink: null,
      file: f ? rel(f) : null,
      group: IN_PLACE_GROUP,
      section: null,
      title: titleOverrides['drawer:' + name] ?? humanize(name),
      component: mm[2],
      kind: 'drawer',
      dynamic: false,
      params: [],
      flags: ['not-a-route'],
    };
    drawer.set(name, node);
    if (f) drawerByFile.set(f, node);
  }
}

// ---------------------------------------------------------------- pop-up sheets & dialogs (non-route)

// Bottom sheets, drawers, modals and dialogs a user sees as a screen of its
// own, but which aren't routes: found by file name (FooSheet.tsx,
// BarDialog.tsx, ...) under config `sheets.dir`. Generic building blocks (the
// sheet chrome other sheets are built from) go in `sheets.skip`; the in-place
// component (mapped above, screen by screen) is left out. `"sheets": false`
// turns this off.
const SHEET_FILE = /\/([A-Z][A-Za-z0-9]*(Sheet|Drawer|Modal|Dialog|Overlay))\.tsx$/;
const SHEET_DIR = CONFIG.sheets ? CONFIG.sheets.dir.replace(/\/*$/, '/') : null;
const SHEET_SKIP = new Set([...(CONFIG.sheets ? CONFIG.sheets.skip : []), ...(drawerFile ? [rel(drawerFile)] : [])]);
const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase();
const sheets = new Map(); // id -> node
const sheetByFile = new Map();
for (const f of allFiles) {
  const r = rel(f);
  const m = r.match(SHEET_FILE);
  if (!m || !SHEET_DIR || !r.startsWith(SHEET_DIR) || SHEET_SKIP.has(r)) continue;
  const component = m[1];
  const id = 'sheet:' + kebab(component);
  const words = kebab(component).replace(/-(sheet|drawer|modal|dialog|overlay)$/, '').split('-');
  const kindWord = m[2] === 'Drawer' ? 'drawer' : m[2] === 'Overlay' ? 'overlay' : m[2] === 'Dialog' || m[2] === 'Modal' ? 'dialog' : 'sheet';
  const node = {
    id,
    slug: slugOf(id),
    route: null,
    url: null,
    deepLink: null,
    file: r,
    group: 'sheets',
    section: r.slice(SHEET_DIR.length).split('/').length > 1 ? r.slice(SHEET_DIR.length).split('/')[0] : null, // <sheets.dir>/<area>/...
    title: titleOverrides[id] ?? `${words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')} (${kindWord})`,
    component,
    kind: 'sheet',
    dynamic: false,
    params: [],
    flags: ['not-a-route'],
  };
  sheets.set(id, node);
  sheetByFile.set(f, node);
}

// ---------------------------------------------------------------- owners (edge sources)

const layoutNodes = new Map(); // file -> node
for (const L of layouts.values()) {
  const gid = groupIdOf(L.dir);
  layoutNodes.set(L.file, {
    id: 'layout:' + gid,
    slug: slugOf('layout:' + gid),
    route: null,
    url: null,
    deepLink: null,
    file: rel(L.file),
    group: gid,
    section: null,
    title: (gid === 'root' ? 'Root' : gid) + ' layout',
    component: files.get(L.file).masked.match(/\bexport\s+default\s+function\s+([\w$]+)/)?.[1] ?? null,
    kind: 'layout',
    dynamic: false,
    params: [],
    flags: ['not-a-route'],
  });
}
const ownerOfFile = (f) => screenByFile.get(f) ?? drawerByFile.get(f) ?? sheetByFile.get(f) ?? layoutNodes.get(f) ?? null;

// Walk reverse imports from the declaration containing `pos` in `file` up to
// the nearest owners, following only importers that use the tainted symbol.
const ownerCache = new Map();
function ownersOf(file, pos) {
  const direct = ownerOfFile(file);
  if (direct) return [direct];
  const info = files.get(file);
  const dc = declAt(info, pos);
  const start = dc ? taintedExports(info, [dc.name]) : new Set(['*']);
  const cacheKey = file + '\u0000' + [...start].sort().join(',');
  if (ownerCache.has(cacheKey)) return ownerCache.get(cacheKey);
  const found = new Set();
  const seen = new Set();
  const queue = [[file, start]];
  while (queue.length) {
    const [cur, names] = queue.shift();
    for (const [imp, specs] of rev.get(cur) ?? []) {
      const hit = specs.filter((s) => s.imported === '*' || names.has('*') || names.has(s.imported));
      if (!hit.length) continue;
      const o = ownerOfFile(imp);
      if (o) {
        found.add(o);
        continue;
      }
      const impInfo = files.get(imp);
      const locals = hit.map((s) => s.local).filter(Boolean);
      let next = locals.length ? taintedExports(impInfo, locals) : new Set(['*']);
      if (!next.size) next = new Set(['*']);
      const key = imp + '\u0000' + [...next].sort().join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push([imp, next]);
    }
  }
  const r = [...found];
  ownerCache.set(cacheKey, r);
  return r;
}

// ---------------------------------------------------------------- route resolution

const segMatch = (pattern, value) => {
  if (/^\[.*\]$/.test(pattern)) {
    if (value === pattern) return 'exact';
    return value.includes('\u0001') ? 'template' : 'concrete';
  }
  if (pattern === value) return 'exact';
  // `/b/${x}` into a static segment: possible, but only taken if it is the
  // only route that fits (see resolveRoute).
  if (value.includes('\u0001')) {
    const re = new RegExp('^' + value.split('\u0001').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+') + '$');
    if (re.test(pattern)) return 'wild';
  }
  return null;
};
const routeScreens = screens;
function resolveRoute(raw) {
  let v = raw.split(/[?#]/)[0];
  if (v.length > 1) v = v.replace(/\/$/, '');
  if (!v.startsWith('/') || v.startsWith('//')) return null;
  const vParts = v.split('/').filter(Boolean);
  const vGroups = vParts.filter((p) => /^\(.*\)$/.test(p));
  const vUrl = vParts.filter((p) => !/^\(.*\)$/.test(p));
  const cands = [];
  for (const s of routeScreens) {
    const sParts = s.route.split('/').filter(Boolean);
    const sUrl = sParts.filter((p) => !/^\(.*\)$/.test(p));
    if (sUrl.length !== vUrl.length) continue;
    let guessed = false;
    let wild = 0;
    let ok = true;
    for (let i = 0; i < sUrl.length; i++) {
      const r = segMatch(sUrl[i], vUrl[i]);
      if (!r) {
        ok = false;
        break;
      }
      if (r !== 'exact') guessed = true;
      if (r === 'wild') wild++;
    }
    if (!ok) continue;
    // Groups named in the href must appear in the route, in order.
    const sGroups = sParts.filter((p) => /^\(.*\)$/.test(p));
    let gi = 0;
    for (const g of sGroups) if (g === vGroups[gi]) gi++;
    if (gi !== vGroups.length) continue;
    cands.push({ screen: s, guessed, dyn: s.dynamic ? 1 : 0, wild: wild ? 1 : 0 });
  }
  if (!cands.length) return { screen: null };
  cands.sort((a, b) => a.wild - b.wild || a.dyn - b.dyn);
  const best = cands.filter((c) => c.wild === cands[0].wild && c.dyn === cands[0].dyn);
  if (best[0].wild && best.length > 1) return { screen: null }; // `/${x}` fits too many
  const pick = best[0];
  const ambiguous = best.length > 1 ? best.map((c) => c.screen.route) : null;
  return { screen: pick.screen, guessed: pick.guessed || !!ambiguous, ambiguous };
}

// ---------------------------------------------------------------- navigation helpers

// Functions that forward their argument to router.push/replace (goTo,
// closeAndNavigate, ...). A literal passed to one of these is a navigation.
const navHelpers = new Map(); // name -> kind
const helperSites = []; // { file, start, end, name }
for (const info of files.values()) {
  const re = /(?:\bfunction\s+([\w$]+)\s*\(|\b(?:const|let)\s+([\w$]+)\s*=\s*(?:useCallback\s*\(\s*)?(?:async\s*)?\()/g;
  let mm;
  while ((mm = re.exec(info.masked))) {
    const name = mm[1] ?? mm[2];
    const paramsEnd = info.masked.indexOf(')', mm.index + mm[0].length);
    const params = [...info.masked.slice(mm.index + mm[0].length, paramsEnd).matchAll(/([\w$]+)\s*[?]?\s*[:,=]|([\w$]+)\s*$/g)].map((p) => p[1] ?? p[2]);
    const body = info.masked.slice(paramsEnd, paramsEnd + 300);
    const call = body.match(/\brouter\.(push|replace|navigate)\s*\(\s*([\w$]+)/);
    if (call && params.includes(call[2])) {
      navHelpers.set(name, call[1] === 'replace' ? 'replace' : 'push');
      helperSites.push({ file: info.file, start: mm.index, end: paramsEnd + 300, name });
    }
  }
}

const NAV_RE = /(?:^|\.)(?:router|navigation|nav)\.(push|replace|navigate|dismissTo)$/;
const DRAWER_CALL_RE = drawerCalls.length ? new RegExp(`(?:^|\\.)(${drawerCalls.join('|')})$`) : /(?!)/;
const COMPARE_CALLS = new Set(['startsWith', 'endsWith', 'includes', 'indexOf', 'match', 'test', 'split', 'fetch', 'apiRequest', 'get', 'post', 'put', 'patch', 'delete']);
// Edge kind per router method. dismissTo pops back to a screen already in
// the stack, so it is drawn as a back link.
const methodKind = (method) => (method === 'replace' ? 'replace' : method === 'navigate' ? 'navigate' : method === 'dismissTo' ? 'back' : 'push');

// `const { push, replace: rep } = useRouter()` -> Map { push: 'push', rep: 'replace' }
function routerAliases(masked) {
  const out = new Map();
  for (const mm of masked.matchAll(/\b(?:const|let)\s*\{([^}]*)\}\s*=\s*useRouter\s*\(\s*\)/g)) {
    for (const s of parseSpecifiers(mm[1])) {
      const [imported, local] = s.imported.includes(':') ? s.imported.split(':').map((x) => x.trim()) : [s.imported, s.local];
      if (/^(push|replace|navigate|dismissTo)$/.test(imported)) out.set(local, imported);
    }
  }
  return out;
}

// Innermost-outward list of unclosed brackets before pos, with callee names.
// `useRouter().push` and destructured router methods come back as `router.push`.
function enclosing(masked, pos, aliases = new Map()) {
  const res = [];
  let depth = 0;
  for (let k = pos - 1; k >= 0 && res.length < 6; k--) {
    const ch = masked[k];
    if (ch === ')' || ch === ']' || ch === '}') depth++;
    else if (ch === '(' || ch === '[' || ch === '{') {
      if (depth > 0) {
        depth--;
        continue;
      }
      const before = masked.slice(Math.max(0, k - 120), k);
      let callee = ch === '(' ? (before.match(/((?:useRouter\(\)\.)?[\w$][\w$.?]*)\s*(?:<[^<>()]*>)?\s*$/)?.[1] ?? '') : '';
      callee = callee.replace(/\?/g, '').replace(/^useRouter\(\)\./, 'router.');
      if (/^(return|if|while|for|switch|catch|typeof|await|yield|in|of|case|else|do|new|void)$/.test(callee)) callee = ''; // `return (`: grouping
      if (aliases.has(callee) && !/\.\s*$/.test(before.slice(0, before.lastIndexOf(callee)))) callee = 'router.' + aliases.get(callee);
      const fnBody = ch === '{' && (/\)\s*(:\s*[\w$<>[\]|, ]+)?\s*$/.test(before) || /=>\s*$/.test(before));
      res.push({ ch, at: k, callee, fnBody });
      if (fnBody) break;
    } else if (ch === ';' && depth === 0) break;
  }
  return res;
}

// Index of the bracket closing the one opened at `open`.
function closeOf(masked, open) {
  let depth = 0;
  for (let k = open; k < masked.length; k++) {
    if ('([{'.includes(masked[k])) depth++;
    else if (')]}'.includes(masked[k]) && --depth === 0) return k;
  }
  return masked.length;
}

// The JSX tag whose attribute list contains pos ('Link' for
// `<Link a={b} href=` ...), or null when pos is not inside an opening tag.
function jsxTagAt(masked, pos) {
  let depth = 0;
  for (let k = pos - 1; k >= 0 && k > pos - 2000; k--) {
    const ch = masked[k];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) return null;
      depth--;
    } else if (depth) continue;
    else if (ch === '<') return /[\w$)\]]/.test(masked[k - 1] ?? '') ? null : (masked.slice(k + 1).match(/^[\w$.]+/)?.[0] ?? null);
    else if (ch === ';' || (ch === '>' && masked[k - 1] !== '=')) return null;
  }
  return null;
}

// ---------------------------------------------------------------- collect references

const refs = []; // { file, line, owners, targetId, kind, certainty, note }
const broken = [];
const unresolved = []; // manifest rows; `calls` keeps the details for step 2 below
const calls = [];
const drawerNames = new Set(drawer.keys());
// Route name ('hike-summary', '(tabs)') -> screen, for
// react-navigation style `CommonActions.reset({ routes: [{ name }] })`. The
// name is looked up in the file's own directory first, then as a top-level
// route or group ('(tabs)' -> its index screen), then as a unique route name
// anywhere (guessed).
function resolveResetName(file, name) {
  if (file.startsWith(APP + path.sep)) {
    const dir = path.dirname(path.relative(APP, file)).split(path.sep).join('/');
    const route = ('/' + (dir === '.' ? '' : dir + '/') + name.replace(/(^|\/)index$/, '')).replace(/\/$/, '');
    const s = screens.find((s) => s.route === route);
    if (s) return { screen: s, guessed: false };
  }
  const top = resolveRoute('/' + name);
  if (top?.screen && !top.ambiguous) return { screen: top.screen, guessed: !!top.guessed };
  const tail = '/' + name.replace(/(^|\/)index$/, '');
  const any = screens.filter((s) => s.route.endsWith(tail));
  return any.length === 1 ? { screen: any[0], guessed: true } : null;
}

for (const info of files.values()) {
  const { file, masked, lits, starts, src } = info;
  const usesRouter = info.specs.has('expo-router');
  const relFile = rel(file);
  const resolvedCallRanges = [];
  const aliases = routerAliases(masked);
  // pushScreen(someVar): in-place names assigned to variables count (inferred).
  const drawerCallWithVar = drawerCalls.length > 0 && new RegExp(`\\b(${drawerCalls.join('|')})\\s*\\(\\s*[A-Za-z_$][\\w$.]*\\s*[,)]`).test(masked);

  for (const L of lits) {
    const pre = masked.slice(Math.max(0, L.start - 80), L.start);
    const post = masked.slice(L.end, L.end + 40);
    if (/\b(from|import|require)\s*\(?\s*$/.test(pre)) continue;
    if (/(===|!==|==|!=)\s*$/.test(pre) || /^\s*(===|!==|==|!=)/.test(post)) continue;
    if (/\bcase\s*$/.test(pre)) continue;
    // Object key directly before the literal ({ key: '...' } / { 'k': '...' }),
    // but not the else-branch of a ternary (cond ? a : '...').
    const keyM = pre.match(/[{,]\s*(?:([\w$]+)|['"]_*['"])\s*:\s*$/);
    let key = keyM ? (keyM[1] ?? '[map key]') : null;

    if (key === 'name' && !L.template && /^[\w()-]+(\/[\w()[\].-]+)*$/.test(L.value)) {
      const enc = enclosing(masked, L.start);
      if (enc.some((e) => /(?:^|\.)(reset|dispatch|navigate)$/.test(e.callee))) {
        const hit = resolveResetName(file, L.value);
        const line = lineOf(starts, L.start);
        if (hit) refs.push({ file, pos: L.start, line, target: hit.screen, kind: 'replace', certainty: hit.guessed ? 'guessed' : 'certain', note: 'navigation.reset by route name' });
        else broken.push({ file: relFile, line, value: L.value, kind: 'reset' });
      }
      continue;
    }

    const isDrawerLit = !L.template && drawerNames.has(L.value);
    const isRouteLit = L.value.startsWith('/') && !L.value.startsWith('//');
    if (!isDrawerLit && !isRouteLit) continue;

    const enc = enclosing(masked, L.start, aliases);
    // ['/a', '/b'].includes(x): a comparison list, not a destination.
    if (enc[0]?.ch === '[' && /^\s*\??\.\s*(includes|indexOf|some|every|find|findIndex|filter)\b/.test(masked.slice(closeOf(masked, enc[0].at) + 1, closeOf(masked, enc[0].at) + 40))) continue;
    let call = null;
    let skip = false;
    for (const e of enc) {
      if (e.ch !== '(') continue;
      if (!e.callee) continue; // grouping paren: keep looking outward
      const last = e.callee.split('.').pop();
      if (NAV_RE.test(e.callee) || DRAWER_CALL_RE.test(e.callee) || navHelpers.has(last)) call = e;
      else if (COMPARE_CALLS.has(last)) skip = true;
      else call = { ...e, other: true };
      break;
    }
    if (skip) continue;
    // JSX attribute (href="/a", fallbackRoute={'/a'}), not `const x = '/a'`.
    let prop = null;
    let tag = null;
    const attrM = pre.match(/(?<![\w$.])([\w$]+)\s*=\s*\{?\s*$/);
    if (attrM && (tag = jsxTagAt(masked, L.start - pre.length + attrM.index))) prop = attrM[1];
    // A direct argument of some other call (track('/x'), useState('/x')) is
    // not a navigation; literals in an object argument still count as refs.
    if (call?.other && enc[0].at === call.at && !prop) continue;
    // <Link href={{ pathname: '/a', params }}> is the link itself.
    if (key === 'pathname' && !call && enc[0]?.ch === '{') {
      const b = masked.slice(Math.max(0, enc[0].at - 80), enc[0].at);
      const hm = b.match(/(?<![\w$.])href\s*=\s*\{\s*$/);
      if (hm && (tag = jsxTagAt(masked, enc[0].at - b.length + hm.index))) {
        prop = 'href';
        key = null;
      }
    }
    const constName = masked.slice(Math.max(0, L.start - 200), L.start).match(/\b(?:const|let|var)\s+([\w$]+)\s*(?::[^=;]+)?=(?:[^;=]|={2,3})*$/)?.[1] ?? null;
    // Top-level constant holding the literal (tables like WEEK_TOUR_DAYS).
    const dc = declAt(info, L.start);
    const topName = dc && /^(export\s+)?(const|let|var)\b/.test(masked.slice(dc.start, dc.start + 20)) && !/=>/.test(masked.slice(dc.start, L.start)) ? dc.name : null;
    const line = lineOf(starts, L.start);
    const pos = L.start;

    if (isDrawerLit) {
      const viaCall = call && !call.other && DRAWER_CALL_RE.test(call.callee);
      if (viaCall || key === 'screen') {
        refs.push({ file, pos, line, target: drawer.get(L.value), kind: 'drawer', certainty: 'certain', note: viaCall ? call.callee.split('.').pop() + '()' : 'screen:' });
      } else if (constName && drawerCallWithVar) {
        refs.push({ file, pos, line, target: drawer.get(L.value), kind: 'drawer', certainty: 'inferred', note: `const ${constName} -> ${drawerCalls[0]}()` });
      }
      continue;
    }

    // Route literal: filter out API paths and unrelated strings.
    const groupQualified = L.value.startsWith('/(');
    const typedHref = /^\s*as\s+(const\b|Href\b|never\b)/.test(post);
    if (!usesRouter && !groupQualified && !typedHref) continue;
    const res = resolveRoute(L.value);

    let kind;
    let certainty;
    let note = null;
    const names = []; // identifiers the literal is stored under (for step 2)
    if (call && !call.other) {
      const last = call.callee.split('.').pop();
      const m = call.callee.match(NAV_RE);
      const base = m ? methodKind(m[1]) : navHelpers.get(last);
      if (key && key !== 'pathname') {
        kind = 'param';
        certainty = 'inferred';
        note = `param ${key}`;
      } else {
        kind = base;
        certainty = 'certain';
        if (!m) note = `via ${last}()`;
        else if (m[1] === 'dismissTo') note = 'dismissTo';
        resolvedCallRanges.push(call.at);
      }
    } else if (prop === 'href') {
      kind = tag === 'Redirect' ? 'redirect' : 'link';
      certainty = 'certain';
    } else if (prop && /back/i.test(prop)) {
      kind = 'back';
      certainty = 'certain';
      note = prop;
    } else {
      kind = 'ref';
      certainty = 'inferred';
      note = key === '[map key]' ? 'map value' : key ? `${key}:` : prop ? `${prop}=` : constName ? `const ${constName}` : call?.other ? `arg of ${call.callee}()` : 'literal';
      if (constName) names.push(constName);
      if (topName && topName !== constName) names.push(topName);
    }

    if (!res || !res.screen) {
      if (certainty === 'certain' || groupQualified) broken.push({ file: relFile, line, value: L.value.replace(/\u0001/g, '${…}'), kind });
      continue;
    }
    if (res.guessed && certainty === 'certain') certainty = 'guessed';
    if (res.ambiguous) note = [note, 'ambiguous: ' + res.ambiguous.join(' | ')].filter(Boolean).join('; ');
    if (L.template) note = [note, 'from template ' + '`' + L.value.replace(/\u0001/g, '${…}') + '`'].filter(Boolean).join('; ');
    refs.push({ file, pos, line, target: res.screen, kind, certainty, note, names, prop: kind === 'ref' ? prop : null, tag });
  }

  // router.* calls whose destination is not a literal.
  const aliasAlt = [...aliases.keys()].map((a) => a.replace(/\$/g, '\\$')).join('|');
  const callRe = new RegExp(`(?:\\b(?:router|navigation)\\.|\\buseRouter\\(\\)\\.)(push|replace|navigate|dismissTo)\\s*\\(${aliasAlt ? `|(?<![\\w$.])(${aliasAlt})\\s*\\(` : ''}`, 'g');
  let cm;
  while ((cm = callRe.exec(masked))) {
    const method = cm[1] ?? aliases.get(cm[2]);
    const open = cm.index + cm[0].length - 1;
    if (resolvedCallRanges.includes(open)) continue;
    const close = closeOf(masked, open);
    const inside = lits.filter((L) => L.start > open && L.end <= close);
    if (inside.some((L) => L.value.startsWith('/') && resolveRoute(L.value)?.screen)) continue;
    const arg = src.slice(open + 1, close).replace(/\s+/g, ' ').trim();
    const helper = helperSites.filter((h) => h.file === file && h.start <= cm.index && cm.index < h.end).pop()?.name;
    const row = { file: relFile, line: lineOf(starts, cm.index), call: `router.${method}(${arg.length > 90 ? arg.slice(0, 87) + '...' : arg})`, helper: helper ?? null };
    unresolved.push(row);
    calls.push({ file, pos: cm.index, method, row, names: flowNames(info, cm.index, masked.slice(open + 1, close)) });
  }
}

// Identifiers a router call's destination may come from: those in the
// argument, plus one step back through `const x = <expr>`, `items.map((x) =>`
// and `for (const x of items)` before the call.
function flowNames(info, at, arg) {
  const idents = (t) => (t.match(/(?<![\w$.])[A-Za-z_$][\w$]*/g) ?? []).filter((w) => !/^(as|any|never|const|typeof|string|Href|undefined|null|true|false)$/.test(w));
  const names = new Set(idents(arg));
  const before = info.masked.slice(0, at);
  for (const id of [...names]) {
    const e = id.replace(/\$/g, '\\$');
    const decl = [...before.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${e}\\s*(?::[^=;]+)?=([^;]*)`, 'g'))].pop();
    if (decl) for (const w of idents(decl[1])) names.add(w);
    const iter = [...before.matchAll(new RegExp(`([\\w$]+)\\s*\\.\\s*(?:map|forEach|flatMap|filter|find)\\s*\\(\\s*(?:async\\s*)?\\(?\\s*${e}\\b|\\bfor\\s*\\(\\s*(?:const|let)\\s+${e}\\s+of\\s+([\\w$]+)`, 'g'))].pop();
    if (iter) names.add(iter[1] ?? iter[2]);
  }
  return names;
}

// Step 2: a ref whose value flows into one of those calls (same constant, an
// imported constant, or a prop the rendered component passes on) becomes that
// call's kind, as a guess.
const importedAs = (info, local) => {
  for (const imp of info.imports) for (const s of imp.specs) if (s.local === local && s.imported !== '*') return { file: resolveName(imp.target, s.imported) ?? imp.target, name: s.imported };
  return null;
};
for (const r of refs) {
  if (r.kind !== 'ref' || (!r.names.length && !r.prop)) continue;
  const tagFile = r.prop && r.tag ? importedAs(files.get(r.file), r.tag.split('.')[0])?.file : null;
  const hit = calls.find((c) => {
    if (r.prop && tagFile === c.file && c.names.has(r.prop)) return true;
    for (const n of c.names) {
      if (c.file === r.file && r.names.includes(n)) return true;
      const im = importedAs(files.get(c.file), n);
      if (im && im.file === r.file && r.names.includes(im.name)) return true;
    }
    return false;
  });
  if (!hit) continue;
  r.kind = methodKind(hit.method);
  r.certainty = 'guessed';
  r.promoted = true;
  r.callSite = `${hit.row.file}:${hit.row.line}`;
  r.note = `${r.note} -> router.${hit.method}() at ${r.callSite}`;
}

// ---------------------------------------------------------------- edges

const nodesById = new Map();
for (const s of screens) nodesById.set(s.id, s);
for (const d of drawer.values()) nodesById.set(d.id, d);
for (const d of sheets.values()) nodesById.set(d.id, d);

const edgeMap = new Map();
const RANK = { certain: 0, guessed: 1, inferred: 2 };
const usedLayouts = new Set();
for (const r of refs) {
  const owners = ownersOf(r.file, r.pos);
  const ownerFile = ownerOfFile(r.file);
  for (const o of owners) {
    if (o.kind === 'layout' && r.certainty === 'inferred') continue; // guard lists, pathname checks
    // Dev screens (/ui-test) render components for show, not to navigate.
    if (o.kind === 'dev' && o !== ownerFile && r.certainty !== 'certain') continue;
    if (o.id === r.target.id) continue;
    if (o.kind === 'layout') usedLayouts.add(o);
    const key = `${o.id}\u0000${r.target.id}\u0000${r.kind}`;
    let e = edgeMap.get(key);
    if (!e) {
      e = { from: o.id, to: r.target.id, kind: r.kind, certainty: r.certainty, promoted: !!r.promoted, via: [], sites: [], notes: [] };
      edgeMap.set(key, e);
    }
    if (RANK[r.certainty] < RANK[e.certainty]) e.certainty = r.certainty;
    e.promoted = e.promoted && !!r.promoted;
    for (const site of [`${rel(r.file)}:${r.line}`, r.callSite]) if (site && !e.sites.includes(site)) e.sites.push(site);
    if (!ownerFile || ownerFile !== o) {
      const via = rel(r.file);
      if (!e.via.includes(via)) e.via.push(via);
    }
    if (r.note && !e.notes.includes(r.note)) e.notes.push(r.note);
  }
}
// Tab navigators: the tab bar links the layout to each visible tab's root.
for (const [f, node] of layoutNodes) {
  const L = [...layouts.values()].find((l) => l.file === f);
  if (L.navigator !== 'Tabs') continue;
  const masked = files.get(f).masked;
  const src = files.get(f).src;
  const re = /<Tabs\.Screen\b([^>]*?)\/?>/gs;
  let mm;
  while ((mm = re.exec(masked))) {
    const attrs = src.slice(mm.index, mm.index + mm[0].length);
    if (/href\s*:\s*null/.test(attrs)) continue;
    const name = attrs.match(/name=["']([^"']+)["']/)?.[1];
    const target = name && screens.find((s) => s.route === '/' + (L.dir ? L.dir + '/' : '') + name.replace(/(^|\/)index$/, ''));
    if (!target) continue;
    edgeMap.set(`${node.id}\u0000${target.id}\u0000tab`, {
      from: node.id, to: target.id, kind: 'tab', certainty: 'certain', via: [], sites: [`${rel(f)}:${lineOf(files.get(f).starts, mm.index)}`], notes: ['tab bar'],
    });
    usedLayouts.add(node);
  }
}
// Sheets: an arrow from every screen, drawer screen, layout or other sheet
// that renders one (through any chain of components), found by walking the
// imports up from the sheet's exported component.
for (const [f, sheet] of sheetByFile) {
  const info = files.get(f);
  const exported = info.decls.filter((d) => d.exported.length);
  const openers = new Set();
  for (const d of exported.length ? exported : [{ start: 0 }]) {
    // ownersOf(f) would return the sheet itself; start one level up
    for (const [imp, specs] of rev.get(f) ?? []) {
      if (!specs.some((sp) => sp.imported === '*' || sp.imported === d.name || d.exported?.includes(sp.imported))) continue;
      const direct = ownerOfFile(imp);
      if (direct) openers.add(direct);
      else for (const o of ownersOf(imp, 0)) openers.add(o);
    }
  }
  for (const o of openers) {
    if (o.id === sheet.id) continue;
    if (o.kind === 'layout') usedLayouts.add(o);
    edgeMap.set(`${o.id}\u0000${sheet.id}\u0000sheet`, {
      from: o.id, to: sheet.id, kind: 'sheet', certainty: 'certain', via: [], sites: [o.file ?? rel(f)], notes: [`opens ${sheet.component}`],
    });
  }
}
// A guessed (promoted) edge adds nothing next to a certain one between the
// same two screens, e.g. FloatingTabBar's TAB_ROOTS beside the tab edges.
const certainPairs = new Set([...edgeMap.values()].filter((e) => e.certainty === 'certain').map((e) => `${e.from}\u0000${e.to}`));
for (const [k, e] of edgeMap) if (e.promoted && certainPairs.has(`${e.from}\u0000${e.to}`)) edgeMap.delete(k);
const edges = [...edgeMap.values()].map((e) => {
  const out = { from: e.from, to: e.to, kind: e.kind, certainty: e.certainty };
  if (e.via.length) out.via = e.via;
  out.sites = e.sites;
  if (e.notes.length) out.note = e.notes.join('; ');
  return out;
});

// ---------------------------------------------------------------- groups & output

// '(tabs)/home' -> 'Tabs / home' unless the config names it
const autoGroupTitle = (id) => id.split('/').map((p, i) => (i === 0 ? humanize(p.replace(/[()]/g, '')) : p.replace(/[()]/g, ''))).join(' / ');
const GROUP_TITLES = {
  root: 'Root',
  [IN_PLACE_GROUP]: IN_PLACE?.title ?? 'In-place screens',
  sheets: 'Pop-up sheets & dialogs',
  ...CONFIG.groupTitles,
};
const groups = [...layouts.values()].map((L) => {
  const id = groupIdOf(L.dir);
  const parentDir = L.dir === '' ? null : navigatorDir(L.dir.includes('/') ? L.dir.slice(0, L.dir.lastIndexOf('/')) : '');
  return { id, title: GROUP_TITLES[id] ?? autoGroupTitle(id), navigator: L.navigator, layoutFile: rel(L.file), parent: parentDir === null ? null : groupIdOf(parentDir) };
});
if (sheets.size) groups.push({ id: 'sheets', title: GROUP_TITLES.sheets, navigator: 'Sheets / dialogs (not routes)', layoutFile: null, parent: null });
if (drawer.size) groups.push({ id: IN_PLACE_GROUP, title: GROUP_TITLES[IN_PLACE_GROUP], navigator: 'In place (not routes)', layoutFile: drawerFile ? rel(drawerFile) : null, parent: IN_PLACE?.parent ?? null });

// "owner/name" for links to GitHub: config `repo`, else the origin remote
function githubRepo() {
  if (CONFIG.repo) return CONFIG.repo;
  const url = git('remote', 'get-url', 'origin') ?? '';
  return url.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/)?.[1] ?? null;
}

function git(...args) {
  try {
    return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}
// Entry point: unstable_settings.initialRouteName of the root layout.
let entry = null;
const rootLayout = layouts.get('');
if (rootLayout) {
  const info = files.get(rootLayout.file);
  const at = info.masked.search(/\bunstable_settings\b/);
  const lit = at >= 0 && info.lits.find((L) => L.start > at && /initialRouteName\s*:\s*$/.test(info.masked.slice(Math.max(0, L.start - 40), L.start)));
  if (lit) entry = { route: '/' + lit.value, screen: resolveResetName(rootLayout.file, lit.value)?.screen.id ?? null, site: `${rel(rootLayout.file)}:${lineOf(info.starts, lit.start)}` };
}

const commit = git('rev-parse', 'HEAD');
const short = commit?.slice(0, 7);
const tags = (git('tag', '--points-at', 'HEAD') ?? '').split('\n').filter(Boolean);

const manifest = {
  generatedAt: new Date().toISOString(),
  source: {
    repo: githubRepo(),
    path: project.dir ? path.relative(project.dir, REPO).split(path.sep).join("/") || "." : REPO,
    commit,
    release: tags[0] ?? git('describe', '--tags', '--always'),
    // a release tag on exactly this commit: boards named after it are snapshots
    tag: tags[0] ?? null,
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    // a custom build from a working tree with uncommitted changes (only the
    // app's own folder counts when it sits inside a bigger repo)
    dirty: commit ? (git('status', '--porcelain', '--', '.') ?? '') !== '' : false,
    scheme: SCHEME,
  },
  entry,
  groups,
  screens: [...screens, ...drawer.values(), ...sheets.values(), ...usedLayouts].sort((a, b) => a.group.localeCompare(b.group) || (a.section ?? '').localeCompare(b.section ?? '') || a.id.localeCompare(b.id)),
  edges,
  unresolved: unresolved.filter((u) => !u.helper),
  helperCalls: unresolved.filter((u) => u.helper),
  broken,
};
// ---------------------------------------------------------------- report

const incoming = new Set(edges.map((e) => e.to));
const count = (pred) => edges.filter(pred).length;
const edgeKinds = {};
for (const e of edges) edgeKinds[e.kind] = (edgeKinds[e.kind] ?? 0) + 1;
const report = {
  source: { path: REPO, release: manifest.source.release, commit: short ?? null, dirty: manifest.source.dirty },
  groups: groups.map((g) => {
    const inG = manifest.screens.filter((s) => s.group === g.id && s.kind !== 'layout');
    return { id: g.id, title: g.title, navigator: g.navigator, screens: inG.length };
  }),
  routeFiles: screens.length,
  inPlaceScreens: drawer.size,
  edges: { total: edges.length, byKind: edgeKinds, certain: count((e) => e.certainty === 'certain'), guessed: count((e) => e.certainty === 'guessed'), inferred: count((e) => e.certainty === 'inferred') },
  guessed: edges.filter((e) => e.certainty === 'guessed').map((e) => ({ from: e.from, to: e.to, kind: e.kind, note: e.note ?? null, site: e.sites[0] })),
  unresolved: manifest.unresolved.map((u) => ({ site: `${u.file}:${u.line}`, call: u.call })),
  broken: broken.map((b) => ({ site: `${b.file}:${b.line}`, value: b.value, kind: b.kind })),
  unreached: manifest.screens.filter((s) => s.kind !== 'layout' && !incoming.has(s.id)).map((s) => ({ id: s.id, kind: s.kind })),
  flagged: screens.filter((s) => s.flags.length).map((s) => ({ id: s.id, flags: s.flags })),
  warnings,
};
return { manifest, report };
}
