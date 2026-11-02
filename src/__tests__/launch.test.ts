// Schneller Zugriff (services/launch.ts): shortcut and share queries.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseLaunch, SHARE_MAX, stripLaunch } from '../services/launch.js';

describe('launch', () => {
  test('shortcuts', () => {
    assert.deepEqual(parseLaunch('?do=water'), { action: 'water' });
    assert.deepEqual(parseLaunch('?do=task'), { action: 'task' });
    assert.deepEqual(parseLaunch('?do=note'), { action: 'note' });
    assert.deepEqual(parseLaunch('?do=mood'), { action: 'mood' });
    assert.equal(parseLaunch('?do=delete'), null);
    assert.equal(parseLaunch(''), null);
  });
  test('shared title, text and link become one line without repeats', () => {
    assert.deepEqual(parseLaunch('?st=Artikel&sx=Lesenswert&su=https%3A%2F%2Fexample.org%2Fa'), { share: 'Artikel Lesenswert https://example.org/a' });
    // The link is part of the text already; the title equals the text.
    assert.deepEqual(parseLaunch('?st=Lesenswert&sx=Lesenswert+https%3A%2F%2Fexample.org&su=https%3A%2F%2Fexample.org'), { share: 'Lesenswert https://example.org' });
    assert.deepEqual(parseLaunch('?sx=++zwei+%0A+Zeilen++'), { share: 'zwei Zeilen' });
    assert.equal(parseLaunch('?st=&sx=&su='), null);
    const long = parseLaunch(`?sx=${'a'.repeat(SHARE_MAX + 50)}`);
    assert.ok(long && 'share' in long && long.share.length === SHARE_MAX);
  });
  test('only the launch keys are taken off the address', () => {
    assert.equal(stripLaunch('?do=task'), '');
    assert.equal(stripLaunch('?st=a&sx=b&su=c'), '');
    assert.equal(stripLaunch('?do=task&tag=x'), '?tag=x');
    assert.equal(stripLaunch(''), '');
  });
});
