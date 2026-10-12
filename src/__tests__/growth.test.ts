// F §4.12 mandatory cases plus the approved heatmap rule (Rückfrage 2), C.4 year change.
// Runs against the tsc output (npm test); scripts/run-tests.mjs sets TZ=Europe/Berlin.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Day, Habit, HabitLog, HabitSchedule } from '../model.js';
import {
  bestStreak, isScheduledOn, nextStage, stageAt, stageFor, stageForCount, streak, weekProgress,
} from '../services/growth.js';
import { addDays } from '../util/date.js';

process.env.TZ = 'Europe/Berlin';

const habit = (schedule: HabitSchedule, startDay: Day = '2025-01-01', id = 'h1'): Habit => ({
  id, name: 'Test', schedule, period: 'any', startDay, archived: 0, sortKey: 'V', updatedAt: '2025-01-01T00:00:00.000Z',
});

const log = (day: Day, status: HabitLog['status'] = 'done', habitId = 'h1'): HabitLog => ({
  id: `${habitId}:${day}`, habitId, day, status, loggedAt: `${day}T08:00:00.000Z`,
});

/** Done logs for every day from..to (inclusive). */
const run = (from: Day, to: Day): HabitLog[] => {
  const out: HabitLog[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(log(d));
  return out;
};

const daily = habit({ kind: 'daily', interval: 1 });
const twice = habit({ kind: 'daily', interval: 2 }, '2026-10-01');
const monWedFri = habit({ kind: 'weekly', interval: 1, weekdays: [1, 3, 5] }, '2026-09-28');
const thrice = habit({ kind: 'timesPerWeek', times: 3 }, '2025-01-01');

test('time zone is Europe/Berlin (CET winter, CEST summer)', () => {
  assert.equal(new Date(2026, 0, 15).getTimezoneOffset(), -60);
  assert.equal(new Date(2026, 6, 15).getTimezoneOffset(), -120);
  // 2026-03-29 has 23 hours, 2026-10-25 has 25 hours.
  assert.equal(new Date(2026, 2, 30).getTime() - new Date(2026, 2, 29).getTime(), 23 * 3_600_000);
  assert.equal(new Date(2026, 9, 26).getTime() - new Date(2026, 9, 25).getTime(), 25 * 3_600_000);
});

describe('no log', () => {
  test('streak 0, plant stage 0 (seed), heatmap 0', () => {
    assert.equal(streak(daily, [], '2026-10-11'), 0);
    assert.equal(stageFor(daily, [], '2026-10-11'), 0);
    assert.equal(stageAt(daily, [], '2026-10-11'), 0);
    assert.equal(bestStreak(daily, [], '2026-10-11'), 0);
    assert.equal(stageFor(thrice, [], '2026-10-11'), 0);
  });

  test('skipped logs alone and logs after today keep the seed', () => {
    assert.equal(stageFor(daily, [log('2026-10-10', 'skipped')], '2026-10-11'), 0);
    assert.equal(stageFor(daily, [log('2026-10-12')], '2026-10-11'), 0);
  });

  test("other habits' logs are ignored", () => {
    assert.equal(stageFor(daily, [log('2026-10-11', 'done', 'other')], '2026-10-11'), 0);
    assert.equal(streak(daily, [log('2026-10-11', 'done', 'other')], '2026-10-11'), 0);
  });
});

describe('daily streak', () => {
  test('across a month boundary', () => {
    const logs = run('2026-01-28', '2026-02-03');
    assert.equal(streak(daily, logs, '2026-02-03'), 7);
    assert.equal(stageFor(daily, logs, '2026-02-03'), 3);
    // Today not yet done: counting starts yesterday.
    assert.equal(streak(daily, logs, '2026-02-04'), 7);
    assert.equal(stageAt(daily, logs, '2026-01-31'), 2); // run of 4 days
  });

  test('across the spring DST change (2026-03-29, 23 h day)', () => {
    const logs = run('2026-03-27', '2026-03-31');
    assert.equal(streak(daily, logs, '2026-03-31'), 5);
    assert.equal(stageAt(daily, logs, '2026-03-29'), 2); // 27, 28, 29
    assert.deepEqual(weekProgress(daily, logs, '2026-03-29'), { done: 3, target: 7 });
    assert.equal(streak(daily, run('2026-03-20', '2026-04-05'), '2026-04-05'), 17);
  });

  test('across the autumn DST change (2026-10-25, 25 h day)', () => {
    const logs = run('2026-10-23', '2026-10-27');
    assert.equal(streak(daily, logs, '2026-10-27'), 5);
    assert.equal(streak(daily, logs, '2026-10-28'), 5);
    assert.equal(stageFor(daily, logs, '2026-10-27'), 2);
    assert.equal(stageAt(daily, logs, '2026-10-25'), 2); // 23, 24, 25
    assert.equal(stageAt(daily, logs, '2026-10-26'), 2);
  });

  test('across the year change (C.4)', () => {
    const logs = run('2026-12-28', '2027-01-03');
    assert.equal(streak(daily, logs, '2027-01-03'), 7);
    assert.equal(stageFor(daily, logs, '2027-01-04'), 3);
  });

  test('streak break: plant falls to stage 1, heatmap shows 0 for yesterday', () => {
    const logs = run('2026-10-01', '2026-10-09'); // 10-10 missed, 10-11 not yet done
    assert.equal(streak(daily, logs, '2026-10-10'), 9); // yesterday still counts on 10-10
    assert.equal(stageFor(daily, logs, '2026-10-10'), 3);
    assert.equal(streak(daily, logs, '2026-10-11'), 0);
    assert.equal(stageFor(daily, logs, '2026-10-11'), 1);
    assert.equal(stageAt(daily, logs, '2026-10-10'), 0);
    assert.equal(stageAt(daily, logs, '2026-10-09'), 3);
    assert.equal(bestStreak(daily, logs, '2026-10-11'), 9);
  });

  test('13 → 14 days: stage 3 → 4', () => {
    const logs = run('2026-09-28', '2026-10-10');
    assert.equal(streak(daily, logs, '2026-10-11'), 13);
    assert.equal(stageFor(daily, logs, '2026-10-11'), 3);
    const after = [...logs, log('2026-10-11')];
    assert.equal(streak(daily, after, '2026-10-11'), 14);
    assert.equal(stageFor(daily, after, '2026-10-11'), 4);
    assert.equal(stageAt(daily, after, '2026-10-11'), 4);
    assert.equal(stageAt(daily, after, '2026-10-10'), 3);
  });

  test('skipped days are bridged: they neither break nor count', () => {
    const logs = [log('2026-10-05'), log('2026-10-06'), log('2026-10-07', 'skipped'), log('2026-10-08')];
    assert.equal(streak(daily, logs, '2026-10-08'), 3);
    assert.equal(streak(daily, [...logs, log('2026-10-09', 'skipped')], '2026-10-10'), 3);
    assert.equal(streak(daily, [...logs, log('2026-10-09', 'skipped')], '2026-10-09'), 3);
    assert.equal(stageAt(daily, logs, '2026-10-08'), 2);
    assert.equal(stageAt(daily, logs, '2026-10-07'), 0);
    assert.equal(bestStreak(daily, logs, '2026-10-08'), 3);
  });

  test('done wins over skipped for the same day', () => {
    assert.equal(streak(daily, [log('2026-10-11', 'skipped'), log('2026-10-11')], '2026-10-11'), 1);
  });

  test('logs after today are ignored', () => {
    const logs = run('2026-10-01', '2026-10-15');
    assert.equal(streak(daily, logs, '2026-10-10'), 10);
    assert.equal(bestStreak(daily, logs, '2026-10-10'), 10);
  });

  test('the run never extends before startDay', () => {
    const h = habit({ kind: 'daily', interval: 1 }, '2026-10-05');
    const logs = run('2026-10-01', '2026-10-08');
    assert.equal(streak(h, logs, '2026-10-08'), 4);
    assert.equal(bestStreak(h, logs, '2026-10-08'), 4);
    assert.equal(stageAt(h, logs, '2026-10-02'), 1); // a done day is never level 0
    assert.equal(isScheduledOn(h, '2026-10-04'), false);
    assert.equal(isScheduledOn(h, '2026-10-05'), true);
  });

  test('interval 2: only startDay + k·2 counts', () => {
    const logs = [log('2026-10-01'), log('2026-10-03'), log('2026-10-04'), log('2026-10-05')];
    assert.equal(isScheduledOn(twice, '2026-10-03'), true);
    assert.equal(isScheduledOn(twice, '2026-10-04'), false);
    assert.equal(streak(twice, logs, '2026-10-06'), 3);
    assert.equal(streak(twice, logs, '2026-10-07'), 3); // 10-07 scheduled, not yet done
    assert.equal(streak(twice, logs, '2026-10-08'), 0); // 10-07 missed
    assert.equal(stageFor(twice, logs, '2026-10-08'), 1);
    assert.deepEqual(weekProgress(twice, logs, '2026-10-01'), { done: 2, target: 2 }); // 10-01, 10-03; off-day 10-04 ignored
  });
});

describe('weekly streak', () => {
  test('MO/MI/FR: only target weekdays count, other days are passed over', () => {
    const logs = [
      log('2026-09-28'), log('2026-09-30'), log('2026-10-02'),
      log('2026-10-05'), log('2026-10-06'), log('2026-10-07'), log('2026-10-09'),
    ];
    assert.equal(streak(monWedFri, logs, '2026-10-09'), 6);
    assert.equal(streak(monWedFri, logs, '2026-10-11'), 6); // Sunday: latest scheduled day is Friday
    assert.equal(streak(monWedFri, logs, '2026-10-12'), 6); // Monday, not yet done
    assert.equal(streak(monWedFri, logs, '2026-10-13'), 0); // Monday missed
    assert.equal(stageFor(monWedFri, logs, '2026-10-11'), 2);
    assert.equal(stageAt(monWedFri, logs, '2026-10-07'), 2); // 5th target day
    assert.equal(stageAt(monWedFri, logs, '2026-10-06'), 2); // done off-day: run up to Mon 10-05 (4)
    assert.equal(stageAt(monWedFri, logs, '2026-10-08'), 0);
    assert.deepEqual(weekProgress(monWedFri, logs, '2026-10-08'), { done: 3, target: 3 }); // Tue 10-06 ignored
    assert.equal(isScheduledOn(monWedFri, '2026-10-06'), false);
    assert.equal(isScheduledOn(monWedFri, '2026-10-07'), true);
    assert.equal(isScheduledOn(monWedFri, '2026-09-25'), false); // Friday before startDay
  });

  test('a missed target day breaks the streak', () => {
    const logs = [log('2026-09-28'), log('2026-09-30'), log('2026-10-02'), log('2026-10-05'), log('2026-10-09')];
    assert.equal(streak(monWedFri, logs, '2026-10-11'), 1);
    assert.equal(bestStreak(monWedFri, logs, '2026-10-11'), 4);
  });

  test('interval 2: weeks in phase with the ISO week of startDay', () => {
    const h = habit({ kind: 'weekly', interval: 2, weekdays: [2] }, '2026-10-06');
    assert.equal(isScheduledOn(h, '2026-10-13'), false);
    assert.equal(isScheduledOn(h, '2026-10-20'), true);
    assert.equal(streak(h, [log('2026-10-06'), log('2026-10-20')], '2026-10-27'), 2);
    assert.equal(streak(h, [log('2026-10-06'), log('2026-10-20')], '2026-11-04'), 0);
  });

  test('across the year change and ISO week 2026-W53', () => {
    const h = habit({ kind: 'weekly', interval: 1, weekdays: [1, 5] }, '2026-12-01');
    const logs = [log('2026-12-21'), log('2026-12-25'), log('2026-12-28'), log('2027-01-01'), log('2027-01-04')];
    assert.equal(streak(h, logs, '2027-01-06'), 5);
  });
});

describe('timesPerWeek', () => {
  const week = run('2026-10-05', '2026-10-08'); // Mon–Thu: 4 logs, target 3

  test('3 per week with 4 logs: weekProgress 4/3, streak 1', () => {
    assert.deepEqual(weekProgress(thrice, week, '2026-10-08'), { done: 4, target: 3 });
    assert.equal(streak(thrice, week, '2026-10-08'), 1);
    assert.equal(stageFor(thrice, week, '2026-10-08'), 1);
    assert.equal(streak(thrice, week, '2026-10-11'), 1);
  });

  test('the running week counts once fulfilled, otherwise counting starts at the previous week', () => {
    assert.equal(streak(thrice, week.slice(0, 2), '2026-10-06'), 0);
    assert.equal(stageFor(thrice, week.slice(0, 2), '2026-10-06'), 1);
    assert.equal(streak(thrice, week, '2026-10-12'), 1); // new week, nothing logged yet
    assert.equal(streak(thrice, [...week, log('2026-10-12')], '2026-10-14'), 1);
    assert.equal(streak(thrice, week, '2026-10-19'), 0); // week of 10-12 missed
    assert.equal(stageFor(thrice, week, '2026-10-19'), 1);
  });

  test('four fulfilled weeks reach stage 4; stageAt follows the week streak as of the day', () => {
    const logs = [
      ...run('2026-09-14', '2026-09-16'), ...run('2026-09-21', '2026-09-23'),
      ...run('2026-09-28', '2026-09-30'), ...run('2026-10-05', '2026-10-07'),
    ];
    assert.equal(streak(thrice, logs, '2026-10-07'), 4);
    assert.equal(stageFor(thrice, logs, '2026-10-07'), 4);
    assert.equal(stageAt(thrice, logs, '2026-10-07'), 4);
    assert.equal(stageAt(thrice, logs, '2026-10-05'), 3); // week of 10-05 not yet fulfilled on Monday
    assert.equal(stageAt(thrice, logs, '2026-09-16'), 1);
    assert.equal(stageAt(thrice, logs, '2026-10-08'), 0); // no log that day
    assert.equal(bestStreak(thrice, logs, '2026-10-20'), 4);
  });

  test('across the year change (ISO week 2026-W53)', () => {
    const logs = [
      ...run('2026-12-21', '2026-12-23'), // 2026-W52
      log('2026-12-29'), log('2026-12-31'), log('2027-01-02'), // 2026-W53
      ...run('2027-01-04', '2027-01-06'), // 2027-W01
    ];
    assert.deepEqual(weekProgress(thrice, logs, '2027-01-01'), { done: 3, target: 3 });
    assert.equal(streak(thrice, logs, '2027-01-06'), 3);
    assert.equal(stageFor(thrice, logs, '2027-01-06'), 3);
  });

  test('scheduled every day from startDay on', () => {
    const h = habit({ kind: 'timesPerWeek', times: 2 }, '2026-10-07');
    assert.equal(isScheduledOn(h, '2026-10-06'), false);
    assert.equal(isScheduledOn(h, '2026-10-07'), true);
    assert.equal(isScheduledOn(h, '2026-10-11'), true);
    // Logs before startDay do not count towards the week.
    assert.deepEqual(weekProgress(h, run('2026-10-05', '2026-10-07'), '2026-10-07'), { done: 1, target: 2 });
  });
});

test('stageForCount thresholds (B.5)', () => {
  const days = [0, 1, 2, 3, 6, 7, 13, 14, 100].map((n) => stageForCount('days', n));
  assert.deepEqual(days, [0, 1, 1, 2, 2, 3, 3, 4, 4]);
  const weeks = [0, 1, 2, 3, 4, 10].map((n) => stageForCount('weeks', n));
  assert.deepEqual(weeks, [0, 1, 2, 3, 4, 4]);
});

describe('nextStage ("Noch n Tage bis …" on the garden cards)', () => {
  const day: Day = '2026-10-12';
  test('seed without any done log: one day until Spross', () => {
    assert.deepEqual(nextStage(daily, [], day), { stage: 0, next: 1, remaining: 1, unit: 'days' });
  });
  test('streak 1 up to yesterday: two days until Blätter (today counts as one of them)', () => {
    assert.deepEqual(nextStage(daily, [log('2026-10-11')], day), { stage: 1, next: 2, remaining: 2, unit: 'days' });
  });
  test('streak 13 including today: one day until Blüte', () => {
    assert.deepEqual(nextStage(daily, run('2026-09-30', day), day), { stage: 3, next: 4, remaining: 1, unit: 'days' });
  });
  test('broken streak keeps stage 1 and counts from zero', () => {
    assert.deepEqual(nextStage(daily, run('2026-09-01', '2026-09-20'), day), { stage: 1, next: 2, remaining: 3, unit: 'days' });
  });
  test('full bloom has no next stage', () => {
    assert.deepEqual(nextStage(daily, run('2026-09-20', day), day), { stage: 4, next: null, remaining: 0, unit: 'days' });
  });
  test('timesPerWeek counts fulfilled weeks', () => {
    // Weeks of 2026-09-28 and 2026-10-05 fulfilled (3 logs each): streak 2 → stage 2, one week until Knospe.
    const logs = ['2026-09-28', '2026-09-30', '2026-10-02', '2026-10-05', '2026-10-07', '2026-10-09'].map((d) => log(d));
    assert.deepEqual(nextStage(thrice, logs, day), { stage: 2, next: 3, remaining: 1, unit: 'weeks' });
  });
});
