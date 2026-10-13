// services/ics (C.4, D user stories): VEVENT per dated task, local times with TZID + VTIMEZONE
// (UTC fallback), all-day VALUE=DATE with DTEND = next day, VALARM, UID = task id, SEQUENCE from
// updatedAt, RRULE mapping, TEXT escaping, line folding at 75 octets (UTF-8), DST (a 09:00 series
// stays at 09:00 wall-clock time on both sides of the change), VTIMEZONE rules derived from Intl for
// Europe/Berlin, America/New_York, Asia/Kolkata, Australia/Sydney (checked against Intl by expanding
// the emitted VTIMEZONE), file names. Runs against the tsc output (npm test);
// scripts/run-tests.mjs sets TZ=Europe/Berlin.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Day, Recurrence, Task } from '../model.js';
import {
  buildIcs, escapeText, foldLine, icsFileName, icsOffset, rrule, sequenceOf, slugify, systemTimeZone, tzidZone,
  zoneOffsetMinutes,
} from '../services/ics.js';
import { dayOfIso, isoAt } from '../util/date.js';

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

/** A timed task at an explicit instant (for zones other than the process zone). */
const timedAt = (iso: string): Partial<Task> => ({ dueDay: dayOfIso(iso), dueAt: iso, dueHasTime: 1 });

const build = (tasks: Task[], name = 'Projekt', timeZone?: string): string =>
  buildIcs(tasks, { calendarName: name, now: NOW, ...(timeZone === undefined ? {} : { timeZone }) });
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
/** Lines between BEGIN:<name> and the matching END:<name> (all occurrences). */
function blocks(lines: string[], name: string): string[][] {
  const out: string[][] = [];
  lines.forEach((l, i) => {
    if (l === `BEGIN:${name}`) out.push(lines.slice(i, lines.indexOf(`END:${name}`, i) + 1));
  });
  return out;
}

// --- A small VTIMEZONE reader: resolves a local wall time to its UTC offset (RFC 5545 3.6.5). ---

interface Obs { start: string; from: number; to: number; onsets: (year: number) => string[] }
const BYDAY_INDEX: Readonly<Record<string, number>> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const offsetMin = (v: string): number => {
  const m = /^([+-])(\d{2})(\d{2})$/u.exec(v);
  assert.ok(m, `offset ${v}`);
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
};
const value = (lines: string[], name: string): string => (prop(lines, name) ?? '').split(':').slice(1).join(':');
const p2 = (n: number): string => String(n).padStart(2, '0');

/** Observances of a VTIMEZONE; onsets(year) = local onset times (offset before the change) in that year. */
function readVtimezone(vtz: string[]): Obs[] {
  return [...blocks(vtz, 'STANDARD'), ...blocks(vtz, 'DAYLIGHT')].map((o) => {
    const start = value(o, 'DTSTART');
    const rule = value(o, 'RRULE');
    const rdates = o.filter((l) => l.startsWith('RDATE:')).map((l) => l.slice(6));
    const from = offsetMin(value(o, 'TZOFFSETFROM'));
    const to = offsetMin(value(o, 'TZOFFSETTO'));
    const onsets = (year: number): string[] => {
      const out = [start, ...rdates].filter((d) => d.startsWith(String(year)));
      if (rule && year > Number(start.slice(0, 4))) {
        const m = /^FREQ=YEARLY;BYMONTH=(\d+);BYDAY=(-1|[1-4])([A-Z]{2})$/u.exec(rule);
        assert.ok(m, `unexpected RRULE ${rule}`);
        const month = Number(m[1]);
        const n = Number(m[2]);
        const wd = BYDAY_INDEX[m[3] ?? ''] ?? 0;
        const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
        let d: number;
        if (n > 0) d = 1 + ((wd - new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 7) % 7) + 7 * (n - 1);
        else d = last - ((new Date(Date.UTC(year, month - 1, last)).getUTCDay() - wd + 7) % 7);
        out.push(`${year}${p2(month)}${p2(d)}${start.slice(8)}`);
      }
      return out;
    };
    return { start, from, to, onsets };
  });
}

/** UTC offset (minutes) the VTIMEZONE gives a local wall time "YYYYMMDDTHHMMSS" (not within a change). */
function vtzOffset(observances: Obs[], local: string): number {
  const year = Number(local.slice(0, 4));
  let best: { onset: string; to: number } | undefined;
  for (const o of observances) {
    for (let y = year - 1; y <= year; y++) {
      for (const onset of o.onsets(y)) {
        if (onset <= local && (!best || onset > best.onset)) best = { onset, to: o.to };
      }
    }
  }
  if (best) return best.to;
  // Before the first onset: the offset the earliest observance changes from.
  const sorted = [...observances].sort((a, b) => (a.start < b.start ? -1 : 1));
  return sorted[0]?.from ?? 0;
}

/** Instant of a VTIMEZONE wall time ("YYYYMMDDTHHMMSS"). */
function vtzInstant(observances: Obs[], local: string): number {
  const [y, mo, d, h, mi] = [local.slice(0, 4), local.slice(4, 6), local.slice(6, 8), local.slice(9, 11), local.slice(11, 13)].map(Number);
  return Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0) - vtzOffset(observances, local) * 60_000;
}

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
    // Local wall-clock time with TZID (19.10.2026 is still CEST, the series continues into CET).
    assert.equal(prop(lines, 'DTSTART'), 'DTSTART;TZID=Europe/Berlin:20261019T090000');
    assert.equal(prop(lines, 'DTEND'), 'DTEND;TZID=Europe/Berlin:20261019T093000');
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
  const BERLIN = 'DTSTART;TZID=Europe/Berlin:';

  test('09:00 in winter and in summer → 09:00 wall-clock time', () => {
    assert.equal(prop(event(build([task(timed('2026-01-15', '09:00'))])), 'DTSTART'), `${BERLIN}20260115T090000`);
    assert.equal(prop(event(build([task(timed('2026-07-15', '09:00'))])), 'DTSTART'), `${BERLIN}20260715T090000`);
  });

  test('the days of the DST changes', () => {
    // 29.03.2026: 02:00 → 03:00 (CEST from then on); 25.10.2026: 03:00 → 02:00 (CET from then on).
    assert.equal(prop(event(build([task(timed('2026-03-29', '09:00'))])), 'DTSTART'), `${BERLIN}20260329T090000`);
    assert.equal(prop(event(build([task(timed('2026-10-25', '09:00'))])), 'DTSTART'), `${BERLIN}20261025T090000`);
    // DTEND = start + 30 real minutes across the change (01:45 CET + 30 min = 03:15 CEST).
    const lines = event(build([task(timed('2026-03-29', '01:45'))]));
    assert.equal(prop(lines, 'DTSTART'), `${BERLIN}20260329T014500`);
    assert.equal(prop(lines, 'DTEND'), 'DTEND;TZID=Europe/Berlin:20260329T031500');
  });

  test('a weekly 09:00 series created in summer resolves to 09:00 in winter as well', () => {
    const ics = build([task({ ...timed('2026-07-13', '09:00'), recurrence: { kind: 'weekly', interval: 1, weekdays: [1] } })]);
    const lines = event(ics);
    assert.equal(prop(lines, 'DTSTART'), `${BERLIN}20260713T090000`);
    assert.equal(prop(lines, 'RRULE'), 'RRULE:FREQ=WEEKLY;BYDAY=MO');
    const vtz = readVtimezone(blocks(unfold(ics), 'VTIMEZONE')[0] ?? []);
    // Mondays 09:00 local: 07:00Z in summer, 08:00Z after the change in October.
    assert.equal(new Date(vtzInstant(vtz, '20260713T090000')).toISOString(), '2026-07-13T07:00:00.000Z');
    assert.equal(new Date(vtzInstant(vtz, '20261102T090000')).toISOString(), '2026-11-02T08:00:00.000Z');
    assert.equal(new Date(vtzInstant(vtz, '20270104T090000')).toISOString(), '2027-01-04T08:00:00.000Z');
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

  test('a timed task at 00:30 local keeps its local weekday with TZID (no shift)', () => {
    const lines = event(build([task({
      ...timed('2026-10-19', '00:30'), recurrence: { kind: 'monthly', interval: 1, day: 19 },
    })]));
    assert.equal(prop(lines, 'DTSTART'), 'DTSTART;TZID=Europe/Berlin:20261019T003000');
    assert.equal(prop(lines, 'RRULE'), 'RRULE:FREQ=MONTHLY;BYMONTHDAY=19');
    const weekly = event(build([task({ ...timed('2026-10-19', '00:30'), recurrence: { kind: 'weekly', interval: 1, weekdays: [1] } })]));
    assert.equal(prop(weekly, 'RRULE'), 'RRULE:FREQ=WEEKLY;BYDAY=MO');
  });

  test('UTC fallback: 00:30 local (22:30Z the day before) uses the UTC weekday', () => {
    const lines = event(build([task({
      ...timed('2026-10-19', '00:30'), recurrence: { kind: 'weekly', interval: 1, weekdays: [1] },
    })], 'Projekt', 'UTC'));
    assert.equal(prop(lines, 'DTSTART'), 'DTSTART:20261018T223000Z');
    assert.equal(prop(lines, 'RRULE'), 'RRULE:FREQ=WEEKLY;BYDAY=SU');
  });

  test('a zone other than the system zone shifts to the date written in DTSTART', () => {
    // Monday 00:30 in Berlin = Sunday 18:30 in New York.
    const lines = event(build([task({
      ...timed('2026-10-19', '00:30'), recurrence: { kind: 'weekly', interval: 1, weekdays: [1] },
    })], 'Projekt', 'America/New_York'));
    assert.equal(prop(lines, 'DTSTART'), 'DTSTART;TZID=America/New_York:20261018T183000');
    assert.equal(prop(lines, 'RRULE'), 'RRULE:FREQ=WEEKLY;BYDAY=SU');
  });

  test('all-day recurring tasks keep their local weekday', () => {
    const lines = event(build([task({ ...allDay('2026-10-19'), recurrence: { kind: 'weekly', interval: 1, weekdays: [1] } })]));
    assert.equal(prop(lines, 'RRULE'), 'RRULE:FREQ=WEEKLY;BYDAY=MO');
  });
});

describe('time zones (TZID + VTIMEZONE)', () => {
  const vtimezones = (ics: string): string[][] => blocks(unfold(ics), 'VTIMEZONE');
  const observance = (vtz: string[], kind: 'STANDARD' | 'DAYLIGHT'): string[] => {
    const found = blocks(vtz, kind);
    assert.equal(found.length, 1, `${kind} count`);
    return found[0] ?? [];
  };
  /** Every day at 12:00 local from `from` to `to`: the VTIMEZONE offset equals the Intl offset. */
  function agreesWithIntl(vtz: string[], zone: string, fromYear: number, toYear: number): void {
    const obs = readVtimezone(vtz);
    for (let ms = Date.UTC(fromYear, 0, 1, 12); ms < Date.UTC(toYear + 1, 0, 1); ms += 86_400_000) {
      const d = new Date(ms);
      const local = `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T120000`;
      const instant = vtzInstant(obs, local);
      assert.equal(vtzOffset(obs, local), zoneOffsetMinutes(instant, zone), `${zone} ${local}`);
    }
  }

  test('the default zone is the system zone (Intl)', () => {
    assert.equal(systemTimeZone(), 'Europe/Berlin');
    const ics = build([task(timed('2026-10-20', '14:00'))]);
    assert.equal(prop(event(ics), 'DTSTART'), 'DTSTART;TZID=Europe/Berlin:20261020T140000');
    assert.equal(vtimezones(ics).length, 1);
  });

  test('Europe/Berlin: weekly 09:00 series created in summer, VTIMEZONE with yearly rules', () => {
    const ics = build([
      task({ ...timed('2026-07-13', '09:00'), recurrence: { kind: 'weekly', interval: 1, weekdays: [1] } }),
      task(timed('2026-12-01', '18:00')),
      task(allDay('2026-08-01')),
    ], 'Projekt', 'Europe/Berlin');
    const lines = unfold(ics);
    assert.equal(prop(event(ics), 'DTSTART'), 'DTSTART;TZID=Europe/Berlin:20260713T090000');
    assert.equal(prop(event(ics), 'DTEND'), 'DTEND;TZID=Europe/Berlin:20260713T093000');
    // One VTIMEZONE per zone, before the first VEVENT.
    const all = vtimezones(ics);
    assert.equal(all.length, 1);
    assert.ok(lines.indexOf('BEGIN:VTIMEZONE') < lines.indexOf('BEGIN:VEVENT'));
    const vtz = all[0] ?? [];
    assert.equal(prop(vtz, 'TZID'), 'TZID:Europe/Berlin');
    const daylight = observance(vtz, 'DAYLIGHT');
    assert.equal(prop(daylight, 'RRULE'), 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU');
    assert.equal(prop(daylight, 'TZOFFSETFROM'), 'TZOFFSETFROM:+0100');
    assert.equal(prop(daylight, 'TZOFFSETTO'), 'TZOFFSETTO:+0200');
    assert.equal(prop(daylight, 'DTSTART'), 'DTSTART:20250330T020000');
    const standard = observance(vtz, 'STANDARD');
    assert.equal(prop(standard, 'RRULE'), 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU');
    assert.equal(prop(standard, 'TZOFFSETFROM'), 'TZOFFSETFROM:+0200');
    assert.equal(prop(standard, 'TZOFFSETTO'), 'TZOFFSETTO:+0100');
    assert.equal(prop(standard, 'DTSTART'), 'DTSTART:20251026T030000');
    // The yearly rules keep matching the real zone long after the probed window.
    agreesWithIntl(vtz, 'Europe/Berlin', 2025, 2040);
  });

  test('America/New_York: second Sunday in March, first Sunday in November', () => {
    // 09:00 EDT = 13:00Z.
    const ics = build([task({ ...timedAt('2026-07-15T13:00:00.000Z'), recurrence: { kind: 'daily', interval: 1 } })], 'P', 'America/New_York');
    assert.equal(prop(event(ics), 'DTSTART'), 'DTSTART;TZID=America/New_York:20260715T090000');
    const vtz = vtimezones(ics)[0] ?? [];
    const daylight = observance(vtz, 'DAYLIGHT');
    assert.equal(prop(daylight, 'RRULE'), 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU');
    assert.equal(prop(daylight, 'TZOFFSETFROM'), 'TZOFFSETFROM:-0500');
    assert.equal(prop(daylight, 'TZOFFSETTO'), 'TZOFFSETTO:-0400');
    const standard = observance(vtz, 'STANDARD');
    assert.equal(prop(standard, 'RRULE'), 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU');
    assert.equal(prop(standard, 'DTSTART'), 'DTSTART:20251102T020000');
    agreesWithIntl(vtz, 'America/New_York', 2025, 2040);
  });

  test('Asia/Kolkata (no DST): a single STANDARD with +0530 → +0530', () => {
    // 09:00 IST = 03:30Z.
    const ics = build([task(timedAt('2026-07-15T03:30:00.000Z'))], 'P', 'Asia/Kolkata');
    assert.equal(prop(event(ics), 'DTSTART'), 'DTSTART;TZID=Asia/Kolkata:20260715T090000');
    assert.equal(prop(event(ics), 'DTEND'), 'DTEND;TZID=Asia/Kolkata:20260715T093000');
    const vtz = vtimezones(ics)[0] ?? [];
    assert.equal(blocks(vtz, 'DAYLIGHT').length, 0);
    const standard = observance(vtz, 'STANDARD');
    assert.equal(prop(standard, 'TZOFFSETFROM'), 'TZOFFSETFROM:+0530');
    assert.equal(prop(standard, 'TZOFFSETTO'), 'TZOFFSETTO:+0530');
    assert.equal(prop(standard, 'RRULE'), undefined);
    assert.ok(prop(standard, 'DTSTART'));
    agreesWithIntl(vtz, 'Asia/Kolkata', 2025, 2030);
  });

  test('Australia/Sydney (southern hemisphere): DAYLIGHT in October, STANDARD in April', () => {
    // 09:00 AEST (winter there) = 23:00Z the day before.
    const ics = build([task(timedAt('2026-07-14T23:00:00.000Z'))], 'P', 'Australia/Sydney');
    assert.equal(prop(event(ics), 'DTSTART'), 'DTSTART;TZID=Australia/Sydney:20260715T090000');
    const vtz = vtimezones(ics)[0] ?? [];
    const daylight = observance(vtz, 'DAYLIGHT');
    assert.equal(prop(daylight, 'RRULE'), 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU');
    assert.equal(prop(daylight, 'TZOFFSETFROM'), 'TZOFFSETFROM:+1000');
    assert.equal(prop(daylight, 'TZOFFSETTO'), 'TZOFFSETTO:+1100');
    const standard = observance(vtz, 'STANDARD');
    assert.equal(prop(standard, 'RRULE'), 'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU');
    assert.equal(prop(standard, 'DTSTART'), 'DTSTART:20250406T030000');
    agreesWithIntl(vtz, 'Australia/Sydney', 2025, 2040);
  });

  test('irregular transitions are listed explicitly (DTSTART + RDATE) and still match Intl', () => {
    // Chile ends DST on the first Sunday on or after 2 April (2029: 8 April), which is no yearly rule.
    const ics = build([task(timedAt('2026-07-15T13:00:00.000Z'))], 'P', 'America/Santiago');
    const vtz = vtimezones(ics)[0] ?? [];
    assert.ok(vtz.some((l) => l.startsWith('RDATE:')));
    for (const line of vtz.filter((l) => l.startsWith('RDATE:') || l.startsWith('DTSTART:'))) {
      assert.match(line, /^(RDATE|DTSTART):\d{8}T\d{6}$/u);
    }
    agreesWithIntl(vtz, 'America/Santiago', 2025, 2029);
  });

  test('UTC fallback: UTC, Etc/* and unknown zones write "…Z" and no VTIMEZONE', () => {
    for (const zone of ['UTC', 'Etc/UTC', 'Etc/GMT-2', 'GMT', 'Mars/Olympus_Mons', '']) {
      const ics = build([task(timed('2026-01-15', '09:00'))], 'P', zone);
      assert.equal(prop(event(ics), 'DTSTART'), 'DTSTART:20260115T080000Z', zone);
      assert.equal(prop(event(ics), 'DTEND'), 'DTEND:20260115T083000Z', zone);
      assert.equal(vtimezones(ics).length, 0, zone);
    }
    assert.equal(tzidZone('Europe/Berlin'), 'Europe/Berlin');
    assert.equal(tzidZone('Etc/GMT+5'), null);
    assert.equal(tzidZone(undefined), null);
  });

  test('all-day events stay VALUE=DATE and need no VTIMEZONE', () => {
    const ics = build([task(allDay('2026-10-20'))], 'P', 'Europe/Berlin');
    assert.equal(prop(event(ics), 'DTSTART'), 'DTSTART;VALUE=DATE:20261020');
    assert.equal(vtimezones(ics).length, 0);
  });

  test('absolute reminders stay UTC next to a TZID start', () => {
    const lines = event(build([task({
      ...timed('2026-10-20', '14:00'),
      reminders: [{ id: 'r', mode: 'absolute', at: isoAt('2026-10-20', '08:00') }, { id: 's', mode: 'relative', offsetMinutes: 10 }],
    })], 'P', 'Europe/Berlin'));
    assert.equal(prop(lines, 'DTSTART'), 'DTSTART;TZID=Europe/Berlin:20261020T140000');
    assert.ok(lines.includes('TRIGGER;VALUE=DATE-TIME:20261020T060000Z'));
    assert.ok(lines.includes('TRIGGER:-PT10M'));
  });

  test('icsOffset', () => {
    assert.equal(icsOffset(60), '+0100');
    assert.equal(icsOffset(-300), '-0500');
    assert.equal(icsOffset(330), '+0530');
    assert.equal(icsOffset(0), '+0000');
    assert.equal(icsOffset(-570), '-0930');
  });

  test('whole file with VTIMEZONE: CRLF only, every physical line ≤ 75 octets', () => {
    const title = 'Wöchentliche Übungsfläche gießen und Kräuter prüfen, danach Notizen schreiben '.repeat(2);
    for (const zone of ['Europe/Berlin', 'America/Argentina/Buenos_Aires', 'Australia/Sydney']) {
      const ics = build([
        task({ ...timed('2026-07-13', '09:00'), title, recurrence: { kind: 'weekly', interval: 2, weekdays: [1, 3, 5] } }),
        task({ ...allDay('2026-07-14'), title }),
      ], title, zone);
      assert.ok(ics.endsWith('\r\n'));
      assert.equal(ics.replace(/\r\n/gu, '').includes('\n'), false, 'bare LF');
      assert.equal(ics.replace(/\r\n/gu, '').includes('\r'), false, 'bare CR');
      for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `${zone}: ${line}`);
      const lines = unfold(ics);
      assert.equal(lines.filter((l) => l === 'BEGIN:VTIMEZONE').length, 1);
      assert.equal(lines.filter((l) => l.startsWith('BEGIN:')).length, lines.filter((l) => l.startsWith('END:')).length);
    }
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
