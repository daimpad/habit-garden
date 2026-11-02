// Lebendige Insel (services/season.ts, components/island-season.ts via islandSvg): calendar seasons, the
// rainbow rule and what each season adds to the island.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { islandSvg, type IslandArea } from '../components/island.js';
import type { PlaceKey } from '../services/island.js';
import { SEASON_DAY_LINE, seasonOf, showRainbow, type Season } from '../services/season.js';

const area = (lvl: 0 | 1 | 2 | 3, stages: Array<0 | 1 | 2 | 3 | 4>, extra: Partial<IslandArea> = {}): IslandArea => ({
  lvl, flower: 'bellis', tint: '#7FA36F', plants: stages.map((stage) => ({ stage, wet: false })), more: 0, ...extra,
});
const KEYS: PlaceKey[] = ['home', 'work', 'bonds', 'health', 'wealth', 'leisure', 'growth'];
const full = Object.fromEntries(KEYS.map((k) => [k, area(3, [4, 4, 3, 2, 1, 1])])) as Record<PlaceKey, IslandArea>;
const svg = (season?: Season, extra: { rainbow?: boolean; areas?: Partial<Record<PlaceKey, IslandArea>> } = {}): string =>
  islandSvg({ areas: extra.areas ?? full, extra: null, decor: 'lush', prefix: 'p-', ...(season ? { season } : {}), ...(extra.rainbow ? { rainbow: true } : {}) });

describe('seasons', () => {
  test('meteorological seasons from the day key', () => {
    assert.equal(seasonOf('2026-03-01'), 'spring');
    assert.equal(seasonOf('2026-05-31'), 'spring');
    assert.equal(seasonOf('2026-06-01'), 'summer');
    assert.equal(seasonOf('2026-08-31'), 'summer');
    assert.equal(seasonOf('2026-09-01'), 'autumn');
    assert.equal(seasonOf('2026-11-30'), 'autumn');
    assert.equal(seasonOf('2026-12-01'), 'winter');
    assert.equal(seasonOf('2027-01-15'), 'winter');
    assert.equal(seasonOf('2027-02-28'), 'winter');
  });
  test('rainbow only by day, with something scheduled and nothing waiting', () => {
    assert.equal(showRainbow({ scheduled: 3, pending: 0, daytime: true }), true);
    assert.equal(showRainbow({ scheduled: 3, pending: 1, daytime: true }), false);
    assert.equal(showRainbow({ scheduled: 0, pending: 0, daytime: true }), false);
    assert.equal(showRainbow({ scheduled: 3, pending: 0, daytime: false }), false);
  });
  test('a day line per season, without exclamation marks', () => {
    for (const line of Object.values(SEASON_DAY_LINE)) {
      assert.ok(line.length > 0);
      assert.doesNotMatch(line, /!/u);
    }
  });
});

describe('island per season', () => {
  test('default is summer: no snow, leaves or blossom symbols', () => {
    const s = svg();
    assert.equal(s, svg('summer'));
    assert.doesNotMatch(s, /i-snow|i-fall|id="p-lf"|id="p-cb"|i-rainbow/u);
  });
  test('winter: snow on roofs and crowns, ice, falling snow, Keimi with a scarf', () => {
    const s = svg('winter');
    assert.match(s, /class="i-snow"/u);
    assert.match(s, /clipPath id="p-cs-tree"/u);
    assert.match(s, /class="i-ice"/u);
    assert.match(s, /class="i-flake"/u);
    assert.match(s, /class="i-scarf"/u);
    // No lily pads on the ice.
    assert.doesNotMatch(s, /class="i-pad"/u);
  });
  test('autumn: leaf symbol, piles and falling leaves', () => {
    const s = svg('autumn');
    assert.match(s, /id="p-lf"/u);
    assert.match(s, /href="#p-lf"/u);
    assert.match(s, /class="i-fall"/u);
    assert.doesNotMatch(s, /i-snow"/u);
  });
  test('spring: blossoms on the big tree', () => {
    assert.match(svg('spring'), /href="#p-cb"/u);
  });
  test('snow only on what exists: no cottage, no roof snow', () => {
    const { home: _home, ...rest } = full;
    const s = svg('winter', { areas: rest });
    assert.doesNotMatch(s, /M249 121C249 113/u);
    assert.match(svg('winter'), /M249 121C249 113/u);
  });
  test('rainbow by request, as a day-only part', () => {
    assert.match(svg('summer', { rainbow: true }), /class="i-day i-rainbow"/u);
  });
  test('reward moment around an arriving object', () => {
    const areas = { ...full, health: area(2, [4], { trace: 1, arrive: 'trace' }) };
    assert.match(svg('summer', { areas }), /class="i-fx"/u);
    assert.doesNotMatch(svg(), /class="i-fx"/u);
  });
  test('every season stays CSP-clean and within 90 KB', () => {
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      const s = svg(season, { rainbow: true });
      assert.doesNotMatch(s, /style=|<style|filter|§/u, season);
      assert.ok(s.length < 90_000, `${season}: ${s.length}`);
    }
  });
});
