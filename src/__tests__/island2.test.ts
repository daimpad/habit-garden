// Garten-Insel (Teil 2): balance percentages (same numbers as the Rückblick), overall state thresholds,
// short area names, person closeness, which people become figures and where they stand, when person
// pills show, the label layout (no overlaps, bounds, hidden when there is no room) and the sprout figure.
// Runs against the tsc output (npm test); scripts/run-tests.mjs sets TZ=Europe/Berlin.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PEOPLE_SPOTS, sproutFigure } from '../components/island.js';
import { DEFAULT_AREAS, type Contact, type ContactLog, type Day, type Habit, type HabitLog, type HabitSchedule } from '../model.js';
import { closeness, contactStatus } from '../services/contacts.js';
import {
  balancePercent, balanceState, balanceWord, boxesOverlap, figureSlots, layoutLabels, PEOPLE_MAX, percentText, pickPeople,
  shortAreaName, showPeoplePills, type Box, type LabelRequest,
} from '../services/island.js';
import { percent, review } from '../services/review.js';
import { addDays } from '../util/date.js';

process.env.TZ = 'Europe/Berlin';

const TODAY: Day = '2026-10-13';

const habit = (id: string, schedule: HabitSchedule, extra: Partial<Habit> = {}): Habit => ({
  id, name: id, schedule, period: 'any', startDay: '2026-08-01', archived: 0, sortKey: 'V', updatedAt: '2026-08-01T00:00:00.000Z', ...extra,
});
const done = (habitId: string, ago: number, status: HabitLog['status'] = 'done'): HabitLog => {
  const day = addDays(TODAY, -ago);
  return { id: `${habitId}:${day}`, habitId, day, status, loggedAt: `${day}T08:00:00.000Z` };
};

describe('balancePercent (same rules and numbers as the Rückblick)', () => {
  const daily = habit('d', { kind: 'daily', interval: 1 });
  const weekly = habit('w', { kind: 'timesPerWeek', times: 3 });
  const young = habit('y', { kind: 'daily', interval: 1 }, { startDay: addDays(TODAY, -4) });
  const archived = habit('a', { kind: 'daily', interval: 1 }, { archived: 1 });
  const logs = new Map<string, HabitLog[]>([
    ['d', [0, 1, 2, 5, 8, 9, 10, 20, 29, 30, 31].map((n) => done('d', n)).concat([done('d', 3, 'skipped')])],
    ['w', [1, 2, 4, 6, 7, 12, 13, 14, 15, 16, 22].map((n) => done('w', n))],
    ['y', [1, 2].map((n) => done('y', n))],
    ['a', [0, 1, 2].map((n) => done('a', n))],
  ]);

  test('one area equals the Rückblick rate of its routines', () => {
    for (const list of [[daily], [weekly], [young], [daily, weekly], [daily, weekly, young, archived]]) {
      const expected = percent(review({ habits: list, logs, moods: [], today: TODAY }).rate);
      assert.equal(balancePercent(list, logs, TODAY), expected, list.map((h) => h.id).join('+'));
    }
  });

  test('the overall chip equals the Rückblick "Erfüllt"', () => {
    const all = [daily, weekly, young, archived];
    assert.equal(balancePercent(all, logs, TODAY), percent(review({ habits: all, logs, moods: [], today: TODAY }).rate));
  });

  test('a known value: 30 days of a daily routine, today open, 9 of 28 due days done', () => {
    // Days 1..29 are due (day 3 skipped = no opportunity), today counts once done: done on 0,1,2,5,8,9,10,20,29.
    assert.equal(balancePercent([daily], logs, TODAY), Math.round((9 / 29) * 100));
  });

  test('no routines or no due day yet: null, shown as "–"', () => {
    assert.equal(balancePercent([], logs, TODAY), null);
    const future = habit('f', { kind: 'daily', interval: 1 }, { startDay: TODAY });
    assert.equal(balancePercent([future], new Map(), TODAY), null);
    assert.equal(percentText(null), '–');
    assert.equal(percentText(62), '62 %');
  });
});

describe('balanceState thresholds', () => {
  test('keimend < 30 ≤ wachsend < 55 ≤ blühend < 80 ≤ verwurzelt', () => {
    const cases: Array<[number, string]> = [
      [0, 'keimend'], [29, 'keimend'], [30, 'wachsend'], [54, 'wachsend'], [55, 'blühend'], [79, 'blühend'], [80, 'verwurzelt'], [100, 'verwurzelt'],
    ];
    for (const [pct, word] of cases) assert.equal(balanceWord(balanceState(pct)), word, String(pct));
  });
  test('without due days', () => {
    assert.equal(balanceState(null), null);
    assert.equal(balanceWord(null), 'noch offen');
  });
});

describe('shortAreaName', () => {
  test('default areas by their flower', () => {
    const short = DEFAULT_AREAS.map((a) => shortAreaName(a.name, a.flower));
    assert.deepEqual(short, ['Gesundheit', 'Finanzen', 'Beziehungen', 'Beruf', 'Entwicklung', 'Freizeit', 'Wohnen']);
  });
  test('a renamed default area falls back to its own name', () => {
    assert.equal(shortAreaName('Sport', 'bellis'), 'Sport');
    assert.equal(shortAreaName('Persönliche Ziele 2027', 'passiflora'), 'Persönliche');
  });
  test('custom names: whole up to 12 characters, else the first word, cut with "…"', () => {
    assert.equal(shortAreaName('Garten', 'generic'), 'Garten');
    assert.equal(shortAreaName('Ohne Bereich', 'generic'), 'Ohne Bereich');
    assert.equal(shortAreaName('Sport im Verein', 'generic'), 'Sport');
    assert.equal(shortAreaName('Haus & Hof Projekte', 'generic'), 'Haus');
    assert.equal(shortAreaName('Ehrenamtsarbeit im Verein', 'generic'), 'Ehrenamtsar…');
    assert.equal([...shortAreaName('Ehrenamtsarbeit im Verein', 'generic')].length, 12);
  });
});

describe('closeness (person percent)', () => {
  const person = (rhythmDays: number): Contact => ({
    id: 'p', name: 'Lena', rhythmDays, archived: 0, sortKey: 'V', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
  const log = (ago: number): ContactLog => {
    const day = addDays(TODAY, -ago);
    return { id: `p:${day}`, contactId: 'p', day, loggedAt: `${day}T10:00:00.000Z` };
  };
  const pct = (rhythm: number, ago: number | null): number => closeness(contactStatus(person(rhythm), ago === null ? [] : [log(ago)], TODAY));

  test('100 % while in rhythm', () => {
    assert.equal(pct(7, 0), 100);
    assert.equal(pct(7, 6), 100);
    assert.equal(pct(30, 29), 100);
  });
  test('falls linearly from the due day to 0 % at twice the rhythm, at most 99 % once due', () => {
    assert.equal(pct(7, 7), 99);
    assert.equal(pct(10, 12), 80);
    assert.equal(pct(10, 15), 50);
    assert.equal(pct(30, 40), 67);
    assert.equal(pct(7, 13), 14);
    assert.equal(pct(7, 14), 0);
    assert.equal(pct(7, 60), 0);
  });
  test('never contacted: 0 %', () => {
    assert.equal(pct(14, null), 0);
  });
  test('never increases with more days', () => {
    let last = 100;
    for (let d = 0; d <= 40; d++) {
      const v = pct(14, d);
      assert.ok(v <= last && v >= 0 && v <= 100, `day ${d}`);
      last = v;
    }
  });
});

describe('pickPeople and figure slots', () => {
  const p = (id: string, state: 'fresh' | 'due', urgency = 0): { id: string; state: 'fresh' | 'due'; urgency: number } => ({ id, state, urgency });

  test('all people up to five; in rhythm first (input order), then overdue (most overdue first)', () => {
    const { shown, more } = pickPeople([p('a', 'due', 0.2), p('b', 'fresh'), p('c', 'due', 2), p('d', 'fresh')]);
    assert.deepEqual(shown.map((x) => x.id), ['b', 'd', 'c', 'a']);
    assert.equal(more, 0);
  });

  test('more than five: overdue people win the places, the rest is "+n"', () => {
    const list = [p('f1', 'fresh'), p('f2', 'fresh'), p('f3', 'fresh'), p('d1', 'due', 1), p('d2', 'due', Number.POSITIVE_INFINITY), p('d3', 'due', 0.5), p('f4', 'fresh')];
    const { shown, more } = pickPeople(list);
    assert.equal(shown.length, PEOPLE_MAX);
    assert.equal(more, 2);
    assert.deepEqual(shown.map((x) => x.id), ['f1', 'f2', 'd2', 'd1', 'd3']);
  });

  test('a person contacted today (urgency 1) stays among the shown ones', () => {
    const list = [p('f1', 'fresh'), p('f2', 'fresh'), p('d1', 'due', 1), p('d2', 'due', 2), p('d3', 'due', 3), p('now', 'fresh', 1)];
    const { shown, more } = pickPeople(list);
    assert.deepEqual(shown.map((x) => x.id), ['now', 'f1', 'd3', 'd2', 'd1']);
    assert.equal(more, 1);
  });

  test('custom maximum and empty input', () => {
    assert.deepEqual(pickPeople([p('a', 'fresh'), p('b', 'fresh')], 1).shown.map((x) => x.id), ['a']);
    assert.deepEqual(pickPeople([]), { shown: [], more: 0 });
  });

  test('slots: in rhythm from the bench on, overdue from the far end; always distinct', () => {
    assert.deepEqual(figureSlots(['fresh', 'fresh', 'due', 'due', 'due']), [0, 1, 4, 3, 2]);
    assert.deepEqual(figureSlots(['fresh', 'due']), [0, 4]);
    assert.deepEqual(figureSlots(['due', 'due']), [4, 3]);
    assert.deepEqual(figureSlots(['fresh', 'fresh', 'fresh', 'fresh', 'fresh']), [0, 1, 2, 3, 4]);
  });

  test('the five slots are on the island, apart from each other (≥ 46 units = 24 px at 320 px)', () => {
    const slots = PEOPLE_SPOTS.slots;
    assert.equal(slots.length, PEOPLE_MAX);
    for (const [i, a] of slots.entries()) {
      assert.ok(a[0] > 40 && a[0] < 580 && a[1] > 120 && a[1] < 400, `slot ${i}`);
      for (const b of slots.slice(i + 1)) assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) >= 46, `${a} ~ ${b}`);
      assert.ok(Math.hypot(a[0] - PEOPLE_SPOTS.more[0], a[1] - PEOPLE_SPOTS.more[1]) >= 40, `more ~ ${a}`);
    }
  });

  test('person pills: always in the balance view; in the garden view with room or up to three people', () => {
    assert.equal(showPeoplePills('balance', 5, false), true);
    assert.equal(showPeoplePills('garden', 3, false), true);
    assert.equal(showPeoplePills('garden', 4, false), false);
    assert.equal(showPeoplePills('garden', 5, true), true);
  });
});

describe('layoutLabels', () => {
  const bounds: Box = { x: 0, y: 0, w: 300, h: 200 };
  const req = (id: string, cx: number, cy: number, extra: Partial<LabelRequest> = {}): LabelRequest => ({
    id, cx, cy, w: 80, h: 20, reach: 60, required: true, ...extra,
  });

  test('free labels stay at their anchor', () => {
    const out = layoutLabels([req('a', 60, 40), req('b', 220, 160)], [], bounds);
    assert.deepEqual(out.get('a'), { x: 20, y: 30, w: 80, h: 20 });
    assert.deepEqual(out.get('b'), { x: 180, y: 150, w: 80, h: 20 });
  });

  test('no two placed labels overlap (gap kept), obstacles are avoided, all inside the bounds', () => {
    const requests = Array.from({ length: 8 }, (_, i) => req(`l${i}`, 150 + (i % 2) * 10, 100 + (i % 3) * 4, { reach: 120, required: false }));
    const obstacle: Box = { x: 130, y: 80, w: 40, h: 40 };
    const out = layoutLabels(requests, [obstacle], bounds, { gap: 3 });
    const boxes = [...out.values()].filter((b): b is Box => b !== null);
    assert.ok(boxes.length >= 6, `${boxes.length} placed`);
    for (const [i, a] of boxes.entries()) {
      assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= 300 && a.y + a.h <= 200, 'inside');
      assert.ok(!boxesOverlap(a, obstacle, 3), 'obstacle');
      for (const b of boxes.slice(i + 1)) assert.ok(!boxesOverlap(a, b, 3), `${JSON.stringify(a)} ~ ${JSON.stringify(b)}`);
    }
  });

  test('prefers a vertical move over a horizontal one', () => {
    const out = layoutLabels([req('a', 150, 100), req('b', 150, 100)], [], bounds);
    const b = out.get('b');
    assert.ok(b && b.x === 110 && b.y !== 90);
  });

  test('a label near the edge moves inside the bounds', () => {
    const out = layoutLabels([req('edge', 290, 5)], [], bounds);
    assert.deepEqual(out.get('edge'), { x: 220, y: 0, w: 80, h: 20 });
  });

  test('without room: an optional label is hidden, a required one keeps its place', () => {
    const wall: Box[] = [{ x: 0, y: 0, w: 300, h: 200 }];
    const out = layoutLabels([req('opt', 150, 100, { required: false }), req('req', 150, 100)], wall, bounds);
    assert.equal(out.get('opt'), null);
    assert.deepEqual(out.get('req'), { x: 110, y: 90, w: 80, h: 20 });
  });

  test('reach limits how far a label wanders', () => {
    const block: Box[] = [{ x: 60, y: 40, w: 180, h: 120 }];
    const near = layoutLabels([req('a', 150, 100, { reach: 20, required: false })], block, bounds);
    assert.equal(near.get('a'), null);
    const far = layoutLabels([req('a', 150, 100, { reach: 80, required: false })], block, bounds);
    assert.ok(far.get('a'));
  });
});

describe('sproutFigure', () => {
  test('shape tells the state (leaves up and a smile vs drooping leaves), no style attributes', () => {
    const fresh = sproutFigure('#E8963E', 'fresh');
    const due = sproutFigure('#E8963E', 'due');
    assert.notEqual(fresh, due);
    assert.match(fresh, /q2 2 4 0/u);
    assert.match(due, /h3\.4/u);
    for (const svg of [fresh, due]) {
      assert.doesNotMatch(svg, /style=|<style|filter|\sid=/u);
      assert.match(svg, /aria-hidden="true"/u);
    }
  });
  test('unsafe colours fall back to a safe tint', () => {
    assert.doesNotMatch(sproutFigure('red;x', 'fresh'), /red;x/u);
  });
});
