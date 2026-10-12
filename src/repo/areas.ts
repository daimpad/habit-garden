import { liveQuery, type Observable } from 'dexie';
import { db } from '../db.js';
import { isFlowerId } from '../components/flora.js';
import type { Area, Id } from '../model.js';
import { nowIso } from '../util/date.js';
import { newId, sortKeyBetween } from '../util/ids.js';

/** Thrown when the last non-archived area would be archived (S40). */
export class LastAreaError extends Error {
  constructor() {
    super('the last active area cannot be archived');
    this.name = 'LastAreaError';
  }
}

/** Areas ordered by sortKey; archived ones only when includeArchived. */
export async function listAreas(includeArchived = false): Promise<Area[]> {
  const all = await db.areas.orderBy('sortKey').toArray();
  return includeArchived ? all : all.filter((a) => a.archived === 0);
}

export function areas$(includeArchived = false): Observable<Area[]> {
  return liveQuery(() => listAreas(includeArchived));
}

export function getArea(id: Id): Promise<Area | undefined> {
  return db.areas.get(id);
}

/** First non-archived area by sortKey (default area for captured tasks). */
export function firstActiveArea(): Promise<Area | undefined> {
  return db.areas.orderBy('sortKey').filter((a) => a.archived === 0).first();
}

const AREA_TINT_RE = /^#[0-9A-Fa-f]{6}$/u;

/** Area tints are #RRGGBB (the palette), flowers one of the known ids; anything else throws RangeError. */
function checkLook(look: Partial<Pick<Area, 'flower' | 'tint'>>): void {
  if (look.tint !== undefined && !AREA_TINT_RE.test(look.tint)) throw new RangeError(`invalid tint ${look.tint}`);
  if (look.flower !== undefined && !isFlowerId(look.flower)) throw new RangeError(`invalid flower ${String(look.flower)}`);
}

/** Appends a new area at the end (sortKey after the last one); tint/flower are validated. */
export function createArea(input: Pick<Area, 'name' | 'flower' | 'tint'>): Promise<Area> {
  try {
    checkLook(input);
  } catch (err) {
    return Promise.reject(err);
  }
  return db.transaction('rw', db.areas, async () => {
    const last = await db.areas.orderBy('sortKey').last();
    const area: Area = {
      id: newId(),
      name: input.name.trim(),
      flower: input.flower,
      tint: input.tint,
      sortKey: sortKeyBetween(last?.sortKey ?? null, null),
      archived: 0,
      updatedAt: nowIso(),
    };
    await db.areas.add(area);
    return area;
  });
}

/** Patches an area; archiving the last active area throws LastAreaError; tint/flower are validated. */
export function updateArea(id: Id, patch: Partial<Omit<Area, 'id' | 'updatedAt'>>): Promise<void> {
  try {
    checkLook(patch);
  } catch (err) {
    return Promise.reject(err);
  }
  return db.transaction('rw', db.areas, async () => {
    const area = await db.areas.get(id);
    if (!area) throw new Error(`unknown area ${id}`);
    if (patch.archived === 1 && area.archived === 0) {
      const active = await db.areas.filter((a) => a.archived === 0).count();
      if (active <= 1) throw new LastAreaError();
    }
    const next: Area = { ...area, ...stripUndefined(patch), id, updatedAt: nowIso() };
    if (typeof patch.name === 'string') next.name = patch.name.trim();
    await db.areas.put(next);
  });
}

export function setAreaArchived(id: Id, archived: 0 | 1): Promise<void> {
  return updateArea(id, { archived });
}

function stripUndefined<T extends object>(patch: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(patch) as [keyof T, T[keyof T]][]) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
