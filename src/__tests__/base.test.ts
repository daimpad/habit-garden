// util/base.ts: base path normalisation, joining and stripping (GitHub Pages project site vs. domain root).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { appBase, appPath, appUrl, normalizeBase, stripBase, withBase } from '../util/base.js';

const PAGES = '/habit-garden/';

describe('normalizeBase', () => {
  const cases: Array<[string | null | undefined, string]> = [
    [undefined, '/'],
    [null, '/'],
    ['', '/'],
    ['/', '/'],
    ['//', '/'],
    ['  /  ', '/'],
    ['/habit-garden/', PAGES],
    ['/habit-garden', PAGES],
    ['habit-garden', PAGES],
    ['habit-garden/', PAGES],
    ['//habit-garden//', PAGES],
    ['/a/b', '/a/b/'],
    ['/a/./../b/', '/a/b/'],
  ];
  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} → ${expected}`, () => {
      assert.equal(normalizeBase(input), expected);
    });
  }
});

describe('withBase', () => {
  test('domain root keeps internal paths unchanged', () => {
    assert.equal(withBase('/', '/heute'), '/heute');
    assert.equal(withBase('/', '/'), '/');
    assert.equal(withBase('/', '/wissen?tag=a/b,c&op=and'), '/wissen?tag=a/b,c&op=and');
    assert.equal(withBase('/', '/assets/icons.svg'), '/assets/icons.svg');
  });

  test('project site prefixes the base', () => {
    assert.equal(withBase(PAGES, '/heute'), '/habit-garden/heute');
    assert.equal(withBase(PAGES, '/'), PAGES);
    assert.equal(withBase(PAGES, '/aufgabe/a%2Fb'), '/habit-garden/aufgabe/a%2Fb');
    assert.equal(withBase(PAGES, '/wissen?tag=x'), '/habit-garden/wissen?tag=x');
    assert.equal(withBase(PAGES, 'licenses.txt'), '/habit-garden/licenses.txt');
    assert.equal(withBase('/habit-garden', '/start'), '/habit-garden/start');
  });

  test('a protocol-relative path cannot leave the origin', () => {
    assert.equal(withBase('/', '//example.org/x'), '/example.org/x');
  });
});

describe('stripBase', () => {
  test('domain root: every root-relative path is internal', () => {
    assert.equal(stripBase('/', '/heute'), '/heute');
    assert.equal(stripBase('/', '/'), '/');
    assert.equal(stripBase('/', '/licenses.txt'), '/licenses.txt');
    assert.equal(stripBase('/', 'heute'), null);
  });

  test('project site: paths under the base', () => {
    assert.equal(stripBase(PAGES, '/habit-garden/heute'), '/heute');
    assert.equal(stripBase(PAGES, '/habit-garden/aufgabe/t1'), '/aufgabe/t1');
    assert.equal(stripBase(PAGES, '/habit-garden/'), '/');
    assert.equal(stripBase(PAGES, '/habit-garden'), '/');
    assert.equal(stripBase(PAGES, '/habit-garden?x=1'), '/?x=1');
    assert.equal(stripBase(PAGES, '/habit-garden/wissen?tag=a/b#top'), '/wissen?tag=a/b#top');
    assert.equal(stripBase(PAGES, '/habit-garden/licenses.txt'), '/licenses.txt');
  });

  test('project site: paths outside the base', () => {
    assert.equal(stripBase(PAGES, '/heute'), null);
    assert.equal(stripBase(PAGES, '/'), null);
    assert.equal(stripBase(PAGES, '/habit-gardener/heute'), null);
    assert.equal(stripBase(PAGES, '/other/habit-garden/heute'), null);
    assert.equal(stripBase(PAGES, '/x?/habit-garden/'), null);
    assert.equal(stripBase(PAGES, 'habit-garden/heute'), null);
  });

  test('withBase and stripBase round-trip', () => {
    for (const path of ['/heute', '/planung/p/p1', '/wissen?tag=a/b,c', '/aufgabe/a%20b', '/']) {
      assert.equal(stripBase(PAGES, withBase(PAGES, path)), path);
      assert.equal(stripBase('/', withBase('/', path)), path);
    }
  });
});

describe('base from the document', () => {
  test('without a document the base is "/"', () => {
    assert.equal(appBase(), '/');
    assert.equal(appUrl('/heute'), '/heute');
    assert.equal(appPath('/heute'), '/heute');
  });
});
