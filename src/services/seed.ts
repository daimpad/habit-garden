// Example data ("Beispieldaten laden", E.2 seed; decision 2026-10-12: available in every build).
// Adds routines in all five growth stages with some weeks of history, three tasks and a focus,
// relative to today. Existing data is kept; a second run is refused (names already present).
// "10 min dehnen" has 13 days in a row up to yesterday, so ticking it today shows the
// stage change to Blüte with its animation.
import { db } from '../db.js';
import { t } from '../i18n/de.js';
import { DEFAULT_AREAS, type Area, type Day, type HabitSchedule, type Habit } from '../model.js';
import { createArea, listAreas } from '../repo/areas.js';
import { addToFocus } from '../repo/dayPlans.js';
import { createHabit } from '../repo/habits.js';
import { toggleLog } from '../repo/habitLogs.js';
import { createTask } from '../repo/tasks.js';
import { addDays, diffDays, isoAt, startOfWeek, today } from '../util/date.js';

export type SeedResult = 'created' | 'exists';

interface SeedHabit {
  name: string;
  schedule: HabitSchedule;
  period: Habit['period'];
  startOffset: number;
  /** Days before today with a 'done' log (0 = today). */
  done: number[];
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Areas to spread the routines over: the active ones, completed to four with default areas. */
async function seedAreas(): Promise<Area[]> {
  const areas = await listAreas();
  for (const def of DEFAULT_AREAS) {
    if (areas.length >= 4) break;
    if (!areas.some((a) => a.flower === def.flower)) areas.push(await createArea(def));
  }
  return areas;
}

export async function loadExampleData(): Promise<SeedResult> {
  const existing = await db.habits.filter((h) => h.name === t.seedHabitStretch).first();
  if (existing) return 'exists';

  const day = today();
  const ago = (n: number): Day => addDays(day, -n);
  const monday = startOfWeek(day);
  const weeksBack = (w: number, offsets: number[]): number[] =>
    offsets.map((o) => diffDays(day, addDays(monday, -7 * w + o)));

  const habits: SeedHabit[] = [
    { name: t.seedHabitWater, schedule: { kind: 'daily', interval: 1 }, period: 'morning', startOffset: 40, done: [...range(0, 20), ...range(26, 33)] },
    { name: t.seedHabitStretch, schedule: { kind: 'daily', interval: 1 }, period: 'morning', startOffset: 30, done: [...range(1, 13), ...range(18, 22)] },
    {
      name: t.seedHabitRead, schedule: { kind: 'timesPerWeek', times: 3 }, period: 'any', startOffset: 35,
      done: [...weeksBack(3, [0, 2, 4]), ...weeksBack(2, [1, 3, 5]), ...weeksBack(1, [0, 2, 4]), ...weeksBack(0, [0])],
    },
    { name: t.seedHabitJournal, schedule: { kind: 'daily', interval: 1 }, period: 'evening', startOffset: 20, done: [...range(1, 5), ...range(10, 12)] },
    { name: t.seedHabitWalk, schedule: { kind: 'daily', interval: 1 }, period: 'any', startOffset: 10, done: [1, 4, 5] },
    { name: t.seedHabitMeditate, schedule: { kind: 'daily', interval: 1 }, period: 'morning', startOffset: 0, done: [] },
  ];

  const areas = await seedAreas();
  for (const [i, spec] of habits.entries()) {
    const area = areas[i % Math.max(1, areas.length)];
    const habit = await createHabit({
      name: spec.name, schedule: spec.schedule, period: spec.period, startDay: ago(spec.startOffset),
      ...(area ? { areaId: area.id } : {}),
    });
    const days = [...new Set(spec.done)].filter((n) => n >= 0 && n <= spec.startOffset).sort((a, b) => b - a);
    for (const n of days) await toggleLog(habit.id, ago(n));
  }

  const areaId = areas[0]?.id;
  if (areaId) {
    const invoice = await createTask({ title: t.seedTaskInvoice, areaId, dueAt: isoAt(day, '14:00'), dueHasTime: 1 });
    await createTask({ title: t.seedTaskBike, areaId: areas[1]?.id ?? areaId, dueAt: isoAt(ago(1)), dueHasTime: 0 });
    const call = await createTask({ title: t.seedTaskCall, areaId: areas[2]?.id ?? areaId });
    for (const id of [invoice.id, call.id]) {
      try {
        await addToFocus(day, id);
      } catch {
        // Focus already full: the tasks stay available in the focus picker.
      }
    }
  }
  return 'created';
}
