// Besucher und Herbarium (services/visitors.ts, services/herbarium.ts, island drawing): reasons and dates, the
// pause rule, days with everything watered, who is on the island, arrivals, herbarium order and lines.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { islandSvg } from '../components/island.js';
import { visitorGlyph } from '../components/island-visitors.js';
import type { Area, Habit, HabitLog, Milestone } from '../model.js';
import { herbariumCards } from '../services/herbarium.js';
import {
  allDoneDays, islandVisitors, ISLAND_MAX, newlyArrived, returnDay, VISITOR_IDS, visitorInfos, type VisitorHistory,
} from '../services/visitors.js';
import { addDays } from '../util/date.js';

const EMPTY: VisitorHistory = {
  blooms: [], streak7: [], streak30: [], joyDays: [], doneLogDays: [], allDoneDays: [], contactDays: [], taskDays: [],
};
const days = (from: string, n: number): string[] => Array.from({ length: n }, (_, i) => addDays(from, i));
const habit = (id: string, extra: Partial<Habit> = {}): Habit => ({
  id, name: id, schedule: { kind: 'daily', interval: 1 }, period: 'any', startDay: '2026-10-01', archived: 0, sortKey: 'a', updatedAt: '2026-10-01T08:00:00.000Z', ...extra,
});
const log = (habitId: string, day: string): HabitLog => ({ id: `${habitId}:${day}`, habitId, day, status: 'done', loggedAt: `${day}T08:00:00.000Z` });

describe('visitors', () => {
  test('nothing found in an empty garden; every visitor has a hint', () => {
    const infos = visitorInfos(EMPTY, '2026-11-02');
    assert.deepEqual(infos.map((v) => v.id), [...VISITOR_IDS]);
    for (const v of infos) {
      assert.equal(v.day, null);
      assert.match(v.text, /^Kommt/u);
      assert.doesNotMatch(v.text, /!/u);
    }
  });
  test('reasons and their dates', () => {
    const h: VisitorHistory = {
      ...EMPTY,
      blooms: [{ day: '2026-10-14', name: 'Lesen' }, { day: '2026-10-20', name: 'Laufen' }, { day: '2026-10-28', name: 'Wasser' }],
      streak7: [{ day: '2026-10-07', name: 'Lesen' }],
      joyDays: ['2026-10-02', '2026-10-03'],
      contactDays: ['2026-10-05'],
      taskDays: days('2026-10-01', 12),
      doneLogDays: days('2026-10-01', 40),
      allDoneDays: days('2026-10-10', 5),
    };
    const by = new Map(visitorInfos(h, '2026-11-02').map((v) => [v.id, v]));
    assert.equal(by.get('bee')?.day, '2026-10-14');
    assert.equal(by.get('bee')?.text, 'Kam am 14. Oktober, als Lesen voll blühte.');
    assert.equal(by.get('robin')?.day, '2026-10-07');
    assert.equal(by.get('hedgehog')?.day, '2026-10-02');
    assert.equal(by.get('tit')?.day, '2026-10-05');
    assert.equal(by.get('ladybug')?.day, '2026-10-10');
    assert.equal(by.get('duck')?.day, '2026-10-28');
    assert.equal(by.get('frog')?.day, '2026-10-14');
    // Still open, with progress: 2 of 5 evening fires, 12 of 25 tasks, 33 of 100 waterings (up to today).
    assert.deepEqual(by.get('owl')?.progress, { n: 2, of: 5 });
    assert.deepEqual(by.get('dragonfly')?.progress, { n: 12, of: 25 });
    assert.deepEqual(by.get('mole')?.progress, { n: 33, of: 100 });
    assert.equal(by.get('squirrel')?.day, null);
  });
  test('days after today do not count', () => {
    const h = { ...EMPTY, joyDays: ['2026-11-05'] };
    assert.equal(visitorInfos(h, '2026-11-02').find((v) => v.id === 'hedgehog')?.day, null);
  });
  test('snail: watering again after a pause of at least three days', () => {
    assert.equal(returnDay(['2026-10-01', '2026-10-02', '2026-10-05'], '2026-11-02'), null);
    assert.equal(returnDay(['2026-10-01', '2026-10-02', '2026-10-06', '2026-10-07'], '2026-11-02'), '2026-10-06');
    assert.equal(returnDay(['2026-10-01', '2026-10-01', '2026-10-09'], '2026-10-08'), null);
  });
  test('days with everything watered', () => {
    const a = habit('a');
    const b = habit('b', { startDay: '2026-10-03' });
    const w = habit('w', { schedule: { kind: 'timesPerWeek', times: 3 } });
    const logs = [log('a', '2026-10-01'), log('a', '2026-10-02'), log('a', '2026-10-03'), log('a', '2026-10-04'), log('b', '2026-10-04')];
    // 1st and 2nd: only a was due; 3rd: b due and missing; 4th: both done. The weekly routine never blocks.
    assert.deepEqual(allDoneDays([a, b, w], logs, '2026-10-05'), ['2026-10-01', '2026-10-02', '2026-10-04']);
    // An archived routine only counts up to its last done day (here 1 October).
    const old = habit('old', { archived: 1 });
    assert.deepEqual(allDoneDays([a, old], [...logs.filter((l) => l.habitId === 'a'), log('old', '2026-10-01')], '2026-10-04'),
      ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  });
  test('island: the newly found stay three days, then known ones drop by now and then (at most three)', () => {
    const h: VisitorHistory = { ...EMPTY, blooms: [{ day: '2026-11-01', name: 'Lesen' }], joyDays: ['2026-09-01'], contactDays: ['2026-09-02'] };
    const infos = visitorInfos(h, '2026-11-02');
    assert.deepEqual(islandVisitors(infos, '2026-11-02', 'autumn')[0], { id: 'bee', isNew: true });
    assert.ok(!islandVisitors(infos, '2026-11-04', 'autumn').some((v) => v.id === 'bee' && v.isNew));
    // Over a month known visitors come on some days and not on others, never more than ISLAND_MAX.
    let withGuests = 0;
    for (const day of days('2026-12-01', 30)) {
      const list = islandVisitors(infos, day, 'winter');
      assert.ok(list.length <= ISLAND_MAX);
      // The bee and the hedgehog stay away in winter.
      assert.ok(!list.some((v) => v.id === 'bee' || v.id === 'hedgehog'), day);
      if (list.length > 0) withGuests++;
    }
    assert.ok(withGuests > 3 && withGuests < 27, String(withGuests));
    // Stable for a day.
    assert.deepEqual(islandVisitors(infos, '2026-12-10', 'winter'), islandVisitors(infos, '2026-12-10', 'winter'));
  });
  test('arrival: found today and not before', () => {
    const before = visitorInfos(EMPTY, '2026-11-02');
    const after = visitorInfos({ ...EMPTY, joyDays: ['2026-11-02'] }, '2026-11-02');
    assert.deepEqual(newlyArrived(before, after, '2026-11-02'), ['hedgehog']);
    assert.deepEqual(newlyArrived(after, after, '2026-11-02'), []);
    const old = visitorInfos({ ...EMPTY, joyDays: ['2026-10-02'] }, '2026-11-02');
    assert.deepEqual(newlyArrived(before, old, '2026-11-02'), []);
  });
  test('drawn on the island and in the album', () => {
    const svg = islandSvg({ areas: {}, extra: null, decor: 'low', prefix: 'p-', visitors: VISITOR_IDS.map((id, i) => ({ id, arrive: i === 0 })) });
    for (const id of VISITOR_IDS) assert.match(svg, new RegExp(`data-visitor="${id}"`, 'u'));
    assert.equal((svg.match(/i-visit-new/gu) ?? []).length, 1);
    assert.doesNotMatch(svg, /style=|§/u);
    assert.match(visitorGlyph('owl', true), /ol-visitor-glyph--open/u);
    assert.doesNotMatch(visitorGlyph('owl', false), /url\(#/u);
  });
});

describe('herbarium', () => {
  const areas = new Map<string, Area>([['ar', { id: 'ar', name: 'Gesundheit', flower: 'bellis', tint: '#7FA36F', sortKey: 'a', archived: 0, updatedAt: '' }]]);
  const bloom = (habitId: string, earnedOn: string): Milestone => ({ id: `${habitId}:bloom`, kind: 'bloom', habitId, earnedOn });
  test('pressed flowers newest first, then the growing ones closest first; archived without bloom left out', () => {
    const habits = [habit('a', { areaId: 'ar' }), habit('b'), habit('c'), habit('d', { archived: 1 }), habit('e', { archived: 1 })];
    const logs = new Map([['c', days('2026-10-28', 6).map((d) => log('c', d))]]);
    const cards = herbariumCards(habits, logs, [bloom('a', '2026-10-14'), bloom('b', '2026-10-21'), bloom('e', '2026-09-01')], areas, '2026-11-02');
    assert.deepEqual(cards.map((c) => c.habitId), ['b', 'a', 'e', 'c']);
    assert.equal(cards[1]?.line, 'voll erblüht am 14. Oktober');
    assert.equal(cards[1]?.area, 'Gesundheit');
    assert.equal(cards[1]?.flower, 'bellis');
    assert.equal(cards[2]?.archived, true);
    // c: six days in a row, 14 for full bloom → noch 8 Tage.
    assert.equal(cards[3]?.line, 'noch 8 Tage');
    assert.equal(cards[3]?.bloomedOn, null);
  });
});
