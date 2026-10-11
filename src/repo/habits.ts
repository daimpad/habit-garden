// CONTRACT STUB – implemented in AP5. Signatures are binding; bodies are placeholders.
import type { Observable } from 'dexie';
import type { Habit, HabitLog, Id } from '../model.js';

export type HabitInput = Pick<Habit, 'name' | 'schedule' | 'period'> & Partial<Habit>;

/** startDay defaults to today, sortKey to the end, archived 0. */
export function createHabit(input: HabitInput): Promise<Habit> {
  throw new Error(`not implemented: createHabit ${input.name}`);
}

export function updateHabit(id: Id, patch: Partial<Omit<Habit, 'id' | 'updatedAt'>>): Promise<void> {
  throw new Error(`not implemented: updateHabit ${id} ${Object.keys(patch).join()}`);
}

export function setHabitArchived(id: Id, archived: 0 | 1): Promise<void> {
  throw new Error(`not implemented: setHabitArchived ${id} ${archived}`);
}

export interface DeletedHabit { habit: Habit; logs: HabitLog[] }

/** Deletes the habit and all its logs; returns both for "Rückgängig". */
export function deleteHabit(id: Id): Promise<DeletedHabit> {
  throw new Error(`not implemented: deleteHabit ${id}`);
}

export function restoreHabit(deleted: DeletedHabit): Promise<void> {
  throw new Error(`not implemented: restoreHabit ${deleted.habit.id}`);
}

export function getHabit(id: Id): Promise<Habit | undefined> {
  throw new Error(`not implemented: getHabit ${id}`);
}

export function habit$(id: Id): Observable<Habit | undefined> {
  throw new Error(`not implemented: habit$ ${id}`);
}

/** Non-archived habits ordered by sortKey (all habits when includeArchived). */
export function habits$(includeArchived = false): Observable<Habit[]> {
  throw new Error(`not implemented: habits$ ${includeArchived}`);
}
