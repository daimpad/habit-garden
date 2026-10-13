// PLANUNG data (Phase 3): one live list of open top-level tasks that the screens filter in memory
// (by area, project, inbox rule), and the persisted tab state (Profile.planning).
import { liveQuery, type Observable } from 'dexie';
import { db } from '../db.js';
import type { Id, PlanningState, PlanningView, Task } from '../model.js';
import { getProfile, updateProfile } from './profile.js';

/** liveQuery: all open (not done) top-level tasks. */
export function openTasks$(): Observable<Task[]> {
  return liveQuery(() => db.tasks.filter((t) => t.status !== 'done' && (t.parentId === null || t.parentId === undefined)).toArray());
}

/** Key under which a view is remembered: the area id, or 'all' for "Alle" (A.3: Segment-Zustand pro Bereich). */
export function viewKey(areaId: Id | undefined): string {
  return areaId ?? 'all';
}

/** Stores the selected area (undefined = "Alle"). */
export async function setPlanningArea(areaId: Id | undefined): Promise<void> {
  const profile = await getProfile();
  const next: PlanningState = { ...(profile.planning ?? {}) };
  if (areaId === undefined) delete next.areaId;
  else next.areaId = areaId;
  await updateProfile({ planning: next });
}

/** Stores the view for an area key. */
export async function setPlanningView(key: string, view: PlanningView): Promise<void> {
  const profile = await getProfile();
  const state = profile.planning ?? {};
  await updateProfile({ planning: { ...state, views: { ...(state.views ?? {}), [key]: view } } });
}
