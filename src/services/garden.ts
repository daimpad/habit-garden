// Gestalten und Aufträge (Gamification Teil 3, decision of 02.11.2026). Pure (unit-tested in __tests__/garden.test.ts).
//
// Samen (seeds) come from the history, like the visitors: 1 per watering and per completed task, 2 per evening fire,
// 5 per trace in the garden (milestone), 10 per fulfilled weekly task of Keimi. Nothing is stored for them; taking
// something back lowers the count, but what stands on the island stays (the balance shows at least 0).
// Spent seeds are the prices of what is placed (Profile.garden). Each thing exists once; it stands on one of the
// free places and can be moved or given back (the seeds come back in full). The Steg only fits at the pond; the
// small side island ("Insel erweitern", 60) brings three more places.
//
// Keimis Aufträge: three light tasks per ISO week, chosen from those that fit what the person uses (no contact
// task without people, no watering task without routines; judged by what existed by the end of that week, so past
// weeks keep their tasks). The choice is stable for the week; whatever stays open simply lapses.
import { fmt, t } from '../i18n/de.js';
import type { Day, GardenItemId, GardenSlotId, GardenState } from '../model.js';
import { addDays, isoWeekKey, startOfWeek } from '../util/date.js';

export type ItemId = GardenItemId;
export type SlotId = GardenSlotId;

export interface ItemDef { id: ItemId; price: number; name: string }

/** Shop order. */
export const ITEMS: readonly ItemDef[] = [
  { id: 'lantern', price: 8, name: t.itemLantern },
  { id: 'flowerbed', price: 10, name: t.itemFlowerbed },
  { id: 'birdhouse', price: 12, name: t.itemBirdhouse },
  { id: 'bench', price: 15, name: t.itemBench },
  { id: 'windmill', price: 18, name: t.itemWindmill },
  { id: 'jetty', price: 20, name: t.itemJetty },
];
export const ISLET_PRICE = 60;
export const ITEM_IDS: readonly ItemId[] = ITEMS.map((i) => i.id);
export const MAIN_SLOTS: readonly SlotId[] = ['a', 'b', 'c', 'd', 'e', 'f'];
export const ISLET_SLOTS: readonly SlotId[] = ['i1', 'i2', 'i3'];
export const SLOT_IDS: readonly SlotId[] = [...MAIN_SLOTS, 'pond', ...ISLET_SLOTS];

export const SEEDS = { water: 1, task: 1, joy: 2, trace: 5, quest: 10 } as const;

export function isItemId(v: unknown): v is ItemId {
  return typeof v === 'string' && (ITEM_IDS as readonly string[]).includes(v);
}
export function isSlotId(v: unknown): v is SlotId {
  return typeof v === 'string' && (SLOT_IDS as readonly string[]).includes(v);
}

export function itemDef(id: ItemId): ItemDef {
  return ITEMS.find((i) => i.id === id) ?? { id, price: 0, name: id };
}

/** Seeds spent on what is placed (and the side island). */
export function seedsSpent(state: GardenState | undefined): number {
  let n = state?.islet === 1 ? ISLET_PRICE : 0;
  for (const [id, slot] of Object.entries(state?.placed ?? {})) if (slot && isItemId(id)) n += itemDef(id).price;
  return n;
}

/** Places an item may take: the Steg only the pond, the rest the free main places (and the side island's, once bought). */
export function freeSlots(item: ItemId, state: GardenState | undefined): SlotId[] {
  const taken = new Set(Object.entries(state?.placed ?? {}).filter(([id]) => id !== item).map(([, slot]) => slot));
  const candidates = item === 'jetty' ? ['pond' as SlotId] : [...MAIN_SLOTS, ...(state?.islet === 1 ? ISLET_SLOTS : [])];
  return candidates.filter((s) => !taken.has(s));
}

// ---------------------------------------------------------------------------
// Keimis Aufträge

export type QuestId = 'water5' | 'morning3' | 'allDone2' | 'tasks5' | 'note1' | 'joy2' | 'mood3' | 'contact1';

/** What the quests read (all day lists ascending; first* = the first day something existed, null when never). */
export interface QuestHistory {
  /** Done habit logs with the local hour they were logged. */
  doneLogs: ReadonlyArray<{ day: Day; hour: number }>;
  allDoneDays: readonly Day[];
  taskDays: readonly Day[];
  noteDays: readonly Day[];
  joyDays: readonly Day[];
  moodDays: readonly Day[];
  contactDays: readonly Day[];
  firstHabit: Day | null;
  firstTask: Day | null;
  firstContact: Day | null;
}

const QUESTS: ReadonlyArray<{ id: QuestId; target: number; needs?: 'habit' | 'task' | 'contact' }> = [
  { id: 'water5', target: 5, needs: 'habit' },
  { id: 'morning3', target: 3, needs: 'habit' },
  { id: 'allDone2', target: 2, needs: 'habit' },
  { id: 'tasks5', target: 5, needs: 'task' },
  { id: 'note1', target: 1 },
  { id: 'joy2', target: 2 },
  { id: 'mood3', target: 3 },
  { id: 'contact1', target: 1, needs: 'contact' },
];

export const QUEST_TEXT: Readonly<Record<QuestId, string>> = {
  water5: t.questWater5, morning3: t.questMorning3, allDone2: t.questAllDone2, tasks5: t.questTasks5,
  note1: t.questNote1, joy2: t.questJoy2, mood3: t.questMood3, contact1: t.questContact1,
};

export interface Quest { id: QuestId; text: string; target: number; progress: number; done: boolean }

function hash(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619) >>> 0;
  return x >>> 0;
}

const inWeek = (list: readonly Day[], from: Day, to: Day): Day[] => list.filter((d) => d >= from && d <= to);

/** Longest run of consecutive days (in the week) with a watering before noon. */
function morningRun(logs: QuestHistory['doneLogs'], from: Day, to: Day): number {
  const days = new Set(logs.filter((l) => l.day >= from && l.day <= to && l.hour < 12).map((l) => l.day));
  let best = 0;
  let run = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    run = days.has(d) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** The week's three tasks (Monday `monday`) with their progress up to `today` (the whole week for past weeks). */
export function weekQuests(h: QuestHistory, monday: Day, today: Day): Quest[] {
  const sunday = addDays(monday, 6);
  const to = today < sunday ? today : sunday;
  const has = (first: Day | null): boolean => first !== null && first <= sunday;
  const fit = QUESTS.filter((q) => !q.needs || has(q.needs === 'habit' ? h.firstHabit : q.needs === 'task' ? h.firstTask : h.firstContact));
  const key = isoWeekKey(monday);
  const chosen = [...fit].sort((a, b) => hash(`${key}:${a.id}`) - hash(`${key}:${b.id}`)).slice(0, 3)
    .sort((a, b) => QUESTS.indexOf(a) - QUESTS.indexOf(b));
  return chosen.map((q) => {
    let n = 0;
    if (q.id === 'water5') n = new Set(h.doneLogs.filter((l) => l.day >= monday && l.day <= to).map((l) => l.day)).size;
    else if (q.id === 'morning3') n = morningRun(h.doneLogs, monday, to);
    else if (q.id === 'allDone2') n = inWeek(h.allDoneDays, monday, to).length;
    else if (q.id === 'tasks5') n = inWeek(h.taskDays, monday, to).length;
    else if (q.id === 'note1') n = inWeek(h.noteDays, monday, to).length;
    else if (q.id === 'joy2') n = inWeek(h.joyDays, monday, to).length;
    else if (q.id === 'mood3') n = new Set(inWeek(h.moodDays, monday, to)).size;
    else n = new Set(inWeek(h.contactDays, monday, to)).size;
    const progress = Math.min(n, q.target);
    return { id: q.id, text: QUEST_TEXT[q.id], target: q.target, progress, done: progress >= q.target };
  });
}

/** Fulfilled tasks over all weeks from the first activity up to today. */
export function questsDone(h: QuestHistory, today: Day): number {
  const firsts = [h.firstHabit, h.firstTask, h.doneLogs[0]?.day, h.noteDays[0], h.joyDays[0], h.moodDays[0], h.contactDays[0]]
    .filter((d): d is Day => typeof d === 'string' && d <= today);
  if (firsts.length === 0) return 0;
  let n = 0;
  for (let monday = startOfWeek(firsts.sort()[0] ?? today); monday <= today; monday = addDays(monday, 7)) {
    n += weekQuests(h, monday, today).filter((q) => q.done).length;
  }
  return n;
}

export interface SeedCount { earned: number; spent: number; balance: number }

/** Seeds earned from the history, spent on the garden, and what is left (at least 0). */
export function seedCount(input: { waterings: number; tasks: number; joys: number; traces: number; quests: number }, state: GardenState | undefined): SeedCount {
  const earned = input.waterings * SEEDS.water + input.tasks * SEEDS.task + input.joys * SEEDS.joy + input.traces * SEEDS.trace + input.quests * SEEDS.quest;
  const spent = seedsSpent(state);
  return { earned, spent, balance: Math.max(0, earned - spent) };
}

export function seedsText(n: number): string {
  return n === 1 ? t.seedsOne : fmt(t.seedsMany, { n });
}
