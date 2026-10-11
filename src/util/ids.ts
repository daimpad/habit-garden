import type { Id, SortKey } from '../model.js';

export function newId(): Id {
  return crypto.randomUUID();
}

// Fractional index over base-62 digits. Keys compare lexicographically
// (plain string comparison, '0' < '9' < 'A' < 'Z' < 'a' < 'z') and never end with '0',
// so a key strictly between any two keys always exists.
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;

function digit(key: string, i: number): number {
  const ch = key[i];
  if (ch === undefined) return 0;
  const v = DIGITS.indexOf(ch);
  if (v < 0) throw new RangeError(`Invalid sort key: ${key}`);
  return v;
}

/** Returns a key k with a < k < b (null = open end). */
export function sortKeyBetween(a: SortKey | null | undefined, b: SortKey | null | undefined): SortKey {
  const lo = a ?? '';
  let hi: string | null = b ?? null;
  if (hi !== null && lo >= hi) throw new RangeError(`sortKeyBetween: ${lo} >= ${hi}`);
  let out = '';
  for (let i = 0; ; i++) {
    const da = digit(lo, i);
    const db = hi === null ? BASE : i < hi.length ? digit(hi, i) : 0;
    if (db - da > 1) return out + DIGITS[Math.floor((da + db) / 2)];
    out += DIGITS[da];
    // Taking da below hi's digit frees the upper bound for the remaining positions.
    if (db - da === 1) hi = null;
  }
}

/** n keys in ascending order after `after` (null = from the start). */
export function sortKeysAfter(after: SortKey | null | undefined, n: number): SortKey[] {
  const keys: SortKey[] = [];
  let prev = after ?? null;
  for (let i = 0; i < n; i++) {
    prev = sortKeyBetween(prev, null);
    keys.push(prev);
  }
  return keys;
}
