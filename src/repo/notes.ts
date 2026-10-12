// The notes UI is TODO(phase-4); Phase 1 writes notes from the capture sheet and the journal sheet.
import { liveQuery, type Observable } from 'dexie';
import { db } from '../db.js';
import { fmt, t } from '../i18n/de.js';
import type { Day, Id, MoodLog, Note } from '../model.js';
import { dayParts, isDay, nowIso, timeOfIso } from '../util/date.js';
import { newId } from '../util/ids.js';
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
