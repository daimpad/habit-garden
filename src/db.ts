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

/**
 * Another tab opened a newer schema version: close this connection so the
 * other tab can upgrade; the page is reloaded on next interaction.
 */
db.on('versionchange', () => {
  db.close();
  return false;
});
