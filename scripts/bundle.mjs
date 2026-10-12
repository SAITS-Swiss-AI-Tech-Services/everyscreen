// Bundles the CLI (src/cli.ts and everything it imports) into dist/cli.js.
// Runtime dependencies stay external: they're installed with the package.
import fs from 'node:fs';
import { build } from 'esbuild';

// old chunks from earlier builds would end up in the package
for (const f of fs.existsSync('dist') ? fs.readdirSync('dist') : []) if (f.endsWith('.js')) fs.rmSync(`dist/${f}`);

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
await build({
  entryPoints: ['src/cli.ts'],
  outdir: 'dist',
  bundle: true,
  splitting: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  banner: { js: '#!/usr/bin/env node' },
  define: { __VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'warning',
});
fs.chmodSync('dist/cli.js', 0o755);
