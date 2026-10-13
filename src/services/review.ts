// Rückblick (A.2 H9, B.5): pure computations for the review screen and the Sunday card in HEUTE.
// No DOM, no Dexie; testable in node.
//
// Definitions used throughout:
// - A period is [from, to] in local calendar days; "Letzte 30 Tage" ends today, the weekly card covers the
//   ISO week of today up to today. Day iteration uses util/date (calendar based, DST-safe).
// - Only active routines count (archived ones are left out by the callers' list and again here).
// - Opportunities ("fällige Tage") start at habit.startDay, never before. 'skipped' days are no
//   opportunity (a deliberate pause). Today is an opportunity only once it is done, so an open today
//   never lowers a rate.
// - daily / weekly: one opportunity per scheduled day, credited when done.
// - timesPerWeek: per ISO week, target = times × (eligible days of that week inside the period) / 7, so
//   weeks cut by the period edge or by startDay count pro rata; done logs of the week are credited up
//   to that target. `done` stays the raw count of done logs.
// - Weekday rhythm: done logs on scheduled days plus contact logs, averaged over the occurrences of each
//   weekday in the period (a 30-day period holds some weekdays five times, others four).
import type { ContactLog, Day, Habit, HabitLog, Id, MoodLog, Stage } from '../model.js';
import { addDays, diffDays, isoWeekday, startOfWeek } from '../util/date.js';
import { bestStreak, isScheduledOn, stageForCount } from './growth.js';

export const REVIEW_DAYS = 30;

export type MoodValue = 1 | 2 | 3 | 4 | 5;
type LogsByHabit = ReadonlyMap<Id, readonly HabitLog[]>;

export interface Period { from: Day; to: Day; days: number }

/** The last `days` days up to and including today. */
export function lastDays(today: Day, days = REVIEW_DAYS): Period {
  const n = Math.max(1, Math.floor(days));
  return { from: addDays(today, 1 - n), to: today, days: n };
}

/** Monday of today's ISO week up to and including today (the Sunday card: the whole week). */
export function isoWeekUntil(today: Day): Period {
  const from = startOfWeek(today);
  return { from, to: today, days: diffDays(today, from) + 1 };
}

function daysOf(from: Day, to: Day): Day[] {
  const out: Day[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Status per day of one habit ('done' wins over 'skipped'). */
function statusMap(habit: Habit, logs: readonly HabitLog[]): Map<Day, HabitLog['status']> {
  const map = new Map<Day, HabitLog['status']>();
  for (const log of logs) {
    if (log.habitId !== habit.id) continue;
    if (log.status === 'done' || !map.has(log.day)) map.set(log.day, log.status);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Fulfilment

export interface Fulfilment {
  /** Done logs on the habit's eligible days in the period (raw count). */
  done: number;
  /** Opportunities in the period (fractional for timesPerWeek weeks cut by the period). */
  target: number;
  /** Done credited towards target (≤ target). */
  credited: number;
  /** credited / target, null without any opportunity. */
  rate: number | null;
}

/** Fulfilment of one habit in period; `today` (default period.to) only counts once it is done. */
export function fulfilment(habit: Habit, logs: readonly HabitLog[], period: Period, today: Day = period.to): Fulfilment {
  const start = habit.startDay > period.from ? habit.startDay : period.from;
  const status = statusMap(habit, logs);
  let done = 0;
  let target = 0;
  let credited = 0;
  if (habit.archived === 0 && start <= period.to) {
    if (habit.schedule.kind === 'timesPerWeek') {
      const times = Number.isFinite(habit.schedule.times) && habit.schedule.times >= 1 ? Math.floor(habit.schedule.times) : 1;
      const weeks = new Map<Day, { eligible: number; done: number }>();
      for (const day of daysOf(start, period.to)) {
        const s = status.get(day);
        if (s === 'skipped' || (day === today && s !== 'done')) continue;
        const key = startOfWeek(day);
        const week = weeks.get(key) ?? { eligible: 0, done: 0 };
        week.eligible++;
        if (s === 'done') week.done++;
        weeks.set(key, week);
      }
      for (const week of weeks.values()) {
        const t = (times * week.eligible) / 7;
        done += week.done;
        target += t;
        credited += Math.min(week.done, t);
      }
    } else {
      for (const day of daysOf(start, period.to)) {
        if (!isScheduledOn(habit, day)) continue;
        const s = status.get(day);
        if (s === 'skipped' || (day === today && s !== 'done')) continue;
        target++;
        if (s === 'done') done++;
      }
      credited = done;
    }
  }
  return { done, target, credited, rate: target > 0 ? Math.min(1, credited / target) : null };
}

export interface HabitFulfilment { habit: Habit; fulfilment: Fulfilment }

/** Fulfilment of every active habit (input order kept). */
export function fulfilments(habits: readonly Habit[], logs: LogsByHabit, period: Period, today: Day = period.to): HabitFulfilment[] {
  return habits
    .filter((habit) => habit.archived === 0)
    .map((habit) => ({ habit, fulfilment: fulfilment(habit, logs.get(habit.id) ?? [], period, today) }));
}

/** Overall rate: all credited opportunities over all opportunities (null without any). */
export function overallRate(list: readonly HabitFulfilment[]): number | null {
  let target = 0;
  let credited = 0;
  for (const { fulfilment: f } of list) {
    target += f.target;
    credited += f.credited;
  }
  return target > 0 ? Math.min(1, credited / target) : null;
}

/** Integer percent 0–100 of a rate (null stays null). */
export function percent(rate: number | null): number | null {
  return rate === null ? null : Math.round(Math.min(1, Math.max(0, rate)) * 100);
}

// ---------------------------------------------------------------------------
// Best streaks

export interface BestStreak {
  habit: Habit;
  best: number;
  unit: 'days' | 'weeks';
  /** Stage the best streak reached (B.5 thresholds). */
  stage: Stage;
  /** best in days (weeks × 7) for comparing and scaling bars across units. */
  span: number;
}

/** Best streak of every active habit up to today, longest first (ties by name). */
export function bestStreaks(habits: readonly Habit[], logs: LogsByHabit, today: Day): BestStreak[] {
  return habits
    .filter((habit) => habit.archived === 0)
    .map((habit) => {
      const unit = habit.schedule.kind === 'timesPerWeek' ? 'weeks' as const : 'days' as const;
      const best = bestStreak(habit, logs.get(habit.id) ?? [], today);
      return { habit, best, unit, stage: stageForCount(unit, best), span: unit === 'weeks' ? best * 7 : best };
    })
    .sort((a, b) => b.span - a.span || a.habit.name.localeCompare(b.habit.name, 'de'));
}

// ---------------------------------------------------------------------------
// Weekday rhythm

export interface WeekdayValue {
  /** ISO weekday 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** Done routines plus contacts on this weekday in the period. */
  total: number;
  /** How often this weekday occurs in the period. */
  occurrences: number;
  /** total / occurrences (0 when the weekday does not occur). */
  average: number;
}

export interface Rhythm {
  days: WeekdayValue[];
  /** Weekday with the highest average (earliest on ties), null when nothing was done. */
  best: number | null;
}

export function weekdayRhythm(habits: readonly Habit[], logs: LogsByHabit, period: Period, contactLogs: readonly ContactLog[] = []): Rhythm {
  const totals = [0, 0, 0, 0, 0, 0, 0];
  const occurrences = [0, 0, 0, 0, 0, 0, 0];
  const add = (day: Day): void => {
    const i = isoWeekday(day) - 1;
    totals[i] = (totals[i] ?? 0) + 1;
  };
  for (const day of daysOf(period.from, period.to)) {
    const i = isoWeekday(day) - 1;
    occurrences[i] = (occurrences[i] ?? 0) + 1;
  }
  for (const habit of habits) {
    if (habit.archived !== 0) continue;
    for (const [day, s] of statusMap(habit, logs.get(habit.id) ?? [])) {
      if (s === 'done' && day >= period.from && day <= period.to && isScheduledOn(habit, day)) add(day);
    }
  }
  const contactDays = new Set<string>();
  for (const log of contactLogs) {
    const key = `${log.contactId}:${log.day}`;
    if (log.day < period.from || log.day > period.to || contactDays.has(key)) continue;
    contactDays.add(key);
    add(log.day);
  }
  const days = totals.map((total, i) => {
    const occ = occurrences[i] ?? 0;
    return { weekday: i + 1, total, occurrences: occ, average: occ > 0 ? total / occ : 0 };
  });
  let best: number | null = null;
  let max = 0;
  for (const d of days) {
    if (d.average > max + 1e-9) {
      max = d.average;
      best = d.weekday;
    }
  }
  return { days, best };
}

// ---------------------------------------------------------------------------
// Mood

export interface MoodPoint { day: Day; value: MoodValue | null }

export interface MoodTrend {
  points: MoodPoint[];
  count: number;
  average: number | null;
  /** Averages of the first and the second half of the period (null with fewer than two entries there). */
  firstHalf: number | null;
  secondHalf: number | null;
  /** Difference of the halves ≥ 0.3 counts as a change. */
  trend: 'up' | 'down' | 'steady' | null;
  /** Entries per value 1–5 (index 0 = value 1). */
  counts: [number, number, number, number, number];
  /** Most frequent value (the higher one on ties), null without entries. */
  most: MoodValue | null;
}

const TREND_STEP = 0.3;

function isMood(value: unknown): value is MoodValue {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/** One value per day (the newest loggedAt wins), the whole period as points. */
export function moodTrend(moods: readonly MoodLog[], period: Period): MoodTrend {
  const byDay = new Map<Day, MoodLog>();
  for (const mood of moods) {
    if (mood.day < period.from || mood.day > period.to || !isMood(mood.value)) continue;
    const current = byDay.get(mood.day);
    if (!current || Date.parse(mood.loggedAt) > Date.parse(current.loggedAt)) byDay.set(mood.day, mood);
  }
  const points = daysOf(period.from, period.to).map((day) => ({ day, value: byDay.get(day)?.value ?? null }));
  const values = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  const half = Math.floor(points.length / 2);
  const first = points.slice(0, half).flatMap((p) => (p.value === null ? [] : [p.value]));
  const second = points.slice(half).flatMap((p) => (p.value === null ? [] : [p.value]));
  const firstHalf = first.length >= 2 ? mean(first) : null;
  const secondHalf = second.length >= 2 ? mean(second) : null;
  let trend: MoodTrend['trend'] = null;
  if (firstHalf !== null && secondHalf !== null) {
    const diff = secondHalf - firstHalf;
    trend = diff >= TREND_STEP ? 'up' : diff <= -TREND_STEP ? 'down' : 'steady';
  }
  const tally = [0, 0, 0, 0, 0];
  for (const v of values) tally[v - 1] = (tally[v - 1] ?? 0) + 1;
  const counts: MoodTrend['counts'] = [tally[0] ?? 0, tally[1] ?? 0, tally[2] ?? 0, tally[3] ?? 0, tally[4] ?? 0];
  let most: MoodValue | null = null;
  let mostCount = 0;
  for (const v of [1, 2, 3, 4, 5] as const) {
    const n = counts[v - 1] ?? 0;
    if (n > 0 && n >= mostCount) {
      most = v;
      mostCount = n;
    }
  }
  return { points, count: values.length, average: mean(values), firstHalf, secondHalf, trend, counts, most };
}

// ---------------------------------------------------------------------------
// Summaries

export interface ReviewInput {
  habits: readonly Habit[];
  logs: LogsByHabit;
  moods: readonly MoodLog[];
  contactLogs?: readonly ContactLog[];
  today: Day;
  days?: number;
}

export interface Review {
  period: Period;
  rings: HabitFulfilment[];
  rate: number | null;
  streaks: BestStreak[];
  /** Longest best streak (null when no routine has one yet). */
  longest: BestStreak | null;
  active: number;
  rhythm: Rhythm;
  mood: MoodTrend;
}

export function review(input: ReviewInput): Review {
  const period = lastDays(input.today, input.days);
  const active = input.habits.filter((habit) => habit.archived === 0);
  const rings = fulfilments(active, input.logs, period, input.today);
  const streaks = bestStreaks(active, input.logs, input.today);
  const top = streaks[0];
  return {
    period,
    rings,
    rate: overallRate(rings),
    streaks,
    longest: top && top.best > 0 ? top : null,
    active: active.length,
    rhythm: weekdayRhythm(active, input.logs, period, input.contactLogs),
    mood: moodTrend(input.moods, period),
  };
}

export interface WeekSummary {
  period: Period;
  /** Done logs of active routines on their eligible days this week. */
  done: number;
  rate: number | null;
  /** Active routines with at least one opportunity this week. */
  routines: number;
}

/** Key numbers of today's ISO week (Sunday card "Deine Woche"). */
export function weekSummary(habits: readonly Habit[], logs: LogsByHabit, today: Day): WeekSummary {
  const period = isoWeekUntil(today);
  const list = fulfilments(habits, logs, period, today);
  return {
    period,
    done: list.reduce((n, { fulfilment: f }) => n + f.done, 0),
    rate: overallRate(list),
    routines: list.filter(({ fulfilment: f }) => f.target > 0).length,
  };
}

/** The Sunday card shows on Sundays unless it was dismissed in the same ISO week. */
export function showWeekCard(today: Day, dismissedFor: Day | undefined): boolean {
  if (isoWeekday(today) !== 7) return false;
  return dismissedFor === undefined || startOfWeek(dismissedFor) !== startOfWeek(today);
}
