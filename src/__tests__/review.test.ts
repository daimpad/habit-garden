// Rückblick (H9): fulfilment, best streaks, weekday rhythm, mood trend, Sunday card.
// Runs against the tsc output (npm test); scripts/run-tests.mjs sets TZ=Europe/Berlin.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ContactLog, Day, Habit, HabitLog, HabitSchedule, MoodLog } from '../model.js';
import {
  bestStreaks, fulfilment, isoWeekUntil, lastDays, moodTrend, overallRate, percent, review, showWeekCard,
  weekdayRhythm, weekSummary, fulfilments,
} from '../services/review.js';
import { addDays } from '../util/date.js';

process.env.TZ = 'Europe/Berlin';

const habit = (schedule: HabitSchedule, startDay: Day = '2026-01-01', id = 'h1', extra: Partial<Habit> = {}): Habit => ({
  id, name: id, schedule, period: 'any', startDay, archived: 0, sortKey: 'V', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
});

const log = (day: Day, habitId = 'h1', status: HabitLog['status'] = 'done'): HabitLog => ({
  id: `${habitId}:${day}`, habitId, day, status, loggedAt: `${day}T08:00:00.000Z`,
});

const run = (from: Day, to: Day, habitId = 'h1'): HabitLog[] => {
  const out: HabitLog[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(log(d, habitId));
  return out;
};

const mood = (day: Day, value: MoodLog['value'], at = `${day}T20:00:00.000Z`): MoodLog => ({ id: `${day}:${at}`, day, value, loggedAt: at });

const daily = habit({ kind: 'daily', interval: 1 });
// 2026-10-18 is a Sunday; the 30-day period up to it starts on Saturday 2026-09-19.
const SUNDAY: Day = '2026-10-18';

describe('periods', () => {
  test('last 30 days end today', () => {
    assert.deepEqual(lastDays(SUNDAY), { from: '2026-09-19', to: SUNDAY, days: 30 });
  });
  test('ISO week until today', () => {
    assert.deepEqual(isoWeekUntil(SUNDAY), { from: '2026-10-12', to: SUNDAY, days: 7 });
    assert.deepEqual(isoWeekUntil('2026-10-12'), { from: '2026-10-12', to: '2026-10-12', days: 1 });
  });
  test('a period across the DST change (2026-10-25) keeps whole days', () => {
    const p = lastDays('2026-10-31', 14);
    assert.equal(p.from, '2026-10-18');
    const f = fulfilment(daily, run('2026-10-18', '2026-10-31'), p);
    assert.deepEqual([f.done, f.target, f.rate], [14, 14, 1]);
  });
});

describe('fulfilment', () => {
  const period = lastDays(SUNDAY);

  test('daily: done days over scheduled days; open today does not count', () => {
    const logs = run('2026-09-19', '2026-10-02'); // 14 of 29 past days, today open
    const f = fulfilment(daily, logs, period);
    assert.deepEqual([f.done, f.target], [14, 29]);
    assert.equal(percent(f.rate), 48);
    const withToday = fulfilment(daily, [...logs, log(SUNDAY)], period);
    assert.deepEqual([withToday.done, withToday.target], [15, 30]);
  });

  test('created mid-period: only days since startDay', () => {
    const late = habit({ kind: 'daily', interval: 1 }, '2026-10-12');
    const f = fulfilment(late, run('2026-10-12', '2026-10-17'), period);
    assert.deepEqual([f.done, f.target, f.rate], [6, 6, 1]);
  });

  test('startDay in the future or created today without log: no opportunity, rate null', () => {
    assert.equal(fulfilment(habit({ kind: 'daily', interval: 1 }, SUNDAY), [], period).rate, null);
    assert.equal(fulfilment(habit({ kind: 'daily', interval: 1 }, '2026-11-01'), [], period).target, 0);
  });

  test('weekly weekdays and daily intervals count only scheduled days', () => {
    const mwf = habit({ kind: 'weekly', interval: 1, weekdays: [1, 3, 5] }, '2026-09-28');
    // Mon 28.9. … Fri 16.10.: 9 scheduled days; done on 3 of them plus a Tuesday (not scheduled).
    const f = fulfilment(mwf, [log('2026-09-28'), log('2026-09-30'), log('2026-10-02'), log('2026-09-29')], period);
    assert.deepEqual([f.done, f.target], [3, 9]);
    const every2 = habit({ kind: 'daily', interval: 2 }, '2026-10-01'); // 1., 3., … 17.: 9 days
    assert.equal(fulfilment(every2, [], period).target, 9);
  });

  test('skipped days are no opportunity', () => {
    const f = fulfilment(daily, [log('2026-10-16', 'h1', 'skipped'), log('2026-10-17')], lastDays('2026-10-17', 3));
    assert.deepEqual([f.done, f.target, f.rate], [1, 2, 0.5]);
  });

  test('timesPerWeek: full weeks credit up to the target, cut weeks pro rata', () => {
    const tpw = habit({ kind: 'timesPerWeek', times: 3 }, '2026-01-01');
    const week = isoWeekUntil(SUNDAY);
    // Five done in the week: credited 3 of 3.
    const five = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].map((d) => log(d));
    const full = fulfilment(tpw, [...five, log(SUNDAY)], week);
    assert.equal(full.done, 6);
    assert.equal(full.target, 3);
    assert.equal(full.rate, 1);
    // Today open: six eligible days, target 18/7, still fulfilled.
    const open = fulfilment(tpw, five, week);
    assert.ok(Math.abs(open.target - 18 / 7) < 1e-9);
    assert.equal(open.rate, 1);
    // One done in a full week: 1/3.
    assert.ok(Math.abs((fulfilment(tpw, [log('2026-10-13'), log(SUNDAY, 'other')], week).rate ?? 0) - (1 / 3) * (7 / 6)) < 1e-9);
  });

  test('archived habits are left out', () => {
    const archived = habit({ kind: 'daily', interval: 1 }, '2026-01-01', 'a', { archived: 1 });
    const list = fulfilments([daily, archived], new Map([['h1', run('2026-09-19', SUNDAY)], ['a', run('2026-09-19', SUNDAY, 'a')]]), period);
    assert.equal(list.length, 1);
    assert.equal(overallRate(list), 1);
  });

  test('overall rate weights by opportunities; no habits gives null', () => {
    const other = habit({ kind: 'daily', interval: 1 }, '2026-10-15', 'h2');
    const logs = new Map([['h1', run('2026-09-19', '2026-10-17')], ['h2', [] as HabitLog[]]]);
    const list = fulfilments([daily, other], logs, period);
    // 29 of 29 plus 0 of 3.
    assert.equal(percent(overallRate(list)), Math.round((29 / 32) * 100));
    assert.equal(overallRate([]), null);
  });
});

describe('best streaks', () => {
  test('longest first, stage of the best run, weeks compared as 7 days', () => {
    const a = habit({ kind: 'daily', interval: 1 }, '2026-01-01', 'a');
    const b = habit({ kind: 'daily', interval: 1 }, '2026-01-01', 'b');
    const w = habit({ kind: 'timesPerWeek', times: 1 }, '2026-01-05', 'w');
    const logs = new Map<string, HabitLog[]>([
      ['a', run('2026-10-01', '2026-10-03', 'a')], // 3 days → stage 2
      ['b', [...run('2026-09-01', '2026-09-14', 'b'), ...run('2026-10-10', '2026-10-11', 'b')]], // best 14 → stage 4
      ['w', [log('2026-09-28', 'w'), log('2026-10-06', 'w')]], // 2 weeks → span 14, stage 2
    ]);
    const list = bestStreaks([a, b, w], logs, SUNDAY);
    assert.deepEqual(list.map((s) => [s.habit.id, s.best, s.unit, s.stage]), [
      ['b', 14, 'days', 4], ['w', 2, 'weeks', 2], ['a', 3, 'days', 2],
    ]);
  });
});

describe('weekday rhythm', () => {
  test('averages per weekday occurrence, contacts count, best day', () => {
    const period = lastDays(SUNDAY); // Sat 19.9. … Sun 18.10.: Sat and Sun occur 5 times, others 4
    const logs = new Map([['h1', [log('2026-10-13'), log('2026-10-06'), log('2026-09-29'), log('2026-10-17')]]]);
    const contacts: ContactLog[] = [
      { id: 'c:2026-10-13', contactId: 'c', day: '2026-10-13', loggedAt: '2026-10-13T10:00:00.000Z' },
      { id: 'c:2026-08-01', contactId: 'c', day: '2026-08-01', loggedAt: '2026-08-01T10:00:00.000Z' },
    ];
    const r = weekdayRhythm([daily], logs, period, contacts);
    assert.deepEqual(r.days.map((d) => d.occurrences), [4, 4, 4, 4, 4, 5, 5]);
    assert.equal(r.days[1]?.total, 4); // Tuesday: three routine days plus one contact
    assert.equal(r.days[1]?.average, 1);
    assert.equal(r.days[5]?.average, 1 / 5);
    assert.equal(r.best, 2);
  });
  test('nothing done: no best day', () => {
    assert.equal(weekdayRhythm([daily], new Map(), lastDays(SUNDAY)).best, null);
  });
});

describe('mood trend', () => {
  test('one value per day (newest wins), averages, halves and trend', () => {
    const period = lastDays(SUNDAY, 10); // 9. … 18.10., halves 9.–13. and 14.–18.
    const moods = [
      mood('2026-10-09', 2), mood('2026-10-10', 2), mood('2026-10-11', 3),
      mood('2026-10-15', 4), mood('2026-10-16', 4), mood('2026-10-16', 5, '2026-10-16T21:00:00.000Z'), mood('2026-10-18', 4),
      mood('2026-09-01', 1),
    ];
    const m = moodTrend(moods, period);
    assert.equal(m.points.length, 10);
    assert.equal(m.points.find((p) => p.day === '2026-10-16')?.value, 5);
    assert.equal(m.points.find((p) => p.day === '2026-10-12')?.value, null);
    assert.equal(m.count, 6);
    assert.equal(m.average, (2 + 2 + 3 + 4 + 5 + 4) / 6);
    assert.equal(m.firstHalf, 7 / 3);
    assert.equal(m.secondHalf, 13 / 3);
    assert.equal(m.trend, 'up');
    assert.deepEqual(m.counts, [0, 2, 1, 2, 1]);
    assert.equal(m.most, 4);
  });
  test('no entries', () => {
    const m = moodTrend([], lastDays(SUNDAY));
    assert.deepEqual([m.count, m.average, m.trend, m.most], [0, null, null, null]);
  });
});

describe('summaries', () => {
  test('review without habits', () => {
    const r = review({ habits: [], logs: new Map(), moods: [], today: SUNDAY });
    assert.deepEqual([r.active, r.rate, r.longest, r.rings.length, r.rhythm.best], [0, null, null, 0, null]);
  });
  test('week summary counts the ISO week until today', () => {
    const s = weekSummary([daily], new Map([['h1', run('2026-10-05', '2026-10-15')]]), SUNDAY);
    assert.deepEqual([s.done, s.routines], [4, 1]);
    assert.equal(percent(s.rate), 67); // 4 of 6 (today open)
  });
  test('Sunday card: Sundays only, hidden after dismissing in the same week', () => {
    assert.equal(showWeekCard(SUNDAY, undefined), true);
    assert.equal(showWeekCard('2026-10-17', undefined), false);
    assert.equal(showWeekCard(SUNDAY, SUNDAY), false);
    assert.equal(showWeekCard(SUNDAY, '2026-10-11'), true);
    assert.equal(showWeekCard('2026-10-25', SUNDAY), true);
  });
});
