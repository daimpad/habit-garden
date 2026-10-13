// Builds public/assets/icons.svg from lucide-static with an explicit allow-list.
// Each icon becomes <symbol id="i-{name}">; stroke attributes are removed so
// the stylesheet controls them (stroke-width 1.75, currentColor).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const ICONS = [
  'alarm-clock', 'archive', 'arrow-left', 'bell', 'brain', 'calendar', 'check',
  'chevron-down', 'chevron-right', 'chevron-up', 'circle-check', 'clipboard-list',
  'download', 'ellipsis', 'flag', 'flame', 'hard-drive', 'hash', 'inbox', 'info',
  'list-checks', 'notebook-pen', 'pencil', 'plus', 'repeat', 'search', 'settings',
  'shield', 'sprout', 'sun', 'trash-2', 'undo-2', 'upload', 'x',
  // Garden and people (Habit Garden redesign)
  'coffee', 'droplets', 'heart-handshake', 'message-circle', 'moon', 'phone', 'user-plus', 'users',
  // Planung (Phase 3)
  'folder', 'folder-input', 'folder-plus', 'sunrise',
];

const parts = [];
for (const name of ICONS) {
  const file = join(root, 'node_modules', 'lucide-static', 'icons', `${name}.svg`);
  let svg;
  try {
    svg = await readFile(file, 'utf8');
  } catch {
    throw new Error(`sprite: unknown Lucide icon "${name}"`);
  }
  const inner = svg
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/^[\s\S]*?<svg[^>]*>/u, '')
    .replace(/<\/svg>\s*$/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
  parts.push(`<symbol id="i-${name}" viewBox="0 0 24 24">${inner}</symbol>`);
}

const sprite = `<svg xmlns="http://www.w3.org/2000/svg"><!-- Lucide (ISC License), lucide-static 0.400.0 -->${parts.join('')}</svg>\n`;
await mkdir(join(root, 'public', 'assets'), { recursive: true });
await writeFile(join(root, 'public', 'assets', 'icons.svg'), sprite);
console.log(`sprite: ${ICONS.length} icons`);
