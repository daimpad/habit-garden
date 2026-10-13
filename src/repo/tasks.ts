// Rules: updatedAt is set only here; dueDay is derived from dueAt (util/date deriveDueDay);
// booleans are 0|1; all writes go through this module.
// A date-only task stores dueAt = local midnight of its day (isoAt(day)) with dueHasTime 0.
// Recurrence (C.4): recurrenceAnchor follows the due day whenever the due date or the rule is
// written (unless the write sets the anchor itself); completing a recurring top-level task creates
// the follow-up instance as a new record in the same transaction (followUpId on the completed one),
// reopenTask takes an untouched follow-up back again.
// Subtasks: tasks with parentId = parent id, same areaId/projectId as the parent, no due date, no
// recurrence, no reminders; one level only. They are excluded from every top-level query.
// Inbox view for captured tasks without date/project: TODO(phase-3).
import Dexie, { liveQuery, type Observable } from 'dexie';
import { db } from '../db.js';
import type { Day, Id, ISO, Reminder, Task } from '../model.js';
import { followUpDay } from '../services/recurrence.js';
import { matches } from '../services/search.js';
import { compareIso, deriveDueDay, isoAt, now, nowIso, timeOfIso, today } from '../util/date.js';
import { newId, sortKeyBetween, sortKeysAfter } from '../util/ids.js';

export type TaskInput = Pick<Task, 'title' | 'areaId'> & Partial<Task>;

/** Optional fields that a patch may clear by passing undefined. */
const CLEARABLE: ReadonlyArray<keyof Task> = [
  'description', 'dueAt', 'dueDay', 'completedAt', 'recurrence', 'recurrenceAnchor', 'tagPaths', 'linkedNoteIds',
  'followUpId',
];

const isTopLevel = (t: Task): boolean => t.parentId === null || t.parentId === undefined;

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

/** Keeps recurrenceAnchor on the due day after a write that touches the due date or the rule. */
function settleAnchor(task: Task, change: Partial<Task>): Task {
  if (!task.recurrence) {
    delete task.recurrenceAnchor;
    return task;
  }
  const touched = 'dueAt' in change || 'dueDay' in change || 'recurrence' in change;
  if (touched && !('recurrenceAnchor' in change) && task.dueDay) task.recurrenceAnchor = task.dueDay;
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
    const task = settleAnchor(settleDue(applyPatch(base, change), change), change);
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

/**
 * Patches a task; recomputes dueDay when dueAt changes; sets updatedAt. A new area or project of a
 * top-level task is passed on to its subtasks.
 */
export function updateTask(id: Id, patch: Partial<Task>): Promise<void> {
  return db.transaction('rw', db.tasks, async () => {
    const next = await mutate(id, (task) => {
      const patched = settleAnchor(settleDue(applyPatch(task, patch), patch, task), patch);
      if (typeof patch.title === 'string') patched.title = patched.title.trim();
      return patched;
    });
    if (!('areaId' in patch || 'projectId' in patch) || !isTopLevel(next)) return;
    const stamp = nowIso();
    await db.tasks
      .where('parentId').equals(id)
      .filter((sub) => sub.areaId !== next.areaId || sub.projectId !== next.projectId)
      .modify((sub) => {
        sub.areaId = next.areaId;
        sub.projectId = next.projectId;
        sub.updatedAt = stamp;
      });
  });
}

export interface CompleteResult {
  /** The next instance of a recurring task (created now, or earlier when the task was done already). */
  followUp?: Task;
}

/** Subtasks of a task in sortKey order (inside or outside a transaction). */
async function childrenOf(parentId: Id): Promise<Task[]> {
  const rows = await db.tasks.where('parentId').equals(parentId).toArray();
  return rows.sort(compareSiblings);
}

function compareSiblings(a: Task, b: Task): number {
  if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
  return compareIso(a.createdAt, b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The follow-up instance of a recurring task completed on `completionDay` (C.4): title, area,
 * project, flags, description, tags, rule and anchor; due on followUpDay() at the same time of day;
 * relative reminders (new ids, not dismissed). Absolute reminders and links are not copied.
 */
function followUpOf(task: Task, completionDay: Day, stamp: ISO, sortKey: string): Task | null {
  const rec = task.recurrence;
  if (!rec || rec.kind === 'timesPerWeek') return null;
  const anchor = task.recurrenceAnchor ?? task.dueDay ?? completionDay;
  const day = followUpDay(rec, anchor, task.dueDay, completionDay);
  const timed = task.dueHasTime === 1 && task.dueAt !== undefined;
  const next: Task = {
    id: newId(),
    areaId: task.areaId,
    projectId: task.projectId,
    parentId: null,
    title: task.title,
    status: 'open',
    important: task.important,
    urgent: task.urgent,
    dueAt: isoAt(day, timed && task.dueAt ? timeOfIso(task.dueAt) : undefined),
    dueDay: day,
    dueHasTime: timed ? 1 : 0,
    recurrence: structuredClone(rec),
    recurrenceAnchor: anchor,
    reminders: (task.reminders ?? [])
      .filter((r) => r.mode === 'relative' && typeof r.offsetMinutes === 'number')
      .map((r) => ({ id: newId(), mode: 'relative', offsetMinutes: r.offsetMinutes })),
    sortKey,
    createdAt: stamp,
    updatedAt: stamp,
  };
  if (task.description !== undefined) next.description = task.description;
  if (task.tagPaths) next.tagPaths = [...task.tagPaths];
  return next;
}

/**
 * status 'done' + completedAt. A recurring top-level task also gets its follow-up instance, in the
 * same transaction: a new record (followUpOf) with copies of the subtasks, all open; followUpId
 * links it. Completing a task that is done already changes nothing (no second follow-up).
 */
export function completeTask(id: Id): Promise<CompleteResult> {
  return db.transaction('rw', db.tasks, async () => {
    const task = await db.tasks.get(id);
    if (!task) throw new Error(`unknown task ${id}`);
    if (task.status === 'done') {
      const existing = task.followUpId ? await db.tasks.get(task.followUpId) : undefined;
      return existing ? { followUp: existing } : {};
    }
    const stamp = nowIso();
    const next = structuredClone(task);
    next.status = 'done';
    next.completedAt = stamp;
    next.updatedAt = stamp;
    delete next.followUpId;
    let followUp: Task | null = null;
    if (task.recurrence && isTopLevel(task)) {
      followUp = followUpOf(task, today(), stamp, await nextTaskSortKey(task.areaId));
    }
    if (followUp) {
      const copies = (await childrenOf(id)).map((sub): Task => ({
        id: newId(),
        areaId: followUp.areaId,
        projectId: followUp.projectId,
        parentId: followUp.id,
        title: sub.title,
        status: 'open',
        important: sub.important,
        urgent: sub.urgent,
        dueHasTime: 0,
        reminders: [],
        sortKey: sub.sortKey,
        createdAt: stamp,
        updatedAt: stamp,
      }));
      await db.tasks.bulkAdd([followUp, ...copies]);
      next.followUpId = followUp.id;
    }
    await db.tasks.put(next);
    return followUp ? { followUp } : {};
  });
}

/** Untouched since completeTask created it: open, never written, subtasks as copied. */
function untouched(followUp: Task, subtasks: readonly Task[]): boolean {
  const pristine = (t: Task): boolean =>
    t.status === 'open' && t.updatedAt === t.createdAt && t.createdAt === followUp.createdAt;
  return pristine(followUp) && subtasks.every(pristine);
}

/**
 * status 'open', completedAt removed. When completing it created a follow-up instance that is
 * still untouched, the follow-up and its subtasks are deleted again ("Rückgängig"); a follow-up the
 * user has worked on stays. followUpId is cleared either way.
 */
export function reopenTask(id: Id): Promise<void> {
  return db.transaction('rw', db.tasks, async () => {
    const task = await db.tasks.get(id);
    if (!task) throw new Error(`unknown task ${id}`);
    if (task.followUpId) {
      const followUp = await db.tasks.get(task.followUpId);
      if (followUp) {
        const subtasks = await childrenOf(followUp.id);
        if (untouched(followUp, subtasks)) await db.tasks.bulkDelete([followUp.id, ...subtasks.map((s) => s.id)]);
      }
    }
    await mutate(id, (current) => {
      current.status = 'open';
      delete current.completedAt;
      delete current.followUpId;
      return current;
    });
  });
}

/** What deleteTask removed: the task and its subtasks (for restoreTask). */
export interface DeletedTask { task: Task; subtasks: Task[] }

/**
 * Deletes the task and its subtasks; returns them for "Rückgängig". Its id stays in DayPlans
 * (readers skip unknown ids), so restoreTask brings back its focus slot.
 */
export function deleteTask(id: Id): Promise<DeletedTask> {
  return db.transaction('rw', db.tasks, async () => {
    const task = await db.tasks.get(id);
    if (!task) throw new Error(`unknown task ${id}`);
    const subtasks = await childrenOf(id);
    await db.tasks.bulkDelete([id, ...subtasks.map((s) => s.id)]);
    return { task, subtasks };
  });
}

/** Puts a deleted task and its subtasks back unchanged (undo of deleteTask). */
export async function restoreTask(deleted: DeletedTask): Promise<void> {
  await db.tasks.bulkPut([deleted.task, ...deleted.subtasks]);
}

export function getTask(id: Id): Promise<Task | undefined> {
  return db.tasks.get(id);
}

export function task$(id: Id): Observable<Task | undefined> {
  return liveQuery(() => db.tasks.get(id));
}

/** liveQuery: tasks whose linkedNoteIds contain noteId (Rückverweise of a note), open ones first, then by creation. */
export function linkedTasks$(noteId: Id): Observable<Task[]> {
  return liveQuery(async () => {
    const rows = await db.tasks.filter((t) => t.linkedNoteIds?.includes(noteId) === true).toArray();
    return rows.sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || compareIso(a.createdAt, b.createdAt));
  });
}

/** Tasks for the given ids, in the given order; missing ids are skipped. */
export function tasksByIds$(ids: readonly Id[]): Observable<Task[]> {
  const keys = [...ids];
  return liveQuery(async () => {
    const rows = await db.tasks.bulkGet(keys);
    return rows.filter((t): t is Task => t !== undefined);
  });
}

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

// ---------------------------------------------------------------------------
// Subtasks

/** Adds an open subtask at the end of the parent's list (parent must be a top-level task). */
export function createSubtask(parentId: Id, title: string): Promise<Task> {
  const text = title.trim();
  if (!text) return Promise.reject(new RangeError('createSubtask: empty title'));
  return db.transaction('rw', db.tasks, async () => {
    const parent = await db.tasks.get(parentId);
    if (!parent) throw new Error(`unknown task ${parentId}`);
    if (!isTopLevel(parent)) throw new RangeError(`createSubtask: ${parentId} is a subtask`);
    const siblings = await childrenOf(parentId);
    const stamp = nowIso();
    const task: Task = {
      id: newId(),
      areaId: parent.areaId,
      projectId: parent.projectId,
      parentId,
      title: text,
      status: 'open',
      important: 0,
      urgent: 0,
      dueHasTime: 0,
      reminders: [],
      sortKey: sortKeyBetween(siblings.at(-1)?.sortKey ?? null, null),
      createdAt: stamp,
      updatedAt: stamp,
    };
    await db.tasks.add(task);
    return task;
  });
}

/** liveQuery: the subtasks of a task in sortKey order. */
export function subtasks$(parentId: Id): Observable<Task[]> {
  return liveQuery(() => childrenOf(parentId));
}

/** liveQuery: done/total subtasks per parent; only parents with at least one subtask appear. */
export function subtaskProgress$(parentIds: readonly Id[]): Observable<Map<Id, { done: number; total: number }>> {
  const keys = [...new Set(parentIds)];
  return liveQuery(async () => {
    const progress = new Map<Id, { done: number; total: number }>();
    if (keys.length === 0) return progress;
    const rows = await db.tasks.where('parentId').anyOf(keys).toArray();
    for (const sub of rows) {
      if (!sub.parentId) continue;
      const entry = progress.get(sub.parentId) ?? { done: 0, total: 0 };
      entry.total += 1;
      if (sub.status === 'done') entry.done += 1;
      progress.set(sub.parentId, entry);
    }
    return progress;
  });
}

/** Moves a subtask to position `index` (clamped) among its siblings. */
export function moveSubtask(id: Id, index: number): Promise<void> {
  return db.transaction('rw', db.tasks, async () => {
    const task = await db.tasks.get(id);
    if (!task?.parentId) throw new Error(`unknown subtask ${id}`);
    const others = (await childrenOf(task.parentId)).filter((s) => s.id !== id);
    const at = Math.min(Math.max(Math.trunc(index), 0), others.length);
    const before = others[at - 1]?.sortKey ?? null;
    const after = others[at]?.sortKey ?? null;
    if (before !== null && after !== null && before >= after) {
      // Equal keys (e.g. imported): renumber the siblings first.
      const keys = sortKeysAfter(null, others.length + 1);
      const order = [...others.slice(0, at), task, ...others.slice(at)];
      await Promise.all(order.map((s, i) => mutate(s.id, (row) => ({ ...row, sortKey: keys[i] ?? row.sortKey }))));
      return;
    }
    await mutate(id, (row) => ({ ...row, sortKey: sortKeyBetween(before, after) }));
  });
}

/** liveQuery: not-done tasks that have at least one reminder (for services/reminders). */
export function tasksWithReminders$(): Observable<Task[]> {
  return liveQuery(() =>
    db.tasks.filter((t) => t.status !== 'done' && Array.isArray(t.reminders) && t.reminders.length > 0).toArray(),
  );
}
