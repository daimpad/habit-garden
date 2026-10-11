// CONTRACT STUB – implemented in AP4. Pure functions (no DOM, no Dexie), testable in node.
// Rules: F §4.12 plus the approved precision (Rückfrage 2): the heatmap level of a
// day without a 'done' log is 0, while the plant (stageFor) never falls below 1
// once a 'done' log exists.
import type { Day, Habit, HabitLog, Stage } from '../model.js';

/** Current streak: days (daily, weekly) or ISO weeks (timesPerWeek); see F §4.12. */
export function streak(habit: Habit, logs: readonly HabitLog[], today: Day): number {
  throw new Error(`not implemented: streak ${habit.id} ${logs.length} ${today}`);
}

/** Plant stage today: 0 without any done log on or before today, otherwise ≥ 1. */
export function stageFor(habit: Habit, logs: readonly HabitLog[], today: Day): Stage {
  throw new Error(`not implemented: stageFor ${habit.id} ${logs.length} ${today}`);
}

/** Heatmap level of day: 0 when day has no done log, else the thresholds applied to the run ending at day. */
export function stageAt(habit: Habit, logs: readonly HabitLog[], day: Day): Stage {
  throw new Error(`not implemented: stageAt ${habit.id} ${logs.length} ${day}`);
}

/** Done logs in the ISO week of day vs. the weekly target (timesPerWeek; others: target 1 per scheduled day of that week). */
export function weekProgress(habit: Habit, logs: readonly HabitLog[], day: Day): { done: number; target: number } {
  throw new Error(`not implemented: weekProgress ${habit.id} ${logs.length} ${day}`);
}

/** Longest streak ever up to today (habit sheet "Bester Streak"). */
export function bestStreak(habit: Habit, logs: readonly HabitLog[], today: Day): number {
  throw new Error(`not implemented: bestStreak ${habit.id} ${logs.length} ${today}`);
}

/** Whether the habit is due on day (shown in HEUTE): daily interval, weekly weekdays, timesPerWeek every day. */
export function isScheduledOn(habit: Habit, day: Day): boolean {
  throw new Error(`not implemented: isScheduledOn ${habit.id} ${day}`);
}

/** Stage thresholds (B.5): days 0/1–2/3–6/7–13/≥14, weeks 0/1/2/3/≥4. */
export function stageForCount(unit: 'days' | 'weeks', count: number): Stage {
  throw new Error(`not implemented: stageForCount ${unit} ${count}`);
}
