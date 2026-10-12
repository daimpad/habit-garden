// Static build for GitHub Pages (npm run build:pages, runs after npm run build). Writes dist/pages/:
// app/, vendor/, styles/, assets/ and licenses.txt from public/ (no index.php, no .htaccess),
// index.html, an identical 404.html (Pages answers unknown paths with it, so deep links and reloads
// boot the app) and .nojekyll.
//
// The HTML is derived from public/index.php, the single source for structure, texts, import map
// entries and security policy:
// - BASE_PATH (normalized, default "/", e.g. "/habit-garden/") prefixes every URL, each with ?v=<stamp>;
//   <meta name="olife-base"> carries it to the app (util/base.ts).
// - Pages sets no custom headers. The CSP becomes <meta http-equiv> right after the charset, with the
//   sha256 of the import map exactly as emitted and without frame-ancestors (ignored in a meta, with a
//   console error); Referrer-Policy becomes <meta name="referrer">. HSTS, X-Content-Type-Options and
//   Permissions-Policy have no meta form.
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const out = join(root, 'dist', 'pages');

function fail(message) {
  console.error(`pages: ${message}`);
  process.exit(1);
}

function attr(value) {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

// The app's own base-path helpers (compiled by npm run build), so both sides normalize alike.
let normalizeBase;
let withBase;
try {
  ({ normalizeBase, withBase } = await import('../public/app/util/base.js'));
} catch {
  fail('public/app/ is missing, run npm run build first');
}

const base = normalizeBase(process.env.BASE_PATH);

const stamp = (await readFile(join(pub, 'app', 'build.txt'), 'utf8').catch(() => '')).trim();
if (!/^[0-9a-f]{8}$/u.test(stamp)) fail('public/app/build.txt holds no build stamp, run npm run build first');
const v = `?v=${stamp}`;

// --- Read index.php: PHP part (headers, import map) and the HTML template after "?>".
const php = await readFile(join(pub, 'index.php'), 'utf8');
const end = php.indexOf('?>');
if (end < 0) fail('index.php: no "?>" before the HTML');
const code = php.slice(0, end);
// PHP drops a single newline right after "?>".
const template = php.slice(end + 2).replace(/^\r?\n/u, '');

const cspTemplate = /header\("Content-Security-Policy: ([^"]+)"\);/u.exec(code)?.[1];
if (!cspTemplate || !cspTemplate.includes("'sha256-{$mapHash}'")) fail('index.php: Content-Security-Policy with {$mapHash} not found');
const referrer = /header\('Referrer-Policy: ([^']+)'\);/u.exec(code)?.[1];
if (!referrer) fail('index.php: Referrer-Policy not found');
const mapBlock = /json_encode\(\['imports' => \[([\s\S]*?)\]\]/u.exec(code)?.[1] ?? '';
const entries = [...mapBlock.matchAll(/'([^']+)' => '(\/[^']+)' \. \$v,?/gu)];
if (entries.length === 0) fail('index.php: import map entries not found');

// --- Import map and its hash: the same string is hashed and emitted (json_encode with
// JSON_UNESCAPED_SLASHES and JSON.stringify agree for these ASCII paths).
const importMap = JSON.stringify({ imports: Object.fromEntries(entries.map(([, name, path]) => [name, withBase(base, path) + v])) });
const mapHash = createHash('sha256').update(importMap, 'utf8').digest('base64');
const csp = cspTemplate
  .replace('{$mapHash}', mapHash)
  .split(';')
  .map((directive) => directive.trim())
  .filter((directive) => directive !== '' && !directive.startsWith('frame-ancestors'))
  .join('; ');

// --- HTML: fill the PHP echoes, prefix root-relative URLs with the base, add the policy metas.
const vars = { $build: stamp, $v: v, $importMap: importMap };
let html = template.replace(/<\?=\s*(\$\w+)\s*\?>/gu, (match, name) => {
  if (!(name in vars)) fail(`index.php: unknown echo ${match}`);
  return vars[name];
});
if (html.includes('<?')) fail('index.php: PHP code in the HTML part');

let prefixed = 0;
html = html.replace(/\b(href|src)="\/(?!\/)/gu, (match, name) => {
  prefixed++;
  return `${name}="${base}`;
});
if (prefixed < 5) fail(`index.php: expected stylesheet and module URLs, found ${prefixed}`);

const baseMeta = '<meta name="olife-base" content="/">';
if (!html.includes(baseMeta)) fail('index.php: <meta name="olife-base" content="/"> not found');
html = html.replace(baseMeta, () => `<meta name="olife-base" content="${attr(base)}">`);

const charset = /<meta charset="utf-8">\r?\n/u.exec(html);
if (!charset) fail('index.php: <meta charset="utf-8"> not found');
const at = charset.index + charset[0].length;
html = `${html.slice(0, at)}<meta http-equiv="Content-Security-Policy" content="${attr(csp)}">\n`
  + `<meta name="referrer" content="${attr(referrer)}">\n${html.slice(at)}`;

const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gu)].filter((m) => m[1] !== '');
if (inline.length !== 1 || inline[0]?.[1] !== importMap) fail('the import map must be the only inline script');

// --- Output
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const dir of ['app', 'vendor', 'styles', 'assets']) {
  await cp(join(pub, dir), join(out, dir), { recursive: true });
}
await cp(join(pub, 'licenses.txt'), join(out, 'licenses.txt'));
await writeFile(join(out, 'index.html'), html);
await writeFile(join(out, '404.html'), html);
await writeFile(join(out, '.nojekyll'), '');
console.log(`pages: dist/pages (base ${base}, stamp ${stamp})`);
