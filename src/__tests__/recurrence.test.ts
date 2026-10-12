// F §4.14 / C.4 mandatory cases: both DST changes (Europe/Berlin), the 31st in 30-day months,
// 'last', weekly interval 2, afterCompletion, year change.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Day, Recurrence } from '../model.js';
import { nextOccurrence } from '../services/recurrence.js';
import { isoAt, timeOfIso } from '../util/date.js';

process.env.TZ = 'Europe/Berlin';

/** The first `n` occurrences after `after`, each computed from the previous one. */
function chain(rec: Recurrence, anchor: Day, after: Day, n: number): Day[] {
  const out: Day[] = [];
  let prev = after;
  for (let i = 0; i < n; i++) {
    prev = nextOccurrence(rec, anchor, prev);
    out.push(prev);
  }
  return out;
}

test('time zone is Europe/Berlin (CET winter, CEST summer)', () => {
  assert.equal(new Date(2026, 0, 15).getTimezoneOffset(), -60);
  assert.equal(new Date(2026, 6, 15).getTimezoneOffset(), -120);
});

describe('daily', () => {
  const rec: Recurrence = { kind: 'daily', interval: 1 };

  test('across the spring DST change: every day exactly once', () => {
    assert.deepEqual(chain(rec, '2026-03-27', '2026-03-27', 4), ['2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
  });

  test('across the autumn DST change: every day exactly once', () => {
    assert.deepEqual(chain(rec, '2026-10-23', '2026-10-23', 4), ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
  });

  test('before the anchor the anchor itself is the next occurrence', () => {
    assert.equal(nextOccurrence(rec, '2026-10-11', '2026-10-01'), '2026-10-11');
  });

  test('interval 3 stays in phase with the anchor, across the year change', () => {
    const every3: Recurrence = { kind: 'daily', interval: 3 };
    assert.equal(nextOccurrence(every3, '2026-12-27', '2026-12-28'), '2026-12-30');
    assert.equal(nextOccurrence(every3, '2026-12-27', '2026-12-30'), '2027-01-02');
  });

  test('interval below 1 counts as 1', () => {
    assert.equal(nextOccurrence({ kind: 'daily', interval: 0 }, '2026-10-01', '2026-10-05'), '2026-10-06');
  });
});

describe('weekly', () => {
  test('a 09:00 wall time stays 09:00 across both DST changes (2026 and 2027)', () => {
    const mondays: Recurrence = { kind: 'weekly', interval: 1, weekdays: [1] };
    const cases: Array<[Day, Day, number]> = [
      ['2026-03-23', '2026-03-30', 167], // spring 2026-03-29: one hour less
      ['2026-10-19', '2026-10-26', 169], // autumn 2026-10-25: one hour more
      ['2027-03-22', '2027-03-29', 167], // spring 2027-03-28
    ];
    for (const [prev, expected, hours] of cases) {
      const next = nextOccurrence(mondays, '2026-01-05', prev);
      assert.equal(next, expected);
      const before = isoAt(prev, '09:00');
      const after = isoAt(next, '09:00');
      assert.equal(timeOfIso(after), '09:00');
      assert.equal(Date.parse(after) - Date.parse(before), hours * 3_600_000);
    }
  });

  test('a wall time that does not exist is normalised by the browser (02:30 on 2027-03-28)', () => {
    assert.equal(timeOfIso(isoAt('2027-03-28', '02:30')), '03:30');
  });

  test('interval 2: listed weekdays in weeks anchorWeek + k·2', () => {
    const rec: Recurrence = { kind: 'weekly', interval: 2, weekdays: [4, 1] };
    const anchor = '2026-10-05'; // Monday
    assert.equal(nextOccurrence(rec, anchor, '2026-10-04'), '2026-10-05');
    assert.deepEqual(chain(rec, anchor, '2026-10-05', 5), [
      '2026-10-08', '2026-10-19', '2026-10-22', '2026-11-02', '2026-11-05',
    ]);
    assert.equal(nextOccurrence(rec, anchor, '2026-10-12'), '2026-10-19'); // off-phase week skipped
  });

  test('interval 2 across ISO week 2026-W53 and the year change', () => {
    const rec: Recurrence = { kind: 'weekly', interval: 2, weekdays: [1] };
    assert.equal(nextOccurrence(rec, '2026-12-21', '2026-12-21'), '2027-01-04');
  });

  test('Friday across the year change', () => {
    const rec: Recurrence = { kind: 'weekly', interval: 1, weekdays: [5] };
    assert.equal(nextOccurrence(rec, '2026-12-25', '2026-12-25'), '2027-01-01');
  });

  test('anchor on a non-listed weekday: first listed day after it', () => {
    const rec: Recurrence = { kind: 'weekly', interval: 2, weekdays: [1] };
    assert.equal(nextOccurrence(rec, '2026-10-07', '2026-10-01'), '2026-10-19');
  });

  test("empty weekday list means the anchor's weekday", () => {
    const rec: Recurrence = { kind: 'weekly', interval: 1, weekdays: [] };
    assert.equal(nextOccurrence(rec, '2026-10-07', '2026-10-07'), '2026-10-14');
  });
});

describe('monthly', () => {
  test('the 31st is clamped in 30-day months and February without drift', () => {
    const rec: Recurrence = { kind: 'monthly', interval: 1, day: 31 };
    assert.deepEqual(chain(rec, '2026-01-31', '2026-01-31', 6), [
      '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31',
    ]);
    assert.deepEqual(chain(rec, '2026-08-31', '2026-08-31', 4), ['2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31']);
  });

  test('the 31st in a leap-year February', () => {
    assert.equal(nextOccurrence({ kind: 'monthly', interval: 1, day: 31 }, '2028-01-31', '2028-01-31'), '2028-02-29');
  });

  test("'last' is the last day of each month", () => {
    const rec: Recurrence = { kind: 'monthly', interval: 1, day: 'last' };
    assert.deepEqual(chain(rec, '2028-01-31', '2028-01-31', 3), ['2028-02-29', '2028-03-31', '2028-04-30']);
    assert.equal(nextOccurrence(rec, '2026-01-31', '2026-01-31'), '2026-02-28');
  });

  test('across both DST changes (calendar months, no shift)', () => {
    const rec: Recurrence = { kind: 'monthly', interval: 1, day: 29 };
    assert.equal(nextOccurrence(rec, '2026-01-29', '2026-02-28'), '2026-03-29');
    const oct: Recurrence = { kind: 'monthly', interval: 1, day: 25 };
    assert.equal(nextOccurrence(oct, '2026-01-25', '2026-09-25'), '2026-10-25');
    assert.equal(timeOfIso(isoAt('2026-10-25', '09:00')), '09:00');
  });

  test('interval 2 across the year change', () => {
    const rec: Recurrence = { kind: 'monthly', interval: 2, day: 30 };
    assert.deepEqual(chain(rec, '2026-11-30', '2026-11-30', 3), ['2027-01-30', '2027-03-30', '2027-05-30']);
    assert.equal(nextOccurrence({ kind: 'monthly', interval: 1, day: 15 }, '2026-12-15', '2026-12-15'), '2027-01-15');
  });

  test('day before the anchor day in the anchor month: next month', () => {
    const rec: Recurrence = { kind: 'monthly', interval: 1, day: 10 };
    assert.equal(nextOccurrence(rec, '2026-01-15', '2026-01-01'), '2026-02-10');
  });

  test('invalid day of month throws', () => {
    assert.throws(() => nextOccurrence({ kind: 'monthly', interval: 1, day: 0 }, '2026-01-01', '2026-01-01'), RangeError);
    assert.throws(() => nextOccurrence({ kind: 'monthly', interval: 1, day: 32 }, '2026-01-01', '2026-01-01'), RangeError);
  });
});

describe('afterCompletion', () => {
  test('completion day + days, across the year change and DST', () => {
    const rec: Recurrence = { kind: 'afterCompletion', days: 3 };
    assert.equal(nextOccurrence(rec, '2026-12-01', '2026-12-30'), '2027-01-02');
    assert.equal(nextOccurrence({ kind: 'afterCompletion', days: 2 }, '2026-10-01', '2026-10-24'), '2026-10-26');
    assert.equal(nextOccurrence({ kind: 'afterCompletion', days: 1 }, '2026-03-01', '2026-03-28'), '2026-03-29');
  });
});

test('timesPerWeek is for habits only', () => {
  assert.throws(() => nextOccurrence({ kind: 'timesPerWeek', times: 3 }, '2026-10-05', '2026-10-05'), RangeError);
});
