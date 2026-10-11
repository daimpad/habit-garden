// CONTRACT STUB – implemented in AP5. Phase 1 only reads projects; creation UI is TODO(phase-3).
import type { Observable } from 'dexie';
import type { Id, Project } from '../model.js';

/** Active projects, optionally of one area, ordered by sortKey. */
export function listProjects(areaId?: Id): Promise<Project[]> {
  throw new Error(`not implemented: listProjects ${areaId ?? ''}`);
}

export function projects$(areaId?: Id): Observable<Project[]> {
  throw new Error(`not implemented: projects$ ${areaId ?? ''}`);
}

export function getProject(id: Id): Promise<Project | undefined> {
  throw new Error(`not implemented: getProject ${id}`);
}
