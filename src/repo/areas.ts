// CONTRACT STUB – implemented in AP5. Signatures are binding; bodies are placeholders.
import type { Observable } from 'dexie';
import type { Area, Id } from '../model.js';

/** Areas ordered by sortKey; archived ones only when includeArchived. */
export function listAreas(includeArchived = false): Promise<Area[]> {
  throw new Error(`not implemented: listAreas ${includeArchived}`);
}

export function areas$(includeArchived = false): Observable<Area[]> {
  throw new Error(`not implemented: areas$ ${includeArchived}`);
}

export function getArea(id: Id): Promise<Area | undefined> {
  throw new Error(`not implemented: getArea ${id}`);
}

/** First non-archived area by sortKey (default area for captured tasks). */
export function firstActiveArea(): Promise<Area | undefined> {
  throw new Error('not implemented: firstActiveArea');
}

/** Appends a new area at the end (sortKey after the last one). */
export function createArea(input: Pick<Area, 'name' | 'flower' | 'tint'>): Promise<Area> {
  throw new Error(`not implemented: createArea ${input.name}`);
}

export function updateArea(id: Id, patch: Partial<Omit<Area, 'id' | 'updatedAt'>>): Promise<void> {
  throw new Error(`not implemented: updateArea ${id} ${Object.keys(patch).join()}`);
}

export function setAreaArchived(id: Id, archived: 0 | 1): Promise<void> {
  throw new Error(`not implemented: setAreaArchived ${id} ${archived}`);
}
