// Notes (Phase 4, A.2 W1–W4): created by the editor, the capture sheet and the journal sheet.
// updateNote derives the title from the first line (W3) and the stored tags from explicit + inline tags (W4);
// journal notes keep their fixed title ("YYYY-MM-DD Journal").
import { liveQuery, type Observable } from 'dexie';
import { db } from '../db.js';
import { fmt, t } from '../i18n/de.js';
import type { Day, Id, MoodLog, Note, Tag } from '../model.js';
import { dayParts, isDay, nowIso, timeOfIso } from '../util/date.js';
import { newId } from '../util/ids.js';
import { deriveTitle, mergeTags } from '../services/notes.js';
import { ensureTags, normalizeTagPaths } from './tags.js';

export type NoteInput = Pick<Note, 'title'> & Partial<Pick<Note, 'body' | 'kind' | 'journalDay' | 'tagPaths' | 'pinned'>>;

/** Creates a note; ensures its tags exist (repo/tags ensureTags). */
export function createNote(input: NoteInput): Promise<Note> {
  return db.transaction('rw', db.notes, db.tags, async () => {
    const stamp = nowIso();
    const note: Note = {
      id: newId(),
      kind: input.kind ?? 'note',
      title: input.title.trim(),
      body: input.body ?? '',
      tagPaths: normalizeTagPaths(input.tagPaths ?? []),
      pinned: input.pinned ?? 0,
      archived: 0,
      createdAt: stamp,
      updatedAt: stamp,
    };
    if (input.journalDay !== undefined) note.journalDay = input.journalDay;
    await db.notes.add(note);
    await ensureTags(note.tagPaths);
    return note;
  });
}

/** Tag of a journal note: `journal/YYYY/MM`. */
export function journalTag(day: Day): string {
  const { year, month } = dayParts(day);
  return `journal/${String(year).padStart(4, '0')}/${String(month).padStart(2, '0')}`;
}

/** The journal note of day (the oldest one if an import produced several). */
async function findJournal(day: Day): Promise<Note | undefined> {
  const rows = await db.notes.where('journalDay').equals(day).filter((n) => n.kind === 'journal').toArray();
  rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return rows[0];
}

/** Newest mood entry of day. */
export function newestMood(rows: readonly MoodLog[]): MoodLog | undefined {
  let best: MoodLog | undefined;
  for (const row of rows) if (!best || Date.parse(row.loggedAt) > Date.parse(best.loggedAt)) best = row;
  return best;
}

/**
 * Journal entry of day (A.2 H4): appends text to the day's journal note
 * (kind 'journal', journalDay = day), separated by a blank line, or creates it
 * with title fmt(t.journalNoteTitle) ("YYYY-MM-DD Journal", S20: sorts by date) and tag `journal/YYYY/MM`.
 * Each entry starts with its local time ("**HH:MM** text"); the day's mood
 * entry, if any, is linked to the note (MoodLog.noteId).
 */
export function appendJournal(day: Day, text: string): Promise<Note> {
  const content = text.trim();
  if (!isDay(day)) return Promise.reject(new RangeError(`invalid day ${day}`));
  if (content === '') return Promise.reject(new RangeError('empty journal entry'));
  return db.transaction('rw', db.notes, db.tags, db.moodLogs, async () => {
    const stamp = nowIso();
    const entry = `**${timeOfIso(stamp)}** ${content}`;
    const tag = journalTag(day);
    let note = await findJournal(day);
    if (note) {
      note = {
        ...note,
        body: note.body.trim() === '' ? entry : `${note.body.replace(/\s+$/u, '')}\n\n${entry}`,
        tagPaths: note.tagPaths.includes(tag) ? note.tagPaths : [...note.tagPaths, tag],
        updatedAt: stamp,
      };
      await db.notes.put(note);
    } else {
      note = {
        id: newId(),
        kind: 'journal',
        journalDay: day,
        title: fmt(t.journalNoteTitle, { date: day }),
        body: entry,
        tagPaths: [tag],
        pinned: 0,
        archived: 0,
        createdAt: stamp,
        updatedAt: stamp,
      };
      await db.notes.add(note);
    }
    await ensureTags(note.tagPaths);
    const mood = newestMood(await db.moodLogs.where('day').equals(day).toArray());
    if (mood && mood.noteId !== note.id) await db.moodLogs.update(mood.id, { noteId: note.id });
    return note;
  });
}

/** All notes, archived ones included (Markdown export). */
export function listNotes(): Promise<Note[]> {
  return db.notes.toArray();
}

export function getNotes(ids: readonly Id[]): Promise<Array<Note | undefined>> {
  return db.notes.bulkGet([...ids]);
}

export function getNote(id: Id): Promise<Note | undefined> {
  return db.notes.get(id);
}

export function journalFor$(day: Day): Observable<Note | undefined> {
  return liveQuery(() => findJournal(day));
}

/** Id of the journal note of day, if any (used by repo/moodLogs). */
export async function journalIdFor(day: Day): Promise<Id | undefined> {
  return (await findJournal(day))?.id;
}

/** liveQuery: number of non-archived notes (both kinds). */
export function noteCount$(): Observable<number> {
  return liveQuery(() => db.notes.where('archived').equals(0).count());
}

/** liveQuery: all notes of the list (archived ones only when asked for), newest first. */
export function notes$(includeArchived = false): Observable<Note[]> {
  return liveQuery(async () => {
    const rows = includeArchived ? await db.notes.toArray() : await db.notes.where('archived').equals(0).toArray();
    return rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  });
}

export function note$(id: Id): Observable<Note | undefined> {
  return liveQuery(() => db.notes.get(id));
}

export function tags$(): Observable<Tag[]> {
  return liveQuery(() => db.tags.orderBy('path').toArray());
}

/** New empty note for the editor (W3: FAB → editor, cursor in the first line). */
export function createEmptyNote(explicitTags: readonly string[] = []): Promise<Note> {
  return createNote({ title: '', body: '', tagPaths: [...explicitTags] });
}

/**
 * Saves the editor state: body, explicit tags; title from the first line (kept for journal notes),
 * tagPaths = explicit + inline tags. Resolves to the stored note, or undefined if it no longer exists.
 */
export function saveNoteContent(id: Id, body: string, explicit: readonly string[]): Promise<Note | undefined> {
  return db.transaction('rw', db.notes, db.tags, async () => {
    const note = await db.notes.get(id);
    if (!note) return undefined;
    const tagPaths = mergeTags(explicit, body);
    const title = note.kind === 'journal' ? note.title : deriveTitle(body);
    if (note.body === body && note.title === title && note.tagPaths.join('\n') === tagPaths.join('\n')) return note;
    const next: Note = { ...note, body, title, tagPaths, updatedAt: nowIso() };
    await db.notes.put(next);
    await ensureTags(tagPaths);
    return next;
  });
}

export async function setNotePinned(id: Id, pinned: boolean): Promise<void> {
  await db.notes.update(id, { pinned: pinned ? 1 : 0, updatedAt: nowIso() });
}

export async function setNoteArchived(id: Id, archived: boolean): Promise<void> {
  await db.notes.update(id, { archived: archived ? 1 : 0, ...(archived ? { pinned: 0 as const } : {}), updatedAt: nowIso() });
}

export interface DeletedNote { note: Note; moodIds: Id[] }

/** Deletes a note; mood entries pointing at it lose the link (restored by restoreNote). */
export function deleteNote(id: Id): Promise<DeletedNote | undefined> {
  return db.transaction('rw', db.notes, db.moodLogs, async () => {
    const note = await db.notes.get(id);
    if (!note) return undefined;
    const moods = await db.moodLogs.filter((m) => m.noteId === id).toArray();
    for (const mood of moods) {
      const { noteId: _drop, ...rest } = mood;
      void _drop;
      await db.moodLogs.put(rest);
    }
    await db.notes.delete(id);
    return { note, moodIds: moods.map((m) => m.id) };
  });
}

export function restoreNote(deleted: DeletedNote): Promise<void> {
  return db.transaction('rw', db.notes, db.moodLogs, db.tags, async () => {
    await db.notes.put(deleted.note);
    await ensureTags(deleted.note.tagPaths);
    for (const id of deleted.moodIds) {
      const mood = await db.moodLogs.get(id);
      if (mood && mood.noteId === undefined) await db.moodLogs.update(id, { noteId: deleted.note.id });
    }
  });
}
