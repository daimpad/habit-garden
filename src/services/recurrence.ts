// Recurrence rules (F §4.14, C.4). Pure functions on day keys, calendar components only:
// a wall time is attached afterwards (util/date isoAt), so DST changes cannot shift an occurrence.
// Also: the due day of a completed task's follow-up instance (followUpDay) and the presets of the
// Wiederholung editor (A.2 P8: presetOf, presetRecurrence).
import type { Day, Recurrence } from '../model.js';
import { addDays, dayParts, daysInMonth, diffDays, isoWeekday, makeDay, startOfWeek } from '../util/date.js';

/** Intervals below 1 (or not finite) count as 1. */
const atLeastOne = (value: number): number => (Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1);

const later = (a: Day, b: Day): Day => (a > b ? a : b);

/**
 * First occurrence strictly after `after`, aligned to `anchor` (the first
 * occurrence / recurrenceAnchor). Result: the smallest occurrence ≥ anchor and > after.
 * - daily: anchor + k·interval days
 * - weekly: listed ISO weekdays (1 = Mo … 7 = So) in weeks anchorWeek + k·interval;
 *   an empty list means the anchor's weekday
 * - monthly: day N (clamped to the month's last day) or 'last', months anchor + k·interval;
 *   always computed from N, so clamping never drifts (31 Jan → 28 Feb → 31 Mar)
 * - afterCompletion: after + days (after = completion day)
 * - timesPerWeek: habits only → throws RangeError
 */
export function nextOccurrence(rec: Recurrence, anchor: Day, after: Day): Day {
  switch (rec.kind) {
    case 'daily': {
      const step = atLeastOne(rec.interval);
      if (after < anchor) return anchor;
      return addDays(anchor, (Math.floor(diffDays(after, anchor) / step) + 1) * step);
    }
    case 'weekly':
      return nextWeekly(rec.weekdays, atLeastOne(rec.interval), anchor, after);
    case 'monthly':
      return nextMonthly(rec.day, atLeastOne(rec.interval), anchor, after);
    case 'afterCompletion':
      return addDays(after, atLeastOne(rec.days));
    case 'timesPerWeek':
      throw new RangeError('nextOccurrence: timesPerWeek applies to habits only');
  }
}

/**
 * Due day of the follow-up instance when a recurring task is completed on `completionDay` (C.4).
 * - afterCompletion: completionDay + days
 * - other kinds: the next occurrence after the due day that is today or later, i.e.
 *   nextOccurrence(rec, anchor, max(dueDay ?? completionDay, completionDay − 1)); a task done late
 *   never spawns an already overdue copy, a task done early continues after its own due day.
 * The caller passes anchor = recurrenceAnchor ?? dueDay ?? completionDay.
 */
export function followUpDay(rec: Recurrence, anchor: Day, dueDay: Day | undefined, completionDay: Day): Day {
  if (rec.kind === 'afterCompletion') return addDays(completionDay, atLeastOne(rec.days));
  return nextOccurrence(rec, anchor, later(dueDay ?? completionDay, addDays(completionDay, -1)));
}

/** Presets of the Wiederholung editor (A.2 P8); 'custom' is any other rule (e.g. imported). */
export type RecurrencePreset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'afterCompletion';

const WORKDAYS = [1, 2, 3, 4, 5] as const;

/** Which preset a stored rule corresponds to. */
export function presetOf(rec: Recurrence | undefined): RecurrencePreset | 'custom' {
  if (!rec) return 'none';
  switch (rec.kind) {
    case 'daily':
      return atLeastOne(rec.interval) === 1 ? 'daily' : 'custom';
    case 'weekly': {
      if (atLeastOne(rec.interval) !== 1) return 'custom';
      const days = [...new Set(rec.weekdays)].sort((a, b) => a - b);
      if (days.length === WORKDAYS.length && days.every((d, i) => d === WORKDAYS[i])) return 'weekdays';
      return days.length === 1 ? 'weekly' : 'custom';
    }
    case 'monthly':
      return atLeastOne(rec.interval) === 1 && rec.day !== 'last' ? 'monthly' : 'custom';
    case 'afterCompletion':
      return 'afterCompletion';
    case 'timesPerWeek':
      return 'custom';
  }
}

/**
 * The rule of a preset for a task due on `day` (weekly: that weekday; monthly: that day of the
 * month); `days` is used by afterCompletion only. 'none' gives undefined.
 */
export function presetRecurrence(preset: RecurrencePreset, day: Day, days = 1): Recurrence | undefined {
  switch (preset) {
    case 'none':
      return undefined;
    case 'daily':
      return { kind: 'daily', interval: 1 };
    case 'weekdays':
      return { kind: 'weekly', interval: 1, weekdays: [...WORKDAYS] };
    case 'weekly':
      return { kind: 'weekly', interval: 1, weekdays: [isoWeekday(day)] };
    case 'monthly':
      return { kind: 'monthly', interval: 1, day: dayParts(day).date };
    case 'afterCompletion':
      return { kind: 'afterCompletion', days: atLeastOne(days) };
  }
}

function nextWeekly(list: readonly number[], step: number, anchor: Day, after: Day): Day {
  const days = new Set(list.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7));
  if (days.size === 0) days.add(isoWeekday(anchor));
  const anchorMonday = startOfWeek(anchor);
  let day = later(anchor, addDays(after, 1));
  // At most two in-phase weeks need to be inspected.
  for (let guard = 0; guard < 21; guard++) {
    const weeks = diffDays(startOfWeek(day), anchorMonday) / 7;
    const offPhase = weeks % step;
    if (offPhase !== 0) {
      day = addDays(anchorMonday, (weeks - offPhase + step) * 7);
      continue;
    }
    if (days.has(isoWeekday(day))) return day;
    day = addDays(day, 1);
  }
  throw new RangeError(`nextOccurrence: no weekly occurrence after ${after}`);
}

function nextMonthly(dayOfMonth: number | 'last', step: number, anchor: Day, after: Day): Day {
  if (dayOfMonth !== 'last' && !(Number.isInteger(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 31)) {
    throw new RangeError(`nextOccurrence: invalid day of month ${String(dayOfMonth)}`);
  }
  const a = dayParts(anchor);
  const lower = later(anchor, addDays(after, 1));
  const l = dayParts(lower);
  const monthsToLower = (l.year - a.year) * 12 + (l.month - a.month);
  // Start one interval before the lower bound's month; at most three candidates are needed.
  for (let k = Math.max(0, Math.floor(monthsToLower / step) - 1); ; k++) {
    const index = a.year * 12 + (a.month - 1) + k * step;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    const last = daysInMonth(year, month);
    const candidate = makeDay(year, month, dayOfMonth === 'last' ? last : Math.min(dayOfMonth, last));
    if (candidate >= lower) return candidate;
  }
}
