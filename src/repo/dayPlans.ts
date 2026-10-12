// DayPlan.mitTaskIds may contain ids of deleted tasks (deleteTask keeps them so that
// "Rückgängig" restores the slot); readers skip unknown ids. Past DayPlans are never touched.
import { liveQuery, type Observable } from 'dexie';
import { db } from '../db.js';
import { MAX_FOCUS, type Day, type DayPlan, type Id, type Task } from '../model.js';
import { isDay } from '../util/date.js';
import { createTask, type TaskInput } from './tasks.js';

export class FocusFullError extends Error {
  constructor() {
    super('focus limit reached');
    this.name = 'FocusFullError';
  }
}

/**
 * Replaces the focus of day; throws FocusFullError for more than 3 ids (F §4.7).
 * Duplicates are removed first; ids are stored as given (order = slot order).
 * An id without a task throws RangeError (S15); nothing is written then.
 */
export function setFocus(day: Day, taskIds: Id[]): Promise<void> {
  if (!isDay(day)) return Promise.reject(new RangeError(`invalid day ${day}`));
  const ids = [...new Set(taskIds)];
  if (ids.length > MAX_FOCUS) return Promise.reject(new FocusFullError());
  return db.transaction('rw', db.dayPlans, db.tasks, async () => {
    const found = await db.tasks.bulkGet(ids);
    const missing = ids.find((_, i) => found[i] === undefined);
    if (missing !== undefined) throw new RangeError(`unknown task ${missing}`);
    const plan = await db.dayPlans.get(day);
    await db.dayPlans.put({ ...plan, id: day, mitTaskIds: ids });
  });
}

/**
 * Appends one task; no-op when already present; throws FocusFullError when 3 are set
 * and RangeError for an unknown task.
 * Ids of deleted tasks are dropped first, so a slot freed by a deletion can be refilled.
 */
export function addToFocus(day: Day, taskId: Id): Promise<void> {
  if (!isDay(day)) return Promise.reject(new RangeError(`invalid day ${day}`));
  return db.transaction('rw', db.dayPlans, db.tasks, async () => {
    if ((await db.tasks.get(taskId)) === undefined) throw new RangeError(`unknown task ${taskId}`);
    const plan: DayPlan = (await db.dayPlans.get(day)) ?? { id: day, mitTaskIds: [] };
    if (plan.mitTaskIds.includes(taskId)) return;
    const existing = await db.tasks.bulkGet(plan.mitTaskIds);
    const ids = plan.mitTaskIds.filter((_, i) => existing[i] !== undefined);
    if (ids.length >= MAX_FOCUS) throw new FocusFullError();
    await db.dayPlans.put({ ...plan, mitTaskIds: [...ids, taskId] });
  });
}

/**
 * Creates a task and appends it to the focus of day in one transaction: when the focus is
 * full (FocusFullError) the task is not created either.
 */
export function createTaskInFocus(day: Day, input: TaskInput): Promise<Task> {
  if (!isDay(day)) return Promise.reject(new RangeError(`invalid day ${day}`));
  return db.transaction('rw', db.tasks, db.dayPlans, async () => {
    const task = await createTask(input);
    await addToFocus(day, task.id);
    return task;
  });
}

export function removeFromFocus(day: Day, taskId: Id): Promise<void> {
  return db.transaction('rw', db.dayPlans, async () => {
    const plan = await db.dayPlans.get(day);
    if (!plan || !plan.mitTaskIds.includes(taskId)) return;
    await db.dayPlans.put({ ...plan, mitTaskIds: plan.mitTaskIds.filter((id) => id !== taskId) });
  });
}

export async function getFocus(day: Day): Promise<Id[]> {
  return (await db.dayPlans.get(day))?.mitTaskIds ?? [];
}

/** liveQuery of the DayPlan of day (undefined when none exists). */
export function dayPlan$(day: Day): Observable<DayPlan | undefined> {
  return liveQuery(() => db.dayPlans.get(day));
}

/** True when any DayPlan ever had a task (used for the "Erste Schritte" card). */
export async function anyFocusEver(): Promise<boolean> {
  const hit = await db.dayPlans.filter((p) => Array.isArray(p.mitTaskIds) && p.mitTaskIds.length > 0).first();
  return hit !== undefined;
}
