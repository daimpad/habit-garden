// Markdown export of notes (services/notes-export.ts): frontmatter, quoting, order, file names.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Note } from '../model.js';
import { markdownFileName, noteToMarkdown, notesToMarkdown } from '../services/notes-export.js';

const note = (patch: Partial<Note> = {}): Note => ({
  id: 'n1', kind: 'note', title: 'Balkon: "Ideen"', body: '# Balkon\n\nText #garten\n\n', tagPaths: ['garten'], pinned: 1, archived: 0,
  createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-02T08:00:00.000Z', ...patch,
});

describe('markdown export', () => {
  test('frontmatter with quoted strings, then the body', () => {
    assert.equal(noteToMarkdown(note()), [
      '---', 'id: "n1"', 'title: "Balkon: \\"Ideen\\""', 'tags: ["garten"]', 'created: "2026-10-01T08:00:00.000Z"',
      'updated: "2026-10-02T08:00:00.000Z"', 'pinned: true', '---', '', '# Balkon', '', 'Text #garten', '',
    ].join('\n'));
  });
  test('journal and archived fields only when they apply', () => {
    const md = noteToMarkdown(note({ kind: 'journal', journalDay: '2026-10-13', archived: 1, pinned: 0, tagPaths: [] }));
    assert.match(md, /\ntags: \[\]\n/u);
    assert.match(md, /\npinned: false\nkind: "journal"\njournalDay: "2026-10-13"\narchived: true\n---\n/u);
  });
  test('several notes oldest first, separated by a blank line', () => {
    const a = note({ id: 'a', createdAt: '2026-10-05T08:00:00.000Z', body: 'A' });
    const b = note({ id: 'b', createdAt: '2026-10-01T08:00:00.000Z', body: 'B' });
    const md = notesToMarkdown([a, b]);
    assert.ok(md.indexOf('id: "b"') < md.indexOf('id: "a"'));
    assert.match(md, /\nB\n\n---\nid: "a"/u);
  });
  test('file names', () => {
    assert.equal(markdownFileName(null, '2026-10-13'), 'habit-garden-notizen-2026-10-13.md');
    assert.equal(markdownFileName('Kürbissuppe', '2026-10-13'), 'habit-garden-kuerbissuppe-2026-10-13.md');
    assert.equal(markdownFileName('', '2026-10-13'), 'habit-garden-2026-10-13.md');
  });
});
