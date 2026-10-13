// services/ics (C.4, D user stories): VEVENT per dated task, UTC times, all-day VALUE=DATE with
// DTEND = next day, VALARM, UID = task id, SEQUENCE from updatedAt, RRULE mapping, TEXT escaping,
// line folding at 75 octets (UTF-8), DST (Europe/Berlin: 09:00 → 08:00Z in winter, 07:00Z in summer),
// file names. Runs against the tsc output (npm test); scripts/run-tests.mjs sets TZ=Europe/Berlin.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Day, Recurrence, Task } from '../model.js';
import {
  buildIcs, escapeText, foldLine, icsFileName, rrule, sequenceOf, slugify,
} from '../services/ics.js';
import { isoAt } from '../util/date.js';

process.env.TZ = 'Europe/Berlin';

const NOW = new Date('2026-10-13T10:00:00.000Z');
const STAMP = '2026-10-01T08:00:00.000Z';
let seq = 0;

const task = (extra: Partial<Task> = {}): Task => ({
  id: `task-${++seq}`, areaId: 'a1', projectId: 'p1', parentId: null, title: 'Aufgabe', status: 'open',
  important: 0, urgent: 0, dueHasTime: 0, reminders: [], sortKey: 'V', createdAt: STAMP, updatedAt: STAMP, ...extra,
});
const allDay = (day: Day): Partial<Task> => ({ dueDay: day, dueAt: isoAt(day), dueHasTime: 0 });
const timed = (day: Day, time: string): Partial<Task> => ({ dueDay: day, dueAt: isoAt(day, time), dueHasTime: 1 });

const build = (tasks: Task[], name = 'Projekt'): string => buildIcs(tasks, { calendarName: name, now: NOW });
/** Unfolded content lines (RFC 5545 3.1). */
const unfold = (ics: string): string[] => ics.replace(/\r\n /gu, '').split('\r\n').filter((l) => l !== '');
/** Lines of the n-th VEVENT. */
function event(ics: string, n = 0): string[] {
  const lines = unfold(ics);
  const starts = lines.flatMap((l, i) => (l === 'BEGIN:VEVENT' ? [i] : []));
  const start = starts[n];
  assert.ok(start !== undefined, `no VEVENT #${n}`);
  return lines.slice(start, lines.indexOf('END:VEVENT', start) + 1);
}
const prop = (lines: string[], name: string): string | undefined =>
  lines.find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));

test('time zone is Europe/Berlin', () => {
  assert.equal(new Date(2026, 0, 15).getTimezoneOffset(), -60);
  assert.equal(new Date(2026, 6, 15).getTimezoneOffset(), -120);
});

describe('calendar frame', () => {
  test('VCALENDAR header, CRLF everywhere, trailing CRLF', () => {
    const ics = build([], 'Balkon');
    assert.ok(ics.endsWith('\r\n'));
    assert.equal(ics.replace(/\r\n/gu, '').includes('\n'), false, 'bare LF');
    assert.equal(ics.replace(/\r\n/gu, '').includes('\r'), false, 'bare CR');
    const lines = unfold(ics);
    assert.equal(lines[0], 'BEGIN:VCALENDAR');
    assert.equal(lines.at(-1), 'END:VCALENDAR');
    for (const line of ['VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Balkon']) {
      assert.ok(lines.includes(line), line);
    }
    assert.ok(lines.some((l) => l.startsWith('PRODID:')));
  });

  test('tasks without a date are skipped', () => {
    const ics = build([task(), task(allDay('2026-10-20'))]);
    assert.equal(unfold(ics).filter((l) => l === 'BEGIN:VEVENT').length, 1);
  });

  test('dueDay without dueAt still exports as all-day', () => {
    const lines = event(build([task({ dueDay: '2026-10-20' })]));
    assert.equal(prop(lines, 'DTSTART'), 'DTSTART;VALUE=DATE:20261020');
  });

  test('DTSTAMP is the export time in UTC', () => {
    assert.equal(prop(event(build([task(allDay('2026-10-20'))])), 'DTSTAMP'), 'DTSTAMP:20261013T100000Z');
  });
});

describe('user stories', () => {
  test('weekly Monday 09:00 with 15-minute reminder', () => {
    const t1 = task({
      id: 'b6f0c1d2-weekly', title: 'Wochenplanung', ...timed('2026-10-19', '09:00'),
      recurrence: { kind: 'weekly', interval: 1, weekdays: [1] },
      reminders: [{ id: 'r1', mode: 'relative', offsetMinutes: 15 }],
    });
    const lines = event(build([t1]));
    assert.equal(prop(lines, 'UID'), 'UID:b6f0c1d2-weekly');
    // 19.10.2026 is still summer time (CEST, UTC+2).
    assert.equal(prop(lines, 'DTSTART'), 'DTSTART:20261019T070000Z');
    assert.equal(prop(lines, 'DTEND'), 'DTEND:20261019T073000Z');
    assert.equal(prop(lines, 'RRULE'), 'RRULE:FREQ=WEEKLY;BYDAY=MO');
    const alarmAt = lines.indexOf('BEGIN:VALARM');
    assert.ok(alarmAt > 0);
    const alarm = lines.slice(alarmAt, lines.indexOf('END:VALARM') + 1);
    assert.ok(alarm.includes('ACTION:DISPLAY'));
    assert.ok(alarm.includes('TRIGGER:-PT15M'));
    assert.ok(alarm.includes('DESCRIPTION:Wochenplanung'));
  });

  test('a title change re-exports with a higher SEQUENCE and the same UID', () => {
    const before = task({ id: 'same', title: 'Alt', ...allDay('2026-10-20'), updatedAt: '2026-10-01T08:00:00.000Z' });
    const after = { ...before, title: 'Neu', updatedAt: '2026-10-01T08:00:05.000Z' };
    const seqOf = (t: Task): number => Number(prop(event(build([t])), 'SEQUENCE')?.split(':')[1]);
    assert.ok(seqOf(after) > seqOf(before));
    assert.equal(prop(event(build([after])), 'UID'), 'UID:same');
    assert.equal(prop(event(build([after])), 'SUMMARY'), 'SUMMARY:Neu');
  });

  test('all-day 20.10. → VALUE=DATE with DTEND = following day', () => {
    const lines = event(build([task(allDay('2026-10-20'))]));
    assert.equal(prop(lines, 'DTSTART'), 'DTSTART;VALUE=DATE:20261020');
    assert.equal(prop(lines, 'DTEND'), 'DTEND;VALUE=DATE:20261021');
  });

  test('all-day at the end of a month and a year', () => {
    assert.equal(prop(event(build([task(allDay('2026-10-31'))])), 'DTEND'), 'DTEND;VALUE=DATE:20261101');
    assert.equal(prop(event(build([task(allDay('2026-12-31'))])), 'DTEND'), 'DTEND;VALUE=DATE:20270101');
  });
});

describe('DST (Europe/Berlin)', () => {
  test('09:00 in winter → 08:00Z, in summer → 07:00Z', () => {
    assert.equal(prop(event(build([task(timed('2026-01-15', '09:00'))])), 'DTSTART'), 'DTSTART:20260115T080000Z');
    assert.equal(prop(event(build([task(timed('2026-07-15', '09:00'))])), 'DTSTART'), 'DTSTART:20260715T070000Z');
  });

  test('the days of the DST changes', () => {
    // 29.03.2026: 02:00 → 03:00 (CEST from then on); 25.10.2026: 03:00 → 02:00 (CET from then on).
    assert.equal(prop(event(build([task(timed('2026-03-29', '09:00'))])), 'DTSTART'), 'DTSTART:20260329T070000Z');
    assert.equal(prop(event(build([task(timed('2026-10-25', '09:00'))])), 'DTSTART'), 'DTSTART:20261025T080000Z');
    // DTEND = start + 30 minutes across the change (01:45 CET + 30 min = 03:15 CEST).
    const lines = event(build([task(timed('2026-03-29', '01:45'))]));
    assert.equal(prop(lines, 'DTSTART'), 'DTSTART:20260329T004500Z');
    assert.equal(prop(lines, 'DTEND'), 'DTEND:20260329T011500Z');
  });
});

describe('RRULE', () => {
  const rule = (rec: Recurrence, day: Day = '2026-10-19', shift = 0): string | null => rrule(rec, day, shift);

  test('daily, with and without interval', () => {
    assert.equal(rule({ kind: 'daily', interval: 1 }), 'FREQ=DAILY');
    assert.equal(rule({ kind: 'daily', interval: 2 }), 'FREQ=DAILY;INTERVAL=2');
    assert.equal(rule({ kind: 'daily', interval: 0 }), 'FREQ=DAILY');
  });

  test('weekly: weekdays in week order, interval with WKST, empty list = weekday of the due day', () => {
    assert.equal(rule({ kind: 'weekly', interval: 1, weekdays: [5, 1, 3] }), 'FREQ=WEEKLY;BYDAY=MO,WE,FR');
    assert.equal(rule({ kind: 'weekly', interval: 1, weekdays: [7] }), 'FREQ=WEEKLY;BYDAY=SU');
    assert.equal(rule({ kind: 'weekly', interval: 2, weekdays: [2] }), 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;WKST=MO');
    // 2026-10-21 is a Wednesday.
    assert.equal(rule({ kind: 'weekly', interval: 1, weekdays: [] }, '2026-10-21'), 'FREQ=WEEKLY;BYDAY=WE');
  });

  test('monthly: day N, last, clamped days above 28', () => {
    assert.equal(rule({ kind: 'monthly', interval: 1, day: 15 }), 'FREQ=MONTHLY;BYMONTHDAY=15');
    assert.equal(rule({ kind: 'monthly', interval: 3, day: 1 }), 'FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1');
    assert.equal(rule({ kind: 'monthly', interval: 1, day: 'last' }), 'FREQ=MONTHLY;BYMONTHDAY=-1');
    assert.equal(rule({ kind: 'monthly', interval: 1, day: 31 }), 'FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1');
    assert.equal(rule({ kind: 'monthly', interval: 1, day: 29 }), 'FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1');
  });

  test('afterCompletion and timesPerWeek have no RRULE', () => {
    assert.equal(rule({ kind: 'afterCompletion', days: 3 }), null);
    assert.equal(rule({ kind: 'timesPerWeek', times: 3 }), null);
    const lines = event(build([task({ ...allDay('2026-10-20'), recurrence: { kind: 'afterCompletion', days: 3 } })]));
    assert.equal(prop(lines, 'RRULE'), undefined);
  });

  test('a UTC date before the local day shifts BYDAY and BYMONTHDAY back', () => {
    assert.equal(rule({ kind: 'weekly', interval: 1, weekdays: [1, 3] }, '2026-10-19', -1), 'FREQ=WEEKLY;BYDAY=TU,SU');
    assert.equal(rule({ kind: 'monthly', interval: 1, day: 15 }, '2026-10-15', -1), 'FREQ=MONTHLY;BYMONTHDAY=14');
    assert.equal(rule({ kind: 'monthly', interval: 1, day: 1 }, '2026-10-01', -1), 'FREQ=MONTHLY;BYMONTHDAY=-1');
    assert.equal(rule({ kind: 'monthly', interval: 1, day: 'last' }, '2026-10-31', -1), 'FREQ=MONTHLY;BYMONTHDAY=-2');
    assert.equal(rule({ kind: 'monthly', interval: 1, day: 31 }, '2026-10-31', -1), 'FREQ=MONTHLY;BYMONTHDAY=30,-2;BYSETPOS=1');
  });

  test('a timed task at 00:30 local (22:30Z the day before) uses the UTC weekday', () => {
    const lines = event(build([task({
      ...timed('2026-10-19', '00:30'), recurrence: { kind: 'weekly', interval: 1, weekdays: [1] },
    })]));
    assert.equal(prop(lines, 'DTSTART'), 'DTSTART:20261018T223000Z');
    assert.equal(prop(lines, 'RRULE'), 'RRULE:FREQ=WEEKLY;BYDAY=SU');
  });

  test('all-day recurring tasks keep their local weekday', () => {
    const lines = event(build([task({ ...allDay('2026-10-19'), recurrence: { kind: 'weekly', interval: 1, weekdays: [1] } })]));
    assert.equal(prop(lines, 'RRULE'), 'RRULE:FREQ=WEEKLY;BYDAY=MO');
  });
});

describe('reminders', () => {
  test('absolute reminder → TRIGGER;VALUE=DATE-TIME in UTC', () => {
    const lines = event(build([task({
      ...timed('2026-10-20', '14:00'),
      reminders: [{ id: 'r', mode: 'absolute', at: isoAt('2026-10-20', '08:00') }],
    })]));
    assert.ok(lines.includes('TRIGGER;VALUE=DATE-TIME:20261020T060000Z'));
  });

  test('relative reminder at 0 minutes → PT0M; several reminders → several VALARMs', () => {
    const lines = event(build([task({
      ...timed('2026-10-20', '14:00'),
      reminders: [{ id: 'a', mode: 'relative', offsetMinutes: 0 }, { id: 'b', mode: 'relative', offsetMinutes: 60 }],
    })]));
    assert.ok(lines.includes('TRIGGER:PT0M'));
    assert.ok(lines.includes('TRIGGER:-PT60M'));
    assert.equal(lines.filter((l) => l === 'BEGIN:VALARM').length, 2);
  });

  test('relative reminders of all-day tasks and dismissed absolute reminders are skipped', () => {
    const lines = event(build([task({
      ...allDay('2026-10-20'),
      reminders: [
        { id: 'a', mode: 'relative', offsetMinutes: 15 },
        { id: 'b', mode: 'absolute', at: isoAt('2026-10-19', '18:00'), dismissedAt: '2026-10-19T16:00:00.000Z' },
      ],
    })]));
    assert.equal(lines.includes('BEGIN:VALARM'), false);
  });
});

describe('text', () => {
  test('escaping of backslash, semicolon, comma and newlines', () => {
    assert.equal(escapeText('a\\b;c,d\ne\r\nf\rg'), 'a\\\\b\\;c\\,d\\ne\\nf\\ng');
  });

  test('SUMMARY and DESCRIPTION are escaped; an empty description is omitted', () => {
    const lines = event(build([task({ ...allDay('2026-10-20'), title: 'Erde, Töpfe; Samen', description: 'Zeile 1\nC:\\Pfad' })]));
    assert.equal(prop(lines, 'SUMMARY'), 'SUMMARY:Erde\\, Töpfe\\; Samen');
    assert.equal(prop(lines, 'DESCRIPTION'), 'DESCRIPTION:Zeile 1\\nC:\\\\Pfad');
    assert.equal(prop(event(build([task({ ...allDay('2026-10-20'), description: '  ' })])), 'DESCRIPTION'), undefined);
  });

  test('calendar name is escaped', () => {
    assert.ok(unfold(build([], 'Haus, Garten')).includes('X-WR-CALNAME:Haus\\, Garten'));
  });
});

describe('folding', () => {
  const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

  test('short lines stay as they are', () => {
    assert.equal(foldLine('SUMMARY:kurz'), 'SUMMARY:kurz');
    const exact = `SUMMARY:${'x'.repeat(75 - 8)}`;
    assert.equal(foldLine(exact), exact);
  });

  test('ASCII: 75 octets per line, continuation lines start with one space', () => {
    const line = `DESCRIPTION:${'abcdefghij'.repeat(20)}`;
    const folded = foldLine(line).split('\r\n');
    assert.ok(folded.length > 2);
    for (const [i, part] of folded.entries()) {
      assert.ok(bytes(part) <= 75, `line ${i}: ${bytes(part)} octets`);
      if (i > 0) assert.ok(part.startsWith(' ') && !part.startsWith('  '));
    }
    assert.equal(bytes(folded[0] ?? ''), 75);
    assert.equal(folded.map((p, i) => (i === 0 ? p : p.slice(1))).join(''), line);
  });

  test('umlauts: octets are counted, no character is split', () => {
    const title = 'Größere Übungsfläche für Kräuterbeete säen und Wässerung prüfen – äöüÄÖÜß '.repeat(3);
    const ics = build([task({ ...allDay('2026-10-20'), title })]);
    for (const line of ics.split('\r\n')) {
      assert.ok(bytes(line) <= 75, `${bytes(line)} octets: ${line}`);
      assert.equal(line.includes('�'), false);
    }
    // Round trip through UTF-8 and unfolding gives the escaped title back.
    const decoded = Buffer.from(ics, 'utf8').toString('utf8');
    assert.equal(prop(event(decoded), 'SUMMARY'), `SUMMARY:${escapeText(title)}`);
  });

  test('emoji (4 octets) are never split', () => {
    const line = `SUMMARY:${'🌼'.repeat(40)}`;
    for (const part of foldLine(line).split('\r\n')) {
      assert.ok(bytes(part) <= 75);
      assert.equal([...part.trimStart()].every((ch) => ch === '🌼' || ch === ':' || /[A-Z]/u.test(ch)), true);
    }
  });
});

describe('SEQUENCE and files', () => {
  test('sequenceOf grows with updatedAt and is never negative', () => {
    assert.ok(sequenceOf('2026-10-02T00:00:00.000Z') > sequenceOf('2026-10-01T00:00:00.000Z'));
    assert.equal(sequenceOf('2020-01-01T00:00:00.000Z'), 0);
    assert.equal(sequenceOf('kaputt'), 0);
    assert.ok(sequenceOf('2090-01-01T00:00:00.000Z') < 2 ** 31);
  });

  test('slug and file name', () => {
    assert.equal(slugify('Steuererklärung 2026'), 'steuererklaerung-2026');
    assert.equal(slugify('  Balkon bepflanzen!  '), 'balkon-bepflanzen');
    assert.equal(slugify('Café Größe'), 'cafe-groesse');
    assert.equal(slugify('🌼🌼'), '');
    assert.equal(icsFileName('Balkon bepflanzen', '2026-10-13'), 'habit-garden-balkon-bepflanzen-2026-10-13.ics');
    assert.equal(icsFileName('🌼', '2026-10-13'), 'habit-garden-2026-10-13.ics');
    assert.ok(slugify('a'.repeat(100)).length <= 40);
  });
});
