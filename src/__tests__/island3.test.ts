// Garten-Insel (Teil 3): milestone detection (tiers, weekday and weekly routines, bloom, earned days), the
// live and backfill plans (permanence, taking back a change), merge and validation of the milestones table,
// the evening question (joy entry detection, fire state), the celebration sentences and the island artwork.
// Runs against the tsc output (npm test); scripts/run-tests.mjs sets TZ=Europe/Berlin.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { islandSvg, traceGlyph, type IslandArea } from '../components/island.js';
import type { Day, FlowerId, Habit, HabitLog, HabitSchedule, Milestone, Stage } from '../model.js';
import { bloomCount, reachedOn, streak } from '../services/growth.js';
import { fireState, hasJoyEntry, joyEntry } from '../services/island.js';
import {
  earnedFromHistory, mergeMilestones, milestoneId, milestoneLine, mostNotable, newestFirst, planMilestones, traceTier,
} from '../services/milestones.js';
import { ImportError, validateExport } from '../services/transfer.js';
import { addDays } from '../util/date.js';

process.env.TZ = 'Europe/Berlin';

const TODAY: Day = '2026-10-13'; // a Tuesday

const habit = (id: string, schedule: HabitSchedule, extra: Partial<Habit> = {}): Habit => ({
  id, name: id, schedule, period: 'any', startDay: '2025-01-01', archived: 0, sortKey: 'V', updatedAt: '2025-01-01T00:00:00.000Z', ...extra,
});
const log = (habitId: string, day: Day, status: HabitLog['status'] = 'done'): HabitLog => ({ id: `${habitId}:${day}`, habitId, day, status, loggedAt: `${day}T08:00:00.000Z` });
/** Done logs on the n days ending `endAgo` days before today. */
const run = (habitId: string, n: number, endAgo = 0): HabitLog[] => Array.from({ length: n }, (_, i) => log(habitId, addDays(TODAY, -(endAgo + i))));
const daily = habit('d', { kind: 'daily', interval: 1 }, { areaId: 'health' });
const kinds = (list: ReadonlyArray<{ kind: string }>): string[] => list.map((m) => m.kind).sort();

describe('milestone detection (tiers in the unit of the routine card)', () => {
  test('daily: 7, 30 and 100 days in a row, each with the day it was first reached', () => {
    assert.deepEqual(earnedFromHistory(daily, run('d', 6), TODAY), []);
    const seven = earnedFromHistory(daily, run('d', 7), TODAY);
    assert.deepEqual(seven, [{ kind: 'streak7', day: TODAY }]);
    const long = earnedFromHistory(daily, run('d', 100, 5), TODAY);
    assert.deepEqual(kinds(long), ['bloom', 'streak100', 'streak30', 'streak7']);
    const start = addDays(TODAY, -104);
    assert.equal(long.find((m) => m.kind === 'streak7')?.day, addDays(start, 6));
    assert.equal(long.find((m) => m.kind === 'bloom')?.day, addDays(start, 13));
    assert.equal(long.find((m) => m.kind === 'streak30')?.day, addDays(start, 29));
    assert.equal(long.find((m) => m.kind === 'streak100')?.day, addDays(TODAY, -5));
  });

  test('a gap breaks the run, a skipped day bridges it (as streak() does)', () => {
    const broken = [...run('d', 4, 0), ...run('d', 4, 5)];
    assert.deepEqual(earnedFromHistory(daily, broken, TODAY), []);
    const bridged = [...run('d', 4, 0), log('d', addDays(TODAY, -4), 'skipped'), ...run('d', 3, 5)];
    assert.equal(streak(daily, bridged, TODAY), 7);
    assert.deepEqual(kinds(earnedFromHistory(daily, bridged, TODAY)), ['streak7']);
  });

  test('a run that ended long ago still counts (best streak, history)', () => {
    const old = earnedFromHistory(daily, run('d', 15, 60), TODAY);
    assert.deepEqual(kinds(old), ['bloom', 'streak7']);
    assert.equal(streak(daily, run('d', 15, 60), TODAY), 0);
  });

  test('weekday routine (Mon and Thu): counts scheduled days in a row, like "Tage in Folge" on its card', () => {
    const monThu = habit('w', { kind: 'weekly', interval: 1, weekdays: [1, 4] });
    const days: HabitLog[] = [];
    // The last 7 Mondays and Thursdays up to today (Tuesday 13.10.): Mon 21.09. … Mon 12.10.
    for (let back = 0, n = 0; n < 7; back++) {
      const day = addDays(TODAY, -back);
      const wd = new Date(`${day}T12:00:00`).getDay();
      if (wd === 1 || wd === 4) {
        days.push(log('w', day));
        n++;
      }
    }
    assert.equal(streak(monThu, days, TODAY), 7);
    const earned = earnedFromHistory(monThu, days, TODAY);
    assert.deepEqual(kinds(earned), ['streak7']);
    assert.equal(earned[0]?.day, '2026-10-12');
    // Logs on other weekdays do not count.
    assert.deepEqual(earnedFromHistory(monThu, run('w', 6, 1).filter((l) => ![1, 4].includes(new Date(`${l.day}T12:00:00`).getDay())), TODAY), []);
  });

  test('x-mal pro Woche counts fulfilled ISO weeks: 7 weeks → lantern, 4 weeks → bloom; day = the week\'s fulfilling log', () => {
    const twice = habit('t', { kind: 'timesPerWeek', times: 2 });
    assert.equal(bloomCount(twice), 4);
    assert.equal(bloomCount(daily), 14);
    const logs: HabitLog[] = [];
    // Seven full weeks before the current one (Mon 05.10. … ), two logs each on Tuesday and Friday.
    for (let w = 1; w <= 7; w++) {
      const monday = addDays('2026-10-12', -7 * w);
      logs.push(log('t', addDays(monday, 1)), log('t', addDays(monday, 4)));
    }
    const earned = earnedFromHistory(twice, logs, TODAY);
    assert.deepEqual(kinds(earned), ['bloom', 'streak7']);
    // Weeks from Mon 24.08.; the 4th starts 14.09., its 2nd log is Friday 18.09.
    assert.equal(earned.find((m) => m.kind === 'bloom')?.day, '2026-09-18');
    // The 7th week: Mon 05.10., fulfilled Friday 09.10.
    assert.equal(earned.find((m) => m.kind === 'streak7')?.day, '2026-10-09');
    // One log a week is not enough.
    assert.deepEqual(earnedFromHistory(twice, logs.filter((_, i) => i % 2 === 0), TODAY), []);
  });

  test('reachedOn returns null for counts never reached', () => {
    assert.deepEqual(reachedOn(daily, run('d', 3), TODAY, [1, 3, 4]), [addDays(TODAY, -2), TODAY, null]);
    assert.deepEqual(reachedOn(daily, [], TODAY, [1]), [null]);
  });
});

describe('planMilestones (live sync and backfill)', () => {
  const stored = (kind: Milestone['kind'], earnedOn: Day, habitId = 'd'): Milestone => ({ id: milestoneId(habitId, kind), kind, habitId, areaId: 'health', earnedOn });

  test('backfill adds what the history supports, with area and day; nothing twice', () => {
    const plan = planMilestones(daily, run('d', 15, 20), [], TODAY, { kind: 'backfill' });
    assert.deepEqual(plan.add.map((m) => m.id).sort(), ['d:bloom', 'd:streak7']);
    assert.ok(plan.add.every((m) => m.areaId === 'health' && m.habitId === 'd'));
    assert.deepEqual(plan.remove, []);
    const again = planMilestones(daily, run('d', 15, 20), plan.add, TODAY, { kind: 'backfill' });
    assert.deepEqual(again.add, []);
    const noArea = planMilestones(habit('x', { kind: 'daily', interval: 1 }), run('x', 7), [], TODAY, { kind: 'backfill' });
    assert.equal('areaId' in (noArea.add[0] ?? {}), false);
  });

  test('watering the 7th day earns the lantern today; taking it back removes it again', () => {
    const live = planMilestones(daily, run('d', 7), [], TODAY, { kind: 'live', changedDay: TODAY });
    assert.deepEqual(live.add.map((m) => `${m.kind}@${m.earnedOn}`), [`streak7@${TODAY}`]);
    const undo = planMilestones(daily, run('d', 6, 1), live.add, TODAY, { kind: 'live', changedDay: TODAY });
    assert.deepEqual(undo.remove, ['d:streak7']);
    assert.deepEqual(undo.add, []);
  });

  test('permanent: a broken streak never removes a milestone; only a change on or before its day does', () => {
    const earlier = [stored('streak7', '2026-09-01'), stored('bloom', '2026-09-08')];
    // History today no longer shows the run (e.g. logs of that time were never there in this test), but the
    // change happened today: earlier milestones stay.
    assert.deepEqual(planMilestones(daily, run('d', 2), earlier, TODAY, { kind: 'live', changedDay: TODAY }).remove, []);
    assert.deepEqual(planMilestones(daily, run('d', 2), earlier, TODAY, { kind: 'backfill' }).remove, []);
    // A heatmap change on 05.09. that breaks the run removes the bloom reached after it, not the lantern before.
    assert.deepEqual(planMilestones(daily, run('d', 2), earlier, TODAY, { kind: 'live', changedDay: '2026-09-05' }).remove, ['d:bloom']);
  });

  test('other routines are left alone', () => {
    const other = stored('streak7', TODAY, 'o');
    assert.deepEqual(planMilestones(daily, [], [other], TODAY, { kind: 'live', changedDay: TODAY }).remove, []);
  });
});

describe('traces, celebration and order', () => {
  const m = (kind: Milestone['kind'], earnedOn: Day, habitId = 'h'): Milestone => ({ id: milestoneId(habitId, kind), kind, habitId, earnedOn });

  test('traceTier: highest streak tier, bloom does not count', () => {
    assert.equal(traceTier([]), 0);
    assert.equal(traceTier(['bloom']), 0);
    assert.equal(traceTier(['streak7', 'bloom']), 1);
    assert.equal(traceTier(['streak7', 'streak30']), 2);
    assert.equal(traceTier(['streak100', 'streak7']), 3);
  });

  test('sentences name the place', () => {
    assert.equal(milestoneLine('streak7', 'health'), 'Eine Laterne leuchtet jetzt am Teich.');
    assert.equal(milestoneLine('bloom', 'wealth'), 'Am Brunnen wächst ein blühender Strauch.');
    assert.equal(milestoneLine('streak30', 'bonds'), 'Eine Steinbank steht jetzt am großen Baum.');
    assert.equal(milestoneLine('streak100', 'extra'), 'Ein kleiner Pavillon steht jetzt am Blumenbeet.');
  });

  test('most notable first (higher tier before bloom), newest first for the Rückblick', () => {
    assert.equal(mostNotable([m('bloom', TODAY), m('streak7', TODAY), m('streak30', TODAY, 'g')])?.kind, 'streak30');
    assert.deepEqual(newestFirst([m('streak7', '2026-09-01'), m('bloom', '2026-10-01'), m('streak30', '2026-09-20')]).map((x) => x.kind), ['bloom', 'streak30', 'streak7']);
  });
});

describe('transfer: milestones table', () => {
  const TABLES = ['profile', 'areas', 'projects', 'tasks', 'habits', 'habitLogs', 'notes', 'tags', 'moodLogs', 'dayPlans'];
  const file = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    format: 'olife', version: 1, exportedAt: '2026-10-01T10:00:00.000Z',
    tables: { ...Object.fromEntries(TABLES.map((name) => [name, []])), ...extra },
  });
  const ms = { id: 'h1:streak7', kind: 'streak7', habitId: 'h1', areaId: 'a1', earnedOn: '2026-09-30' };
  const rejects = (extra: Record<string, unknown>): void => {
    assert.throws(() => validateExport(file(extra)), ImportError);
  };

  test('older files without the table import it empty; valid rows pass, unknown fields are dropped', () => {
    assert.deepEqual(validateExport(file()).tables.milestones, []);
    const { tables } = validateExport(file({ milestones: [{ ...ms, extra: 1 }, { id: 'h2:bloom', kind: 'bloom', habitId: 'h2', earnedOn: '2026-10-01' }] }));
    assert.deepEqual(tables.milestones[0], ms);
    assert.equal(tables.milestones[1] && 'areaId' in tables.milestones[1], false);
  });

  test('kind from the union, id = habitId:kind, valid day, no duplicates', () => {
    rejects({ milestones: [{ ...ms, kind: 'streak8', id: 'h1:streak8' }] });
    rejects({ milestones: [{ ...ms, id: 'h1:streak30' }] });
    rejects({ milestones: [{ ...ms, earnedOn: '2026-02-30' }] });
    rejects({ milestones: [{ ...ms, habitId: '' }] });
    rejects({ milestones: [ms, ms] });
    rejects({ milestones: {} });
  });

  test('merge: union by id, the earlier day wins, milestones of unknown routines are dropped', () => {
    const local: Milestone[] = [
      { id: 'h1:streak7', kind: 'streak7', habitId: 'h1', earnedOn: '2026-09-30' },
      { id: 'h1:bloom', kind: 'bloom', habitId: 'h1', earnedOn: '2026-09-01' },
    ];
    const incoming: Milestone[] = [
      { id: 'h1:streak7', kind: 'streak7', habitId: 'h1', earnedOn: '2026-09-20' },
      { id: 'h1:bloom', kind: 'bloom', habitId: 'h1', earnedOn: '2026-09-10' },
      { id: 'h2:streak30', kind: 'streak30', habitId: 'h2', earnedOn: '2026-08-01' },
      { id: 'zz:streak7', kind: 'streak7', habitId: 'zz', earnedOn: '2026-08-01' },
    ];
    const result = mergeMilestones([local[0], local[1], undefined, undefined], incoming, new Set(['h1', 'h2']));
    assert.deepEqual(result.put.map((x) => `${x.id}@${x.earnedOn}`), ['h1:streak7@2026-09-20', 'h2:streak30@2026-08-01']);
    assert.deepEqual([result.created, result.updated, result.unchanged], [1, 1, 1]);
  });
});

describe('Abendfeuer: the evening question', () => {
  test('fire only from the evening on; asks while the entry is missing', () => {
    assert.equal(fireState('day', false), 'off');
    assert.equal(fireState('morning', false), 'off');
    assert.equal(fireState('evening', false), 'ask');
    assert.equal(fireState('night', false), 'ask');
    assert.equal(fireState('evening', true), 'done');
    assert.equal(fireState('evening', null), 'done');
  });

  test('the entry is found in the journal however it was edited', () => {
    assert.equal(joyEntry('  Sonne im Park '), 'Gefreut: Sonne im Park');
    assert.equal(hasJoyEntry(undefined), false);
    assert.equal(hasJoyEntry(''), false);
    assert.equal(hasJoyEntry('**08:10** Kaffee\n\n**19:30** Gefreut: Sonne im Park'), true);
    assert.equal(hasJoyEntry('Gefreut: direkt'), true);
    assert.equal(hasJoyEntry('Notiz\n- gefreut: klein geschrieben'), true);
    assert.equal(hasJoyEntry('> **Gefreut:** zitiert und fett'), true);
    assert.equal(hasJoyEntry('  1. Gefreut: in einer Liste'), true);
    assert.equal(hasJoyEntry('Ich habe mich gefreut: im Satz zählt nicht'), false);
    assert.equal(hasJoyEntry('**19:30** Heute nicht'), false);
  });
});

describe('island artwork with fire and traces', () => {
  const area = (flower: FlowerId, extra: Partial<IslandArea> = {}): IslandArea => ({
    lvl: 3, flower, tint: '#C96A5A', plants: ([4, 4, 4, 4, 4, 4] as Stage[]).map((stage, i) => ({ stage, wet: i % 2 === 0 })), more: 0, ...extra,
  });
  const worst = (extra: Partial<IslandArea>): Record<string, IslandArea> => ({
    home: area('leucanthemum', extra), work: area('centaurea', extra), bonds: area('helianthus', extra), health: area('bellis', extra),
    wealth: area('calendula', extra), leisure: area('matricaria', extra), growth: area('passiflora', extra),
  });

  test('the campfire is always drawn (CSS shows it from the evening on)', () => {
    const svg = islandSvg({ areas: {}, extra: null, decor: 'low', prefix: 'f-' });
    assert.match(svg, /class="i-fire"/u);
    assert.match(svg, /class="i-flame"/u);
    assert.match(svg, /url\(#f-g-fire\)/u);
  });

  test('one object per place (highest tier) and up to three shrubs; symbols only when used', () => {
    const plain = islandSvg({ areas: { health: area('bellis') }, extra: null, decor: 'low', prefix: 'p-' });
    assert.doesNotMatch(plain, /id="p-(lan|ben|pav|shr)"/u);
    const svg = islandSvg({ areas: { health: area('bellis', { trace: 2, shrubs: 5, arrive: 1 }) }, extra: null, decor: 'low', prefix: 'p-' });
    assert.equal((svg.match(/href="#p-ben"/gu) ?? []).length, 1);
    assert.doesNotMatch(svg, /href="#p-(lan|pav)"/u);
    assert.equal((svg.match(/href="#p-shr"/gu) ?? []).length, 3);
    assert.equal((svg.match(/class="i-arrive"/gu) ?? []).length, 1);
    assert.match(svg, /id="p-ben"/u);
  });

  test('worst case stays below 80 KB, ids prefixed and resolvable, no style, no filters', () => {
    const extra = { trace: 3 as const, shrubs: 3 };
    const svg = islandSvg({ areas: worst(extra), extra: area('generic', extra), decor: 'lush', prefix: 'w-' });
    assert.ok(svg.length < 80_000, `${svg.length} bytes`);
    assert.doesNotMatch(svg, /style=|<style|filter/u);
    const ids = [...svg.matchAll(/\sid="([^"]+)"/gu)].map((m) => m[1] ?? '');
    const refs = [...svg.matchAll(/(?:href="#|url\(#)([^")]+)/gu)].map((m) => m[1] ?? '');
    for (const ref of refs) assert.ok(ids.includes(ref), `dangling reference ${ref}`);
    assert.equal((svg.match(/href="#w-pav"/gu) ?? []).length, 8);
  });

  test('glyphs for the Rückblick are small aria-hidden SVGs with a sanitised tint', () => {
    for (const kind of ['streak7', 'streak30', 'streak100', 'bloom'] as const) {
      const svg = traceGlyph(kind, '#5B7FB5');
      assert.match(svg, /^<svg class="ol-trace-glyph"[^>]*aria-hidden="true"/u);
      assert.doesNotMatch(svg, /style=/u);
    }
    assert.doesNotMatch(traceGlyph('streak7', '"><script>'), /<script/u);
  });
});
