// Tag paths are lower-case, '/'-separated ("produkt/olife"); every ancestor has its own row (D.3).
import { db } from '../db.js';
import type { Tag } from '../model.js';

const MAX_TAG_PATH = 200;

/**
 * Normalizes a tag path: trims, removes a leading '#', lower-cases,
 * collapses repeated '/', removes leading/trailing '/'. Returns '' for invalid input.
 * Additionally: NFC, whitespace inside a segment becomes '-', no empty segments.
 */
export function normalizeTagPath(input: string): string {
  if (typeof input !== 'string') return '';
  const path = input
    .normalize('NFC')
    .trim()
    .replace(/^#+/u, '')
    .toLocaleLowerCase('de')
    .normalize('NFC')
    .split('/')
    .map((segment) => segment.trim().replace(/\s+/gu, '-'))
    .filter((segment) => segment !== '')
    .join('/');
  return path.length > MAX_TAG_PATH ? '' : path;
}

/** Tag rows for a normalized path and all its ancestors, root first. */
export function tagChain(path: string): Tag[] {
  const segments = path.split('/').filter((s) => s !== '');
  const out: Tag[] = [];
  for (let i = 1; i <= segments.length; i++) {
    out.push({
      path: segments.slice(0, i).join('/'),
      parentPath: i > 1 ? segments.slice(0, i - 1).join('/') : null,
      name: segments[i - 1] ?? '',
    });
  }
  return out;
}

/** Normalizes, drops invalid and duplicate paths (order kept). */
export function normalizeTagPaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map(normalizeTagPath).filter((p) => p !== ''))];
}

/** Creates every path and all its ancestors (parentPath, name) that do not exist yet. */
export async function ensureTags(paths: readonly string[]): Promise<void> {
  const wanted = new Map<string, Tag>();
  for (const path of normalizeTagPaths(paths)) {
    for (const tag of tagChain(path)) if (!wanted.has(tag.path)) wanted.set(tag.path, tag);
  }
  if (wanted.size === 0) return;
  await db.transaction('rw', db.tags, async () => {
    const tags = [...wanted.values()];
    const existing = await db.tags.bulkGet(tags.map((tag) => tag.path));
    const missing = tags.filter((_, i) => existing[i] === undefined);
    if (missing.length > 0) await db.tags.bulkAdd(missing);
  });
}

export function listTags(): Promise<Tag[]> {
  return db.tags.orderBy('path').toArray();
}
