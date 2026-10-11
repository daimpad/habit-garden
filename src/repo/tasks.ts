// CONTRACT STUB – implemented in AP5. Signatures are binding; bodies are placeholders.
// Rules: updatedAt is set only here; dueDay is derived from dueAt (util/date deriveDueDay);
// booleans are 0|1; all writes go through this module.
import type { Observable } from 'dexie';
import type { Day, Id, ISO, Reminder, Task } from '../model.js';

export type TaskInput = Pick<Task, 'title' | 'areaId'> & Partial<Task>;

export function createTask(input: TaskInput): Promise<Task> {
  throw new Error(`not implemented: createTask ${input.title}`);
}

/** Patches a task; recomputes dueDay when dueAt changes; sets updatedAt. */
export function updateTask(id: Id, patch: Partial<Task>): Promise<void> {
  throw new Error(`not implemented: updateTask ${id} ${Object.keys(patch).join()}`);
}

/** status 'done' + completedAt. Recurring follow-up instance: TODO(phase-2). */
export function completeTask(id: Id): Promise<void> {
  throw new Error(`not implemented: completeTask ${id}`);
}

/** status 'open', completedAt removed. */
export function reopenTask(id: Id): Promise<void> {
  throw new Error(`not implemented: reopenTask ${id}`);
}

/** Deletes the task (and removes it from DayPlans); returns it for "Rückgängig". */
export function deleteTask(id: Id): Promise<Task> {
  throw new Error(`not implemented: deleteTask ${id}`);
}

/** Puts a deleted task back unchanged (undo of deleteTask). */
export function restoreTask(task: Task): Promise<void> {
  throw new Error(`not implemented: restoreTask ${task.id}`);
}

export function getTask(id: Id): Promise<Task | undefined> {
  throw new Error(`not implemented: getTask ${id}`);
}

export function task$(id: Id): Observable<Task | undefined> {
  throw new Error(`not implemented: task$ ${id}`);
}

/** Tasks for the given ids, in the given order; missing ids are skipped. */
export function tasksByIds$(ids: readonly Id[]): Observable<Task[]> {
  throw new Error(`not implemented: tasksByIds$ ${ids.length}`);
}

/**
 * liveQuery: top-level tasks (parentId null) that are not done and have
 * dueDay <= day. Overdue first (ascending dueDay), then today's tasks:
 * timed ones by time, then untimed by sortKey.
 */
export function dueOn(day: Day): Observable<Task[]> {
  throw new Error(`not implemented: dueOn ${day}`);
}

export interface FocusCandidates { overdue: Task[]; dueToday: Task[]; noDate: Task[] }

/**
 * Suggestions for the focus picker (F §4.13): open top-level tasks, grouped,
 * excluding `exclude`; optional case/diacritics-insensitive title filter.
 */
export function focusCandidates(day: Day, query = '', exclude: readonly Id[] = []): Promise<FocusCandidates> {
  throw new Error(`not implemented: focusCandidates ${day} ${query} ${exclude.length}`);
}

/** Adds a reminder (id assigned here). */
export function addReminder(taskId: Id, reminder: Omit<Reminder, 'id'>): Promise<Reminder> {
  throw new Error(`not implemented: addReminder ${taskId} ${reminder.mode}`);
}

export function removeReminder(taskId: Id, reminderId: Id): Promise<void> {
  throw new Error(`not implemented: removeReminder ${taskId} ${reminderId}`);
}

/** Sets dismissedAt (default now). */
export function dismissReminder(taskId: Id, reminderId: Id, at?: ISO): Promise<void> {
  throw new Error(`not implemented: dismissReminder ${taskId} ${reminderId} ${at ?? ''}`);
}

/** D.5 "+1 h": dismisses the reminder and adds an absolute one at now + minutes. */
export function snoozeReminder(taskId: Id, reminderId: Id, minutes = 60): Promise<Reminder> {
  throw new Error(`not implemented: snoozeReminder ${taskId} ${reminderId} ${minutes}`);
}

/** liveQuery: not-done tasks that have at least one reminder (for services/reminders). */
export function tasksWithReminders$(): Observable<Task[]> {
  throw new Error('not implemented: tasksWithReminders$');
}
