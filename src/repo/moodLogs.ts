// CONTRACT STUB – implemented in AP5. One mood entry per day (upsert by day).
import type { Observable } from 'dexie';
import type { Day, Id, MoodLog } from '../model.js';

/** Creates or updates the entry of day (value, loggedAt = now). */
export function setMood(day: Day, value: 1|2|3|4|5): Promise<MoodLog> {
  throw new Error(`not implemented: setMood ${day} ${value}`);
}

export function mood$(day: Day): Observable<MoodLog | undefined> {
  throw new Error(`not implemented: mood$ ${day}`);
}

/** Links the day's journal note to the mood entry (MoodLog.noteId). */
export function linkMoodNote(day: Day, noteId: Id): Promise<void> {
  throw new Error(`not implemented: linkMoodNote ${day} ${noteId}`);
}
