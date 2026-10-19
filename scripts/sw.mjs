// Writes public/sw.js from scripts/sw.template.js (runs after npm run stamp): the build stamp and the list of
// files to keep offline, relative to the worker's scope so the same file works at "/" (index.php) and under
// a base path (GitHub Pages). The list: the shell "./", manifest.webmanifest and every file under app/,
// vendor/, styles/ and assets/ except source maps, build.txt and licence texts.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(p)));
    else files.push(p);
  }
  return files;
}

const stamp = (await readFile(join(pub, 'app', 'build.txt'), 'utf8').catch(() => '')).trim();
if (!/^[0-9a-f]{8}$/u.test(stamp)) {
  console.error('sw: public/app/build.txt holds no build stamp, run npm run stamp first');
  process.exit(1);
}

const skip = (path) => path.endsWith('.map') || path.endsWith('build.txt') || path.endsWith('.txt');
const files = [];
for (const d of ['app', 'vendor', 'styles', 'assets']) {
  for (const f of await walk(join(pub, d))) {
    const rel = relative(pub, f).split(sep).join('/');
    if (!skip(rel)) files.push(rel);
  }
}
files.sort();
const list = ['./', 'manifest.webmanifest', ...files];

const template = await readFile(join(root, 'scripts', 'sw.template.js'), 'utf8');
// Only the two declarations are filled in (the header comment names the placeholders too).
const STAMP_DECL = 'const STAMP = __STAMP__;';
const FILES_DECL = 'const FILES = __FILES__;';
if (!template.includes(STAMP_DECL) || !template.includes(FILES_DECL)) {
  console.error('sw: placeholders missing in scripts/sw.template.js');
  process.exit(1);
}
const out = template
  .replace(STAMP_DECL, () => `const STAMP = ${JSON.stringify(stamp)};`)
  .replace(FILES_DECL, () => `const FILES = ${JSON.stringify(list, null, 1)};`);
try {
  // Parse only (a broken worker would fail silently in the browser).
  new Function(out);
} catch (err) {
  console.error(`sw: generated worker does not parse: ${err.message}`);
  process.exit(1);
}
await writeFile(join(pub, 'sw.js'), out);
console.log(`sw: public/sw.js (stamp ${stamp}, ${list.length} files)`);
