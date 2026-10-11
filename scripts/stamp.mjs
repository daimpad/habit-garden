// Writes public/app/build.txt: an 8-character hash over every deployable file
// (app, vendor, styles, assets). index.php appends it as ?v= to asset URLs.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(p)));
    else if (e.name !== 'build.txt') files.push(p);
  }
  return files;
}

const files = [];
for (const d of ['app', 'vendor', 'styles', 'assets']) files.push(...(await walk(join(pub, d))));
files.sort();

const hash = createHash('sha256');
for (const f of files) {
  hash.update(relative(pub, f));
  hash.update(await readFile(f));
}
const stamp = hash.digest('hex').slice(0, 8);
await writeFile(join(pub, 'app', 'build.txt'), `${stamp}\n`);
console.log(`stamp: ${stamp} (${files.length} files)`);
