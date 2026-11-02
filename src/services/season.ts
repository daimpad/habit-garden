// Lebendige Insel (Gamification Teil 1, decision of 02.11.2026): the island follows the real season of the
// calendar. Pure (unit-tested in __tests__/season.test.ts).
// - Meteorological seasons: spring March–May, summer June–August, autumn September–November, winter
//   December–February. The island recolours (CSS, data-season) and adds seasonal details (components/
//   island-season.ts): blossoms in spring, fireflies on summer evenings, leaves in autumn, snow in winter.
// - Rainbow: by day, once every routine scheduled today is watered (at least one was scheduled).
import { t } from '../i18n/de.js';
import type { Day } from '../model.js';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

/** Season of a day key ("2026-11-02" → autumn). */
export function seasonOf(day: Day): Season {
  const month = Number(day.slice(5, 7));
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

/** The hero's day line (by day only; the other phases keep their own lines). */
export const SEASON_DAY_LINE: Readonly<Record<Season, string>> = {
  spring: t.seasonDaySpring,
  summer: t.greetDayLine,
  autumn: t.seasonDayAutumn,
  winter: t.seasonDayWinter,
};

/** Rainbow over the island: by day, with at least one routine scheduled today and none still waiting. */
export function showRainbow(input: { scheduled: number; pending: number; daytime: boolean }): boolean {
  return input.daytime && input.scheduled > 0 && input.pending === 0;
}
