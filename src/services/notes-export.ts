// Markdown export of notes (A.2 W6, C.4 transfer): all notes in one file, or one note from the editor ⋯.
// Each note starts with YAML frontmatter (id, title, tags, created, updated, pinned; plus kind, journal day
// and archived where they apply), followed by its text. The frontmatter blocks (`---` … `---`) separate
// the notes, so the file stays readable in any editor and can be split again later.
// Strings are always double-quoted (escaping \ and "), so titles with ":" or "#" stay valid YAML.
import { fmt, t } from '../i18n/de.js';
import type { Day, Note } from '../model.js';
import { today } from '../util/date.js';
import { downloadIcs, slugify, type IcsDelivery } from './ics.js';

function quote(value: string): string {
  return `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"').replace(/\r?\n/gu, ' ')}"`;
}

/** One note as frontmatter + body (body ends with a single newline). */
export function noteToMarkdown(note: Note): string {
  const lines = [
    '---',
    `id: ${quote(note.id)}`,
    `title: ${quote(note.title)}`,
    `tags: [${note.tagPaths.map(quote).join(', ')}]`,
    `created: ${quote(note.createdAt)}`,
    `updated: ${quote(note.updatedAt)}`,
    `pinned: ${note.pinned === 1 ? 'true' : 'false'}`,
  ];
  if (note.kind === 'journal') lines.push('kind: "journal"');
  if (note.journalDay) lines.push(`journalDay: ${quote(note.journalDay)}`);
  if (note.archived === 1) lines.push('archived: true');
  lines.push('---', '');
  return `${lines.join('\n')}\n${note.body.replace(/\s+$/u, '')}\n`;
}

/** All notes, oldest first (stable order for diffs), separated by a blank line. */
export function notesToMarkdown(notes: readonly Note[]): string {
  return [...notes]
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
    .map(noteToMarkdown)
    .join('\n');
}

/** "habit-garden-notizen-JJJJ-MM-TT.md", or "habit-garden-<titel>-JJJJ-MM-TT.md" for one note. */
export function markdownFileName(title: string | null, day: Day = today()): string {
  const slug = title === null ? slugify(t.notesFileSlug) : slugify(title);
  return slug ? `habit-garden-${slug}-${day}.md` : `habit-garden-${day}.md`;
}

export type MarkdownExportResult = { notes: number; delivery: IcsDelivery | 'empty' | 'failed' };

async function toast(message: string): Promise<void> {
  const { showToast } = await import('../components/ol-toast.js');
  showToast(message);
}

/** Hands a Markdown file over (share sheet on touch devices, download elsewhere); never rejects. */
export async function exportNotesMarkdown(notes: readonly Note[], single: Note | null = null): Promise<MarkdownExportResult> {
  try {
    if (notes.length === 0) {
      await toast(t.notesExportEmpty);
      return { notes: 0, delivery: 'empty' };
    }
    const text = notesToMarkdown(notes);
    const delivery = await downloadIcs(markdownFileName(single ? single.title : null), text, 'text/markdown');
    if (delivery !== 'cancelled') await toast(notes.length === 1 ? t.notesExportDoneOne : fmt(t.notesExportDone, { n: notes.length }));
    return { notes: notes.length, delivery };
  } catch (err) {
    console.error(err);
    await toast(t.notesExportFailed).catch(() => undefined);
    return { notes: 0, delivery: 'failed' };
  }
}

// --- Import (W6): the same format back in ---
// A note starts with a frontmatter block: a line `---`, then `key: value` lines (at least `id` or
// `title`), then `---`. Everything up to the next such block is the body. A `---` line inside a body
// (a Markdown rule) only counts as a new block when key lines and a closing `---` follow. A file
// without any frontmatter becomes one new note. Strings may be quoted ("…" with \" and \\) or bare.

export interface ParsedNote {
  id?: string;
  title?: string;
  tags: string[];
  created?: string;
  updated?: string;
  pinned: boolean;
  archived: boolean;
  kind: 'note' | 'journal';
  journalDay?: string;
  body: string;
}

const KEY_LINE = /^([A-Za-z]+):\s*(.*)$/u;

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\(["\\])/gu, '$1');
  return v;
}

function parseList(raw: string): string[] {
  const v = raw.trim();
  if (!v.startsWith('[') || !v.endsWith(']')) return v ? [unquote(v)] : [];
  const out: string[] = [];
  for (const m of v.slice(1, -1).matchAll(/"((?:[^"\\]|\\.)*)"|([^,\s][^,]*)/gu)) {
    const item = m[1] !== undefined ? m[1].replace(/\\(["\\])/gu, '$1') : (m[2] ?? '').trim();
    if (item) out.push(item);
  }
  return out;
}

/** Index of the closing `---` of a frontmatter block opening at `start`, or -1. */
function frontmatterEnd(lines: readonly string[], start: number): number {
  if (lines[start]?.trim() !== '---') return -1;
  let keys = 0;
  for (let i = start + 1; i < lines.length && i <= start + 20; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '---') return keys > 0 ? i : -1;
    const m = KEY_LINE.exec(line);
    if (!m) return -1;
    if (m[1] === 'id' || m[1] === 'title') keys += 1;
  }
  return -1;
}

export function parseNotesMarkdown(text: string): ParsedNote[] {
  const lines = text.replace(/^\uFEFF/u, '').split(/\r?\n/u);
  const starts: Array<{ open: number; close: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const close = frontmatterEnd(lines, i);
    if (close > 0) {
      starts.push({ open: i, close });
      i = close;
    }
  }
  if (starts.length === 0) {
    const body = text.trim();
    return body ? [{ tags: [], pinned: false, archived: false, kind: 'note', body: `${body}\n` }] : [];
  }
  return starts.map(({ open, close }, n) => {
    const note: ParsedNote = { tags: [], pinned: false, archived: false, kind: 'note', body: '' };
    for (const line of lines.slice(open + 1, close)) {
      const m = KEY_LINE.exec(line);
      if (!m) continue;
      const key = m[1] ?? '';
      const raw = m[2] ?? '';
      if (key === 'id') note.id = unquote(raw);
      else if (key === 'title') note.title = unquote(raw);
      else if (key === 'tags') note.tags = parseList(raw);
      else if (key === 'created') note.created = unquote(raw);
      else if (key === 'updated') note.updated = unquote(raw);
      else if (key === 'pinned') note.pinned = unquote(raw) === 'true';
      else if (key === 'archived') note.archived = unquote(raw) === 'true';
      else if (key === 'kind') note.kind = unquote(raw) === 'journal' ? 'journal' : 'note';
      else if (key === 'journalDay') note.journalDay = unquote(raw);
    }
    const end = starts[n + 1]?.open ?? lines.length;
    const bodyLines = lines.slice(close + 1, end);
    while (bodyLines.length > 0 && (bodyLines[0] ?? '').trim() === '') bodyLines.shift();
    while (bodyLines.length > 0 && (bodyLines[bodyLines.length - 1] ?? '').trim() === '') bodyLines.pop();
    note.body = bodyLines.length ? `${bodyLines.join('\n')}\n` : '';
    return note;
  });
}
