// Herbarium (Gamification Teil 2, decision of 02.11.2026): one pressed flower for every routine that once reached
// full bloom (its bloom milestone), with routine, area and date; routines still growing show as pale cards with
// how far the bloom is ("noch 3 Tage"). Pure (unit-tested in __tests__/visitors.test.ts).
// Order: pressed flowers newest first, then the open ones closest to blooming first. Archived routines keep
// their pressed flower; archived ones without a bloom are left out.
import { fmt, t } from '../i18n/de.js';
import { GENERIC_TINT, type Area, type Day, type FlowerId, type Habit, type HabitLog, type Id, type Milestone } from '../model.js';
import { formatDayMonth } from '../util/date.js';
import { bloomCount, streak, streakUnit } from './growth.js';

export interface HerbariumCard {
  habitId: Id;
  name: string;
  flower: FlowerId;
  tint: string;
  /** Area name ('' without an area). */
  area: string;
  archived: boolean;
  bloomedOn: Day | null;
  /** "voll erblüht am 21. Oktober" or "noch 3 Tage". */
  line: string;
  /** Open cards: scheduled days (or weeks) still needed, at least 1. */
  remaining?: number;
}

export function herbariumCards(habits: readonly Habit[], logs: ReadonlyMap<Id, readonly HabitLog[]>, milestones: readonly Milestone[],
  areas: ReadonlyMap<Id, Area>, today: Day): HerbariumCard[] {
  const bloomed = new Map(milestones.filter((m) => m.kind === 'bloom').map((m) => [m.habitId, m.earnedOn]));
  const cards: HerbariumCard[] = [];
  for (const habit of habits) {
    const area = habit.areaId ? areas.get(habit.areaId) : undefined;
    const base = {
      habitId: habit.id, name: habit.name, flower: area?.flower ?? 'generic' as FlowerId, tint: area?.tint ?? GENERIC_TINT,
      area: area?.name ?? '', archived: habit.archived === 1,
    };
    const day = bloomed.get(habit.id);
    if (day !== undefined) {
      cards.push({ ...base, bloomedOn: day, line: fmt(t.herbariumBloomed, { date: formatDayMonth(day) }) });
      continue;
    }
    if (habit.archived === 1) continue;
    const remaining = Math.max(1, bloomCount(habit) - streak(habit, logs.get(habit.id) ?? [], today));
    const weeks = streakUnit(habit) === 'weeks';
    const line = weeks
      ? (remaining === 1 ? t.herbariumSoonWeekOne : fmt(t.herbariumSoonWeeks, { n: remaining }))
      : (remaining === 1 ? t.herbariumSoonOne : fmt(t.herbariumSoon, { n: remaining }));
    cards.push({ ...base, bloomedOn: null, line, remaining });
  }
  return cards.sort((a, b) => {
    if (a.bloomedOn && b.bloomedOn) return b.bloomedOn.localeCompare(a.bloomedOn);
    if (a.bloomedOn) return -1;
    if (b.bloomedOn) return 1;
    return (a.remaining ?? 0) - (b.remaining ?? 0);
  });
}
