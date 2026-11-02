// Besucher und Herbarium (Gamification Teil 2) and Gestalten/Aufträge (Teil 3): gathers what services/visitors.ts
// and services/garden.ts read, live. Visitors, seeds and tasks are not stored; everything comes from milestones,
// habit logs, journal entries, notes, mood logs, contacts and completed tasks. Only what stands where is stored
// (Profile.garden), written by placeItem / returnItem / buyIslet.
import { liveQuery, type Observable } from 'dexie';
import { db } from '../db.js';
import type { Day, GardenItemId, GardenSlotId, GardenState, Habit, HabitLog, Milestone } from '../model.js';
import { freeSlots, ISLET_PRICE, itemDef, questsDone, seedCount, type QuestHistory, type SeedCount } from '../services/garden.js';
import { hasJoyEntry } from '../services/island.js';
import { allDoneDays, type VisitorHistory } from '../services/visitors.js';
import { dayOfIso, today } from '../util/date.js';
import { updateProfile } from './profile.js';

export interface GardenData {
  history: VisitorHistory;
  quests: QuestHistory;
  habits: Habit[];
  logs: HabitLog[];
  milestones: Milestone[];
  garden: GardenState;
  seeds: SeedCount;
}

const minDay = (days: ReadonlyArray<Day | undefined>): Day | null => days.filter((d): d is Day => !!d).sort()[0] ?? null;

const byDay = <T extends { day: Day }>(a: T, b: T): number => a.day.localeCompare(b.day);

export function gardenData$(): Observable<GardenData> {
  return liveQuery(async (): Promise<GardenData> => {
    const [habits, logs, milestones, notes, contactLogs, tasks, moods, contacts, profile] = await Promise.all([
      db.habits.toArray(),
      db.habitLogs.toArray(),
      db.milestones.toArray(),
      db.notes.toArray(),
      db.contactLogs.toArray(),
      db.tasks.toArray(),
      db.moodLogs.toArray(),
      db.contacts.toArray(),
      db.profile.get('profile'),
    ]);
    const journal = notes.filter((n) => n.kind === 'journal');
    const done = tasks.filter((x) => x.status === 'done' && Boolean(x.completedAt));
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
      taskDays: done.map((x) => dayOfIso(x.completedAt as string)).sort(),
    };
    const quests: QuestHistory = {
      doneLogs: logs.filter((l) => l.status === 'done')
        .map((l) => ({ day: l.day, hour: new Date(l.loggedAt).getHours() }))
        .sort((a, b) => a.day.localeCompare(b.day)),
      allDoneDays: history.allDoneDays,
      taskDays: history.taskDays,
      noteDays: notes.filter((n) => n.kind === 'note').map((n) => dayOfIso(n.createdAt)).sort(),
      joyDays: history.joyDays,
      moodDays: moods.map((m) => m.day).sort(),
      contactDays: history.contactDays,
      firstHabit: minDay(habits.map((h) => h.startDay)),
      firstTask: minDay(tasks.map((x) => dayOfIso(x.createdAt))),
      firstContact: minDay(contacts.map((c) => dayOfIso(c.createdAt))),
    };
    const garden = profile?.garden ?? {};
    const seeds = seedCount({
      waterings: history.doneLogDays.filter((d) => d <= now).length, tasks: history.taskDays.length, joys: history.joyDays.length,
      traces: milestones.length, quests: questsDone(quests, now),
    }, garden);
    return { history, quests, habits, logs, milestones, garden, seeds };
  });
}

/** Error of a garden action the screen explains (not enough seeds, place taken). */
export class GardenError extends Error {
  constructor(readonly reason: 'seeds' | 'slot') {
    super(`garden: ${reason}`);
    this.name = 'GardenError';
  }
}

async function currentGarden(): Promise<{ garden: GardenState; balance: number }> {
  const data = await new Promise<GardenData>((resolve, reject) => {
    const sub = gardenData$().subscribe({ next: (d) => { sub.unsubscribe(); resolve(d); }, error: reject });
  });
  return { garden: data.garden, balance: data.seeds.balance };
}

/** Places (or moves) an item; a new item needs its price in seeds, moving is free. */
export async function placeItem(item: GardenItemId, slot: GardenSlotId): Promise<void> {
  const { garden, balance } = await currentGarden();
  const placed = { ...(garden.placed ?? {}) };
  if (!freeSlots(item, garden).includes(slot)) throw new GardenError('slot');
  if (!placed[item] && balance < itemDef(item).price) throw new GardenError('seeds');
  placed[item] = slot;
  await updateProfile({ garden: { ...garden, placed } });
}

/** Gives an item back (its seeds return through the balance). */
export async function returnItem(item: GardenItemId): Promise<void> {
  const { garden } = await currentGarden();
  const placed = { ...(garden.placed ?? {}) };
  delete placed[item];
  await updateProfile({ garden: { ...garden, placed } });
}

/** Restores an earlier garden state ("Rückgängig"). */
export function restoreGarden(state: GardenState): Promise<void> {
  return updateProfile({ garden: state });
}

/** Buys the side island (once). */
export async function buyIslet(): Promise<void> {
  const { garden, balance } = await currentGarden();
  if (garden.islet === 1) return;
  if (balance < ISLET_PRICE) throw new GardenError('seeds');
  await updateProfile({ garden: { ...garden, islet: 1 } });
}
