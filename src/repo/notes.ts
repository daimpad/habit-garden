// CONTRACT STUB – implemented in AP5. The notes UI is TODO(phase-4); Phase 1 writes notes
// from the capture sheet and the journal sheet.
import type { Observable } from 'dexie';
import type { Day, Id, Note } from '../model.js';

export type NoteInput = Pick<Note, 'title'> & Partial<Pick<Note, 'body' | 'kind' | 'journalDay' | 'tagPaths' | 'pinned'>>;

/** Creates a note; ensures its tags exist (repo/tags ensureTags). */
export function createNote(input: NoteInput): Promise<Note> {
  throw new Error(`not implemented: createNote ${input.title}`);
}

/**
 * Journal entry of day (A.2 H4): appends text to the day's journal note
 * (kind 'journal', journalDay = day), separated by a blank line, or creates it
 * with title fmt(t.journalNoteTitle) and tag `journal/YYYY/MM`.
 */
export function appendJournal(day: Day, text: string): Promise<Note> {
  throw new Error(`not implemented: appendJournal ${day} ${text.length}`);
}

export function getNote(id: Id): Promise<Note | undefined> {
  throw new Error(`not implemented: getNote ${id}`);
}

export function journalFor$(day: Day): Observable<Note | undefined> {
  throw new Error(`not implemented: journalFor$ ${day}`);
}

/** liveQuery: number of non-archived notes (both kinds). */
export function noteCount$(): Observable<number> {
  throw new Error('not implemented: noteCount$');
}
