// Einsichten (decision of 02.11.2026): "Was dir guttut" and the Jahresgarten in the Rückblick. Pure (unit-tested in
// __tests__/insights.test.ts).
//
// Was dir guttut (last INSIGHT_DAYS days, only with enough data, carefully worded, never claiming a cause):
// - Mood and routines: for each routine with a daily or weekday rhythm, the mean mood on scheduled days with and
//   without watering (days with a mood entry only). Needs at least MIN_MOOD_DAYS mood entries overall and
//   MIN_GROUP days on each side; shown when the difference is at least MIN_DIFF (scale 1–5). At most two.
// - The steadiest weekday: the weekday with the highest share of scheduled waterings done, when it stands out
//   (at least WEEKDAY_LEAD above the average and at least four such weekdays in the window).
// Without enough mood entries a hint says how many more are needed.
//
// Jahresgarten: one bed per month of the year: how much was watered (share of scheduled waterings done; future
// months empty), the full blooms, the traces and the visitors that came that month.
import { fmt, t } from '../i18n/de.js';
import type { Day, Habit, HabitLog, Id, Milestone, MoodLog } from '../model.js';
import { addDays, isoWeekday } from '../util/date.js';
import { isScheduledOn } from './growth.js';

export const INSIGHT_DAYS = 90;
export const MIN_MOOD_DAYS = 14;
export const MIN_GROUP = 5;
export const MIN_DIFF = 0.5;
export const WEEKDAY_LEAD = 0.15;

export type Insight =
  | { kind: 'mood'; habitId: Id; name: string; with: number; without: number; text: string }
  | { kind: 'weekday'; weekday: number; rate: number; text: string };

export interface Insights { items: Insight[]; moodDays: number; hint: string | null }

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const num1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function doneSet(logs: readonly HabitLog[]): Set<Day> {
  return new Set(logs.filter((l) => l.status === 'done').map((l) => l.day));
}

export function insights(habits: readonly Habit[], logs: ReadonlyMap<Id, readonly HabitLog[]>, moods: readonly MoodLog[], today: Day): Insights {
  const from = addDays(today, -(INSIGHT_DAYS - 1));
  const moodByDay = new Map<Day, number>();
  for (const m of moods) if (m.day >= from && m.day <= today) moodByDay.set(m.day, m.value);
  const active = habits.filter((h) => h.archived === 0 && h.schedule.kind !== 'timesPerWeek');
  const items: Insight[] = [];

  if (moodByDay.size >= MIN_MOOD_DAYS) {
    const found: Array<Extract<Insight, { kind: 'mood' }>> = [];
    for (const habit of active) {
      const done = doneSet(logs.get(habit.id) ?? []);
      const yes: number[] = [];
      const no: number[] = [];
      for (const [day, value] of moodByDay) {
        if (day < habit.startDay || !isScheduledOn(habit, day)) continue;
        (done.has(day) ? yes : no).push(value);
      }
      if (yes.length < MIN_GROUP || no.length < MIN_GROUP) continue;
      const a = mean(yes);
      const b = mean(no);
      if (a - b >= MIN_DIFF) {
        found.push({
          kind: 'mood', habitId: habit.id, name: habit.name, with: a, without: b,
          text: fmt(t.insightMood, { name: habit.name, with: num1.format(a), without: num1.format(b) }),
        });
      }
    }
    found.sort((x, y) => (y.with - y.without) - (x.with - x.without));
    items.push(...found.slice(0, 2));
  }

  // Steadiest weekday over the same window.
  const due = new Array<number>(8).fill(0);
  const did = new Array<number>(8).fill(0);
  for (const habit of active) {
    const done = doneSet(logs.get(habit.id) ?? []);
    for (let day = from < habit.startDay ? habit.startDay : from; day <= today; day = addDays(day, 1)) {
      if (!isScheduledOn(habit, day)) continue;
      const w = isoWeekday(day);
      due[w] = (due[w] ?? 0) + 1;
      if (done.has(day)) did[w] = (did[w] ?? 0) + 1;
    }
  }
  const rates = [1, 2, 3, 4, 5, 6, 7].filter((w) => (due[w] ?? 0) >= 4).map((w) => ({ w, rate: (did[w] ?? 0) / (due[w] ?? 1) }));
  if (rates.length >= 3) {
    const avg = mean(rates.map((r) => r.rate));
    const best = [...rates].sort((a, b) => b.rate - a.rate || a.w - b.w)[0];
    if (best && best.rate > 0 && best.rate - avg >= WEEKDAY_LEAD) {
      items.push({ kind: 'weekday', weekday: best.w, rate: best.rate, text: fmt(t.insightWeekday, { day: t.weekdaysPlural.split('|')[best.w - 1] ?? '' }) });
    }
  }

  const missing = MIN_MOOD_DAYS - moodByDay.size;
  const hint = missing > 0 ? (missing === 1 ? t.insightNeedOne : fmt(t.insightNeed, { n: missing })) : items.length === 0 ? t.insightNone : null;
  return { items, moodDays: moodByDay.size, hint };
}

// ---------------------------------------------------------------------------
// Jahresgarten

export interface MonthBed {
  month: number;
  /** Share of scheduled waterings done (0–1), null for months without any due day or in the future. */
  rate: number | null;
  /** Full blooms that month (routine names with their flower). */
  blooms: Array<{ habitId: Id; name: string }>;
  traces: number;
  visitors: number;
  future: boolean;
}

export function yearGarden(year: number, habits: readonly Habit[], logs: ReadonlyMap<Id, readonly HabitLog[]>, milestones: readonly Milestone[],
  visitorDays: readonly Day[], today: Day): MonthBed[] {
  const name = new Map(habits.map((h) => [h.id, h.name]));
  const beds: MonthBed[] = [];
  for (let m = 1; m <= 12; m++) {
    const first = `${year}-${String(m).padStart(2, '0')}-01`;
    const future = first > today;
    let due = 0;
    let done = 0;
    if (!future) {
      for (const habit of habits) {
        if (habit.schedule.kind === 'timesPerWeek') continue;
        const set = doneSet(logs.get(habit.id) ?? []);
        for (let day = first; day.slice(0, 7) === first.slice(0, 7) && day <= today; day = addDays(day, 1)) {
          if (day < habit.startDay || !isScheduledOn(habit, day)) continue;
          if (habit.archived === 1 && !set.has(day) && day > ([...set].sort().pop() ?? '')) continue;
          due++;
          if (set.has(day)) done++;
        }
      }
    }
    const inMonth = (d: Day): boolean => d.slice(0, 7) === first.slice(0, 7);
    beds.push({
      month: m,
      rate: future || due === 0 ? null : done / due,
      blooms: milestones.filter((x) => x.kind === 'bloom' && inMonth(x.earnedOn)).map((x) => ({ habitId: x.habitId, name: name.get(x.habitId) ?? '' })),
      traces: milestones.filter((x) => x.kind !== 'bloom' && inMonth(x.earnedOn)).length,
      visitors: visitorDays.filter(inMonth).length,
      future,
    });
  }
  return beds;
}
