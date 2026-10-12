// HabitLog.id is `${habitId}:${day}`; the primary key guarantees one log per habit and day
// ([habitId+day] is only an index for range scans).
import Dexie, { liveQuery, type Observable } from 'dexie';
import { db } from '../db.js';
import type { Day, HabitLog, Id, Stage } from '../model.js';
import { stageFor } from '../services/growth.js';
import { isDay, nowIso, today } from '../util/date.js';

/**
 * startDayBefore: set when the toggle moved habit.startDay (a done log written before the
 * start day, S35); it holds the previous start day so an undo can restore it.
 */
export interface ToggleResult { before: Stage; after: Stage; done: boolean; startDayBefore?: Day }

export function habitLogId(habitId: Id, day: Day): HabitLog['id'] {
  return `${habitId}:${day}`;
}

const byDay = (a: HabitLog, b: HabitLog): number => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0);

/**
 * Toggles the log of habitId on day: no log → 'done'; 'done' → removed;
 * 'skipped' → 'done'. before/after are growth.stageFor(habit, logs, today())
 * before and after the change (today = the real current day, also when a
 * past day is toggled from the heatmap). Runs in one rw transaction.
 * Days after today are rejected (RangeError).
 * A done log before habit.startDay moves startDay to that day (S35; result.startDayBefore holds
 * the old value). Removing the log of day restores opts.restoreStartDay when startDay is still day.
 */
export function toggleLog(habitId: Id, day: Day, opts: { restoreStartDay?: Day } = {}): Promise<ToggleResult> {
  const current = today();
  if (!isDay(day)) return Promise.reject(new RangeError(`invalid day ${day}`));
  if (day > current) return Promise.reject(new RangeError(`cannot log a future day ${day}`));
  const restore = opts.restoreStartDay;
  if (restore !== undefined && !isDay(restore)) return Promise.reject(new RangeError(`invalid day ${restore}`));
  return db.transaction('rw', db.habits, db.habitLogs, async () => {
    const habit = await db.habits.get(habitId);
    if (!habit) throw new Error(`unknown habit ${habitId}`);
    const logs = await db.habitLogs.where('habitId').equals(habitId).toArray();
    logs.sort(byDay);
    const before = stageFor(habit, logs, current);
    const id = habitLogId(habitId, day);
    const existing = logs.find((l) => l.id === id);
    let next: HabitLog[];
    let done: boolean;
    let nextHabit = habit;
    let startDayBefore: Day | undefined;
    if (existing?.status === 'done') {
      await db.habitLogs.delete(id);
      next = logs.filter((l) => l.id !== id);
      done = false;
      if (restore !== undefined && habit.startDay === day && restore > day) {
        nextHabit = { ...habit, startDay: restore, updatedAt: nowIso() };
      }
    } else {
      const log: HabitLog = { id, habitId, day, status: 'done', loggedAt: nowIso() };
      if (existing?.value !== undefined) log.value = existing.value;
      await db.habitLogs.put(log);
      next = [...logs.filter((l) => l.id !== id), log].sort(byDay);
      done = true;
      if (day < habit.startDay) {
        startDayBefore = habit.startDay;
        nextHabit = { ...habit, startDay: day, updatedAt: nowIso() };
      }
    }
    if (nextHabit !== habit) await db.habits.put(nextHabit);
    const after = stageFor(nextHabit, next, current);
    return startDayBefore === undefined ? { before, after, done } : { before, after, done, startDayBefore };
  });
}

/** Logs of one habit in [fromDay, toDay], ascending by day. */
export function logsFor(habitId: Id, fromDay: Day, toDay: Day): Promise<HabitLog[]> {
  if (fromDay > toDay) return Promise.resolve([]);
  return db.habitLogs.where('[habitId+day]').between([habitId, fromDay], [habitId, toDay], true, true).toArray();
}

/** liveQuery: all logs of one habit, ascending by day. */
export function habitLogs$(habitId: Id): Observable<HabitLog[]> {
  return liveQuery(() =>
    db.habitLogs.where('[habitId+day]').between([habitId, Dexie.minKey], [habitId, Dexie.maxKey], true, true).toArray(),
  );
}

/** liveQuery: all logs of the given habits, grouped by habitId (ascending by day). */
export function logsByHabit$(habitIds: readonly Id[]): Observable<Map<Id, HabitLog[]>> {
  const ids = [...new Set(habitIds)];
  return liveQuery(async () => {
    const grouped = new Map<Id, HabitLog[]>(ids.map((id) => [id, []]));
    if (ids.length === 0) return grouped;
    const rows = await db.habitLogs.where('habitId').anyOf(ids).toArray();
    for (const log of rows) grouped.get(log.habitId)?.push(log);
    for (const list of grouped.values()) list.sort(byDay);
    return grouped;
  });
}
