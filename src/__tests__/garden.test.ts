// Gestalten und Aufträge (services/garden.ts, island drawing, import check): seeds, free places, the week's tasks.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { islandSvg } from '../components/island.js';
import {
  freeSlots, ISLET_PRICE, ITEMS, questsDone, seedCount, seedsSpent, weekQuests, type QuestHistory,
} from '../services/garden.js';
import { parseImport } from '../services/transfer.js';
import { addDays } from '../util/date.js';

const EMPTY: QuestHistory = {
  doneLogs: [], allDoneDays: [], taskDays: [], noteDays: [], joyDays: [], moodDays: [], contactDays: [],
  firstHabit: null, firstTask: null, firstContact: null,
};
const days = (from: string, n: number): string[] => Array.from({ length: n }, (_, i) => addDays(from, i));
const MONDAY = '2026-11-02';

describe('seeds', () => {
  test('earned from the history, spent on the garden, never below zero', () => {
    const c = seedCount({ waterings: 20, tasks: 5, joys: 2, traces: 1, quests: 1 }, { placed: { lantern: 'a', jetty: 'pond' } });
    assert.equal(c.earned, 20 + 5 + 4 + 5 + 10);
    assert.equal(c.spent, 8 + 20);
    assert.equal(c.balance, 44 - 28);
    assert.equal(seedCount({ waterings: 2, tasks: 0, joys: 0, traces: 0, quests: 0 }, { placed: { bench: 'b' } }).balance, 0);
    assert.equal(seedsSpent({ islet: 1 }), ISLET_PRICE);
    assert.deepEqual(ITEMS.map((i) => i.price), [8, 10, 12, 15, 18, 20]);
  });
  test('free places: the jetty only at the pond, side island places only once bought, moving keeps its own place', () => {
    assert.deepEqual(freeSlots('jetty', {}), ['pond']);
    assert.deepEqual(freeSlots('lantern', {}), ['a', 'b', 'c', 'd', 'e', 'f']);
    assert.deepEqual(freeSlots('lantern', { islet: 1, placed: { bench: 'a' } }), ['b', 'c', 'd', 'e', 'f', 'i1', 'i2', 'i3']);
    assert.deepEqual(freeSlots('bench', { placed: { bench: 'a' } }), ['a', 'b', 'c', 'd', 'e', 'f']);
    assert.deepEqual(freeSlots('jetty', { placed: { jetty: 'pond' } }), ['pond']);
  });
});

describe('Keimis Aufträge', () => {
  test('three per week, stable, fitting what is used', () => {
    const q = weekQuests(EMPTY, MONDAY, MONDAY);
    assert.equal(q.length, 3);
    // Without routines, tasks or people only the open tasks remain.
    for (const x of q) assert.ok(['note1', 'joy2', 'mood3'].includes(x.id), x.id);
    assert.deepEqual(weekQuests(EMPTY, MONDAY, MONDAY), q);
    const all = { ...EMPTY, firstHabit: '2026-10-01', firstTask: '2026-10-01', firstContact: '2026-10-01' };
    const ids = new Set<string>();
    for (let w = 0; w < 12; w++) for (const x of weekQuests(all, addDays(MONDAY, 7 * w), addDays(MONDAY, 7 * w))) ids.add(x.id);
    assert.ok(ids.has('contact1') && ids.has('water5') && ids.has('tasks5'), [...ids].join());
  });
  test('a contact task only once people exist by the end of that week', () => {
    for (let w = 0; w < 20; w++) {
      const monday = addDays(MONDAY, 7 * w);
      const qs = weekQuests({ ...EMPTY, firstHabit: '2026-10-01', firstContact: '2027-06-01' }, monday, monday);
      assert.ok(!qs.some((x) => x.id === 'contact1'), monday);
    }
  });
  test('progress inside the week only; morning run needs consecutive mornings', () => {
    const h: QuestHistory = {
      ...EMPTY, firstHabit: '2026-10-01', firstTask: '2026-10-01', firstContact: '2026-10-01',
      doneLogs: [
        { day: '2026-11-01', hour: 8 }, { day: '2026-11-02', hour: 8 }, { day: '2026-11-03', hour: 9 }, { day: '2026-11-04', hour: 15 },
        { day: '2026-11-05', hour: 7 }, { day: '2026-11-06', hour: 7 },
      ],
      taskDays: ['2026-11-02', '2026-11-03', '2026-11-03'],
      noteDays: ['2026-11-04'], joyDays: ['2026-11-02', '2026-11-09'], moodDays: ['2026-11-02', '2026-11-02'],
    };
    // Whatever three tasks this week picked: progress counts only 2–8 November (the 1st and 9th fall outside).
    const expect: Record<string, number> = { water5: 5, morning3: 2, tasks5: 3, note1: 1, joy2: 1, mood3: 1, contact1: 0, allDone2: 0 };
    const picked = weekQuests(h, MONDAY, '2026-11-08');
    assert.equal(picked.length, 3);
    for (const x of picked) assert.equal(x.progress, expect[x.id], x.id);
  });
  test('fulfilled tasks over the weeks count for seeds', () => {
    const h: QuestHistory = {
      ...EMPTY, firstHabit: '2026-10-05',
      noteDays: days('2026-10-05', 42), joyDays: days('2026-10-05', 42), moodDays: days('2026-10-05', 42),
      doneLogs: days('2026-10-05', 42).map((day) => ({ day, hour: 8 })), allDoneDays: days('2026-10-05', 42),
    };
    // Six full weeks where every fitting task is fulfilled (no tasks or people: three water/note/joy/mood picks).
    assert.equal(questsDone(h, '2026-11-15'), 6 * 3);
  });
});

describe('island and import', () => {
  test('placed things, the side island, the preview and the reward moment are drawn', () => {
    const svg = islandSvg({
      areas: {}, extra: null, decor: 'low', prefix: 'p-',
      garden: { islet: true, placed: [{ item: 'lantern', slot: 'a' }, { item: 'windmill', slot: 'i1' }], ghost: { item: 'bench', slot: 'b' }, arrive: 'windmill' },
    });
    assert.match(svg, /data-item="lantern"/u);
    assert.match(svg, /class="i-islet"/u);
    assert.match(svg, /class="i-item i-ghost" data-item="bench"/u);
    assert.match(svg, /class="i-item i-arrive" data-item="windmill"/u);
    assert.match(svg, /class="i-fx"/u);
    assert.doesNotMatch(svg, /style=|§/u);
  });
  test('import keeps a valid garden and rejects broken ones', () => {
    const file = (garden: unknown): string => JSON.stringify({
      format: 'olife', version: 1, exportedAt: '2026-11-02T08:00:00.000Z',
      tables: {
        profile: [{ key: 'profile', settings: {}, onboardingDone: 1, createdAt: '2026-10-01T08:00:00.000Z', garden }],
        areas: [], projects: [], tasks: [], habits: [], habitLogs: [], notes: [], tags: [], moodLogs: [], dayPlans: [],
      },
    });
    const ok = parseImport(file({ islet: 1, placed: { lantern: 'i2', jetty: 'pond' } })) as unknown as { tables: { profile: Array<{ garden: unknown }> } };
    assert.deepEqual(ok.tables.profile[0]?.garden, { islet: 1, placed: { lantern: 'i2', jetty: 'pond' } });
    assert.throws(() => parseImport(file({ placed: { lantern: 'pond' } })));
    assert.throws(() => parseImport(file({ placed: { lantern: 'i1' } })));
    assert.throws(() => parseImport(file({ placed: { lantern: 'a', bench: 'a' } })));
    assert.throws(() => parseImport(file({ placed: { rocket: 'a' } })));
  });
});
