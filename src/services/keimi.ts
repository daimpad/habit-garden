// Keimi wächst mit und Tagesernte (Gamification Teil 4, decision of 02.11.2026). Pure (unit-tested in
// __tests__/keimi.test.ts).
//
// Keimi's stages come from the history (nothing stored, nothing lost after a pause): Keimling at the start,
// Spross after 7 days with watering (four leaves), Strohhut after 30 such days, Gießkanne after 100 waterings,
// Blütenkranz after 90 days in the garden (a season, counted from the first watering or the profile's start).
// Keimi wears what the person chose (Profile.keimi.wear, "Keimi" tab in "Dein Garten"), else the latest thing
// reached; 'none' wears nothing. The winter scarf comes on top (season, island.ts).
//
// Tagesernte: from the evening on, a small card in HEUTE sums up the day: routines watered, plants that grew,
// visitors, tasks done, seeds; Keimi closes with a calm sentence (a quiet day is fine too). Closed for the day
// with "Schließen" (Profile.harvestDismissedFor).
import { fmt, t } from '../i18n/de.js';
import type { Day, KeimiWear } from '../model.js';
import { addDays, diffDays, formatDayMonth } from '../util/date.js';

export type KeimiStage = 'seedling' | 'sprout' | 'hat' | 'can' | 'crown';
export const KEIMI_STAGES: readonly KeimiStage[] = ['seedling', 'sprout', 'hat', 'can', 'crown'];
export const WEARABLE: readonly Exclude<KeimiWear, 'none'>[] = ['hat', 'can', 'crown'];

export const STAGE_NAME: Readonly<Record<KeimiStage, string>> = {
  seedling: t.keimiStageSeedling, sprout: t.keimiStageSprout, hat: t.keimiStageHat, can: t.keimiStageCan, crown: t.keimiStageCrown,
};
/** "Keimi trägt jetzt einen Strohhut." (the Keimi tab, and Keimi's sentence when it grows). */
export const STAGE_NOW: Readonly<Record<KeimiStage, string>> = {
  seedling: t.keimiNowSeedling, sprout: t.keimiNowSprout, hat: t.keimiNowHat, can: t.keimiNowCan, crown: t.keimiNowCrown,
};
const STAGE_HINT: Readonly<Record<KeimiStage, string>> = {
  seedling: t.keimiHintSeedling, sprout: t.keimiHintSprout, hat: t.keimiHintHat, can: t.keimiHintCan, crown: t.keimiHintCrown,
};

export interface KeimiStageInfo { stage: KeimiStage; day: Day | null; text: string; progress?: { n: number; of: number } }

export interface KeimiLook { leaves: 'two' | 'four'; wear: Exclude<KeimiWear, 'none'> | null }

/** Each stage with the day it was reached (null while open) and its line ("seit 14. Oktober" or the hint). */
export function keimiStages(doneLogDays: readonly Day[], start: Day | null, today: Day): KeimiStageInfo[] {
  const days = doneLogDays.filter((d) => d <= today);
  const distinct = [...new Set(days)].sort();
  const first = [start, distinct[0]].filter((d): d is Day => !!d).sort()[0] ?? null;
  const reached: Record<KeimiStage, Day | null> = {
    seedling: first ?? today,
    sprout: distinct[6] ?? null,
    hat: distinct[29] ?? null,
    can: [...days].sort()[99] ?? null,
    crown: first && diffDays(today, first) >= 90 ? addDays(first, 90) : null,
  };
  const progress: Partial<Record<KeimiStage, { n: number; of: number }>> = {
    sprout: { n: Math.min(distinct.length, 6), of: 7 },
    hat: { n: Math.min(distinct.length, 29), of: 30 },
    can: { n: Math.min(days.length, 99), of: 100 },
    crown: { n: first ? Math.min(Math.max(0, diffDays(today, first)), 89) : 0, of: 90 },
  };
  return KEIMI_STAGES.map((stage) => {
    const day = reached[stage];
    if (day) return { stage, day, text: stage === 'seedling' ? t.keimiSinceStart : fmt(t.keimiSince, { date: formatDayMonth(day) }) };
    const p = progress[stage];
    return p ? { stage, day: null, text: STAGE_HINT[stage], progress: p } : { stage, day: null, text: STAGE_HINT[stage] };
  });
}

/** The highest stage reached. */
export function keimiStage(stages: readonly KeimiStageInfo[]): KeimiStage {
  return [...stages].reverse().find((s) => s.day !== null)?.stage ?? 'seedling';
}

/** What Keimi looks like: four leaves from Spross on; the chosen thing if reached, else the latest reached ('none': nothing). */
export function keimiLook(stages: readonly KeimiStageInfo[], chosen: KeimiWear | undefined): KeimiLook {
  const has = (s: KeimiStage): boolean => stages.some((x) => x.stage === s && x.day !== null);
  const leaves = has('sprout') ? 'four' : 'two';
  if (chosen === 'none') return { leaves, wear: null };
  if (chosen && has(chosen)) return { leaves, wear: chosen };
  const latest = [...WEARABLE].filter(has).sort((a, b) => {
    const da = stages.find((x) => x.stage === a)?.day ?? '';
    const db = stages.find((x) => x.stage === b)?.day ?? '';
    return da.localeCompare(db) || WEARABLE.indexOf(a) - WEARABLE.indexOf(b);
  }).pop();
  return { leaves, wear: latest ?? null };
}

// ---------------------------------------------------------------------------
// Tagesernte

export interface HarvestInput {
  watered: number;
  /** Names of routines whose plant reached a higher stage today. */
  grown: readonly string[];
  /** Names of visitors found today. */
  visitors: readonly string[];
  tasks: number;
  seeds: number;
}

export interface Harvest { lines: Array<{ kind: 'water' | 'grow' | 'visit' | 'task' | 'seed'; text: string }>; keimi: string }

function names(list: readonly string[]): string {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} ${t.and} ${list[list.length - 1] ?? ''}`;
}

export function harvest(input: HarvestInput): Harvest {
  const lines: Harvest['lines'] = [];
  if (input.watered > 0) lines.push({ kind: 'water', text: input.watered === 1 ? t.harvestWateredOne : fmt(t.harvestWatered, { n: input.watered }) });
  if (input.grown.length === 1) lines.push({ kind: 'grow', text: fmt(t.harvestGrownOne, { name: input.grown[0] ?? '' }) });
  else if (input.grown.length > 1 && input.grown.length <= 3) lines.push({ kind: 'grow', text: fmt(t.harvestGrownNames, { names: names(input.grown) }) });
  else if (input.grown.length > 3) lines.push({ kind: 'grow', text: fmt(t.harvestGrownMany, { n: input.grown.length }) });
  if (input.visitors.length > 0) lines.push({ kind: 'visit', text: input.visitors.length === 1 ? fmt(t.harvestVisitOne, { name: input.visitors[0] ?? '' }) : fmt(t.harvestVisitMany, { names: names(input.visitors) }) });
  if (input.tasks > 0) lines.push({ kind: 'task', text: input.tasks === 1 ? t.harvestTaskOne : fmt(t.harvestTasks, { n: input.tasks }) });
  if (input.seeds > 0) lines.push({ kind: 'seed', text: fmt(t.harvestSeeds, { n: input.seeds }) });
  return { lines, keimi: lines.length > 0 ? t.harvestKeimiGood : t.harvestKeimiQuiet };
}
