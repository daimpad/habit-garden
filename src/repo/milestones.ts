// Milestones ("Spuren im Garten", Garten-Insel Teil 3): stored in the table `milestones` (Dexie version 3).
// The rules live in services/milestones.ts; this module reads the history and writes what they plan.
import { liveQuery, type Observable } from 'dexie';
import { db } from '../db.js';
import type { Day, Id, Milestone } from '../model.js';
import { planMilestones } from '../services/milestones.js';
import { today } from '../util/date.js';

export function milestones$(): Observable<Milestone[]> {
  return liveQuery(() => db.milestones.toArray());
}

export function listMilestones(): Promise<Milestone[]> {
  return db.milestones.toArray();
}

export interface MilestoneChange { added: Milestone[]; removed: Milestone[] }

/**
 * After a log of `habitId` on `changedDay` changed (watering, the heatmap, Rückgängig): adds the milestones the
 * history now supports and removes those with earnedOn ≥ changedDay it no longer supports (services/milestones
 * planMilestones, mode 'live'). One rw transaction; returns what actually changed (for the celebration).
 */
export function syncMilestones(habitId: Id, changedDay: Day): Promise<MilestoneChange> {
  return db.transaction('rw', db.habits, db.habitLogs, db.milestones, async () => {
    const habit = await db.habits.get(habitId);
    if (!habit) return { added: [], removed: [] };
    const logs = await db.habitLogs.where('habitId').equals(habitId).toArray();
    const stored = await db.milestones.where('habitId').equals(habitId).toArray();
    const plan = planMilestones(habit, logs, stored, today(), { kind: 'live', changedDay });
    const removed = stored.filter((m) => plan.remove.includes(m.id));
    if (plan.remove.length > 0) await db.milestones.bulkDelete(plan.remove);
    if (plan.add.length > 0) await db.milestones.bulkPut(plan.add);
    return { added: plan.add, removed };
  });
}

/**
 * Backfill at every app start and HEUTE mount: adds every milestone the history of any routine (archived ones
 * included) supports and that is missing, with the day it was first reached. Never removes, never celebrates.
 * Returns the number added.
 */
export function backfillMilestones(): Promise<number> {
  return db.transaction('rw', db.habits, db.habitLogs, db.milestones, async () => {
    const [habits, logs, stored] = await Promise.all([db.habits.toArray(), db.habitLogs.toArray(), db.milestones.toArray()]);
    const day = today();
    const byHabit = new Map<Id, typeof logs>();
    for (const log of logs) {
      const list = byHabit.get(log.habitId) ?? [];
      list.push(log);
      byHabit.set(log.habitId, list);
    }
    const add: Milestone[] = [];
    for (const habit of habits) {
      add.push(...planMilestones(habit, byHabit.get(habit.id) ?? [], stored, day, { kind: 'backfill' }).add);
    }
    if (add.length > 0) await db.milestones.bulkAdd(add);
    return add.length;
  });
}
