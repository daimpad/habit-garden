// One mood entry per day (upsert by day). Readers pick the newest loggedAt should an
// import ever leave several entries for one day; setMood consolidates them.
import { liveQuery, type Observable } from 'dexie';
import { db } from '../db.js';
import type { Day, Id, MoodLog } from '../model.js';
import { isDay, nowIso } from '../util/date.js';
import { newId } from '../util/ids.js';
import { journalIdFor, newestMood } from './notes.js';

/**
 * Creates or updates the entry of day (value, loggedAt = now). Re-setting the
 * current value changes nothing. A new entry is linked to the day's journal note.
 */
export function setMood(day: Day, value: 1|2|3|4|5): Promise<MoodLog> {
  if (!isDay(day)) return Promise.reject(new RangeError(`invalid day ${day}`));
  if (![1, 2, 3, 4, 5].includes(value)) return Promise.reject(new RangeError(`invalid mood ${String(value)}`));
  return db.transaction('rw', db.moodLogs, db.notes, async () => {
    const rows = await db.moodLogs.where('day').equals(day).toArray();
    const current = newestMood(rows);
    const extra = rows.filter((r) => r !== current).map((r) => r.id);
    if (extra.length > 0) await db.moodLogs.bulkDelete(extra);
    if (current && current.value === value) return current;
    const noteId = current?.noteId ?? (await journalIdFor(day));
    const entry: MoodLog = { id: current?.id ?? newId(), day, value, loggedAt: nowIso() };
    if (noteId !== undefined) entry.noteId = noteId;
    await db.moodLogs.put(entry);
    return entry;
  });
}

export function mood$(day: Day): Observable<MoodLog | undefined> {
  return liveQuery(async () => newestMood(await db.moodLogs.where('day').equals(day).toArray()));
}

/** Links the day's journal note to the mood entry (MoodLog.noteId). */
export function linkMoodNote(day: Day, noteId: Id): Promise<void> {
  return db.transaction('rw', db.moodLogs, async () => {
    const current = newestMood(await db.moodLogs.where('day').equals(day).toArray());
    if (current && current.noteId !== noteId) await db.moodLogs.update(current.id, { noteId });
  });
}

/** liveQuery: all mood entries with day in [fromDay, toDay] (several per day possible, see newestMood). */
export function moodsBetween$(fromDay: Day, toDay: Day): Observable<MoodLog[]> {
  return liveQuery(async (): Promise<MoodLog[]> => (fromDay > toDay ? [] : db.moodLogs.where('day').between(fromDay, toDay, true, true).toArray()));
}
