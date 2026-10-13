// Garten-Insel (HEUTE hero, decision of 13.10.2026, Teil 1): pure rules behind the island artwork.
// No DOM, no Dexie; components/island.ts draws, screens/garden.ts wires.
//
// - Places: each default area has its own place on the island, found by its flower (every default
//   area has a unique flower). assignPlaces() runs in two passes over the areas in their order:
//   1. an area whose flower belongs to a free place takes it;
//   2. every other area (custom flower 'generic', a second area with an already used flower, routines
//      without area) walks PLACE_RING clockwise, starting at its own flower's place (generic: at the
//      cottage), and takes the first free place.
//   With more than seven areas the rest share one generic flower bed ("Weitere Bereiche", `extra`).
// - Flourish of a place (0–3) follows the average plant stage of the area's active routines; an area
//   without routines stays at 0 (modest structure with a seed).
// - Slots: up to six plants per place in routine order; with more, the six most advanced stay and the
//   rest is counted as "+n".
// - Keimi's sentence: short, action oriented, never a greeting; one fixed priority order (keimiLine).
import { fmt, t } from '../i18n/de.js';
import type { FlowerId, Stage } from '../model.js';

export type PlaceKey = 'home' | 'work' | 'bonds' | 'health' | 'wealth' | 'leisure' | 'growth';

/** Places clockwise around the island, starting at the cottage (top centre). */
export const PLACE_RING: readonly PlaceKey[] = ['home', 'bonds', 'wealth', 'leisure', 'growth', 'health', 'work'];

/** The place of each default area's flower. */
export const PLACE_OF_FLOWER: Readonly<Partial<Record<FlowerId, PlaceKey>>> = {
  leucanthemum: 'home', bellis: 'health', helianthus: 'bonds', centaurea: 'work',
  passiflora: 'growth', matricaria: 'leisure', calendula: 'wealth',
};

export interface PlaceCandidate { key: string; flower: FlowerId }

export interface PlaceAssignment {
  /** Place → candidate key. */
  places: Map<PlaceKey, string>;
  /** Candidate keys without a place of their own (shared generic flower bed), in input order. */
  extra: string[];
}

export function assignPlaces(candidates: readonly PlaceCandidate[]): PlaceAssignment {
  const places = new Map<PlaceKey, string>();
  const placed = new Set<string>();
  for (const c of candidates) {
    const own = PLACE_OF_FLOWER[c.flower];
    if (own && !places.has(own) && !placed.has(c.key)) {
      places.set(own, c.key);
      placed.add(c.key);
    }
  }
  const extra: string[] = [];
  for (const c of candidates) {
    if (placed.has(c.key)) continue;
    const own = PLACE_OF_FLOWER[c.flower];
    const start = own ? PLACE_RING.indexOf(own) : 0;
    let free: PlaceKey | undefined;
    for (let i = 0; i < PLACE_RING.length && !free; i++) {
      const key = PLACE_RING[(start + i) % PLACE_RING.length];
      if (key && !places.has(key)) free = key;
    }
    if (free) places.set(free, c.key);
    else extra.push(c.key);
    placed.add(c.key);
  }
  return { places, extra };
}

export type Flourish = 0 | 1 | 2 | 3;

/** Average stage of the routines: < 1 → 0, 1–2.4 → 1, 2.5–3.4 → 2, ≥ 3.5 → 3 (no routines: 0). */
export function flourishLevel(stages: readonly Stage[]): Flourish {
  if (stages.length === 0) return 0;
  const avg = stages.reduce<number>((sum, s) => sum + s, 0) / stages.length;
  return avg >= 3.5 ? 3 : avg >= 2.5 ? 2 : avg >= 1 ? 1 : 0;
}

export type Decor = 'low' | 'mid' | 'lush';

/** Wild flowers on the island: by the average stage of all active routines (< 1.5 low, < 3 mid, else lush). */
export function decorLevel(stages: readonly Stage[]): Decor {
  if (stages.length === 0) return 'low';
  const avg = stages.reduce<number>((sum, s) => sum + s, 0) / stages.length;
  return avg >= 3 ? 'lush' : avg >= 1.5 ? 'mid' : 'low';
}

export const SLOT_COUNT = 6;

/**
 * The plants shown in a place's slots: all of them (in order) up to `max`; with more, the `max` most
 * advanced ones (ties: earlier first), kept in their original order, and the number left out.
 */
export function fillSlots<T extends { stage: Stage }>(items: readonly T[], max = SLOT_COUNT): { shown: T[]; more: number } {
  if (items.length <= max) return { shown: [...items], more: 0 };
  const ranked = items.map((item, i) => ({ item, i })).sort((a, b) => b.item.stage - a.item.stage || a.i - b.i);
  const keep = new Set(ranked.slice(0, max).map((r) => r.i));
  return { shown: items.filter((_, i) => keep.has(i)), more: items.length - max };
}

/** Accessible name of a place: "Gesundheit & Fitness: 2 von 3 heute gegossen". */
export function placeLabel(area: string, done: number, scheduled: number, routines: number): string {
  if (routines === 0) return fmt(t.islandPlaceEmpty, { area });
  if (scheduled === 0) return fmt(t.islandPlaceFree, { area });
  return fmt(t.islandPlaceAria, { area, done, n: scheduled });
}

// ---------------------------------------------------------------------------
// Keimi

export interface KeimiInput {
  night: boolean;
  evening: boolean;
  /** Active routines at all. */
  habits: number;
  /** Routines scheduled today and how many of them are still open. */
  scheduled: number;
  pending: number;
  /** Open tasks in today's focus. */
  focusOpen: number;
  /** Name of the person most overdue (null when nobody is due). */
  dueContact: string | null;
}

export type KeimiReason = 'night' | 'pending' | 'focus' | 'contact' | 'watered' | 'first' | 'evening' | 'rest';

/** "zwei" … "zwölf" for 2–12, digits otherwise; `capital` for the start of a sentence. */
export function countWord(n: number, capital = false): string {
  const word = n >= 2 && n <= 12 ? t.numberWords.split('|')[n - 2] : undefined;
  if (!word) return String(n);
  return capital ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

/**
 * Keimi's sentence, first match wins: night → plants waiting → focus tasks open → a person due →
 * everything watered (evening variant) → no routine yet → evening → nothing scheduled today.
 */
export function keimiLine(input: KeimiInput): { reason: KeimiReason; text: string } {
  if (input.night) return { reason: 'night', text: t.keimiNight };
  if (input.pending > 0) {
    return { reason: 'pending', text: input.pending === 1 ? t.keimiPendingOne : fmt(t.keimiPendingMany, { n: countWord(input.pending, true) }) };
  }
  if (input.focusOpen > 0) {
    return { reason: 'focus', text: input.focusOpen === 1 ? t.keimiFocusOne : fmt(t.keimiFocusMany, { n: countWord(input.focusOpen) }) };
  }
  if (input.dueContact) return { reason: 'contact', text: fmt(t.keimiContact, { name: input.dueContact }) };
  if (input.scheduled > 0) return { reason: 'watered', text: input.evening ? t.keimiWateredEvening : t.keimiWatered };
  if (input.habits === 0) return { reason: 'first', text: t.keimiFirstRoutine };
  if (input.evening) return { reason: 'evening', text: t.keimiEveningCalm };
  return { reason: 'rest', text: t.keimiRestDay };
}
