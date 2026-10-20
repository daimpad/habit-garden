// Calendar sheet and day view (A.2 H8). Pure functions (no DOM, no Dexie), testable in node.
// All date arithmetic goes through util/date (local calendar components, DST-safe).
//
// Definitions:
// - A month is { year, month } with month 1 … 12. monthGrid() lays it out in ISO weeks (Monday
//   first); cells outside the month are null, so the grid has 4 to 6 rows.
// - Keyboard movement in the grid (moveDay) follows the date-picker pattern: arrows ±1 / ±7 days,
//   Home/End the Monday/Sunday of the week, PageUp/PageDown the same date one month back/forward
//   (Shift: one year), clamped to the last day of the target month (31.01. → 28.02.).
// - Day summary (calendar markers):
//   due       top-level tasks whose dueDay is the day, any status (done instances of a recurring task
//             stay on their day); dueOpen counts the ones not done.
//   habits    only for days up to today: done = habits with a 'done' log that day; due = done plus the
//             non-archived habits that are scheduled that day (isScheduledOn, from startDay on) and have
//             no log. 'skipped' counts neither way (a bridged day, F §4.12); timesPerWeek habits have no
//             fixed day and count only when done.
//   mood      the newest mood entry of the day (by loggedAt), as repo/moodLogs reads it.
// - Day view: dayKind() splits past / today / future; pastDay() and futureDay() collect what the view
//   shows from plain rows.
import type { Contact, ContactLog, Day, DayPlan, Habit, HabitLog, Id, MoodLog, Note, Stage, Task } from '../model.js';
import { addDays, dayOfIso, dayParts, daysInMonth, isoWeekday, makeDay } from '../util/date.js';
import { isScheduledOn, stageFor } from './growth.js';

export interface Month { year: number; month: number }

export type MoodValue = MoodLog['value'];

const isTopLevel = (task: Task): boolean => task.parentId === null || task.parentId === undefined;

export function monthOf(day: Day): Month {
  const { year, month } = dayParts(day);
  return { year, month };
}

/** The month `delta` months after m (negative: before); crosses year boundaries. */
export function shiftMonth(m: Month, delta: number): Month {
  const index = m.year * 12 + (m.month - 1) + Math.trunc(delta);
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
}

export function sameMonth(a: Month, b: Month): boolean {
  return a.year === b.year && a.month === b.month;
}

export function firstOfMonth(m: Month): Day {
  return makeDay(m.year, m.month, 1);
}

export function lastOfMonth(m: Month): Day {
  return makeDay(m.year, m.month, daysInMonth(m.year, m.month));
}

/** All days of the month in order. */
export function monthDays(m: Month): Day[] {
  const out: Day[] = [];
  const n = daysInMonth(m.year, m.month);
  for (let d = 1; d <= n; d++) out.push(makeDay(m.year, m.month, d));
  return out;
}

/** Weeks (Monday first) of the month; cells before the 1st and after the last day are null. */
export function monthGrid(m: Month): Array<Array<Day | null>> {
  const days = monthDays(m);
  const first = days[0];
  if (first === undefined) return [];
  const cells: Array<Day | null> = Array.from({ length: isoWeekday(first) - 1 }, () => null);
  cells.push(...days);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<Day | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Same date `delta` months later, clamped to the last day of that month. */
export function addMonthsClamped(day: Day, delta: number): Day {
  const { year, month, date } = dayParts(day);
  const target = shiftMonth({ year, month }, delta);
  return makeDay(target.year, target.month, Math.min(date, daysInMonth(target.year, target.month)));
}

/** Date-picker keyboard movement; null for keys the grid does not handle. */
export function moveDay(day: Day, key: string, shift = false): Day | null {
  switch (key) {
    case 'ArrowLeft':
      return addDays(day, -1);
    case 'ArrowRight':
      return addDays(day, 1);
    case 'ArrowUp':
      return addDays(day, -7);
    case 'ArrowDown':
      return addDays(day, 7);
    case 'Home':
      return addDays(day, 1 - isoWeekday(day));
    case 'End':
      return addDays(day, 7 - isoWeekday(day));
    case 'PageUp':
      return addMonthsClamped(day, shift ? -12 : -1);
    case 'PageDown':
      return addMonthsClamped(day, shift ? 12 : 1);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Day summaries (calendar markers)

export interface DaySummary {
  due: number;
  dueOpen: number;
  /** Only meaningful for days up to today (0/0 after it). */
  habitsDone: number;
  habitsDue: number;
  mood?: MoodValue;
  /** Calendar sync: events of the imported calendars on the day. */
  events?: number;
}

export interface SummaryInput {
  tasks: readonly Task[];
  habits: readonly Habit[];
  logs: readonly HabitLog[];
  moods: readonly MoodLog[];
}

/** Newest entry by loggedAt (ties: the first one), as repo/notes newestMood. */
export function newestMoodOf(rows: readonly MoodLog[]): MoodLog | undefined {
  let best: MoodLog | undefined;
  for (const row of rows) if (!best || Date.parse(row.loggedAt) > Date.parse(best.loggedAt)) best = row;
  return best;
}

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K | undefined): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k === undefined) continue;
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

/** Habit progress of one day: done logs vs. done + scheduled without a log (see header). */
export function habitTally(habits: readonly Habit[], logsOfDay: readonly HabitLog[], day: Day): { done: number; due: number } {
  const status = new Map<Id, HabitLog['status']>();
  for (const log of logsOfDay) {
    if (log.day !== day) continue;
    if (log.status === 'done' || !status.has(log.habitId)) status.set(log.habitId, log.status);
  }
  let done = 0;
  let due = 0;
  for (const habit of habits) {
    const s = status.get(habit.id);
    if (s === 'done') {
      done++;
      due++;
    } else if (s === undefined && habit.archived === 0 && habit.schedule.kind !== 'timesPerWeek' && isScheduledOn(habit, day)) {
      due++;
    }
  }
  return { done, due };
}

export function summarizeDays(days: readonly Day[], input: SummaryInput, today: Day): Map<Day, DaySummary> {
  const tasksByDay = groupBy(input.tasks.filter(isTopLevel), (task) => task.dueDay);
  const logsByDay = groupBy(input.logs, (log) => log.day);
  const moodsByDay = groupBy(input.moods, (mood) => mood.day);
  const out = new Map<Day, DaySummary>();
  for (const day of days) {
    const tasks = tasksByDay.get(day) ?? [];
    const summary: DaySummary = {
      due: tasks.length,
      dueOpen: tasks.filter((task) => task.status !== 'done').length,
      habitsDone: 0,
      habitsDue: 0,
    };
    if (day <= today) {
      const tally = habitTally(input.habits, logsByDay.get(day) ?? [], day);
      summary.habitsDone = tally.done;
      summary.habitsDue = tally.due;
    }
    const mood = newestMoodOf(moodsByDay.get(day) ?? []);
    if (mood) summary.mood = mood.value;
    out.set(day, summary);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Day view

export type DayKind = 'past' | 'today' | 'future';

export function dayKind(day: Day, today: Day): DayKind {
  return day < today ? 'past' : day > today ? 'future' : 'today';
}

export interface HabitEntry { habit: Habit; status: HabitLog['status']; stage: Stage }
export interface ContactEntry { log: ContactLog; contact: Contact | undefined }

export interface PastDayInput {
  plan: DayPlan | undefined;
  /** Tasks referenced by the plan plus every task completed that day (others are ignored). */
  tasks: readonly Task[];
  habits: readonly Habit[];
  /** All logs of the habits (the stage on that day needs the run up to it). */
  logs: readonly HabitLog[];
  moods: readonly MoodLog[];
  journal: Note | undefined;
  contacts: readonly Contact[];
  contactLogs: readonly ContactLog[];
}

export interface PastDay {
  focus: Task[];
  completed: Task[];
  habits: HabitEntry[];
  mood?: MoodValue;
  journal?: Note;
  contacts: ContactEntry[];
}

const byCompletion = (a: Task, b: Task): number =>
  (a.completedAt ?? '') < (b.completedAt ?? '') ? -1 : (a.completedAt ?? '') > (b.completedAt ?? '') ? 1 : a.id < b.id ? -1 : 1;

const bySortKey = <T extends { sortKey: string; id: Id }>(a: T, b: T): number =>
  a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : 1;

/** What a past day shows: focus in slot order, completions (top-level, by time), logs, mood, journal, contacts. */
export function pastDay(day: Day, input: PastDayInput): PastDay {
  const tasks = new Map(input.tasks.map((task) => [task.id, task]));
  const focusIds = input.plan?.mitTaskIds ?? [];
  const focus = focusIds.map((id) => tasks.get(id)).filter((task): task is Task => task !== undefined);
  const completed = input.tasks
    .filter((task) => isTopLevel(task) && task.completedAt !== undefined && dayOfIso(task.completedAt) === day)
    .sort(byCompletion);

  const logsByHabit = groupBy(input.logs, (log) => log.habitId);
  const habits: HabitEntry[] = [];
  for (const habit of [...input.habits].sort(bySortKey)) {
    const logs = logsByHabit.get(habit.id) ?? [];
    const own = logs.filter((log) => log.day === day);
    if (own.length === 0) continue;
    const status = own.some((log) => log.status === 'done') ? 'done' : 'skipped';
    habits.push({ habit, status, stage: stageFor(habit, logs, day) });
  }

  const people = new Map(input.contacts.map((c) => [c.id, c]));
  const contacts = input.contactLogs
    .filter((log) => log.day === day)
    .map((log) => ({ log, contact: people.get(log.contactId) }))
    .sort((a, b) => (a.log.loggedAt < b.log.loggedAt ? -1 : a.log.loggedAt > b.log.loggedAt ? 1 : 0));

  const out: PastDay = { focus, completed, habits, contacts };
  const mood = newestMoodOf(input.moods.filter((m) => m.day === day));
  if (mood) out.mood = mood.value;
  if (input.journal && input.journal.kind === 'journal' && input.journal.journalDay === day) out.journal = input.journal;
  return out;
}

export function isPastDayEmpty(view: PastDay): boolean {
  return view.focus.length === 0 && view.completed.length === 0 && view.habits.length === 0
    && view.mood === undefined && view.journal === undefined && view.contacts.length === 0;
}

export interface FutureDay {
  focus: Task[];
  /** Open top-level tasks due that day, in due order (timed first by time, then by sortKey). */
  due: Task[];
  /** Non-archived habits scheduled that day (timesPerWeek: every day), in sortKey order. */
  habits: Habit[];
}

function compareDueOrder(a: Task, b: Task): number {
  if (a.dueHasTime !== b.dueHasTime) return a.dueHasTime === 1 ? -1 : 1;
  if (a.dueHasTime === 1 && a.dueAt !== b.dueAt) return (a.dueAt ?? '') < (b.dueAt ?? '') ? -1 : 1;
  return bySortKey(a, b);
}

export function futureDay(day: Day, input: { plan: DayPlan | undefined; tasks: readonly Task[]; habits: readonly Habit[] }): FutureDay {
  const tasks = new Map(input.tasks.map((task) => [task.id, task]));
  const focus = (input.plan?.mitTaskIds ?? []).map((id) => tasks.get(id)).filter((task): task is Task => task !== undefined);
  const due = input.tasks
    .filter((task) => isTopLevel(task) && task.dueDay === day && task.status !== 'done')
    .sort(compareDueOrder);
  const habits = input.habits.filter((habit) => habit.archived === 0 && isScheduledOn(habit, day)).sort(bySortKey);
  return { focus, due, habits };
}

/** Plain-text excerpt of a Markdown body: markup characters dropped, whitespace collapsed, ≤ max chars. */
export function excerpt(markdown: string, max = 160): string {
  const text = markdown
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gmu, '')
    .replace(/\[[ xX]\]\s+/gu, '')
    .replace(/[*_`~]+/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
