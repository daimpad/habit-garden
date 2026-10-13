// services/markdown.ts: the pure steps (markdownToHtml before sanitizing, toggleTaskLine, isSafeLink) and the
// source editing helpers of the note editor.
// renderMarkdown() itself needs DOMPurify with a DOM and is checked in the browser.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyEdit, continueList, cycleHeading, insertTagMark, isSafeLink, markdownToHtml, suggestTags, tagTokenAt, toggleCode,
  toggleInline, toggleLines, toggleTaskLine, type TextEdit,
} from '../services/markdown.js';
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

/** Applies an edit and marks the new selection with [ and ] (a caret as |). */
function show(value: string, edit: TextEdit): string {
  const out = applyEdit(value, edit);
  if (edit.selStart === edit.selEnd) return `${out.slice(0, edit.selStart)}|${out.slice(edit.selStart)}`;
  return `${out.slice(0, edit.selStart)}[${out.slice(edit.selStart, edit.selEnd)}]${out.slice(edit.selEnd)}`;
}

describe('toggleInline', () => {
  test('wraps the selection, whitespace stays outside', () => {
    assert.equal(show('ein Wort hier', toggleInline('ein Wort hier', 4, 9, 'bold')), 'ein **[Wort]** hier');
    assert.equal(show('ein Wort', toggleInline('ein Wort', 4, 8, 'italic')), 'ein *[Wort]*');
    assert.equal(show('ein Wort', toggleInline('ein Wort', 4, 8, 'code')), 'ein `[Wort]`');
  });

  test('empty selection inserts the pair with the caret inside', () => {
    assert.equal(show('ab', toggleInline('ab', 1, 1, 'bold')), 'a**|**b');
    assert.equal(show('', toggleInline('', 0, 0, 'italic')), '*|*');
  });

  test('unwraps marked text; bold and italic are told apart', () => {
    assert.equal(show('**Wort**', toggleInline('**Wort**', 2, 6, 'bold')), '[Wort]');
    assert.equal(show('*Wort*', toggleInline('*Wort*', 1, 5, 'italic')), '[Wort]');
    assert.equal(show('**Wort**', toggleInline('**Wort**', 2, 6, 'italic')), '***[Wort]***');
    assert.equal(show('***Wort***', toggleInline('***Wort***', 3, 7, 'italic')), '**[Wort]**');
    assert.equal(show('***Wort***', toggleInline('***Wort***', 3, 7, 'bold')), '*[Wort]*');
    assert.equal(show('`x`', toggleInline('`x`', 1, 2, 'code')), '[x]');
  });
});

describe('cycleHeading', () => {
  test('none → # → ## → none, caret follows', () => {
    const a = 'Titel\nText';
    const e1 = cycleHeading(a, 2, 2);
    assert.equal(show(a, e1), '# Ti|tel\nText');
    const b = applyEdit(a, e1);
    const e2 = cycleHeading(b, e1.selStart, e1.selEnd);
    assert.equal(show(b, e2), '## Ti|tel\nText');
    const c = applyEdit(b, e2);
    assert.equal(show(c, cycleHeading(c, e2.selStart, e2.selEnd)), 'Ti|tel\nText');
  });

  test('works on the caret line only; deeper headings are removed', () => {
    assert.equal(show('eins\n### drei', cycleHeading('eins\n### drei', 12, 12)), 'eins\ndre|i');
    assert.equal(show('eins\nzwei', cycleHeading('eins\nzwei', 5, 5)), 'eins\n# |zwei');
  });
});

describe('toggleLines', () => {
  test('single line: add and remove, caret keeps its place in the text', () => {
    assert.equal(show('Milch', toggleLines('Milch', 2, 2, 'bullet')), '- Mi|lch');
    assert.equal(show('- Milch', toggleLines('- Milch', 4, 4, 'bullet')), 'Mi|lch');
    assert.equal(show('Milch', toggleLines('Milch', 0, 0, 'task')), '- [ ] |Milch');
    assert.equal(show('', toggleLines('', 0, 0, 'ordered')), '1. |');
  });

  test('replaces another marker kind', () => {
    assert.equal(show('- [x] Milch', toggleLines('- [x] Milch', 11, 11, 'bullet')), '- Milch|');
    assert.equal(show('1. Milch', toggleLines('1. Milch', 8, 8, 'task')), '- [ ] Milch|');
  });

  test('several lines: numbered from 1, empty lines kept, toggled off together', () => {
    const v = 'a\n\nb\nc\n';
    const edit = toggleLines(v, 0, v.length, 'ordered');
    assert.equal(applyEdit(v, edit), '1. a\n\n2. b\n3. c\n');
    const w = applyEdit(v, edit);
    assert.equal(applyEdit(w, toggleLines(w, 0, w.length - 1, 'ordered')), v);
  });

  test('keeps indentation', () => {
    assert.equal(applyEdit('  a', toggleLines('  a', 3, 3, 'bullet')), '  - a');
  });
});

describe('toggleCode', () => {
  test('inline within a line, fenced across lines', () => {
    assert.equal(show('x = 1', toggleCode('x = 1', 0, 5)), '`[x = 1]`');
    assert.equal(show('a\nb\nc', toggleCode('a\nb\nc', 2, 5)), 'a\n```\n[b\nc]\n```');
    // A selection ending at the start of a line leaves that line out.
    assert.equal(show('a\nb\nc', toggleCode('a\nb\nc', 2, 4)), 'a\n```\n[b]\n```\nc');
  });
});

describe('insertTagMark', () => {
  test('inserts # with a space after a word, turns a selected word into a tag', () => {
    assert.equal(show('Text', insertTagMark('Text', 4, 4)), 'Text #|');
    assert.equal(show('Text ', insertTagMark('Text ', 5, 5)), 'Text #|');
    assert.equal(show('', insertTagMark('', 0, 0)), '#|');
    assert.equal(show('mein garten', insertTagMark('mein garten', 5, 11)), 'mein #garten|');
  });
});

describe('continueList', () => {
  const enter = (v: string, caret = v.length): string | null => {
    const edit = continueList(v, caret);
    return edit ? show(v, edit) : null;
  };

  test('continues bullets, numbers and tasks', () => {
    assert.equal(enter('- Milch'), '- Milch\n- |');
    assert.equal(enter('* Milch'), '* Milch\n* |');
    assert.equal(enter('9. Neun'), '9. Neun\n10. |');
    assert.equal(enter('1) eins'), '1) eins\n2) |');
    assert.equal(enter('- [x] erledigt'), '- [x] erledigt\n- [ ] |');
    assert.equal(enter('  - tief'), '  - tief\n  - |');
    assert.equal(enter('> - zitat'), '> - zitat\n> - |');
  });

  test('splits the item at the caret', () => {
    assert.equal(enter('- Milch Brot', 8), '- Milch \n- |Brot');
  });

  test('an empty item ends the list', () => {
    assert.equal(enter('- Milch\n- '), '- Milch\n|');
    assert.equal(enter('- Milch\n- [ ] '), '- Milch\n|');
    assert.equal(enter('1. a\n2. '), '1. a\n|');
  });

  test('no list, or caret inside the marker: null', () => {
    assert.equal(enter('Text'), null);
    assert.equal(enter('-kein'), null);
    assert.equal(enter('- Milch', 1), null);
    assert.equal(enter(''), null);
  });
});

describe('tagTokenAt', () => {
  test('finds the token around the caret', () => {
    assert.deepEqual(tagTokenAt('Text #gar', 9), { hash: 5, start: 6, end: 9, query: 'gar' });
    assert.deepEqual(tagTokenAt('Text #garten/bal und', 10), { hash: 5, start: 6, end: 16, query: 'gart' });
    assert.deepEqual(tagTokenAt('#', 1), { hash: 0, start: 1, end: 1, query: '' });
    assert.deepEqual(tagTokenAt('(#a', 3), { hash: 1, start: 2, end: 3, query: 'a' });
  });

  test('no token: inside a word, digits first, headings, code', () => {
    assert.equal(tagTokenAt('a#b', 3), null);
    assert.equal(tagTokenAt('#1a', 3), null);
    assert.equal(tagTokenAt('# Titel', 7), null);
    assert.equal(tagTokenAt('Text ohne', 9), null);
    assert.equal(tagTokenAt('`#code', 6), null);
    assert.equal(tagTokenAt('```\n#fenced', 11), null);
    assert.ok(tagTokenAt('```\nx\n```\n#danach', 17));
  });
});

describe('suggestTags', () => {
  const paths = ['garten', 'garten/balkon', 'garten/beet', 'kochen/herbst', 'lesen', 'produkt/olife', 'balkonien'];

  test('prefix of the path or of a segment, path prefixes first', () => {
    assert.deepEqual(suggestTags(paths, 'bal'), ['balkonien', 'garten/balkon']);
    assert.deepEqual(suggestTags(paths, 'gar'), ['garten', 'garten/balkon', 'garten/beet']);
    assert.deepEqual(suggestTags(paths, 'garten/b'), ['garten/balkon', 'garten/beet']);
    assert.deepEqual(suggestTags(paths, 'Herb'), ['kochen/herbst']);
  });

  test('empty query lists everything (max 6), the query itself and excluded paths are left out', () => {
    assert.equal(suggestTags(paths, '').length, 6);
    assert.deepEqual(suggestTags(paths, 'garten', new Set(['garten/beet'])), ['garten/balkon']);
    assert.deepEqual(suggestTags(paths, 'xyz'), []);
  });
});
