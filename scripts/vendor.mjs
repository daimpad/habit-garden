// Copies the three runtime libraries (ESM) and the Inter font into public/.
// markdown-it 14 ships no self-contained browser ESM build, so it is bundled
// once with esbuild (the only bundler use in this project, vendor/ only).
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => join(root, 'node_modules', p);
const out = (p) => join(root, 'public', p);

const stripSourceMap = (code) => code.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/u, '\n');

async function copyEsm(from, to) {
  const code = await readFile(nm(from), 'utf8');
  await writeFile(out(to), stripSourceMap(code));
}

await mkdir(out('vendor'), { recursive: true });
await mkdir(out('assets/fonts'), { recursive: true });

await copyEsm('dexie/dist/dexie.mjs', 'vendor/dexie.mjs');
await copyEsm('dompurify/dist/purify.es.mjs', 'vendor/purify.mjs');

await build({
  entryPoints: [nm('markdown-it/index.mjs')],
  outfile: out('vendor/markdown-it.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'inline',
  logLevel: 'warning',
});

await copyFile(nm('inter-ui/variable/InterVariable.woff2'), out('assets/fonts/InterVariable.woff2'));
await copyFile(nm('inter-ui/LICENSE.txt'), out('assets/fonts/OFL.txt'));

console.log('vendor: dexie.mjs, purify.mjs, markdown-it.mjs, InterVariable.woff2');
