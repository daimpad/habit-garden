// CONTRACT STUB – implemented in AP5.
import type { Tag } from '../model.js';

/**
 * Normalizes a tag path: trims, removes a leading '#', lower-cases,
 * collapses repeated '/', removes leading/trailing '/'. Returns '' for invalid input.
 */
export function normalizeTagPath(input: string): string {
  throw new Error(`not implemented: normalizeTagPath ${input}`);
}

/** Creates every path and all its ancestors (parentPath, name) that do not exist yet. */
export function ensureTags(paths: readonly string[]): Promise<void> {
  throw new Error(`not implemented: ensureTags ${paths.length}`);
}

export function listTags(): Promise<Tag[]> {
  throw new Error('not implemented: listTags');
}
