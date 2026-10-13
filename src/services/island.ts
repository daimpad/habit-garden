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
//
// Teil 2 (balance view and people as sprout figures):
// - Balance of a place = the routine fulfilment of its routines over the last 30 days with the Rückblick
//   rules (services/review.ts: fulfilments + overallRate over lastDays(today)), so the island and the
//   Rückblick screen show the same numbers; the overall chip uses all active routines (= "Erfüllt" there).
//   null (shown as "–") when the routines had no due day yet or the area has none.
// - Overall state words from the rounded percent: < 30 keimend, < 55 wachsend, < 80 blühend, else
//   verwurzelt (BALANCE_STEPS).
// - Short area names for the pills: default areas (unchanged default name) by their flower, otherwise the
//   whole name up to 12 characters, else its first word (cut to 12 with "…").
// - People on the island: at most PEOPLE_MAX figures; due people first (most overdue first), then those
//   in rhythm (contacted today first, then list order); the rest is counted as "+n". Five fixed slots from the bench outwards: in
//   rhythm from the bench on, overdue from the far end (figureSlots). Person pills: always in the balance
//   view, in the garden view with room (stage ≥ 560 px) or at most three people; and only when every
//   shown figure's pill finds a free spot near it (all or none, so no person lacks a number).
// - Label layout: pills are placed greedily in priority order at their anchor or the nearest free spot
//   (vertical moves preferred) inside the stage, never overlapping each other or obstacles (Keimi,
//   figures, the switch); a person pill tries above its figure, then below, right and left of it. A pill that is not required and finds no spot within its reach stays hidden.
import { fmt, t } from '../i18n/de.js';
import { DEFAULT_AREAS, type Day, type FlowerId, type Habit, type HabitLog, type Id, type Stage } from '../model.js';
import { fulfilments, lastDays, overallRate, percent } from './review.js';

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

// ---------------------------------------------------------------------------
// Balance (Teil 2)

/** Fulfilment of the routines over the last 30 days as an integer percent (Rückblick rules), null without due days. */
export function balancePercent(habits: readonly Habit[], logs: ReadonlyMap<Id, readonly HabitLog[]>, today: Day): number | null {
  return percent(overallRate(fulfilments(habits, logs, lastDays(today), today)));
}

export type BalanceState = 'sprouting' | 'growing' | 'blooming' | 'rooted';

/** Upper bounds (exclusive) of keimend, wachsend and blühend in percent; from the last one on: verwurzelt. */
export const BALANCE_STEPS: readonly [number, number, number] = [30, 55, 80];

export function balanceState(pct: number | null): BalanceState | null {
  if (pct === null) return null;
  const [sprouting, growing, blooming] = BALANCE_STEPS;
  return pct < sprouting ? 'sprouting' : pct < growing ? 'growing' : pct < blooming ? 'blooming' : 'rooted';
}

const STATE_WORDS: Readonly<Record<BalanceState, string>> = {
  sprouting: t.islandStateSprouting, growing: t.islandStateGrowing, blooming: t.islandStateBlooming, rooted: t.islandStateRooted,
};

/** "keimend", "wachsend", "blühend", "verwurzelt"; "noch offen" without any due day. */
export function balanceWord(state: BalanceState | null): string {
  return state === null ? t.islandStateNone : STATE_WORDS[state];
}

/** "60 %" or "–". */
export function percentText(pct: number | null): string {
  return pct === null ? t.reviewNone : fmt(t.reviewPercent, { n: pct });
}

const SHORT_NAMES: Readonly<Partial<Record<FlowerId, string>>> = {
  bellis: t.islandShortHealth, calendula: t.islandShortWealth, helianthus: t.islandShortBonds, centaurea: t.islandShortWork,
  passiflora: t.islandShortGrowth, matricaria: t.islandShortLeisure, leucanthemum: t.islandShortHome,
};

export const SHORT_NAME_MAX = 12;

/**
 * Compact label of an area for the pills: a default area that still has its default name gets the short
 * name of its flower ("Persönliche Entwicklung" → "Entwicklung"); any other name stays whole up to 12
 * characters, else its first word (split at spaces, "&", "/", ",", "+"), cut to 12 characters with "…".
 */
export function shortAreaName(name: string, flower: FlowerId): string {
  const trimmed = name.trim();
  const def = DEFAULT_AREAS.find((a) => a.flower === flower);
  const short = SHORT_NAMES[flower];
  if (def && short && def.name === trimmed) return short;
  if ([...trimmed].length <= SHORT_NAME_MAX) return trimmed;
  const first = trimmed.split(/[\s&/,+]+/u).find((part) => part.length > 0) ?? trimmed;
  const chars = [...first];
  return chars.length <= SHORT_NAME_MAX ? first : `${chars.slice(0, SHORT_NAME_MAX - 1).join('')}…`;
}

// ---------------------------------------------------------------------------
// People on the island (Teil 2)

/** Figures on the island at most; the rest is "+n" (opens "Alle Personen"). */
export const PEOPLE_MAX = 5;
/** Up to this many people show their pill in the garden view on a phone; more only in the balance view. */
export const PEOPLE_PILLS_GARDEN = 3;

export interface PersonPick {
  state: 'fresh' | 'due';
  /** Rank within the state, higher first: how overdue (due); 1 when contacted today, else 0 (fresh). */
  urgency: number;
}

/**
 * The people shown as figures: due people first (most overdue first), then the people in rhythm (contacted
 * today first, so a person just contacted stays on the island), ties in input order; at most `max`.
 * Returned as the fresh ones followed by the due ones, each in that order, with the number left out.
 */
export function pickPeople<T extends PersonPick>(people: readonly T[], max = PEOPLE_MAX): { shown: T[]; more: number } {
  const indexed = people.map((p, i) => ({ p, i }));
  const due = indexed.filter((x) => x.p.state === 'due').sort((a, b) => b.p.urgency - a.p.urgency || a.i - b.i);
  const fresh = indexed.filter((x) => x.p.state === 'fresh').sort((a, b) => b.p.urgency - a.p.urgency || a.i - b.i);
  const keep = new Set([...due, ...fresh].slice(0, Math.max(0, max)).map((x) => x.i));
  const shown = [...fresh, ...due].filter((x) => keep.has(x.i)).map((x) => x.p);
  return { shown, more: people.length - shown.length };
}

/**
 * Slot of each figure among `slots` places ordered from the bench outwards: people in rhythm take the
 * slots from the bench on (in order), overdue people from the far end inwards, so they stand a little
 * apart. Input: the states in display order; output: one slot index per person (all distinct).
 */
export function figureSlots(states: ReadonlyArray<'fresh' | 'due'>, slots = PEOPLE_MAX): number[] {
  let near = 0;
  let far = slots - 1;
  return states.map((state) => (state === 'fresh' ? near++ : far--));
}

/** Whether the person pills show: always in the balance view; in the garden view with room or few people. */
export function showPeoplePills(mode: 'garden' | 'balance', shown: number, roomy: boolean): boolean {
  return mode === 'balance' || roomy || shown <= PEOPLE_PILLS_GARDEN;
}

// ---------------------------------------------------------------------------
// Label layout (Teil 2)

/** Axis-aligned box, top-left corner and size (pixels). */
export interface Box { x: number; y: number; w: number; h: number }

export interface LabelRequest {
  id: string;
  /** Preferred centre. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** How far (each axis) the label may move from its preferred centre. */
  reach: number;
  /** Further centres tried in order (each with the same reach) when the preferred one has no room. */
  alternatives?: ReadonlyArray<readonly [number, number]>;
  /** A required label is placed even without a free spot (at its preferred place, inside the bounds). */
  required: boolean;
}

export function boxesOverlap(a: Box, b: Box, gap = 0): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

const inside = (a: Box, b: Box): boolean => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/**
 * Places labels in request order (priority): each at its preferred centre (moved inside `bounds`) or the
 * nearest spot on a `step` grid within its reach that keeps `gap` to every placed label and obstacle;
 * then the same around each alternative centre in turn.
 * Vertical moves cost less than horizontal ones (dx² × 2 + dy²). Returns the box per id, null for a label
 * that is not required and found no spot.
 */
export function layoutLabels(requests: readonly LabelRequest[], obstacles: readonly Box[], bounds: Box,
  opts: { step?: number; gap?: number } = {}): Map<string, Box | null> {
  const step = Math.max(1, opts.step ?? 4);
  const gap = opts.gap ?? 3;
  const placed: Box[] = [];
  const out = new Map<string, Box | null>();
  for (const req of requests) {
    const w = Math.min(req.w, bounds.w);
    const h = Math.min(req.h, bounds.h);
    const n = Math.floor(Math.max(0, req.reach) / step);
    const offsets: Array<readonly [number, number, number]> = [];
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) offsets.push([i * step, j * step, 2 * (i * step) ** 2 + (j * step) ** 2]);
    }
    offsets.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
    const origin = (cx: number, cy: number): readonly [number, number] => [
      Math.min(Math.max(cx - w / 2, bounds.x), bounds.x + bounds.w - w),
      Math.min(Math.max(cy - h / 2, bounds.y), bounds.y + bounds.h - h),
    ];
    const [x0, y0] = origin(req.cx, req.cy);
    let found: Box | null = null;
    for (const [cx, cy] of [[req.cx, req.cy] as const, ...(req.alternatives ?? [])]) {
      const [ox, oy] = origin(cx, cy);
      for (const [dx, dy] of offsets) {
        const box = { x: ox + dx, y: oy + dy, w, h };
        if (!inside(box, bounds)) continue;
        if (obstacles.some((o) => boxesOverlap(box, o, gap)) || placed.some((p) => boxesOverlap(box, p, gap))) continue;
        found = box;
        break;
      }
      if (found) break;
    }
    if (!found && req.required) found = { x: x0, y: y0, w, h };
    if (found) placed.push(found);
    out.set(req.id, found);
  }
  return out;
}
