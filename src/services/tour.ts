// Guided tour (decision of 19.10.2026): Keimi explains the app step by step while a soft light moves
// from element to element. A main tour (ten steps through HEUTE, PLANUNG, WISSEN and the settings) and
// one chapter per area, started from the "?" in that area's header or from Einstellungen › Hilfe; after
// the onboarding the main tour is offered once. Pure: step data and the geometry (no DOM, no Dexie).
//
// Rules (unit-tested in __tests__/tour.test.ts):
// - A step names its route and a list of target selectors; the first visible match is highlighted. A step
//   without targets shows Keimi in the middle. An `optional` step whose targets are all missing is left
//   out (e.g. "Heute gießen" without any routine); a non-optional one shows in the middle instead.
// - `tryIt` steps offer "Ausprobieren": the tour steps aside, opens the matching sheet and continues with
//   the next step once every sheet is closed again. Nothing is created by the tour itself.
// - Geometry: the light is the target's box plus SPOT_PAD, clipped to the visible area (between the top
//   and the bottom navigation). Keimi's bubble goes below the light when it fits, else above, else it
//   lies over the lower part of the screen; horizontally it is centred on the light and kept inside the
//   16 px gutters. scrollTarget() says where the target's top should be so that light and bubble fit.
import { t } from '../i18n/de.js';

export type TourId = 'main' | 'heute' | 'planung' | 'wissen';
export type TourRoute = '/heute' | '/planung' | '/wissen';
export type TryIt = 'habit' | 'focus';

export interface TourStep {
  id: string;
  route: TourRoute;
  /** Selectors in order of preference; empty = Keimi in the middle. */
  targets: readonly string[];
  title: string;
  text: string;
  /** Left out when no target is visible. */
  optional?: boolean;
  tryIt?: TryIt;
}

const step = (id: string, route: TourRoute, targets: readonly string[], title: string, text: string, extra: Partial<TourStep> = {}): TourStep =>
  ({ id, route, targets, title, text, ...extra });

// Shared targets (CSS selectors of existing elements; the tour only reads them).
const T = {
  island: ['.ol-isl__stage', '.ol-isl'],
  islandMode: ['.ol-isl__mode'],
  date: ['.ol-hero__date-btn'],
  review: ['.ol-hero__review'],
  habitAdd: ['.ol-garden-add:not([hidden])', '.ol-heute__routine-empty:not([hidden]) .ol-heute__card', '.ol-heute__first:not([hidden]) .ol-heute__steps'],
  water: ['.ol-garden-card ol-habit-toggle'],
  habitCard: ['.ol-garden-card'],
  people: ['.ol-heute__people'],
  focus: ['.ol-heute__focus .ol-heute__card'],
  mood: ['.ol-heute__mood-section .ol-heute__card'],
  due: ['.ol-heute__due:not([hidden])'],
  fire: ['.ol-isl[data-fire] .ol-isl__fire'],
  fab: ['ol-fab:not([hidden]) .ol-fab__btn'],
  planChips: ['.ol-plan__chips'],
  planViews: ['.ol-plan__views'],
  planInbox: ['.ol-plan__inbox-row:not([hidden])'],
  planProject: ['.ol-plan__projects > li'],
  planAddProject: ['.ol-plan__add-project'],
  planSearch: ['.ol-plan__search'],
  wissenSearch: ['.ol-wissen__search', '.ol-wissen ol-empty-state'],
  wissenTags: ['.ol-wissen__tag-open'],
  wissenNote: ['.ol-wissen__list li'],
  wissenSettings: ['.ol-wissen__settings'],
  help: ['.ol-help'],
} as const;

export const TOURS: Readonly<Record<TourId, readonly TourStep[]>> = {
  main: [
    step('welcome', '/heute', [], t.tourWelcomeTitle, t.tourWelcomeText),
    step('island', '/heute', T.island, t.tourIslandTitle, t.tourIslandText),
    step('habit', '/heute', T.habitAdd, t.tourHabitTitle, t.tourHabitText, { tryIt: 'habit' }),
    step('water', '/heute', T.water, t.tourWaterTitle, t.tourWaterText, { optional: true }),
    step('focus', '/heute', T.focus, t.tourFocusTitle, t.tourFocusText, { tryIt: 'focus' }),
    step('fab', '/heute', T.fab, t.tourFabTitle, t.tourFabText),
    step('planung', '/planung', T.planViews, t.tourPlanTitle, t.tourPlanText),
    step('wissen', '/wissen', T.wissenSearch, t.tourWissenTitle, t.tourWissenText),
    step('settings', '/wissen', T.wissenSettings, t.tourSettingsTitle, t.tourSettingsText),
    step('end', '/wissen', T.help, t.tourEndTitle, t.tourEndText),
  ],
  heute: [
    step('date', '/heute', T.date, t.tourDateTitle, t.tourDateText),
    step('island', '/heute', T.island, t.tourPlacesTitle, t.tourPlacesText),
    step('mode', '/heute', T.islandMode, t.tourModeTitle, t.tourModeText),
    step('fire', '/heute', T.fire, t.tourFireTitle, t.tourFireText, { optional: true }),
    step('review', '/heute', T.review, t.tourReviewTitle, t.tourReviewText),
    step('card', '/heute', T.habitCard, t.tourCardTitle, t.tourCardText, { optional: true }),
    step('habit', '/heute', T.habitAdd, t.tourHabitTitle, t.tourHabitText, { optional: true }),
    step('people', '/heute', T.people, t.tourPeopleTitle, t.tourPeopleText, { optional: true }),
    step('focus', '/heute', T.focus, t.tourFocusTitle, t.tourFocusChapterText),
    step('mood', '/heute', T.mood, t.tourMoodTitle, t.tourMoodText),
    step('due', '/heute', T.due, t.tourDueTitle, t.tourDueText, { optional: true }),
  ],
  planung: [
    step('chips', '/planung', T.planChips, t.tourChipsTitle, t.tourChipsText),
    step('views', '/planung', T.planViews, t.tourViewsTitle, t.tourViewsText),
    step('inbox', '/planung', T.planInbox, t.tourInboxTitle, t.tourInboxText, { optional: true }),
    step('project', '/planung', T.planProject, t.tourProjectTitle, t.tourProjectText, { optional: true }),
    step('add', '/planung', T.planAddProject, t.tourAddProjectTitle, t.tourAddProjectText, { optional: true }),
    step('search', '/planung', T.planSearch, t.tourPlanSearchTitle, t.tourPlanSearchText),
    step('fab', '/planung', T.fab, t.tourTaskTitle, t.tourTaskText),
  ],
  wissen: [
    step('search', '/wissen', T.wissenSearch, t.tourNoteSearchTitle, t.tourNoteSearchText),
    step('tags', '/wissen', T.wissenTags, t.tourTagsTitle, t.tourTagsText),
    step('note', '/wissen', T.wissenNote, t.tourNoteTitle, t.tourNoteText, { optional: true }),
    step('fab', '/wissen', T.fab, t.tourNewNoteTitle, t.tourNewNoteText),
  ],
};

export function isTourId(value: unknown): value is TourId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TOURS, value);
}

// --- Geometry ---

export interface Rect { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }
/** Visible area for the light: below `top`, above `bottom` (bottom navigation), `width` wide. */
export interface Viewport { width: number; height: number; top: number; bottom: number }
export type BubbleSide = 'below' | 'above' | 'over' | 'center';
export interface Placement {
  /** The light (null: none, Keimi in the middle). */
  spot: Rect | null;
  bubble: { x: number; y: number };
  side: BubbleSide;
  /** Horizontal position of the bubble's pointer, relative to the bubble's left edge. */
  pointer: number;
}

export const SPOT_PAD = 8;
export const GUTTER = 16;
export const GAP = 14;

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** The light around `target`, clipped to the visible area (null when nothing of it is visible). */
export function spotRect(target: Rect, vp: Viewport): Rect | null {
  const x1 = Math.max(target.x - SPOT_PAD, 4);
  const y1 = Math.max(target.y - SPOT_PAD, vp.top + 4);
  const x2 = Math.min(target.x + target.w + SPOT_PAD, vp.width - 4);
  const y2 = Math.min(target.y + target.h + SPOT_PAD, vp.bottom - 4);
  if (x2 - x1 < 1 || y2 - y1 < 1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function place(target: Rect | null, bubble: Size, vp: Viewport): Placement {
  const maxX = vp.width - GUTTER - bubble.w;
  const spot = target ? spotRect(target, vp) : null;
  if (!spot) {
    return {
      spot: null,
      bubble: { x: clamp((vp.width - bubble.w) / 2, GUTTER, maxX), y: clamp((vp.top + vp.bottom - bubble.h) / 2, vp.top + GUTTER, vp.bottom - GUTTER - bubble.h) },
      side: 'center',
      pointer: bubble.w / 2,
    };
  }
  const cx = spot.x + spot.w / 2;
  const x = clamp(cx - bubble.w / 2, GUTTER, maxX);
  const pointer = clamp(cx - x, 24, bubble.w - 24);
  const below = spot.y + spot.h + GAP;
  if (below + bubble.h <= vp.bottom - GUTTER) return { spot, bubble: { x, y: below }, side: 'below', pointer };
  const above = spot.y - GAP - bubble.h;
  if (above >= vp.top + GUTTER) return { spot, bubble: { x, y: above }, side: 'above', pointer };
  return { spot, bubble: { x, y: vp.bottom - GUTTER - bubble.h }, side: 'over', pointer };
}

/**
 * Where the target's top edge should be (viewport y) so that light and bubble fit together: the pair is
 * centred in the visible area; a target too tall for that starts near the top (the bubble then lies over
 * its lower part). Returns null when the target already fits as it is.
 */
export function scrollTarget(target: Rect, bubble: Size, vp: Viewport): number | null {
  const room = vp.bottom - vp.top - 2 * GUTTER;
  const need = target.h + 2 * SPOT_PAD + GAP + bubble.h;
  const placed = place(target, bubble, vp);
  const whole = target.y - SPOT_PAD >= vp.top + 4 && target.y + target.h + SPOT_PAD <= vp.bottom - 4;
  if (whole && placed.side !== 'over') return null;
  if (need <= room) return vp.top + GUTTER + (room - need) / 2 + SPOT_PAD;
  return vp.top + GUTTER + SPOT_PAD;
}
