// Phase 1 only reads projects; creation UI is TODO(phase-3).
import { liveQuery, type Observable } from 'dexie';
import { db } from '../db.js';
import type { Id, Project } from '../model.js';

/** Active projects, optionally of one area, ordered by sortKey. */
export async function listProjects(areaId?: Id): Promise<Project[]> {
  const rows = areaId === undefined
    ? await db.projects.where('status').equals('active').toArray()
    : await db.projects.where('[areaId+status]').equals([areaId, 'active']).toArray();
  return rows.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
}

export function projects$(areaId?: Id): Observable<Project[]> {
  return liveQuery(() => listProjects(areaId));
}

export function getProject(id: Id): Promise<Project | undefined> {
  return db.projects.get(id);
}
