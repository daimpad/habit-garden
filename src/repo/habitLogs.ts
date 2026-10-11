// CONTRACT STUB – implemented in AP5. Signatures are binding; bodies are placeholders.
// HabitLog.id is `${habitId}:${day}`; [habitId+day] guarantees one log per habit and day.
import type { Observable } from 'dexie';
import type { Day, HabitLog, Id, Stage } from '../model.js';

export interface ToggleResult { before: Stage; after: Stage; done: boolean }

/**
 * Toggles the log of habitId on day: no log → 'done'; 'done' → removed;
 * 'skipped' → 'done'. before/after are growth.stageFor(habit, logs, today())
 * before and after the change (today = the real current day, also when a
 * past day is toggled from the heatmap). Runs in one rw transaction.
 */
export function toggleLog(habitId: Id, day: Day): Promise<ToggleResult> {
  throw new Error(`not implemented: toggleLog ${habitId} ${day}`);
}

/** Logs of one habit in [fromDay, toDay], ascending by day. */
export function logsFor(habitId: Id, fromDay: Day, toDay: Day): Promise<HabitLog[]> {
  throw new Error(`not implemented: logsFor ${habitId} ${fromDay} ${toDay}`);
}

/** liveQuery: all logs of one habit, ascending by day. */
export function habitLogs$(habitId: Id): Observable<HabitLog[]> {
  throw new Error(`not implemented: habitLogs$ ${habitId}`);
}

/** liveQuery: all logs of the given habits, grouped by habitId (ascending by day). */
export function logsByHabit$(habitIds: readonly Id[]): Observable<Map<Id, HabitLog[]>> {
  throw new Error(`not implemented: logsByHabit$ ${habitIds.length}`);
}
