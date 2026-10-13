// Calendar sheet and day view helpers (A.2 H8): month grid, month arithmetic, date-picker keys,
// day summaries and the day view data. scripts/run-tests.mjs sets TZ=Europe/Berlin (DST cases).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Contact, ContactLog, Day, Habit, HabitLog, HabitSchedule, MoodLog, Note, Task } from '../model.js';
import {
  addMonthsClamped, dayKind, excerpt, firstOfMonth, futureDay, habitTally, isPastDayEmpty, lastOfMonth, monthDays,
  monthGrid, monthOf, moveDay, pastDay, shiftMonth, summarizeDays,
} from '../services/calendar.js';
import { isoAt } from '../util/date.js';

process.env.TZ = 'Europe/Berlin';

const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id, areaId: 'a1', projectId: null, parentId: null, title: id, status: 'open', important: 0, urgent: 0,
  dueHasTime: 0, reminders: [], sortKey: id, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z',
  ...patch,
});

const habit = (id: string, schedule: HabitSchedule, startDay: Day = '2026-01-01', archived: 0 | 1 = 0): Habit => ({
  id, name: id, schedule, period: 'any', startDay, archived, sortKey: id, updatedAt: '2026-01-01T00:00:00.000Z',
});

const log = (habitId: string, day: Day, status: HabitLog['status'] = 'done'): HabitLog => ({
  id: `${habitId}:${day}`, habitId, day, status, loggedAt: `${day}T08:00:00.000Z`,
});

const mood = (id: string, day: Day, value: MoodLog['value'], loggedAt = `${day}T12:00:00.000Z`): MoodLog => ({ id, day, value, loggedAt });

describe('month grid', () => {
  test('October 2026 starts on a Thursday: three blanks, five weeks', () => {
    const weeks = monthGrid({ year: 2026, month: 10 });
    assert.equal(weeks.length, 5);
    assert.deepEqual(weeks[0], [null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    assert.deepEqual(weeks[4], ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', null]);
    assert.ok(weeks.every((w) => w.length === 7));
  });

  test('DST months keep every day exactly once (29.03. and 25.10.2026)', () => {
    for (const m of [{ year: 2026, month: 3 }, { year: 2026, month: 10 }]) {
      const days = monthGrid(m).flat().filter((d): d is Day => d !== null);
      assert.deepEqual(days, monthDays(m));
      assert.equal(new Set(days).size, days.length);
    }
    const march = monthGrid({ year: 2026, month: 3 });
    // 29.03.2026 is a Sunday (last column), 30.03. the Monday after.
    assert.equal(march[4]?.[6], '2026-03-29');
    assert.equal(march[5]?.[0], '2026-03-30');
    assert.equal(march.length, 6);
  });

  test('February 2027 starts on a Monday and fills exactly four weeks', () => {
    const weeks = monthGrid({ year: 2027, month: 2 });
    assert.equal(weeks.length, 4);
    assert.equal(weeks[0]?.[0], '2027-02-01');
    assert.equal(weeks[3]?.[6], '2027-02-28');
  });

  test('leap year February', () => {
    assert.equal(lastOfMonth({ year: 2028, month: 2 }), '2028-02-29');
    assert.equal(monthDays({ year: 2028, month: 2 }).length, 29);
  });
});

describe('month arithmetic', () => {
  test('shiftMonth crosses year boundaries both ways', () => {
    assert.deepEqual(shiftMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
    assert.deepEqual(shiftMonth({ year: 2027, month: 1 }, -1), { year: 2026, month: 12 });
    assert.deepEqual(shiftMonth({ year: 2026, month: 10 }, -22), { year: 2024, month: 12 });
    assert.deepEqual(shiftMonth({ year: 2026, month: 10 }, 15), { year: 2028, month: 1 });
  });

  test('monthOf, firstOfMonth, lastOfMonth', () => {
    assert.deepEqual(monthOf('2026-12-31'), { year: 2026, month: 12 });
    assert.equal(firstOfMonth({ year: 2026, month: 12 }), '2026-12-01');
    assert.equal(lastOfMonth({ year: 2026, month: 12 }), '2026-12-31');
  });

  test('addMonthsClamped clamps to the last day', () => {
    assert.equal(addMonthsClamped('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonthsClamped('2028-01-31', 1), '2028-02-29');
    assert.equal(addMonthsClamped('2026-03-31', -1), '2026-02-28');
    assert.equal(addMonthsClamped('2026-12-15', 1), '2027-01-15');
    assert.equal(addMonthsClamped('2028-02-29', 12), '2029-02-28');
  });
});

describe('keyboard movement', () => {
  test('arrows move by days and weeks across DST and the year end', () => {
    assert.equal(moveDay('2026-03-29', 'ArrowRight'), '2026-03-30');
    assert.equal(moveDay('2026-10-25', 'ArrowLeft'), '2026-10-24');
    assert.equal(moveDay('2026-10-22', 'ArrowDown'), '2026-10-29');
    assert.equal(moveDay('2026-12-31', 'ArrowRight'), '2027-01-01');
    assert.equal(moveDay('2027-01-03', 'ArrowUp'), '2026-12-27');
  });

  test('Home/End go to Monday/Sunday of the week', () => {
    assert.equal(moveDay('2026-10-14', 'Home'), '2026-10-12');
    assert.equal(moveDay('2026-10-14', 'End'), '2026-10-18');
    assert.equal(moveDay('2026-12-31', 'End'), '2027-01-03');
    assert.equal(moveDay('2026-10-12', 'Home'), '2026-10-12');
  });

  test('PageUp/PageDown: month (Shift: year), clamped', () => {
    assert.equal(moveDay('2026-10-31', 'PageDown'), '2026-11-30');
    assert.equal(moveDay('2026-03-31', 'PageUp'), '2026-02-28');
    assert.equal(moveDay('2026-12-10', 'PageDown'), '2027-01-10');
    assert.equal(moveDay('2028-02-29', 'PageDown', true), '2029-02-28');
    assert.equal(moveDay('2026-10-13', 'PageUp', true), '2025-10-13');
  });

  test('other keys are not handled', () => {
    assert.equal(moveDay('2026-10-13', 'Enter'), null);
    assert.equal(moveDay('2026-10-13', 'a'), null);
  });
});

describe('day summaries', () => {
  const daily = habit('daily', { kind: 'daily', interval: 1 }, '2026-10-01');
  const monFri = habit('monfri', { kind: 'weekly', interval: 1, weekdays: [1, 5] }, '2026-10-01');
  const weekly3 = habit('tpw', { kind: 'timesPerWeek', times: 3 }, '2026-10-01');
  const archived = habit('old', { kind: 'daily', interval: 1 }, '2026-01-01', 1);
  const habits = [daily, monFri, weekly3, archived];

  test('habit tally: done, scheduled without a log, skipped, timesPerWeek, archived, before start', () => {
    // Monday 12.10.: daily + monFri scheduled.
    assert.deepEqual(habitTally(habits, [log('daily', '2026-10-12')], '2026-10-12'), { done: 1, due: 2 });
    // skipped is neither done nor due; timesPerWeek counts only when done; archived only with a log.
    assert.deepEqual(
      habitTally(habits, [log('monfri', '2026-10-12', 'skipped'), log('tpw', '2026-10-12'), log('old', '2026-10-12')], '2026-10-12'),
      { done: 2, due: 3 },
    );
    // Tuesday: monFri not scheduled; before startDay nothing is due.
    assert.deepEqual(habitTally(habits, [], '2026-10-13'), { done: 0, due: 1 });
    assert.deepEqual(habitTally(habits, [], '2026-09-30'), { done: 0, due: 0 });
  });

  test('summaries: due counts (top-level, any status), habits up to today only, newest mood', () => {
    const tasks = [
      task('t1', { dueDay: '2026-10-12', dueAt: isoAt('2026-10-12') }),
      task('t2', { dueDay: '2026-10-12', dueAt: isoAt('2026-10-12'), status: 'done', completedAt: '2026-10-12T09:00:00.000Z' }),
      task('sub', { dueDay: '2026-10-12', parentId: 't1' }),
      task('t3', { dueDay: '2026-10-20', dueAt: isoAt('2026-10-20') }),
    ];
    const logs = [log('daily', '2026-10-12'), log('daily', '2026-10-20')];
    const moods = [mood('m1', '2026-10-12', 2, '2026-10-12T08:00:00.000Z'), mood('m2', '2026-10-12', 4, '2026-10-12T20:00:00.000Z')];
    const map = summarizeDays(['2026-10-12', '2026-10-13', '2026-10-20'], { tasks, habits, logs, moods }, '2026-10-13');
    assert.deepEqual(map.get('2026-10-12'), { due: 2, dueOpen: 1, habitsDone: 1, habitsDue: 2, mood: 4 });
    assert.deepEqual(map.get('2026-10-13'), { due: 0, dueOpen: 0, habitsDone: 0, habitsDue: 1 });
    // Future days carry no habit progress, even with a (stray) log.
    assert.deepEqual(map.get('2026-10-20'), { due: 1, dueOpen: 1, habitsDone: 0, habitsDue: 0 });
  });

  test('summaries across the DST change and the year end', () => {
    const tasks = [
      task('d1', { dueDay: '2026-10-25', dueAt: isoAt('2026-10-25', '23:30'), dueHasTime: 1 }),
      task('d2', { dueDay: '2027-01-01', dueAt: isoAt('2027-01-01') }),
    ];
    const map = summarizeDays(['2026-10-25', '2026-10-26', '2026-12-31', '2027-01-01'], { tasks, habits: [], logs: [], moods: [] }, '2027-06-01');
    assert.equal(map.get('2026-10-25')?.due, 1);
    assert.equal(map.get('2026-10-26')?.due, 0);
    assert.equal(map.get('2026-12-31')?.due, 0);
    assert.equal(map.get('2027-01-01')?.due, 1);
  });
});

describe('day view', () => {
  test('dayKind', () => {
    assert.equal(dayKind('2026-10-12', '2026-10-13'), 'past');
    assert.equal(dayKind('2026-10-13', '2026-10-13'), 'today');
    assert.equal(dayKind('2027-01-01', '2026-12-31'), 'future');
  });

  const daily = habit('daily', { kind: 'daily', interval: 1 }, '2026-10-01');
  const other = habit('other', { kind: 'daily', interval: 1 }, '2026-10-01');
  const anna: Contact = { id: 'c1', name: 'Anna', rhythmDays: 14, archived: 0, sortKey: 'a', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
  const journal: Note = {
    id: 'n1', kind: 'journal', journalDay: '2026-10-10', title: '2026-10-10 Journal', body: '**08:15** Ruhiger Morgen',
    tagPaths: [], pinned: 0, archived: 0, createdAt: '2026-10-10T06:15:00.000Z', updatedAt: '2026-10-10T06:15:00.000Z',
  };

  test('past day: focus in slot order (deleted ids skipped), completions by local day, logs with stage', () => {
    const tasks = [
      task('f1', { status: 'done', completedAt: '2026-10-10T07:00:00.000Z' }),
      task('f2'),
      // Completed at 23:30 local time on 10.10. (21:30 UTC) and at 00:30 local on 11.10. (22:30 UTC on 10.10.).
      task('late', { status: 'done', completedAt: '2026-10-10T21:30:00.000Z' }),
      task('next', { status: 'done', completedAt: '2026-10-10T22:30:00.000Z' }),
      task('subdone', { status: 'done', parentId: 'f2', completedAt: '2026-10-10T08:00:00.000Z' }),
    ];
    const logs = [log('daily', '2026-10-08'), log('daily', '2026-10-09'), log('daily', '2026-10-10'), log('other', '2026-10-10', 'skipped')];
    const contactLogs: ContactLog[] = [{ id: 'c1:2026-10-10', contactId: 'c1', day: '2026-10-10', kind: 'call', loggedAt: '2026-10-10T15:00:00.000Z' }];
    const view = pastDay('2026-10-10', {
      plan: { id: '2026-10-10', mitTaskIds: ['f2', 'gone', 'f1'] },
      tasks, habits: [other, daily], logs,
      moods: [mood('m', '2026-10-10', 3)], journal, contacts: [anna], contactLogs,
    });
    assert.deepEqual(view.focus.map((x) => x.id), ['f2', 'f1']);
    assert.deepEqual(view.completed.map((x) => x.id), ['f1', 'late']);
    assert.deepEqual(view.habits.map((e) => [e.habit.id, e.status, e.stage]), [['daily', 'done', 2], ['other', 'skipped', 0]]);
    assert.equal(view.mood, 3);
    assert.equal(view.journal?.id, 'n1');
    assert.equal(view.contacts[0]?.contact?.name, 'Anna');
    assert.equal(isPastDayEmpty(view), false);
  });

  test('past day without anything is empty; a journal of another day is ignored', () => {
    const view = pastDay('2026-10-11', {
      plan: undefined, tasks: [], habits: [daily], logs: [], moods: [], journal, contacts: [], contactLogs: [],
    });
    assert.equal(view.journal, undefined);
    assert.equal(isPastDayEmpty(view), true);
  });

  test('future day: focus, open due tasks (timed first), scheduled habits', () => {
    const tasks = [
      task('b', { dueDay: '2026-10-20', dueAt: isoAt('2026-10-20'), sortKey: 'B' }),
      task('a', { dueDay: '2026-10-20', dueAt: isoAt('2026-10-20'), sortKey: 'A' }),
      task('timed', { dueDay: '2026-10-20', dueAt: isoAt('2026-10-20', '09:00'), dueHasTime: 1, sortKey: 'Z' }),
      task('done', { dueDay: '2026-10-20', status: 'done' }),
      task('other', { dueDay: '2026-10-21' }),
      task('plan'),
    ];
    const tue = habit('tue', { kind: 'weekly', interval: 1, weekdays: [2] }, '2026-10-01');
    const wed = habit('wed', { kind: 'weekly', interval: 1, weekdays: [3] }, '2026-10-01');
    const later = habit('later', { kind: 'daily', interval: 1 }, '2026-11-01');
    const view = futureDay('2026-10-20', {
      plan: { id: '2026-10-20', mitTaskIds: ['plan'] }, tasks, habits: [wed, tue, later, habit('arch', { kind: 'daily', interval: 1 }, '2026-01-01', 1)],
    });
    assert.deepEqual(view.focus.map((x) => x.id), ['plan']);
    assert.deepEqual(view.due.map((x) => x.id), ['timed', 'a', 'b']);
    assert.deepEqual(view.habits.map((x) => x.id), ['tue']);
  });

  test('excerpt strips markup and shortens at a word', () => {
    assert.equal(excerpt('**08:15** Ruhiger [Morgen](note:abc)\n\n- Tee'), '08:15 Ruhiger Morgen Tee');
    const long = excerpt('Wort '.repeat(60), 40);
    assert.ok(long.length <= 41 && long.endsWith('…'));
  });
});
