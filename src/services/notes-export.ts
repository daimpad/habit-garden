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
