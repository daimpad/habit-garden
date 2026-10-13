// WISSEN helpers (services/notes.ts): title, preview, inline tags, tag filter and tree, search, URL state.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Note } from '../model.js';
import {
  buildTagTree, deriveTitle, explicitTags, filterNotes, inlineTags, matchesTags, matchRange, mergeTags,
  parseTagQuery, previewLine, relativeTime, tagQueryString, tagTint,
} from '../services/notes.js';

process.env.TZ = 'Europe/Berlin';

let seq = 0;
const note = (patch: Partial<Note> = {}): Note => ({
  id: `n${++seq}`, kind: 'note', title: 'X', body: '', tagPaths: [], pinned: 0, archived: 0,
  createdAt: '2026-10-01T08:00:00.000Z', updatedAt: `2026-10-0${(seq % 9) + 1}T08:00:00.000Z`, ...patch,
});

describe('title and preview', () => {
  test('title is the first line without Markdown marks', () => {
    assert.equal(deriveTitle('# Balkon – Ideen\n\nText'), 'Balkon – Ideen');
    assert.equal(deriveTitle('\n\n- [ ] **Erde** kaufen'), 'Erde kaufen');
    assert.equal(deriveTitle('   \n'), '');
  });
  test('preview is the next line with text, code fences skipped', () => {
    assert.equal(previewLine('# Titel\n\n```\ncode\n```\n> Zitat hier'), 'code');
    assert.equal(previewLine('Titel\n\nZweite *Zeile*'), 'Zweite Zeile');
    assert.equal(previewLine('Nur Titel'), '');
  });
});

describe('inline tags', () => {
  test('finds #a/b, normalises, ignores headings, code and numbers', () => {
    const body = '# Überschrift\nText #Produkt/Olife und (#journal) #1 #\n`#nicht` \n```\n#auch-nicht\n```\nEnde #data/dcat.';
    assert.deepEqual(inlineTags(body), ['produkt/olife', 'journal', 'data/dcat']);
  });
  test('not inside words or URLs', () => {
    assert.deepEqual(inlineTags('mail a#b https://x.de/#anker'), []);
  });
  test('explicit = stored minus inline; merge keeps explicit first', () => {
    const n = note({ body: 'x #a', tagPaths: ['b', 'a'] });
    assert.deepEqual(explicitTags(n), ['b']);
    assert.deepEqual(mergeTags(['b'], 'neu #c #b'), ['b', 'c']);
  });
});

describe('tag filter and tree', () => {
  test('parent tag matches children; AND and OR', () => {
    assert.equal(matchesTags(['produkt/olife'], ['produkt'], 'or'), true);
    assert.equal(matchesTags(['produktion'], ['produkt'], 'or'), false);
    assert.equal(matchesTags(['a', 'b/c'], ['a', 'b'], 'and'), true);
    assert.equal(matchesTags(['a'], ['a', 'b'], 'and'), false);
    assert.equal(matchesTags(['a'], ['a', 'b'], 'or'), true);
    assert.equal(matchesTags([], [], 'and'), true);
  });
  test('tree with counts, empty tags left out', () => {
    const notes = [note({ tagPaths: ['produkt/olife'] }), note({ tagPaths: ['produkt/garten', 'journal/2026/10'] })];
    const tree = buildTagTree([{ path: 'leer' }, { path: 'produkt' }], notes);
    assert.deepEqual(tree.map((n) => `${n.path}:${n.count}`), ['journal:1', 'produkt:2']);
    assert.deepEqual(tree[1]?.children.map((n) => `${n.name}:${n.count}:${n.depth}`), ['garten:1:1', 'olife:1:1']);
    assert.equal(tree[0]?.children[0]?.children[0]?.path, 'journal/2026/10');
  });
  test('URL state round trip', () => {
    assert.equal(tagQueryString(['a/b', 'c'], 'and'), '?tag=a/b,c&op=and');
    assert.equal(tagQueryString(['a'], 'or'), '?tag=a');
    assert.equal(tagQueryString([], 'and'), '');
    assert.deepEqual(parseTagQuery('?tag=a/b,C&op=and'), { tags: ['a/b', 'c'], op: 'and' });
    assert.deepEqual(parseTagQuery(''), { tags: [], op: 'or' });
    assert.deepEqual(parseTagQuery(tagQueryString(['grüße/ä'], 'or')), { tags: ['grüße/ä'], op: 'or' });
  });
});

describe('search', () => {
  test('rank title > tag > body, then newest first', () => {
    const a = note({ title: 'Garten', body: 'x', updatedAt: '2026-10-01T08:00:00.000Z' });
    const b = note({ title: 'Y', tagPaths: ['garten/beet'], updatedAt: '2026-10-05T08:00:00.000Z' });
    const c = note({ title: 'Z', body: 'Im Garten', updatedAt: '2026-10-09T08:00:00.000Z' });
    const d = note({ title: 'Anderes', updatedAt: '2026-10-10T08:00:00.000Z' });
    assert.deepEqual(filterNotes([c, b, a, d], 'gärten'.replace('ä', 'a'), [], 'or').map((n) => n.id), [a.id, b.id, c.id]);
    assert.deepEqual(filterNotes([a, d], '', [], 'or').map((n) => n.id), [d.id, a.id]);
    assert.deepEqual(filterNotes([a, b], '', ['garten'], 'or').map((n) => n.id), [b.id]);
  });
  test('match range for highlighting', () => {
    assert.deepEqual(matchRange('Schöne Blüte', 'blute'), [7, 12]);
    assert.equal(matchRange('Straße', 'strasse'), null);
    assert.equal(matchRange('abc', ''), null);
  });
});

describe('display', () => {
  const texts = { justNow: 'gerade eben', minutesAgo: (n: number) => `vor ${n} Min.` };
  const now = new Date('2026-10-13T10:00:00+02:00');
  test('relative time', () => {
    assert.equal(relativeTime('2026-10-13T07:59:40.000Z', now, texts), 'gerade eben');
    assert.equal(relativeTime('2026-10-13T07:45:00.000Z', now, texts), 'vor 15 Min.');
    assert.equal(relativeTime('2026-10-13T05:12:00.000Z', now, texts), '07:12');
    assert.equal(relativeTime('2026-10-09T08:00:00.000Z', now, texts), 'Fr');
    assert.equal(relativeTime('2026-09-30T08:00:00.000Z', now, texts), '30.09.');
  });
  test('tag tint is stable per root and uses stored colours', () => {
    assert.equal(tagTint('garten/beet'), tagTint('garten/rosen'));
    assert.equal(tagTint('garten', new Map([['garten', '#123456']])), '#123456');
    assert.equal(tagTint(undefined), undefined);
  });
});
