import Dexie, { type EntityTable } from 'dexie';
import type { Area, DayPlan, Habit, HabitLog, MoodLog, Note, Profile, Project, Tag, Task } from './model.js';

export const db = new Dexie('olife') as Dexie & {
  profile: EntityTable<Profile,'key'>; areas: EntityTable<Area,'id'>; projects: EntityTable<Project,'id'>;
  tasks: EntityTable<Task,'id'>; habits: EntityTable<Habit,'id'>; habitLogs: EntityTable<HabitLog,'id'>;
  notes: EntityTable<Note,'id'>; tags: EntityTable<Tag,'path'>; moodLogs: EntityTable<MoodLog,'id'>; dayPlans: EntityTable<DayPlan,'id'>;
};
db.version(1).stores({
  profile:   'key',
  areas:     'id, sortKey, archived',
  projects:  'id, areaId, status, [areaId+status]',
  tasks:     'id, projectId, parentId, dueDay, [areaId+status], [projectId+status], updatedAt',
  habits:    'id, archived, period',
  habitLogs: 'id, habitId, day, [habitId+day]',
  notes:     'id, kind, journalDay, pinned, archived, updatedAt, *tagPaths',
  tags:      'path, parentPath',
  moodLogs:  'id, day',
  dayPlans:  'id'
});

/** All table names in a stable order (export, import, delete-all). */
export const TABLES = [
  'profile', 'areas', 'projects', 'tasks', 'habits', 'habitLogs', 'notes', 'tags', 'moodLogs', 'dayPlans',
] as const;
export type TableName = typeof TABLES[number];

let reloadPlanned = false;

/** Reloads the page now when it is hidden, otherwise at the next visibility change or interaction. */
function planReload(): void {
  if (reloadPlanned || typeof window === 'undefined' || typeof document === 'undefined') return;
  reloadPlanned = true;
  if (document.hidden) {
    window.location.reload();
    return;
  }
  // The triggering interaction must not reach the app any more: its connection is closed.
  const swallow = (event: Event): void => {
    event.stopImmediatePropagation();
    event.preventDefault();
  };
  const reload = (event: Event): void => {
    if (event.type !== 'visibilitychange' && event.type !== 'focus') swallow(event);
    window.location.reload();
  };
  for (const type of ['pointerdown', 'keydown', 'click'] as const) window.addEventListener(type, reload, { capture: true });
  window.addEventListener('focus', reload);
  document.addEventListener('visibilitychange', reload);
}

/**
 * Another tab deletes the database ("Alle Daten löschen", restore) or opens a newer schema
 * version: close this connection so the other tab can proceed, and reload this page (when it is
 * hidden at once, else on the next interaction) so it shows the new state instead of stale data.
 * return false keeps Dexie from reopening the connection on its own.
 */
db.on('versionchange', () => {
  db.close();
  planReload();
  return false;
});
