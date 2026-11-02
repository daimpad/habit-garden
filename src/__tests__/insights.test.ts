// Einsichten (services/insights.ts): "Was dir guttut" and the Jahresgarten; the year-garden drawing.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { yearGardenSvg } from '../components/year-garden.js';
import type { Day, Habit, HabitLog, HabitSchedule, Milestone, MoodLog } from '../model.js';
import { insights, MIN_MOOD_DAYS, yearGarden } from '../services/insights.js';
import { addDays, isoWeekday } from '../util/date.js';

process.env.TZ = 'Europe/Berlin';

const habit = (schedule: HabitSchedule, id = 'h1', startDay: Day = '2026-01-01', extra: Partial<Habit> = {}): Habit => ({
  id, name: id === 'h1' ? 'Lesen' : id, schedule, period: 'any', startDay, archived: 0, sortKey: 'V', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
});
const log = (day: Day, habitId = 'h1'): HabitLog => ({ id: `${habitId}:${day}`, habitId, day, status: 'done', loggedAt: `${day}T08:00:00.000Z` });
const mood = (day: Day, value: MoodLog['value']): MoodLog => ({ id: day, day, value, loggedAt: `${day}T20:00:00.000Z` });
const daily = habit({ kind: 'daily', interval: 1 });
const TODAY: Day = '2026-11-02';

describe('insights', () => {
  test('too few mood days: a hint how many are missing', () => {
    const moods = [mood(TODAY, 4), mood(addDays(TODAY, -1), 3)];
    const r = insights([daily], new Map([['h1', []]]), moods, TODAY);
    assert.equal(r.moodDays, 2);
    assert.match(r.hint ?? '', new RegExp(`${MIN_MOOD_DAYS - 2} Tagen`, 'u'));
    assert.ok(!r.items.some((i) => i.kind === 'mood'));
    const one = insights([daily], new Map([['h1', []]]), Array.from({ length: MIN_MOOD_DAYS - 1 }, (_, i) => mood(addDays(TODAY, -i), 3)), TODAY);
    assert.match(one.hint ?? '', /einem Tag/u);
  });

  test('better mood on watered days shows, worded as a connection', () => {
    const logs: HabitLog[] = [];
    const moods: MoodLog[] = [];
    for (let i = 0; i < 20; i++) {
      const day = addDays(TODAY, -i);
      const watered = i % 2 === 0;
      if (watered) logs.push(log(day));
      moods.push(mood(day, watered ? 4 : 3));
    }
    const r = insights([daily], new Map([['h1', logs]]), moods, TODAY);
    const m = r.items.find((i) => i.kind === 'mood');
    assert.ok(m && m.kind === 'mood');
    assert.equal(m.with, 4);
    assert.equal(m.without, 3);
    assert.equal(m.text, 'An Tagen mit Lesen ist deine Stimmung meist besser: im Schnitt 4,0 statt 3,0.');
    assert.equal(r.hint, null);
  });

  test('a small difference or a small group shows nothing', () => {
    const logs: HabitLog[] = [];
    const moods: MoodLog[] = [];
    for (let i = 0; i < 20; i++) {
      const day = addDays(TODAY, -i);
      if (i % 2 === 0) logs.push(log(day));
      moods.push(mood(day, 3));
    }
    assert.ok(!insights([daily], new Map([['h1', logs]]), moods, TODAY).items.some((i) => i.kind === 'mood'));
    // Watered on all but three days: the group without is too small.
    const most = moods.map((m) => m.day).filter((_, i) => i > 2).map((d) => log(d));
    assert.ok(!insights([daily], new Map([['h1', most]]), moods, TODAY).items.some((i) => i.kind === 'mood'));
  });

  test('the steadiest weekday when it stands out', () => {
    const logs: HabitLog[] = [];
    for (let i = 0; i < 90; i++) {
      const day = addDays(TODAY, -i);
      const w = isoWeekday(day);
      if (w === 2 || (w !== 2 && i % 3 === 0)) logs.push(log(day));
    }
    const r = insights([daily], new Map([['h1', logs]]), [], TODAY);
    const w = r.items.find((i) => i.kind === 'weekday');
    assert.ok(w && w.kind === 'weekday');
    assert.equal(w.weekday, 2);
    assert.equal(w.text, 'Dienstags gießt du am regelmäßigsten.');
    // Evenly watered: no weekday stands out.
    const even = Array.from({ length: 90 }, (_, i) => log(addDays(TODAY, -i)));
    assert.ok(!insights([daily], new Map([['h1', even]]), [], TODAY).items.some((i) => i.kind === 'weekday'));
  });

  test('archived routines and times-per-week rhythms are left out', () => {
    const archived = habit({ kind: 'daily', interval: 1 }, 'h2', '2026-01-01', { archived: 1 });
    const weekly = habit({ kind: 'timesPerWeek', times: 3 }, 'h3');
    const r = insights([archived, weekly], new Map(), [], TODAY);
    assert.deepEqual(r.items, []);
  });
});

describe('yearGarden', () => {
  test('twelve beds: rate per month, future months empty', () => {
    const logs = [log('2026-10-01'), log('2026-10-02'), ...Array.from({ length: 2 }, (_, i) => log(addDays('2026-11-01', i)))];
    const start = habit({ kind: 'daily', interval: 1 }, 'h1', '2026-10-01');
    const beds = yearGarden(2026, [start], new Map([['h1', logs]]), [], [], TODAY);
    assert.equal(beds.length, 12);
    assert.equal(beds[0]?.rate, null);
    assert.equal(beds[9]?.rate, 2 / 31);
    assert.equal(beds[10]?.rate, 1);
    assert.equal(beds[10]?.future, false);
    assert.equal(beds[11]?.future, true);
    assert.equal(beds[11]?.rate, null);
  });

  test('blooms, traces and visitors land in their month', () => {
    const ms: Milestone[] = [
      { id: 'h1:bloom', habitId: 'h1', kind: 'bloom', earnedOn: '2026-05-10' },
      { id: 'h1:streak7', habitId: 'h1', kind: 'streak7', earnedOn: '2026-05-03' },
      { id: 'h1:streak30', habitId: 'h1', kind: 'streak30', earnedOn: '2026-06-01' },
    ];
    const beds = yearGarden(2026, [daily], new Map([['h1', []]]), ms, ['2026-05-20', '2026-05-21', '2025-05-01'], TODAY);
    assert.deepEqual(beds[4]?.blooms, [{ habitId: 'h1', name: 'Lesen' }]);
    assert.equal(beds[4]?.traces, 1);
    assert.equal(beds[5]?.traces, 1);
    assert.equal(beds[4]?.visitors, 2);
  });

  test('the drawing is one standalone SVG with literal colours', () => {
    const svg = yearGardenSvg('Jahresgarten 2026', Array.from({ length: 12 }, (_, i) => ({
      label: `M${i}`, rate: i < 10 ? i / 10 : null, future: i >= 11, blooms: i === 3 ? [{ flower: 'bellis', tint: '#ccc' }] : [], traces: i === 4 ? 2 : 0, visitors: i === 5 ? 1 : 0,
    })));
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/u);
    assert.ok(svg.includes('Jahresgarten 2026'));
    assert.ok(!svg.includes('var('));
    assert.ok(!/style=/u.test(svg));
    assert.equal((svg.match(/>M\d+</gu) ?? []).length, 12);
    assert.ok(svg.length < 60_000);
    assert.ok(yearGardenSvg('<&>', []).includes('&lt;&amp;&gt;'));
  });
});
