// util/date.ts: local day keys, ISO weeks (week-year), DST-safe arithmetic, the clock hook
// and the midnight watcher (acceptance 10). TZ=Europe/Berlin (scripts/run-tests.mjs).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  addDays, dayKey, dayOfIso, diffDays, isDay, isoAt, isoWeekday, isoWeekKey, msUntilNextMidnight, now,
  onDayChange, parseDay, setClock, startOfWeek, today,
} from '../util/date.js';

process.env.TZ = 'Europe/Berlin';

test('time zone is Europe/Berlin (CET winter, CEST summer)', () => {
  assert.equal(new Date(2026, 0, 15).getTimezoneOffset(), -60);
  assert.equal(new Date(2026, 6, 15).getTimezoneOffset(), -120);
});

describe('day keys', () => {
  test('dayKey uses local components (00:30 local is still the same day)', () => {
    const early = new Date(2026, 9, 11, 0, 30);
    assert.equal(dayKey(early), '2026-10-11');
    assert.equal(early.toISOString().slice(0, 10), '2026-10-10'); // the UTC trap avoided above
  });

  test('parseDay returns local midnight, also on DST days', () => {
    for (const day of ['2026-03-29', '2026-10-25', '2026-01-01']) {
      const date = parseDay(day);
      assert.equal(date.getHours(), 0);
      assert.equal(dayKey(date), day);
    }
  });

  test('dayOfIso maps a UTC instant to the local day', () => {
    assert.equal(dayOfIso('2026-10-10T22:30:00.000Z'), '2026-10-11');
    assert.equal(dayOfIso('2026-01-10T23:30:00.000Z'), '2026-01-11');
  });

  test('isDay accepts only real calendar days in YYYY-MM-DD', () => {
    for (const day of ['2026-10-11', '2028-02-29', '2026-12-31', '2027-01-01']) assert.equal(isDay(day), true, day);
    for (const value of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-2-3', '20261011', '', 20261011, null]) {
      assert.equal(isDay(value), false, String(value));
    }
  });
});

describe('ISO weeks', () => {
  test('isoWeekKey uses the ISO week-numbering year', () => {
    assert.equal(isoWeekKey('2026-01-01'), '2026-W01');
    assert.equal(isoWeekKey('2027-01-01'), '2026-W53');
    assert.equal(isoWeekKey('2024-12-30'), '2025-W01');
    assert.equal(isoWeekKey('2026-12-31'), '2026-W53');
    assert.equal(isoWeekKey('2027-01-03'), '2026-W53');
    assert.equal(isoWeekKey('2027-01-04'), '2027-W01');
    assert.equal(isoWeekKey('2026-10-11'), '2026-W41');
  });

  test('isoWeekday: Monday = 1 … Sunday = 7', () => {
    assert.equal(isoWeekday('2026-10-05'), 1);
    assert.equal(isoWeekday('2026-10-07'), 3);
    assert.equal(isoWeekday('2026-10-11'), 7);
    assert.equal(isoWeekday('2026-03-29'), 7);
  });

  test('startOfWeek returns the Monday', () => {
    assert.equal(startOfWeek('2026-10-11'), '2026-10-05');
    assert.equal(startOfWeek('2026-10-05'), '2026-10-05');
    assert.equal(startOfWeek('2027-01-01'), '2026-12-28');
    assert.equal(startOfWeek('2026-03-29'), '2026-03-23');
    assert.equal(startOfWeek('2026-11-01'), '2026-10-26');
  });
});

describe('DST-safe arithmetic', () => {
  test('addDays across both DST changes, month and year ends', () => {
    assert.equal(addDays('2026-03-28', 1), '2026-03-29');
    assert.equal(addDays('2026-03-29', 1), '2026-03-30');
    assert.equal(addDays('2026-10-25', 1), '2026-10-26');
    assert.equal(addDays('2026-10-24', 2), '2026-10-26');
    assert.equal(addDays('2026-03-30', -2), '2026-03-28');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addDays('2026-01-31', 30), '2026-03-02');
  });

  test('millisecond addition would repeat 2026-10-25; addDays does not', () => {
    const naive = dayKey(new Date(parseDay('2026-10-25').getTime() + 86_400_000));
    assert.equal(naive, '2026-10-25');
    assert.equal(addDays('2026-10-25', 1), '2026-10-26');
  });

  test('diffDays counts calendar days', () => {
    assert.equal(diffDays('2026-03-30', '2026-03-29'), 1);
    assert.equal(diffDays('2026-03-29', '2026-03-28'), 1);
    assert.equal(diffDays('2026-10-26', '2026-10-25'), 1);
    assert.equal(diffDays('2026-11-01', '2026-10-01'), 31);
    assert.equal(diffDays('2027-01-01', '2026-12-31'), 1);
    assert.equal(diffDays('2026-03-01', '2026-02-01'), 28);
    assert.equal(diffDays('2026-10-01', '2026-10-11'), -10);
  });

  test('isoAt keeps the wall time on both sides of a DST change', () => {
    assert.equal(isoAt('2026-03-28', '09:00'), '2026-03-28T08:00:00.000Z');
    assert.equal(isoAt('2026-03-30', '09:00'), '2026-03-30T07:00:00.000Z');
    assert.equal(isoAt('2026-10-26', '09:00'), '2026-10-26T08:00:00.000Z');
    assert.equal(isoAt('2026-10-11'), '2026-10-10T22:00:00.000Z');
  });
});

describe('clock hook', () => {
  test('setClock overrides now() and today(); null restores the system clock', () => {
    setClock(() => new Date(2026, 9, 25, 12, 0));
    assert.equal(today(), '2026-10-25');
    assert.equal(now().getHours(), 12);
    setClock(null);
    assert.ok(Math.abs(now().getTime() - Date.now()) < 1000);
  });

  test('msUntilNextMidnight follows the calendar (23 h and 25 h days)', () => {
    setClock(() => new Date(2026, 9, 24, 23, 0));
    assert.equal(msUntilNextMidnight(), 3_600_000);
    setClock(() => new Date(2026, 9, 25, 0, 0));
    assert.equal(msUntilNextMidnight(), 25 * 3_600_000);
    setClock(() => new Date(2026, 2, 29, 0, 0));
    assert.equal(msUntilNextMidnight(), 23 * 3_600_000);
    setClock(() => new Date(2026, 2, 28, 12, 0));
    assert.equal(msUntilNextMidnight(), 12 * 3_600_000);
    setClock(null);
  });

  // Must stay the last test: once onDayChange started the watcher, every setClock call arms a
  // timer. The mocked setTimeout keeps those timers from holding the process open.
  test('onDayChange fires at local midnight and on setClock, until unsubscribed', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let fake = new Date(2026, 9, 24, 23, 59, 0);
    setClock(() => fake);
    const seen: string[] = [];
    const off = onDayChange((day) => seen.push(day));

    // Midnight passes (the 25 h DST day begins): the armed timer re-evaluates "today".
    fake = new Date(2026, 9, 25, 0, 0, 1);
    t.mock.timers.tick(60_000 + 250);
    assert.deepEqual(seen, ['2026-10-25']);

    // A clock jump (e.g. the tab was asleep) is noticed by setClock/checkDay as well.
    fake = new Date(2026, 9, 27, 8, 0);
    setClock(() => fake);
    assert.deepEqual(seen, ['2026-10-25', '2026-10-27']);

    // The same day again does not notify.
    fake = new Date(2026, 9, 27, 20, 0);
    setClock(() => fake);
    assert.equal(seen.length, 2);

    off();
    fake = new Date(2026, 9, 28, 8, 0);
    setClock(() => fake);
    assert.equal(seen.length, 2);
    setClock(null);
  });
});
