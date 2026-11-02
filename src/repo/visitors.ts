// Besucher und Herbarium (Gamification Teil 2): gathers what services/visitors.ts reads, live. Nothing is stored
// of its own; everything comes from milestones, habit logs, the evening fire's journal entries, contact logs and
// completed tasks.
import { liveQuery, type Observable } from 'dexie';
import { db } from '../db.js';
import type { Day, Habit, HabitLog, Milestone } from '../model.js';
import { hasJoyEntry } from '../services/island.js';
import { allDoneDays, type VisitorHistory } from '../services/visitors.js';
import { dayOfIso, today } from '../util/date.js';

export interface GardenData {
  history: VisitorHistory;
  habits: Habit[];
  logs: HabitLog[];
  milestones: Milestone[];
}

const byDay = <T extends { day: Day }>(a: T, b: T): number => a.day.localeCompare(b.day);

export function gardenData$(): Observable<GardenData> {
  return liveQuery(async (): Promise<GardenData> => {
    const [habits, logs, milestones, journal, contactLogs, tasks] = await Promise.all([
      db.habits.toArray(),
      db.habitLogs.toArray(),
      db.milestones.toArray(),
      db.notes.where('kind').equals('journal').toArray(),
      db.contactLogs.toArray(),
      db.tasks.filter((x) => x.status === 'done' && Boolean(x.completedAt)).toArray(),
    ]);
    const now = today();
    const name = new Map(habits.map((h) => [h.id, h.name]));
    const named = (kind: Milestone['kind']): Array<{ day: Day; name: string }> => milestones
      .filter((m) => m.kind === kind)
      .map((m) => ({ day: m.earnedOn, name: name.get(m.habitId) ?? '' }))
      .sort(byDay);
    const history: VisitorHistory = {
      blooms: named('bloom'),
      streak7: named('streak7'),
      streak30: named('streak30'),
      joyDays: journal.filter((n) => n.journalDay && hasJoyEntry(n.body)).map((n) => n.journalDay as Day).sort(),
      doneLogDays: logs.filter((l) => l.status === 'done').map((l) => l.day).sort(),
      allDoneDays: allDoneDays(habits, logs, now),
      contactDays: [...new Set(contactLogs.map((l) => l.day))].sort(),
      taskDays: tasks.filter((x) => x.completedAt).map((x) => dayOfIso(x.completedAt as string)).sort(),
    };
    return { history, habits, logs, milestones };
  });
}
