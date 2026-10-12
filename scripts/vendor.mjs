// Copies the three runtime libraries (ESM) and the Inter font into public/.
// markdown-it 14 ships no self-contained browser ESM build, so it is bundled
// once with esbuild (the only bundler use in this project, vendor/ only).
// Writes public/licenses.txt with the full licence (and NOTICE) texts of
// everything that is delivered (S39); Einstellungen › Info links to it.
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
  legalComments: 'eof',
  // The bundled sources carry no licence comments; the banner names them (full texts: licenses.txt).
  banner: {
    js: '/*! markdown-it (MIT), bundled with entities (BSD-2-Clause), linkify-it, mdurl, punycode.js and uc.micro (MIT). Full licence texts: licenses.txt */',
  },
  logLevel: 'warning',
});

await copyFile(nm('inter-ui/variable/InterVariable.woff2'), out('assets/fonts/InterVariable.woff2'));
await copyFile(nm('inter-ui/LICENSE.txt'), out('assets/fonts/OFL.txt'));

// Licence texts of everything delivered (S39): Habit Garden itself, the runtime libraries
// (markdown-it with the packages bundled into it), the font and the icons.
const LICENSES = [
  { pkg: null, files: ['LICENSE'] },
  { pkg: 'dexie', files: ['LICENSE', 'NOTICE'] },
  { pkg: 'dompurify', files: ['LICENSE'] },
  { pkg: 'markdown-it', files: ['LICENSE'] },
  { pkg: 'entities', files: ['LICENSE'] },
  { pkg: 'linkify-it', files: ['LICENSE'] },
  { pkg: 'mdurl', files: ['LICENSE'] },
  { pkg: 'punycode.js', files: ['LICENSE-MIT.txt'] },
  { pkg: 'uc.micro', files: ['LICENSE.txt'] },
  { pkg: 'inter-ui', files: ['LICENSE.txt'] },
  { pkg: 'lucide-static', files: ['LICENSE'] },
];

const sections = [];
for (const { pkg, files } of LICENSES) {
  const dir = pkg === null ? root : nm(pkg);
  const meta = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const name = pkg === null ? 'Habit Garden' : meta.name;
  const texts = [];
  for (const file of files) texts.push((await readFile(join(dir, file), 'utf8')).trim());
  const rule = '='.repeat(72);
  const license = String(meta.license).replace(/^\((.*)\)$/u, '$1');
  sections.push(`${rule}\n${name} ${meta.version} (${license})\n${rule}\n\n${texts.join(`\n\n${'-'.repeat(72)}\n\n`)}\n`);
}
await writeFile(out('licenses.txt'), `${sections.join('\n\n')}`);

console.log(`vendor: dexie.mjs, purify.mjs, markdown-it.mjs, InterVariable.woff2, licenses.txt (${LICENSES.length} sections)`);
