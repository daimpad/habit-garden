// PLANUNG helpers (Phase 3, A.3 Screen 2). Pure functions, no DOM, no Dexie, testable in node.
// - List view groups (A.3 "Ansicht Liste"): Überfällig · Heute · Diese Woche · Später · Ohne Datum.
//   "Diese Woche" ends with the Sunday of today's ISO week; on a Sunday it is empty.
// - Inbox (P7): open top-level tasks without project and without due date ("unsortiert").
// - Project progress as a plant: the share of done tasks picks the growth stage, so a project grows
//   like a routine (seed without tasks, bloom when everything is done).
import type { Day, Id, Stage, Task } from '../model.js';
import { compareDue } from '../repo/tasks.js';
import { addDays, startOfWeek } from '../util/date.js';

export type ListGroupKey = 'overdue' | 'today' | 'week' | 'later' | 'noDate';
export const LIST_GROUPS: readonly ListGroupKey[] = ['overdue', 'today', 'week', 'later', 'noDate'];

export function listGroupOf(task: Pick<Task, 'dueDay'>, today: Day): ListGroupKey {
  const day = task.dueDay;
  if (day === undefined) return 'noDate';
  if (day < today) return 'overdue';
  if (day === today) return 'today';
  return day <= addDays(startOfWeek(today), 6) ? 'week' : 'later';
}

/** Groups open tasks for the list view; each group in due order (undated: newest first). */
export function groupForList(tasks: readonly Task[], today: Day): Record<ListGroupKey, Task[]> {
  const out: Record<ListGroupKey, Task[]> = { overdue: [], today: [], week: [], later: [], noDate: [] };
  for (const task of tasks) out[listGroupOf(task, today)].push(task);
  for (const key of LIST_GROUPS) {
    if (key === 'noDate') out[key].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    else out[key].sort(compareDue);
  }
  return out;
}

const isTopLevel = (task: Task): boolean => task.parentId === null || task.parentId === undefined;

/** Open (not done) top-level tasks. */
export function openTopLevel(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) => task.status !== 'done' && isTopLevel(task));
}

export function isInbox(task: Task): boolean {
  return task.status !== 'done' && isTopLevel(task) && !task.projectId && task.dueDay === undefined;
}

/** Tasks of the scope: an area (undefined = all areas) and optionally one project. */
export function inScope(tasks: readonly Task[], scope: { areaId?: Id; projectId?: Id }): Task[] {
  return tasks.filter((task) => (scope.areaId === undefined || task.areaId === scope.areaId)
    && (scope.projectId === undefined || task.projectId === scope.projectId));
}

/** Stage of a project's plant from its progress: 0 without tasks, 1–3 by share done, 4 when all are done. */
export function projectStage(done: number, total: number): Stage {
  if (total <= 0) return 0;
  const share = done / total;
  if (share >= 1) return 4;
  if (share >= 0.5) return 3;
  if (share >= 0.25) return 2;
  return 1;
}
