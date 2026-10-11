// Static checks that tsc cannot express:
// - no explicit `any`, no @ts-ignore / @ts-expect-error
// - no exclamation marks in user-facing texts (src/i18n/de.ts)
// - no string literals with German umlauts outside src/i18n (texts belong in de.ts)
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const problems = [];
for (const file of await walk(src)) {
  const rel = relative(root, file);
  const isTest = rel.includes('__tests__');
  const lines = (await readFile(file, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    const isComment = trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//');
    const code = isComment ? '' : line.replace(/\s\/\/.*$/u, '');
    const at = `${rel}:${i + 1}`;
    if (/(:\s*any\b|<any>|\bas any\b|any\[\])/u.test(code)) problems.push(`${at}: explicit any`);
    if (/@ts-(ignore|expect-error|nocheck)/u.test(line)) problems.push(`${at}: ts suppression`);
    if (rel === join('src', 'i18n', 'de.ts') && /'[^']*!(?!=)[^']*'/u.test(code)) problems.push(`${at}: exclamation mark in UI text`);
    if (!isTest && !rel.startsWith(join('src', 'i18n')) && rel !== join('src', 'model.ts') && /['"`][^'"`]*[äöüÄÖÜß][^'"`]*['"`]/u.test(code)) {
      problems.push(`${at}: German text literal outside i18n`);
    }
  });
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('check: ok');
