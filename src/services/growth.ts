// Growth and streak rules (F §4.12, B.5). Pure functions (no DOM, no Dexie), testable in node.
// Approved precision (Rückfrage 2): the heatmap level of a day without a 'done' log is 0,
// while the plant (stageFor) never falls below 1 once a 'done' log exists.
//
// Definitions used throughout:
// - Only logs of `habit` count; 'done' wins over 'skipped' for the same day.
// - Scheduled days start at habit.startDay (never before). daily: startDay + k·interval;
//   weekly: the listed ISO weekdays in the weeks (ISO week of startDay) + k·interval;
//   timesPerWeek: every day. Only logs on scheduled days take part in runs.
// - A run walks backwards over scheduled days: 'done' counts, 'skipped' is bridged
//   (neither counts nor breaks), a missing log ends it.
// - Days are mapped to integers via util/date diffDays (UTC based, so DST cannot shift them).
import type { Day, Habit, HabitLog, Stage } from '../model.js';
import { diffDays } from '../util/date.js';

type Status = HabitLog['status'];

const EPOCH: Day = '1970-01-01'; // a Thursday

// Day keys repeat across calls (a heatmap evaluates 84 days over the same logs), so the
// pure key → number mapping is memoised.
const dayNumbers = new Map<Day, number>();
function toNum(day: Day): number {
  let n = dayNumbers.get(day);
  if (n === undefined) {
    n = diffDays(day, EPOCH);
    if (dayNumbers.size > 20_000) dayNumbers.clear();
    dayNumbers.set(day, n);
  }
  return n;
}
/** ISO weekday 1 = Monday … 7 = Sunday of a day number. */
const weekdayOf = (n: number): number => ((((n + 3) % 7) + 7) % 7) + 1;
/** Day number of the Monday of n's ISO week. */
const mondayOf = (n: number): number => n - (weekdayOf(n) - 1);
/** Intervals and targets below 1 (or not finite) count as 1. */
const atLeastOne = (value: number): number => (Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1);

interface Ctx {
  start: number;
  schedule: Habit['schedule'];
  step: number;
  weekdays: ReadonlySet<number>;
  times: number;
  /** All logs of the habit by day number (including days before startDay). */
  status: ReadonlyMap<number, Status>;
}

// The log map is reused while the same logs array (a liveQuery snapshot; treated as immutable)
// is evaluated for the same habit object, e.g. 84 heatmap cells in one render.
const contexts = new WeakMap<readonly HabitLog[], { habit: Habit; startDay: Day; schedule: Habit['schedule']; length: number; ctx: Ctx }>();

function context(habit: Habit, logs: readonly HabitLog[]): Ctx {
  const hit = contexts.get(logs);
  if (hit && hit.habit === habit && hit.startDay === habit.startDay && hit.schedule === habit.schedule && hit.length === logs.length) {
    return hit.ctx;
  }
  const ctx = buildContext(habit, logs);
  contexts.set(logs, { habit, startDay: habit.startDay, schedule: habit.schedule, length: logs.length, ctx });
  return ctx;
}

function buildContext(habit: Habit, logs: readonly HabitLog[]): Ctx {
  const status = new Map<number, Status>();
  for (const log of logs) {
    if (log.habitId !== habit.id) continue;
    const n = toNum(log.day);
    if (log.status === 'done' || !status.has(n)) status.set(n, log.status);
  }
  const start = toNum(habit.startDay);
  const schedule = habit.schedule;
  let step = 1;
  let times = 1;
  let weekdays: Set<number> = new Set();
  if (schedule.kind === 'daily') step = atLeastOne(schedule.interval);
  if (schedule.kind === 'weekly') {
    step = atLeastOne(schedule.interval);
    weekdays = new Set(schedule.weekdays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7));
    if (weekdays.size === 0) weekdays.add(weekdayOf(start));
  }
  if (schedule.kind === 'timesPerWeek') times = atLeastOne(schedule.times);
  return { start, schedule, step, weekdays, times, status };
}

function scheduled(ctx: Ctx, n: number): boolean {
  if (n < ctx.start) return false;
  switch (ctx.schedule.kind) {
    case 'daily':
      return (n - ctx.start) % ctx.step === 0;
    case 'weekly':
      return ctx.weekdays.has(weekdayOf(n)) && ((mondayOf(n) - mondayOf(ctx.start)) / 7) % ctx.step === 0;
    case 'timesPerWeek':
      return true;
  }
}

/** Latest scheduled day ≤ n, or null when there is none (n before startDay). */
function latestScheduled(ctx: Ctx, n: number): number | null {
  if (n < ctx.start) return null;
  if (ctx.schedule.kind === 'daily') return ctx.start + Math.floor((n - ctx.start) / ctx.step) * ctx.step;
  for (let d = n; d >= ctx.start; d--) if (scheduled(ctx, d)) return d;
  return null;
}

/** Earliest scheduled day ≥ n (n ≥ startDay assumed by callers), or null after `limit`. */
function nextScheduled(ctx: Ctx, n: number, limit: number): number | null {
  const from = Math.max(n, ctx.start);
  if (ctx.schedule.kind === 'daily') {
    const d = ctx.start + Math.ceil((from - ctx.start) / ctx.step) * ctx.step;
    return d <= limit ? d : null;
  }
  for (let d = from; d <= limit; d++) if (scheduled(ctx, d)) return d;
  return null;
}

/** Length of the run that ends at the scheduled day `first` (walking backwards). */
function runFrom(ctx: Ctx, first: number | null): number {
  let count = 0;
  for (let d = first; d !== null; d = latestScheduled(ctx, d - 1)) {
    const s = ctx.status.get(d);
    if (s === 'done') count++;
    else if (s !== 'skipped') break;
  }
  return count;
}

/** Done logs per ISO week (Monday day number) on scheduled days in [startDay, limit]. */
function weekCounts(ctx: Ctx, limit: number): Map<number, number> {
  const counts = new Map<number, number>();
  for (const [n, s] of ctx.status) {
    if (s !== 'done' || n > limit || !scheduled(ctx, n)) continue;
    const w = mondayOf(n);
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return counts;
}

/** timesPerWeek: fulfilled ISO weeks in a row as of `limit`; an unfinished week neither counts nor breaks. */
function weekStreak(ctx: Ctx, limit: number): number {
  if (limit < ctx.start) return 0;
  const counts = weekCounts(ctx, limit);
  const firstWeek = mondayOf(ctx.start);
  let w = mondayOf(limit);
  if ((counts.get(w) ?? 0) < ctx.times) w -= 7;
  let count = 0;
  while (w >= firstWeek && (counts.get(w) ?? 0) >= ctx.times) {
    count++;
    w -= 7;
  }
  return count;
}

function unitOf(habit: Habit): 'days' | 'weeks' {
  return habit.schedule.kind === 'timesPerWeek' ? 'weeks' : 'days';
}

/** Current streak: days (daily, weekly) or ISO weeks (timesPerWeek); see F §4.12. */
export function streak(habit: Habit, logs: readonly HabitLog[], today: Day): number {
  const ctx = context(habit, logs);
  const t = toNum(today);
  if (ctx.schedule.kind === 'timesPerWeek') return weekStreak(ctx, t);
  // Grace: start today when today is scheduled and done, else at the latest scheduled day before today.
  let first = latestScheduled(ctx, t);
  if (first === t && ctx.status.get(t) !== 'done') first = latestScheduled(ctx, t - 1);
  return runFrom(ctx, first);
}

/** Plant stage today: 0 without any done log on or before today, otherwise ≥ 1. */
export function stageFor(habit: Habit, logs: readonly HabitLog[], today: Day): Stage {
  const hasDone = logs.some((log) => log.habitId === habit.id && log.status === 'done' && log.day <= today);
  if (!hasDone) return 0;
  return atLeastStage1(stageForCount(unitOf(habit), streak(habit, logs, today)));
}

/** Heatmap level of day: 0 when day has no done log, else the thresholds applied to the run ending at day. */
export function stageAt(habit: Habit, logs: readonly HabitLog[], day: Day): Stage {
  const ctx = context(habit, logs);
  const n = toNum(day);
  if (ctx.status.get(n) !== 'done') return 0;
  if (ctx.schedule.kind === 'timesPerWeek') return atLeastStage1(stageForCount('weeks', weekStreak(ctx, n)));
  // No grace day: the run must reach the latest scheduled day ≤ day (day itself when scheduled).
  return atLeastStage1(stageForCount('days', runFrom(ctx, latestScheduled(ctx, n))));
}

/**
 * Done logs in the ISO week of day vs. the weekly target (timesPerWeek; others: target 1 per
 * scheduled day of that week). Counts the whole week and only scheduled days (never before
 * startDay). `done` is the raw count (may exceed the target); the UI clamps it.
 */
export function weekProgress(habit: Habit, logs: readonly HabitLog[], day: Day): { done: number; target: number } {
  const ctx = context(habit, logs);
  const monday = mondayOf(toNum(day));
  let done = 0;
  let scheduledDays = 0;
  for (let d = monday; d < monday + 7; d++) {
    if (!scheduled(ctx, d)) continue;
    scheduledDays++;
    if (ctx.status.get(d) === 'done') done++;
  }
  return { done, target: ctx.schedule.kind === 'timesPerWeek' ? ctx.times : scheduledDays };
}

/** Longest streak ever up to today (habit sheet "Bester Streak"); same unit as streak(). */
export function bestStreak(habit: Habit, logs: readonly HabitLog[], today: Day): number {
  const ctx = context(habit, logs);
  const t = toNum(today);
  let firstDone = Number.POSITIVE_INFINITY;
  for (const [n, s] of ctx.status) if (s === 'done' && n >= ctx.start && n <= t && n < firstDone) firstDone = n;
  if (firstDone === Number.POSITIVE_INFINITY) return 0;

  let best = 0;
  let current = 0;
  if (ctx.schedule.kind === 'timesPerWeek') {
    const counts = weekCounts(ctx, t);
    for (let w = mondayOf(firstDone); w <= mondayOf(t); w += 7) {
      if ((counts.get(w) ?? 0) >= ctx.times) best = Math.max(best, ++current);
      else current = 0;
    }
    return best;
  }
  for (let d = nextScheduled(ctx, firstDone, t); d !== null; d = nextScheduled(ctx, d + 1, t)) {
    const s = ctx.status.get(d);
    if (s === 'done') best = Math.max(best, ++current);
    else if (s !== 'skipped') current = 0;
  }
  return best;
}

/** Whether the habit is due on day (shown in HEUTE): daily interval, weekly weekdays, timesPerWeek every day. */
export function isScheduledOn(habit: Habit, day: Day): boolean {
  return scheduled(buildContext(habit, []), toNum(day));
}

/** Stage thresholds (B.5): days 0/1–2/3–6/7–13/≥14, weeks 0/1/2/3/≥4. */
export function stageForCount(unit: 'days' | 'weeks', count: number): Stage {
  if (!(count >= 1)) return 0;
  if (unit === 'weeks') return count >= 4 ? 4 : count >= 3 ? 3 : count >= 2 ? 2 : 1;
  return count >= 14 ? 4 : count >= 7 ? 3 : count >= 3 ? 2 : 1;
}

function atLeastStage1(stage: Stage): Stage {
  return stage === 0 ? 1 : stage;
}
