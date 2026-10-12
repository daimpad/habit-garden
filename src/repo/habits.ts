import { liveQuery, type Observable } from 'dexie';
import { db } from '../db.js';
import type { Habit, HabitLog, Id } from '../model.js';
import { nowIso, today } from '../util/date.js';
import { newId, sortKeyBetween } from '../util/ids.js';

export type HabitInput = Pick<Habit, 'name' | 'schedule' | 'period'> & Partial<Habit>;

const bySortKey = (a: Habit, b: Habit): number => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

/** startDay defaults to today, sortKey to the end, archived 0. */
export function createHabit(input: HabitInput): Promise<Habit> {
  return db.transaction('rw', db.habits, async () => {
    let last: string | null = null;
    await db.habits.each((h) => {
      if (last === null || h.sortKey > last) last = h.sortKey;
    });
    const habit: Habit = {
      ...input,
      id: input.id ?? newId(),
      name: input.name.trim(),
      startDay: input.startDay ?? today(),
      archived: input.archived ?? 0,
      sortKey: input.sortKey ?? sortKeyBetween(last, null),
      updatedAt: nowIso(),
    };
    if (habit.areaId === undefined) delete habit.areaId;
    if (habit.target === undefined) delete habit.target;
    await db.habits.add(habit);
    return habit;
  });
}

/** Patches a habit; undefined clears the optional fields areaId and target. */
export function updateHabit(id: Id, patch: Partial<Omit<Habit, 'id' | 'updatedAt'>>): Promise<void> {
  return db.transaction('rw', db.habits, async () => {
    const habit = await db.habits.get(id);
    if (!habit) throw new Error(`unknown habit ${id}`);
    const next: Record<string, unknown> = { ...habit };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) next[key] = value;
      else if (key === 'areaId' || key === 'target') delete next[key];
    }
    const updated = next as unknown as Habit;
    updated.id = id;
    if (typeof patch.name === 'string') updated.name = patch.name.trim();
    updated.updatedAt = nowIso();
    await db.habits.put(updated);
  });
}

export function setHabitArchived(id: Id, archived: 0 | 1): Promise<void> {
  return updateHabit(id, { archived });
}

export interface DeletedHabit { habit: Habit; logs: HabitLog[] }

/** Deletes the habit and all its logs; returns both for "Rückgängig". */
export function deleteHabit(id: Id): Promise<DeletedHabit> {
  return db.transaction('rw', db.habits, db.habitLogs, async () => {
    const habit = await db.habits.get(id);
    if (!habit) throw new Error(`unknown habit ${id}`);
    const logs = await db.habitLogs.where('habitId').equals(id).toArray();
    await db.habitLogs.bulkDelete(logs.map((l) => l.id));
    await db.habits.delete(id);
    return { habit, logs };
  });
}

export function restoreHabit(deleted: DeletedHabit): Promise<void> {
  return db.transaction('rw', db.habits, db.habitLogs, async () => {
    await db.habits.put(deleted.habit);
    if (deleted.logs.length > 0) await db.habitLogs.bulkPut(deleted.logs);
  });
}

export function getHabit(id: Id): Promise<Habit | undefined> {
  return db.habits.get(id);
}

export function habit$(id: Id): Observable<Habit | undefined> {
  return liveQuery(() => db.habits.get(id));
}

/** Non-archived habits ordered by sortKey (all habits when includeArchived). */
export function habits$(includeArchived = false): Observable<Habit[]> {
  return liveQuery(async () => {
    const rows = includeArchived ? await db.habits.toArray() : await db.habits.where('archived').equals(0).toArray();
    return rows.sort(bySortKey);
  });
}
