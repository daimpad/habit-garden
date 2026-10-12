// util/ids.ts: fractional sort keys and ids.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { newId, sortKeyBetween, sortKeysAfter } from '../util/ids.js';

process.env.TZ = 'Europe/Berlin';

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const random = prng(20261011);
const pick = (n: number): number => Math.floor(random() * n);

/** A valid key: 1–6 base-62 digits, never ending with '0'. */
function randomKey(): string {
  const length = 1 + pick(6);
  let key = '';
  for (let i = 0; i < length - 1; i++) key += DIGITS[pick(62)];
  return key + DIGITS[1 + pick(61)];
}

function assertBetween(a: string | null, b: string | null, key: string): void {
  assert.ok(key.length > 0, 'empty key');
  assert.ok(!key.endsWith('0'), `${key} ends with 0`);
  assert.ok(/^[0-9A-Za-z]+$/u.test(key), `${key} has invalid digits`);
  if (a !== null) assert.ok(a < key, `${a} < ${key}`);
  if (b !== null) assert.ok(key < b, `${key} < ${b}`);
}

test('time zone is Europe/Berlin', () => {
  assert.equal(new Date(2026, 0, 15).getTimezoneOffset(), -60);
});

describe('sortKeyBetween', () => {
  test('open ends', () => {
    const first = sortKeyBetween(null, null);
    assertBetween(null, null, first);
    assertBetween(null, first, sortKeyBetween(null, first));
    assertBetween(first, null, sortKeyBetween(first, null));
    assertBetween('z', null, sortKeyBetween('z', null));
    assertBetween(null, '1', sortKeyBetween(null, '1'));
    assertBetween(null, '0001', sortKeyBetween(null, '0001'));
    assertBetween(null, 'V', sortKeyBetween(undefined, 'V'));
  });

  test('many random pairs: a < key < b, never ending with 0', () => {
    for (let i = 0; i < 5000; i++) {
      const x = randomKey();
      const y = randomKey();
      if (x === y) continue;
      const [a, b] = x < y ? [x, y] : [y, x];
      assertBetween(a, b, sortKeyBetween(a, b));
      assertBetween(a, null, sortKeyBetween(a, null));
      assertBetween(null, b, sortKeyBetween(null, b));
    }
  });

  test('adjacent keys (b is a extended by one digit)', () => {
    for (let i = 0; i < 2000; i++) {
      const a = randomKey();
      const b = a + DIGITS[1 + pick(61)];
      assertBetween(a, b, sortKeyBetween(a, b));
    }
  });

  test('random insertions keep a strictly ascending list', () => {
    const keys: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const at = pick(keys.length + 1);
      const key = sortKeyBetween(keys[at - 1] ?? null, keys[at] ?? null);
      keys.splice(at, 0, key);
    }
    for (let i = 1; i < keys.length; i++) assert.ok((keys[i - 1] ?? '') < (keys[i] ?? ''), `order at ${i}`);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(keys.every((k) => !k.endsWith('0')));
  });

  test('repeated prepend and append stay valid', () => {
    let low = sortKeyBetween(null, null);
    let high = low;
    for (let i = 0; i < 300; i++) {
      const before = sortKeyBetween(null, low);
      assertBetween(null, low, before);
      low = before;
      const after = sortKeyBetween(high, null);
      assertBetween(high, null, after);
      high = after;
    }
  });

  test('throws for a >= b', () => {
    assert.throws(() => sortKeyBetween('V', 'V'), RangeError);
    assert.throws(() => sortKeyBetween('W', 'V'), RangeError);
    assert.throws(() => sortKeyBetween('a', 'Z'), RangeError);
  });
});

test('sortKeysAfter returns ascending keys after the start', () => {
  const keys = sortKeysAfter(null, 20);
  assert.equal(keys.length, 20);
  for (let i = 1; i < keys.length; i++) assert.ok((keys[i - 1] ?? '') < (keys[i] ?? ''));
  const tail = sortKeysAfter('V', 3);
  assert.ok(tail.every((k) => k > 'V' && !k.endsWith('0')));
  assert.deepEqual(sortKeysAfter('V', 0), []);
});

test('newId returns distinct UUIDs', () => {
  const ids = new Set(Array.from({ length: 100 }, () => newId()));
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
});
