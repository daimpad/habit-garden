// Rules: updatedAt is set only here; dueDay is derived from dueAt (util/date deriveDueDay);
// booleans are 0|1; all writes go through this module.
// A date-only task stores dueAt = local midnight of its day (isoAt(day)) with dueHasTime 0.
// Inbox view for captured tasks without date/project: TODO(phase-3).
import Dexie, { liveQuery, type Observable } from 'dexie';
import { db } from '../db.js';
import type { Day, Id, ISO, Reminder, Task } from '../model.js';
import { matches } from '../services/search.js';
import { compareIso, deriveDueDay, isoAt, now, nowIso, timeOfIso } from '../util/date.js';
import { newId, sortKeyBetween } from '../util/ids.js';

export type TaskInput = Pick<Task, 'title' | 'areaId'> & Partial<Task>;

/** Optional fields that a patch may clear by passing undefined. */
const CLEARABLE: ReadonlyArray<keyof Task> = [
  'description', 'dueAt', 'dueDay', 'completedAt', 'recurrence', 'recurrenceAnchor', 'tagPaths', 'linkedNoteIds',
];

/** Applies a patch: undefined clears clearable fields and is ignored for required ones. */
function applyPatch(task: Task, patch: Partial<Task>): Task {
  const next: Record<string, unknown> = { ...task };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) next[key] = value;
    else if ((CLEARABLE as readonly string[]).includes(key)) delete next[key];
  }
  return next as unknown as Task;
}

function clearDue(task: Task): Task {
  delete task.dueAt;
  delete task.dueDay;
  task.dueHasTime = 0;
  return task;
}

/**
 * Settles the due fields of `task` (already patched) after a change that touches
 * dueAt, dueDay or dueHasTime; other writes leave them alone, so dueDay is never
 * re-derived later (e.g. after a time-zone change).
 * - dueAt set: dueDay = deriveDueDay(dueAt); dueHasTime given or inferred
 *   (a time other than local midnight means "timed"); date-only → dueAt = isoAt(dueDay).
 * - dueDay without dueAt: dueAt = that day at the previous time (timed) or at midnight.
 * - dueHasTime 0 alone: dueAt moves to the midnight of dueDay. A time requires a date.
 */
function settleDue(task: Task, change: Partial<Task>, before?: Task): Task {
  if ('dueAt' in change) {
    if (!change.dueAt) return clearDue(task);
    if (Number.isNaN(Date.parse(change.dueAt))) throw new RangeError(`invalid dueAt ${change.dueAt}`);
    const day = deriveDueDay(change.dueAt);
    if (day === undefined) return clearDue(task);
    const timed = change.dueHasTime ?? (timeOfIso(change.dueAt) === '00:00' ? 0 : 1);
    task.dueDay = day;
    task.dueHasTime = timed === 1 ? 1 : 0;
    task.dueAt = task.dueHasTime === 1 ? new Date(change.dueAt).toISOString() : isoAt(day);
    return task;
  }
  if ('dueDay' in change) {
    if (!change.dueDay) return clearDue(task);
    const previous = before?.dueAt;
    const timed = (change.dueHasTime ?? before?.dueHasTime) === 1 && previous !== undefined;
    task.dueDay = change.dueDay;
    task.dueHasTime = timed ? 1 : 0;
    task.dueAt = isoAt(change.dueDay, timed && previous ? timeOfIso(previous) : undefined);
    return task;
  }
  if ('dueHasTime' in change) {
    if (!task.dueDay) return clearDue(task);
    task.dueHasTime = task.dueHasTime === 1 ? 1 : 0;
    if (task.dueHasTime === 0) task.dueAt = isoAt(task.dueDay);
  }
  return task;
}

async function nextTaskSortKey(areaId: Id): Promise<string> {
  let max: string | null = null;
  await db.tasks
    .where('[areaId+status]')
    .between([areaId, Dexie.minKey], [areaId, Dexie.maxKey], true, true)
    .each((t) => {
      if (max === null || t.sortKey > max) max = t.sortKey;
    });
  return sortKeyBetween(max, null);
}

export function createTask(input: TaskInput): Promise<Task> {
  return db.transaction('rw', db.tasks, async () => {
    const stamp = nowIso();
    const base: Task = {
      id: newId(),
      areaId: input.areaId,
      projectId: null,
      parentId: null,
      title: input.title.trim(),
      status: 'open',
      important: 0,
      urgent: 0,
      dueHasTime: 0,
      reminders: [],
      sortKey: '',
      createdAt: stamp,
      updatedAt: stamp,
    };
    const change: Partial<Task> = { ...input, title: input.title.trim() };
    const task = settleDue(applyPatch(base, change), change);
    if (!task.sortKey) task.sortKey = await nextTaskSortKey(task.areaId);
    task.updatedAt = stamp;
    if (task.status === 'done' && !task.completedAt) task.completedAt = stamp;
    await db.tasks.add(task);
    return task;
  });
}

/** Runs a read-modify-write on one task inside a rw transaction; sets updatedAt. */
function mutate(id: Id, fn: (task: Task) => Task): Promise<Task> {
  return db.transaction('rw', db.tasks, async () => {
    const task = await db.tasks.get(id);
    if (!task) throw new Error(`unknown task ${id}`);
    const next = fn(structuredClone(task));
    next.id = id;
    next.updatedAt = nowIso();
    await db.tasks.put(next);
    return next;
  });
}

/** Patches a task; recomputes dueDay when dueAt changes; sets updatedAt. */
export async function updateTask(id: Id, patch: Partial<Task>): Promise<void> {
  await mutate(id, (task) => {
    const next = settleDue(applyPatch(task, patch), patch, task);
    if (typeof patch.title === 'string') next.title = patch.title.trim();
    return next;
  });
}

/** status 'done' + completedAt. Recurring follow-up instance: TODO(phase-2). */
export async function completeTask(id: Id): Promise<void> {
  await mutate(id, (task) => {
    task.status = 'done';
    task.completedAt = nowIso();
    // TODO(phase-2): when task.recurrence is set, create the next instance (services/recurrence).
    return task;
  });
}

/** status 'open', completedAt removed. */
export async function reopenTask(id: Id): Promise<void> {
  await mutate(id, (task) => {
    task.status = 'open';
    delete task.completedAt;
    return task;
  });
}

/**
 * Deletes the task; returns it for "Rückgängig". Its id stays in DayPlans
 * (readers skip unknown ids), so restoreTask brings back its focus slot.
 */
export function deleteTask(id: Id): Promise<Task> {
  return db.transaction('rw', db.tasks, async () => {
    const task = await db.tasks.get(id);
    if (!task) throw new Error(`unknown task ${id}`);
    await db.tasks.delete(id);
    return task;
  });
}

/** Puts a deleted task back unchanged (undo of deleteTask). */
export async function restoreTask(task: Task): Promise<void> {
  await db.tasks.put(task);
}

export function getTask(id: Id): Promise<Task | undefined> {
  return db.tasks.get(id);
}

export function task$(id: Id): Observable<Task | undefined> {
  return liveQuery(() => db.tasks.get(id));
}

/** Tasks for the given ids, in the given order; missing ids are skipped. */
export function tasksByIds$(ids: readonly Id[]): Observable<Task[]> {
  const keys = [...ids];
  return liveQuery(async () => {
    const rows = await db.tasks.bulkGet(keys);
    return rows.filter((t): t is Task => t !== undefined);
  });
}

const isTopLevel = (t: Task): boolean => t.parentId === null || t.parentId === undefined;

/** Due order: dueDay ascending; within a day timed tasks by time, then untimed by sortKey. */
export function compareDue(a: Task, b: Task): number {
  const da = a.dueDay ?? '';
  const dbDay = b.dueDay ?? '';
  if (da !== dbDay) return da < dbDay ? -1 : 1;
  if (a.dueHasTime !== b.dueHasTime) return a.dueHasTime === 1 ? -1 : 1;
  if (a.dueHasTime === 1) {
    const byTime = compareIso(a.dueAt, b.dueAt);
    if (byTime !== 0) return byTime;
  }
  if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
  return compareIso(a.createdAt, b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * liveQuery: top-level tasks (parentId null) that are not done and have
 * dueDay <= day. Overdue first (ascending dueDay), then today's tasks:
 * timed ones by time, then untimed by sortKey.
 */
export function dueOn(day: Day): Observable<Task[]> {
  return liveQuery(async () => {
    const rows = await db.tasks.where('dueDay').belowOrEqual(day).toArray();
    return rows.filter((t) => t.status !== 'done' && isTopLevel(t)).sort(compareDue);
  });
}

export interface FocusCandidates { overdue: Task[]; dueToday: Task[]; noDate: Task[] }

/**
 * Suggestions for the focus picker (F §4.13): open top-level tasks, grouped,
 * excluding `exclude`; optional case/diacritics-insensitive title filter.
 * Tasks due after day are not suggested; "noDate" lists the newest first.
 */
export async function focusCandidates(day: Day, query = '', exclude: readonly Id[] = []): Promise<FocusCandidates> {
  const skip = new Set(exclude);
  const rows = (await db.tasks.toArray()).filter(
    (t) => t.status !== 'done' && isTopLevel(t) && !skip.has(t.id) && matches(t.title, query),
  );
  const overdue = rows.filter((t) => t.dueDay !== undefined && t.dueDay < day).sort(compareDue);
  const dueToday = rows.filter((t) => t.dueDay === day).sort(compareDue);
  const noDate = rows
    .filter((t) => t.dueDay === undefined)
    .sort((a, b) => compareIso(b.createdAt, a.createdAt) || (a.id < b.id ? -1 : 1));
  return { overdue, dueToday, noDate };
}

/** Adds a reminder (id assigned here). */
export async function addReminder(taskId: Id, reminder: Omit<Reminder, 'id'>): Promise<Reminder> {
  const added: Reminder = { ...reminder, id: newId() };
  await mutate(taskId, (task) => {
    task.reminders = [...(task.reminders ?? []), added];
    return task;
  });
  return added;
}

export async function removeReminder(taskId: Id, reminderId: Id): Promise<void> {
  await mutate(taskId, (task) => {
    task.reminders = (task.reminders ?? []).filter((r) => r.id !== reminderId);
    return task;
  });
}

/** Sets dismissedAt (default now). */
export async function dismissReminder(taskId: Id, reminderId: Id, at?: ISO): Promise<void> {
  const stamp = at ?? nowIso();
  await mutate(taskId, (task) => {
    task.reminders = (task.reminders ?? []).map((r) => (r.id === reminderId ? { ...r, dismissedAt: stamp } : r));
    return task;
  });
}

/** D.5 "+1 h": dismisses the reminder and adds an absolute one at now + minutes. */
export async function snoozeReminder(taskId: Id, reminderId: Id, minutes = 60): Promise<Reminder> {
  const stamp = now();
  const added: Reminder = {
    id: newId(),
    mode: 'absolute',
    at: new Date(stamp.getTime() + minutes * 60_000).toISOString(),
  };
  await mutate(taskId, (task) => {
    const dismissed = stamp.toISOString();
    task.reminders = [
      ...(task.reminders ?? []).map((r) => (r.id === reminderId ? { ...r, dismissedAt: dismissed } : r)),
      added,
    ];
    return task;
  });
  return added;
}

/** liveQuery: not-done tasks that have at least one reminder (for services/reminders). */
export function tasksWithReminders$(): Observable<Task[]> {
  return liveQuery(() =>
    db.tasks.filter((t) => t.status !== 'done' && Array.isArray(t.reminders) && t.reminders.length > 0).toArray(),
  );
}
