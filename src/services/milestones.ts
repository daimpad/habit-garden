// "Spuren im Garten" (Garten-Insel Teil 3, decision of 13.10.2026): permanent traces of a routine on the
// island. Pure rules (no DOM, no Dexie); repo/milestones.ts stores them, screens/heute.ts celebrates and draws.
//
// - Kinds: streak7, streak30, streak100 (a run of 7, 30, 100) and bloom (the plant reached stage 4 for the
//   first time). Counted in the unit of growth.streak(), as the routine card shows it ("Tage/Wochen in Folge"):
//   daily and weekday routines count scheduled days in a row (a weekday routine on Mon/Thu needs 7 such
//   days), "x-mal pro Woche" (timesPerWeek) counts fulfilled ISO weeks in a row (7, 30, 100 weeks).
//   bloom: 14 scheduled days or 4 weeks (growth.bloomCount, the stage-4 threshold).
// - One milestone per routine and kind (id `${habitId}:${kind}`). earnedOn is the day the run first reached
//   the count (growth.reachedOn over the whole history), also for a live earning (then usually today).
// - Permanent: a later broken streak never removes a milestone. Only a change of the history itself takes one
//   back: after a log of day D changed (live sync), stored milestones with earnedOn ≥ D that the history no
//   longer supports are removed (watering today by mistake and taking it back removes today's lantern again).
// - Backfill (every app start, idempotent): adds what the history supports and is missing, never removes and
//   never celebrates.
// - On the island each place shows the highest streak tier any routine of its area earned (lantern, stone
//   bench, pavilion; one object, the calmest reading) and one flowering shrub per bloomed routine, at most
//   SHRUB_MAX (oldest first). A routine's area is its current area while the routine exists, else the stored one.
import { fmt, t } from '../i18n/de.js';
import type { Day, Habit, HabitLog, Id, Milestone, MilestoneKind } from '../model.js';
import { bloomCount, reachedOn } from './growth.js';
import type { PlaceKey } from './island.js';

export const MILESTONE_KINDS: readonly MilestoneKind[] = ['streak7', 'streak30', 'streak100', 'bloom'];

/** Streak tiers in ascending order with their run length. */
export const STREAK_TIERS: ReadonlyArray<{ kind: Exclude<MilestoneKind, 'bloom'>; count: number }> = [
  { kind: 'streak7', count: 7 }, { kind: 'streak30', count: 30 }, { kind: 'streak100', count: 100 },
];

/** Flowering shrubs per place at most. */
export const SHRUB_MAX = 3;

export type TraceTier = 0 | 1 | 2 | 3;

export function milestoneId(habitId: Id, kind: MilestoneKind): Milestone['id'] {
  return `${habitId}:${kind}`;
}

export function isMilestoneKind(value: unknown): value is MilestoneKind {
  return typeof value === 'string' && (MILESTONE_KINDS as readonly string[]).includes(value);
}

/** Run length of a kind for a routine (7/30/100, bloom: 14 days or 4 weeks). */
export function countFor(habit: Habit, kind: MilestoneKind): number {
  if (kind === 'bloom') return bloomCount(habit);
  return STREAK_TIERS.find((tier) => tier.kind === kind)?.count ?? Number.POSITIVE_INFINITY;
}

/** The kinds the routine's history supports up to today, each with the day it was first reached. */
export function earnedFromHistory(habit: Habit, logs: readonly HabitLog[], today: Day): Array<{ kind: MilestoneKind; day: Day }> {
  const days = reachedOn(habit, logs, today, MILESTONE_KINDS.map((kind) => countFor(habit, kind)));
  const out: Array<{ kind: MilestoneKind; day: Day }> = [];
  MILESTONE_KINDS.forEach((kind, i) => {
    const day = days[i];
    if (day) out.push({ kind, day });
  });
  return out;
}

export interface MilestonePlan { add: Milestone[]; remove: Array<Milestone['id']> }

/**
 * What to store for one routine. `stored`: its milestones as stored. mode 'backfill' only adds; mode 'live'
 * (after a log of `changedDay` changed) also removes stored milestones with earnedOn ≥ changedDay that the
 * history no longer supports. New milestones carry the routine's area and the day the run reached them.
 */
export function planMilestones(habit: Habit, logs: readonly HabitLog[], stored: readonly Milestone[], today: Day,
  mode: { kind: 'backfill' } | { kind: 'live'; changedDay: Day }): MilestonePlan {
  const mine = stored.filter((m) => m.habitId === habit.id);
  const have = new Set(mine.map((m) => m.kind));
  const earned = earnedFromHistory(habit, logs, today);
  const supported = new Set(earned.map((e) => e.kind));
  const add: Milestone[] = earned.filter((e) => !have.has(e.kind)).map((e) => {
    const m: Milestone = { id: milestoneId(habit.id, e.kind), kind: e.kind, habitId: habit.id, earnedOn: e.day };
    if (habit.areaId) m.areaId = habit.areaId;
    return m;
  });
  const remove = mode.kind === 'live'
    ? mine.filter((m) => !supported.has(m.kind) && m.earnedOn >= mode.changedDay).map((m) => m.id)
    : [];
  return { add, remove };
}

/** Highest streak tier among the kinds: 0 none, 1 lantern (7), 2 stone bench (30), 3 pavilion (100). */
export function traceTier(kinds: Iterable<MilestoneKind>): TraceTier {
  let tier: TraceTier = 0;
  for (const kind of kinds) {
    const n: TraceTier = kind === 'streak100' ? 3 : kind === 'streak30' ? 2 : kind === 'streak7' ? 1 : 0;
    if (n > tier) tier = n;
  }
  return tier;
}

/** Oldest first (earnedOn, then id), the order shrubs take their spots and the Rückblick reverses. */
export function byEarned(a: Milestone, b: Milestone): number {
  return a.earnedOn < b.earnedOn ? -1 : a.earnedOn > b.earnedOn ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Newest first (Rückblick "Spuren im Garten"). */
export function newestFirst(list: readonly Milestone[]): Milestone[] {
  return [...list].sort((a, b) => byEarned(b, a));
}

/** Celebration order: a higher streak tier first, then the bloom. */
const RANK: Readonly<Record<MilestoneKind, number>> = { streak100: 0, streak30: 1, streak7: 2, bloom: 3 };
export function mostNotable(list: readonly Milestone[]): Milestone | undefined {
  return [...list].sort((a, b) => RANK[a.kind] - RANK[b.kind] || byEarned(a, b))[0];
}

const PLACE_AT: Readonly<Record<PlaceKey | 'extra', string>> = {
  home: t.placeAtHome, work: t.placeAtWork, bonds: t.placeAtBonds, health: t.placeAtHealth,
  wealth: t.placeAtWealth, leisure: t.placeAtLeisure, growth: t.placeAtGrowth, extra: t.placeAtExtra,
};

const LINES: Readonly<Record<MilestoneKind, string>> = {
  streak7: t.traceLineLantern, streak30: t.traceLineBench, streak100: t.traceLinePavilion, bloom: t.traceLineShrub,
};

/** Keimi's quiet sentence: "Eine Laterne leuchtet jetzt am Teich." / "Am Brunnen wächst ein blühender Strauch." */
export function milestoneLine(kind: MilestoneKind, place: PlaceKey | 'extra'): string {
  const text = fmt(LINES[kind], { at: PLACE_AT[place] });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const OBJECTS: Readonly<Record<MilestoneKind, string>> = {
  streak7: t.traceLantern, streak30: t.traceBench, streak100: t.tracePavilion, bloom: t.traceShrub,
};

/** "Laterne", "Steinbank", "Pavillon", "Blühender Strauch". */
export function milestoneObject(kind: MilestoneKind): string {
  return OBJECTS[kind];
}

export interface MilestoneMerge { put: Milestone[]; created: number; updated: number; unchanged: number }

/**
 * JSON "Zusammenführen" of milestones: union by id; milestones of routines unknown after the merge are dropped;
 * for an id on both sides the earlier earnedOn wins (the first time it was earned; ties keep local).
 */
export function mergeMilestones(local: ReadonlyArray<Milestone | undefined>, incoming: readonly Milestone[], habitIds: ReadonlySet<Id>): MilestoneMerge {
  const result: MilestoneMerge = { put: [], created: 0, updated: 0, unchanged: 0 };
  const mine = new Map<string, Milestone>();
  for (const m of local) if (m) mine.set(m.id, m);
  for (const m of incoming) {
    if (!habitIds.has(m.habitId)) continue;
    const have = mine.get(m.id);
    if (!have) {
      result.put.push(m);
      result.created++;
    } else if (m.earnedOn < have.earnedOn) {
      result.put.push(m);
      result.updated++;
    } else {
      result.unchanged++;
    }
  }
  return result;
}
