// Projects (Phase 3, Feinkonzept A.2 P3/P4): every project belongs to exactly one area; its tasks
// (and their subtasks) carry the same areaId. updatedAt of a project is set only here.
// Rules:
// - createProject trims the name (empty → RangeError), status 'active', sortKey after the last project
//   of the area (archived ones included, so a restored or re-activated project keeps its place).
// - moveProject moves the project and all its tasks (incl. subtasks) to the new area in one
//   transaction; the project goes to the end of the new area.
// - deleteProject keeps the tasks: their projectId becomes null. restoreProject puts the project back
//   and re-assigns the tasks that still exist without a project in the project's area; a task untouched
//   since the delete gets its previous updatedAt back (so an untouched recurring follow-up stays
//   "pristine" for reopenTask).
// - The task writes of moveProject/deleteProject/restoreProject are the one exception to "all task
//   writes go through repo/tasks": they need the projects table in the same transaction.
// - Stats (P3 project card): top-level tasks only; done/total; nextDue = earliest dueDay of the
//   tasks that are not done (computeProjectStats, pure and unit-tested).
// - projectResolver: the "@" lookup of the capture sheet (Phase 3): active projects first, then areas.
import Dexie, { liveQuery, type Observable } from 'dexie';
import { db } from '../db.js';
import type { Area, Day, Id, ISO, Project, Task } from '../model.js';
import { matchNamed, type QuickTarget } from '../services/quick-syntax.js';
import { nowIso } from '../util/date.js';
import { newId, sortKeyBetween } from '../util/ids.js';

const bySortKey = (a: Project, b: Project): number =>
  (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Active projects, optionally of one area, ordered by sortKey. */
export async function listProjects(areaId?: Id): Promise<Project[]> {
  const rows = areaId === undefined
    ? await db.projects.where('status').equals('active').toArray()
    : await db.projects.where('[areaId+status]').equals([areaId, 'active']).toArray();
  return rows.sort(bySortKey);
}

export function projects$(areaId?: Id): Observable<Project[]> {
  return liveQuery(() => listProjects(areaId));
}

export function getProject(id: Id): Promise<Project | undefined> {
  return db.projects.get(id);
}

export function project$(id: Id): Observable<Project | undefined> {
  return liveQuery(() => db.projects.get(id));
}

/** All projects by sortKey; archived ones only when includeArchived. */
export function allProjects$(includeArchived = false): Observable<Project[]> {
  return liveQuery(async () => {
    const rows = includeArchived ? await db.projects.toArray() : await db.projects.where('status').equals('active').toArray();
    return rows.sort(bySortKey);
  });
}

function cleanName(name: string): string {
  const trimmed = name.replace(/\s+/gu, ' ').trim();
  if (trimmed === '') throw new RangeError('project name must not be empty');
  return trimmed;
}

/** sortKey after the last project of the area (inside a transaction on projects). */
async function nextProjectSortKey(areaId: Id, skip?: Id): Promise<string> {
  let max: string | null = null;
  await db.projects
    .where('[areaId+status]')
    .between([areaId, Dexie.minKey], [areaId, Dexie.maxKey], true, true)
    .each((p) => {
      if (p.id !== skip && (max === null || p.sortKey > max)) max = p.sortKey;
    });
  return sortKeyBetween(max, null);
}

export function createProject(input: { areaId: Id; name: string; description?: string }): Promise<Project> {
  let name: string;
  try {
    name = cleanName(input.name);
  } catch (err) {
    return Promise.reject(err);
  }
  return db.transaction('rw', db.projects, async () => {
    const project: Project = {
      id: newId(),
      areaId: input.areaId,
      name,
      status: 'active',
      sortKey: await nextProjectSortKey(input.areaId),
      updatedAt: nowIso(),
    };
    const description = input.description?.trim();
    if (description) project.description = input.description;
    await db.projects.add(project);
    return project;
  });
}

/** Read-modify-write of one project inside a rw transaction; sets updatedAt. */
function mutateProject(id: Id, fn: (project: Project) => void): Promise<Project> {
  return db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(id);
    if (!project) throw new Error(`unknown project ${id}`);
    const next = structuredClone(project);
    fn(next);
    next.id = id;
    next.updatedAt = nowIso();
    await db.projects.put(next);
    return next;
  });
}

/**
 * Patches name (trimmed, must not be empty), description (undefined or blank clears it) and dueAt
 * (undefined clears it, otherwise a valid ISO timestamp).
 */
export async function updateProject(id: Id, patch: Partial<Pick<Project, 'name' | 'description' | 'dueAt'>>): Promise<void> {
  const name = 'name' in patch && patch.name !== undefined ? cleanName(patch.name) : undefined;
  if (patch.dueAt !== undefined && Number.isNaN(Date.parse(patch.dueAt))) throw new RangeError(`invalid dueAt ${patch.dueAt}`);
  await mutateProject(id, (project) => {
    if (name !== undefined) project.name = name;
    if ('description' in patch) {
      if (patch.description === undefined || patch.description.trim() === '') delete project.description;
      else project.description = patch.description;
    }
    if ('dueAt' in patch) {
      if (patch.dueAt === undefined) delete project.dueAt;
      else project.dueAt = new Date(patch.dueAt).toISOString();
    }
  });
}

/** Moves the project to another area (at its end) together with all its tasks and their subtasks. */
export function moveProject(id: Id, areaId: Id): Promise<void> {
  return db.transaction('rw', db.projects, db.tasks, async () => {
    const project = await db.projects.get(id);
    if (!project) throw new Error(`unknown project ${id}`);
    if (project.areaId === areaId) return;
    const stamp = nowIso();
    await db.projects.put({ ...project, areaId, sortKey: await nextProjectSortKey(areaId, id), updatedAt: stamp });
    const taskIds = await db.tasks.where('projectId').equals(id).primaryKeys();
    // Subtasks normally carry the parent's projectId already; also catch ones that do not.
    const subtasks = taskIds.length ? await db.tasks.where('parentId').anyOf(taskIds).primaryKeys() : [];
    await db.tasks
      .where('id').anyOf([...new Set([...taskIds, ...subtasks])])
      .modify((task) => {
        task.areaId = areaId;
        task.projectId = id;
        task.updatedAt = stamp;
      });
  });
}

/** status 'archived' (true) or 'active' (false). */
export async function setProjectArchived(id: Id, archived: boolean): Promise<void> {
  await mutateProject(id, (project) => {
    project.status = archived ? 'archived' : 'active';
  });
}

/** What deleteProject removed (for restoreProject). */
export interface DeletedProject {
  project: Project;
  /** The tasks (incl. subtasks) that lost their project, as they were before. */
  tasks: Task[];
  /** updatedAt written on those tasks by the delete. */
  stamp: ISO;
}

/** Deletes the project; its tasks stay (projectId null). Returns what restoreProject needs. */
export function deleteProject(id: Id): Promise<DeletedProject> {
  return db.transaction('rw', db.projects, db.tasks, async () => {
    const project = await db.projects.get(id);
    if (!project) throw new Error(`unknown project ${id}`);
    const tasks = await db.tasks.where('projectId').equals(id).toArray();
    const stamp = nowIso();
    await db.tasks.bulkPut(tasks.map((task) => ({ ...task, projectId: null, updatedAt: stamp })));
    await db.projects.delete(id);
    return { project, tasks, stamp };
  });
}

/** Undo of deleteProject (see the rules at the top). */
export function restoreProject(deleted: DeletedProject): Promise<void> {
  const { project, stamp } = deleted;
  return db.transaction('rw', db.projects, db.tasks, async () => {
    await db.projects.put(project);
    const current = await db.tasks.bulkGet(deleted.tasks.map((t) => t.id));
    const fresh = nowIso();
    const rows: Task[] = [];
    deleted.tasks.forEach((before, i) => {
      const row = current[i];
      if (!row || row.projectId !== null || row.areaId !== project.areaId) return;
      rows.push({ ...row, projectId: project.id, updatedAt: row.updatedAt === stamp ? before.updatedAt : fresh });
    });
    if (rows.length) await db.tasks.bulkPut(rows);
  });
}

// ---------------------------------------------------------------------------
// Stats

export interface ProjectStats { done: number; total: number; nextDue?: Day }

/** done/total of the top-level tasks per project; nextDue = earliest dueDay of the open ones. */
export function computeProjectStats(tasks: readonly Task[]): Map<Id, ProjectStats> {
  const stats = new Map<Id, ProjectStats>();
  for (const task of tasks) {
    if (!task.projectId || (task.parentId !== null && task.parentId !== undefined)) continue;
    const entry = stats.get(task.projectId) ?? { done: 0, total: 0 };
    entry.total += 1;
    if (task.status === 'done') entry.done += 1;
    else if (task.dueDay && (entry.nextDue === undefined || task.dueDay < entry.nextDue)) entry.nextDue = task.dueDay;
    stats.set(task.projectId, entry);
  }
  return stats;
}

/** liveQuery: computeProjectStats over all tasks with a project (null is not indexed). */
export function projectStats$(): Observable<Map<Id, ProjectStats>> {
  return liveQuery(async () => computeProjectStats(await db.tasks.orderBy('projectId').toArray()));
}

// ---------------------------------------------------------------------------
// "@" in the capture sheet

/**
 * Resolver for parseQuickSyntax (QuickContext.resolveAt): active projects of the given (active) areas
 * first, matched like areas (matchNamed: exact name, else a unique name or word prefix); when no
 * single project matches, the areas.
 */
export function projectResolver(
  projects: readonly Pick<Project, 'id' | 'name' | 'areaId' | 'status'>[],
  areas: readonly Pick<Area, 'id' | 'name'>[],
): (query: string) => QuickTarget | undefined {
  const areaIds = new Set(areas.map((a) => a.id));
  const candidates = projects.filter((p) => p.status === 'active' && areaIds.has(p.areaId));
  return (query) => {
    const project = matchNamed(query, candidates);
    if (project && project !== 'ambiguous') return { kind: 'project', id: project.id };
    const area = matchNamed(query, areas);
    return area && area !== 'ambiguous' ? { kind: 'area', id: area.id } : undefined;
  };
}
