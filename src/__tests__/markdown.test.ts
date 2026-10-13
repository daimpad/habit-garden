// services/markdown.ts: the pure steps (markdownToHtml before sanitizing, toggleTaskLine, isSafeLink).
// renderMarkdown() itself needs DOMPurify with a DOM and is checked in the browser.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isSafeLink, markdownToHtml, toggleTaskLine } from '../services/markdown.js';
import { inlineTags } from '../services/notes.js';

const tagsIn = (html: string): string[] => [...html.matchAll(/data-tag="([^"]*)"/gu)].map((m) => m[1] ?? '');

describe('markdownToHtml: basics', () => {
  test('html: false escapes raw HTML', () => {
    const html = markdownToHtml('<script>alert(1)</script> <b>x</b>');
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  test('breaks: a single newline becomes <br>', () => {
    assert.match(markdownToHtml('eins\nzwei'), /eins<br>\s*zwei/u);
  });

  test('headings are shifted one level down', () => {
    const html = markdownToHtml('# Eins\n\n## Zwei\n\n###### Sechs');
    assert.match(html, /<h2>Eins<\/h2>/u);
    assert.match(html, /<h3>Zwei<\/h3>/u);
    assert.match(html, /<h6>Sechs<\/h6>/u);
    assert.ok(!html.includes('<h1'));
  });

  test('table alignment becomes a class, no style attribute', () => {
    const html = markdownToHtml('| a | b | c |\n|:-|:-:|-:|\n| 1 | 2 | 3 |');
    assert.ok(!html.includes('style='));
    assert.match(html, /<th class="ol-md-align-left">a<\/th>/u);
    assert.match(html, /<td class="ol-md-align-center">2<\/td>/u);
    assert.match(html, /<td class="ol-md-align-right">3<\/td>/u);
  });
});

describe('markdownToHtml: links', () => {
  test('links open in a new tab without referrer', () => {
    const html = markdownToHtml('[Seite](https://example.org/a)');
    assert.match(html, /<a href="https:\/\/example.org\/a" target="_blank" rel="noopener noreferrer">Seite<\/a>/u);
  });

  test('linkify turns bare addresses into links', () => {
    assert.match(markdownToHtml('siehe www.example.org'), /<a href="http:\/\/www.example.org" target="_blank"/u);
  });

  test('javascript:, data: and other schemes are dropped', () => {
    for (const src of ['[x](javascript:alert(1))', '[x](JaVaScRiPt:alert(1))', '[x](data:text/html,hi)', '[x](vbscript:x)', '[x](ftp://a.b/c)']) {
      const html = markdownToHtml(src);
      assert.ok(!/<a /u.test(html), `${src} → ${html}`);
    }
  });

  test('images become links (no remote <img>)', () => {
    const html = markdownToHtml('![Ein Bild](https://example.org/a.png)');
    assert.ok(!html.includes('<img'));
    assert.match(html, /<a href="https:\/\/example.org\/a.png" target="_blank" rel="noopener noreferrer" class="ol-md-image">Ein Bild<\/a>/u);
  });

  test('isSafeLink', () => {
    assert.equal(isSafeLink('https://a.b'), true);
    assert.equal(isSafeLink('mailto:a@b.c'), true);
    assert.equal(isSafeLink('tel:+491234'), true);
    assert.equal(isSafeLink('/wissen'), true);
    assert.equal(isSafeLink('#anker'), true);
    assert.equal(isSafeLink('javascript:x'), false);
    assert.equal(isSafeLink(' javascript:x'), false);
    assert.equal(isSafeLink('data:image/png;base64,AA'), false);
  });
});

describe('markdownToHtml: task lists', () => {
  test('open and done items with source lines', () => {
    const html = markdownToHtml('Titel\n\n- [ ] offen\n- [x] erledigt\n- [X] auch erledigt\n- normal');
    assert.match(html, /<ul class="ol-md-tasklist">/u);
    assert.match(html, /<li class="ol-md-task"><span class="ol-md-check" role="checkbox" aria-checked="false" data-line="2" tabindex="0"><\/span>offen<\/li>/u);
    assert.match(html, /<li class="ol-md-task ol-md-task--done"><span class="ol-md-check" role="checkbox" aria-checked="true" data-line="3" tabindex="0"><\/span>erledigt<\/li>/u);
    assert.match(html, /data-line="4"/u);
    assert.match(html, /<li>normal<\/li>/u);
  });

  test('ordered, nested and quoted task items', () => {
    const html = markdownToHtml('1. [ ] eins\n   - [x] unten\n\n> - [ ] zitat');
    assert.match(html, /<ol class="ol-md-tasklist">/u);
    assert.match(html, /data-line="0"[^>]*><\/span>eins/u);
    assert.match(html, /aria-checked="true" data-line="1"/u);
    assert.match(html, /<blockquote>\s*<ul class="ol-md-tasklist">\s*<li class="ol-md-task"><span[^>]*data-line="3"/u);
  });

  test('brackets elsewhere are no tasks', () => {
    const html = markdownToHtml('[ ] kein Listenpunkt\n\n- [] leer\n- [ ]x ohne Abstand');
    assert.ok(!html.includes('ol-md-check'), html);
  });

  test('item text with a tag right after the box', () => {
    const html = markdownToHtml('- [ ] #einkauf Milch');
    assert.deepEqual(tagsIn(html), ['einkauf']);
  });
});

describe('markdownToHtml: inline tags', () => {
  test('tags after line start, whitespace and brackets', () => {
    const html = markdownToHtml('#start mitten #produkt/olife (#klammer) [#eckig] a,#komma');
    assert.deepEqual(tagsIn(html), ['start', 'produkt/olife', 'klammer', 'eckig', 'komma']);
    assert.match(html, /<span class="ol-md-tag" data-tag="produkt\/olife">#produkt\/olife<\/span>/u);
  });

  test('no tags inside words, after emphasis, in code, links or escaped', () => {
    const src = 'a#b **fett**#nein `#code` [text #link](https://a.b) \\#escaped #1zahl\n\n```\n#fenced\n```\n\n    #indented';
    assert.deepEqual(tagsIn(markdownToHtml(src)), []);
  });

  test('display keeps the original spelling, data-tag is normalized', () => {
    const html = markdownToHtml('#Produkt/OLife');
    assert.match(html, /data-tag="produkt\/olife">#Produkt\/OLife<\/span>/u);
  });

  test('a heading line is not a tag, a tag in a heading is', () => {
    assert.deepEqual(tagsIn(markdownToHtml('# Titel #thema')), ['thema']);
  });

  test('underscores and hyphens stay inside the tag', () => {
    assert.deepEqual(tagsIn(markdownToHtml('#a_b-c/d_e und mehr')), ['a_b-c/d_e']);
  });

  test('agrees with inlineTags() of services/notes', () => {
    const body = 'Notiz #eins\n\n- [ ] #zwei/drei Text\n\n`#nein` und (#vier) **x**#nein #Fünf/Sechs';
    assert.deepEqual(tagsIn(markdownToHtml(body)), inlineTags(body));
  });

  test('tag text is escaped', () => {
    const html = markdownToHtml('#tag<b>');
    assert.ok(!html.includes('<b>'));
  });
});

describe('toggleTaskLine', () => {
  const src = 'Titel\n- [ ] offen\n- [x] erledigt\n  * [X] tief\n> 1. [ ] zitat\nkein [ ] task\n- normal';

  test('flips open and done boxes on the given line', () => {
    const lines = (s: string): string[] => s.split('\n');
    assert.equal(lines(toggleTaskLine(src, 1))[1], '- [x] offen');
    assert.equal(lines(toggleTaskLine(src, 2))[2], '- [ ] erledigt');
    assert.equal(lines(toggleTaskLine(src, 3))[3], '  * [ ] tief');
    assert.equal(lines(toggleTaskLine(src, 4))[4], '> 1. [x] zitat');
  });

  test('only the given line changes', () => {
    const out = toggleTaskLine(src, 1).split('\n');
    const before = src.split('\n');
    out.forEach((line, i) => {
      if (i !== 1) assert.equal(line, before[i]);
    });
  });

  test('no-op on other lines and out of range', () => {
    for (const line of [0, 5, 6, 7, 99, -1, 1.5]) assert.equal(toggleTaskLine(src, line), src);
  });

  test('round trip and CRLF line endings', () => {
    assert.equal(toggleTaskLine(toggleTaskLine(src, 1), 1), src);
    assert.equal(toggleTaskLine('a\r\n- [ ] b\r\n', 1), 'a\r\n- [x] b\r\n');
  });

  test('line numbers from markdownToHtml toggle the right item', () => {
    const body = '# Einkauf\n\nText\n\n- [ ] Milch\n- [ ] Brot';
    const line = Number(/data-line="(\d+)"[^>]*><\/span>Brot/u.exec(markdownToHtml(body))?.[1]);
    assert.equal(toggleTaskLine(body, line), '# Einkauf\n\nText\n\n- [ ] Milch\n- [x] Brot');
  });
});
