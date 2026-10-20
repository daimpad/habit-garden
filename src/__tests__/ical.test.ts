// Calendar import (services/ical.ts): parsing, zones, recurrences, exceptions, overrides, ranges.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CalendarEvent } from '../model.js';
import {
  durationMinutes, eventRange, expandEvents, normalizeZone, parseIcal, parseRule, timeRange, unescapeText, wallToMs,
  type ParsedEvent,
} from '../services/ical.js';

process.env.TZ = 'Europe/Berlin';

const cal = (...events: string[]): string => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Privat', 'X-APPLE-CALENDAR-COLOR:#3a87ad', ...events, 'END:VCALENDAR'].join('\r\n');
const ev = (...lines: string[]): string => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');

/** Parsed event → stored event (as the repository does it). */
function store(p: ParsedEvent, sourceId = 's1'): CalendarEvent {
  const { cancelled, ...rest } = p;
  const id = p.recurrenceDay ? `${sourceId}:${p.uid}:${p.recurrenceDay}` : `${sourceId}:${p.uid}`;
  return { ...rest, ...(cancelled && p.recurrenceDay ? { duration: -1 } : {}), id, sourceId, ...eventRange(p) };
}
const events = (text: string): CalendarEvent[] => parseIcal(text).events.filter((p) => !(p.cancelled && !p.recurrenceDay)).map((p) => store(p));

describe('parsing', () => {
  test('calendar name and colour, folded lines, escaped text', () => {
    const c = parseIcal(cal(ev('UID:1', 'DTSTART;VALUE=DATE:20261024', 'SUMMARY:Geburtstag\\, Lena', 'DESCRIPTION:Zeile eins\\nZeile', ' zwei', 'LOCATION:Café \\; Bar')));
    assert.equal(c.name, 'Privat');
    assert.equal(c.color, '#3A87AD');
    const e = c.events[0];
    assert.equal(e?.title, 'Geburtstag, Lena');
    assert.equal(e?.description, 'Zeile eins\nZeilezwei');
    assert.equal(e?.location, 'Café ; Bar');
    assert.equal(e?.allDay, 1);
    assert.equal(e?.duration, 1);
  });
  test('LF-only files, quoted parameters with colons, VTODO and VALARM ignored', () => {
    const text = ['BEGIN:VCALENDAR', 'BEGIN:VTODO', 'UID:t', 'DTSTART:20261020T100000Z', 'END:VTODO',
      'BEGIN:VEVENT', 'UID:a', 'ORGANIZER;CN="Doe: John":mailto:x@y', 'DTSTART;TZID="Europe/Berlin":20261020T090000', 'DTEND;TZID=Europe/Berlin:20261020T103000',
      'BEGIN:VALARM', 'TRIGGER:-PT10M', 'END:VALARM', 'SUMMARY:Arzt', 'END:VEVENT', 'END:VCALENDAR'].join('\n');
    const c = parseIcal(text);
    assert.equal(c.events.length, 1);
    assert.deepEqual([c.events[0]?.startTime, c.events[0]?.tz, c.events[0]?.duration, c.events[0]?.title], ['09:00', 'Europe/Berlin', 90, 'Arzt']);
  });
  test('UTC, floating and Windows zone names', () => {
    const c = parseIcal(cal(
      ev('UID:u', 'DTSTART:20261020T070000Z', 'DURATION:PT45M', 'SUMMARY:U'),
      ev('UID:f', 'DTSTART:20261020T090000', 'SUMMARY:F'),
      ev('UID:w', 'DTSTART;TZID=W. Europe Standard Time:20261020T090000', 'SUMMARY:W'),
      ev('UID:x', 'DTSTART;TZID=Mars/Olympus:20261020T090000', 'SUMMARY:X'),
    ));
    assert.deepEqual(c.events.map((e) => [e.uid, e.tz ?? 'local', e.duration]), [['u', 'UTC', 45], ['f', 'local', 60], ['w', 'Europe/Berlin', 60], ['x', 'local', 60]]);
    assert.equal(normalizeZone('/mozilla.org/20070129_1/Europe/Vienna'), 'Europe/Vienna');
    assert.equal(normalizeZone('Etc/UTC'), 'UTC');
  });
  test('durations and rules', () => {
    assert.equal(durationMinutes('PT1H30M'), 90);
    assert.equal(durationMinutes('P1D'), 1440);
    assert.equal(durationMinutes('P1W'), 10080);
    assert.equal(durationMinutes('-PT5M'), null);
    assert.deepEqual(parseRule('FREQ=MONTHLY;BYDAY=-1FR;INTERVAL=2;COUNT=5'), { freq: 'MONTHLY', interval: 2, count: 5, byDay: [{ n: -1, wd: 'FR' }] });
    assert.equal(parseRule('FREQ=HOURLY'), undefined);
    assert.equal(parseRule('FREQ=WEEKLY;UNTIL=20261231')?.until, '2026-12-31');
    assert.equal(parseRule('FREQ=WEEKLY;UNTIL=20261231T225959Z')?.until, '2026-12-31T22:59:59.000Z');
    assert.equal(unescapeText('a\\\\b'), 'a\\b');
  });
  test('cancelled events are marked', () => {
    const c = parseIcal(cal(ev('UID:c', 'DTSTART:20261020T090000Z', 'STATUS:CANCELLED', 'SUMMARY:Abgesagt')));
    assert.equal(c.events[0]?.cancelled, true);
  });
});

describe('zones', () => {
  test('wall clock in a zone to an instant, across DST', () => {
    assert.equal(new Date(wallToMs('2026-10-20', '09:00', 'Europe/Berlin')).toISOString(), '2026-10-20T07:00:00.000Z');
    assert.equal(new Date(wallToMs('2026-12-20', '09:00', 'Europe/Berlin')).toISOString(), '2026-12-20T08:00:00.000Z');
    assert.equal(new Date(wallToMs('2026-10-20', '09:00', 'America/New_York')).toISOString(), '2026-10-20T13:00:00.000Z');
    assert.equal(new Date(wallToMs('2026-10-20', '09:00', 'UTC')).toISOString(), '2026-10-20T09:00:00.000Z');
  });
  test('a New York meeting shows at the Berlin local time', () => {
    const list = expandEvents(events(cal(ev('UID:ny', 'DTSTART;TZID=America/New_York:20261020T180000', 'DTEND;TZID=America/New_York:20261020T190000', 'SUMMARY:Call'))), '2026-10-20', '2026-10-21');
    // 18:00 New York = 00:00 Berlin the next day.
    assert.deepEqual(list.map((o) => [o.startDay, o.start]), [['2026-10-21', '2026-10-20T22:00:00.000Z']]);
  });
});

describe('recurrence', () => {
  const days = (text: string, from: string, to: string): string[] => expandEvents(events(text), from, to).map((o) => o.startDay);
  test('weekly on two weekdays keeps 09:00 across the DST change', () => {
    const text = cal(ev('UID:w', 'DTSTART;TZID=Europe/Berlin:20261019T090000', 'DTEND;TZID=Europe/Berlin:20261019T093000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH', 'SUMMARY:Team'));
    const list = expandEvents(events(text), '2026-10-19', '2026-11-05');
    assert.deepEqual(list.map((o) => o.startDay), ['2026-10-19', '2026-10-22', '2026-10-26', '2026-10-29', '2026-11-02', '2026-11-05']);
    assert.ok(list.every((o) => new Date(o.start ?? '').getHours() === 9));
  });
  test('daily with COUNT and EXDATE (COUNT counts before the exclusion)', () => {
    const text = cal(ev('UID:d', 'DTSTART;VALUE=DATE:20261020', 'RRULE:FREQ=DAILY;COUNT=4', 'EXDATE;VALUE=DATE:20261021', 'SUMMARY:Kur'));
    assert.deepEqual(days(text, '2026-10-01', '2026-10-31'), ['2026-10-20', '2026-10-22', '2026-10-23']);
  });
  test('UNTIL as a UTC instant is inclusive', () => {
    const text = cal(ev('UID:u', 'DTSTART;TZID=Europe/Berlin:20261020T090000', 'RRULE:FREQ=DAILY;UNTIL=20261022T070000Z', 'SUMMARY:U'));
    assert.deepEqual(days(text, '2026-10-01', '2026-10-31'), ['2026-10-20', '2026-10-21', '2026-10-22']);
  });
  test('monthly: last Friday, 31st skips short months, BYSETPOS last workday', () => {
    assert.deepEqual(days(cal(ev('UID:a', 'DTSTART;VALUE=DATE:20261030', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR', 'SUMMARY:A')), '2026-10-01', '2027-01-31'),
      ['2026-10-30', '2026-11-27', '2026-12-25', '2027-01-29']);
    assert.deepEqual(days(cal(ev('UID:b', 'DTSTART;VALUE=DATE:20261031', 'RRULE:FREQ=MONTHLY', 'SUMMARY:B')), '2026-10-01', '2027-01-31'),
      ['2026-10-31', '2026-12-31', '2027-01-31']);
    assert.deepEqual(days(cal(ev('UID:c', 'DTSTART;VALUE=DATE:20261030', 'RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', 'SUMMARY:C')), '2026-10-01', '2027-01-31'),
      ['2026-10-30', '2026-11-30', '2026-12-31', '2027-01-29']);
  });
  test('yearly birthday on 29 February only in leap years; interval 2 weeks', () => {
    assert.deepEqual(days(cal(ev('UID:y', 'DTSTART;VALUE=DATE:20240229', 'RRULE:FREQ=YEARLY', 'SUMMARY:Y')), '2025-01-01', '2028-12-31'), ['2028-02-29']);
    assert.deepEqual(days(cal(ev('UID:i', 'DTSTART;VALUE=DATE:20261005', 'RRULE:FREQ=WEEKLY;INTERVAL=2', 'SUMMARY:I')), '2026-10-01', '2026-11-30'),
      ['2026-10-05', '2026-10-19', '2026-11-02', '2026-11-16', '2026-11-30']);
  });
  test('a long-running daily series is found far in the future', () => {
    assert.deepEqual(days(cal(ev('UID:l', 'DTSTART;VALUE=DATE:20100101', 'RRULE:FREQ=DAILY;INTERVAL=3', 'SUMMARY:L')), '2026-10-20', '2026-10-25'),
      ['2026-10-22', '2026-10-25']);
  });
  test('an override moves one occurrence, a cancelled override removes one', () => {
    const text = cal(
      ev('UID:m', 'DTSTART;TZID=Europe/Berlin:20261019T090000', 'RRULE:FREQ=DAILY;COUNT=5', 'SUMMARY:Stand-up'),
      ev('UID:m', 'RECURRENCE-ID;TZID=Europe/Berlin:20261020T090000', 'DTSTART;TZID=Europe/Berlin:20261020T140000', 'SUMMARY:Stand-up (verschoben)'),
      ev('UID:m', 'RECURRENCE-ID;TZID=Europe/Berlin:20261021T090000', 'DTSTART;TZID=Europe/Berlin:20261021T090000', 'STATUS:CANCELLED', 'SUMMARY:Stand-up'),
    );
    const list = expandEvents(events(text), '2026-10-19', '2026-10-23');
    assert.deepEqual(list.map((o) => `${o.startDay} ${new Date(o.start ?? '').getHours()} ${o.title}`), [
      '2026-10-19 9 Stand-up', '2026-10-20 14 Stand-up (verschoben)', '2026-10-22 9 Stand-up', '2026-10-23 9 Stand-up',
    ]);
  });
});

describe('days and display', () => {
  test('multi-day all-day event covers each day, DTEND exclusive', () => {
    const list = expandEvents(events(cal(ev('UID:u', 'DTSTART;VALUE=DATE:20261020', 'DTEND;VALUE=DATE:20261023', 'SUMMARY:Urlaub'))), '2026-10-22', '2026-10-22');
    assert.deepEqual(list.map((o) => [o.startDay, o.endDay]), [['2026-10-20', '2026-10-22']]);
    assert.equal(expandEvents(events(cal(ev('UID:u', 'DTSTART;VALUE=DATE:20261020', 'DTEND;VALUE=DATE:20261023', 'SUMMARY:Urlaub'))), '2026-10-23', '2026-10-23').length, 0);
  });
  test('sorted: all-day first, then by time; time ranges', () => {
    const list = expandEvents(events(cal(
      ev('UID:b', 'DTSTART;TZID=Europe/Berlin:20261020T140000', 'DTEND;TZID=Europe/Berlin:20261020T150000', 'SUMMARY:B'),
      ev('UID:a', 'DTSTART;TZID=Europe/Berlin:20261020T090000', 'DTEND;TZID=Europe/Berlin:20261020T100000', 'SUMMARY:A'),
      ev('UID:c', 'DTSTART;VALUE=DATE:20261020', 'SUMMARY:C'),
      ev('UID:n', 'DTSTART;TZID=Europe/Berlin:20261020T230000', 'DTEND;TZID=Europe/Berlin:20261021T010000', 'SUMMARY:N'),
    )), '2026-10-20', '2026-10-20');
    assert.deepEqual(list.map((o) => o.title), ['C', 'A', 'B', 'N']);
    assert.deepEqual(timeRange(list[1]!, '2026-10-20'), { from: '09:00', to: '10:00' });
    assert.deepEqual(timeRange(list[3]!, '2026-10-20'), { from: '23:00' });
    assert.equal(timeRange(list[0]!, '2026-10-20'), null);
  });
  test('event ranges for queries', () => {
    const [single] = events(cal(ev('UID:s', 'DTSTART;VALUE=DATE:20261020', 'SUMMARY:S')));
    assert.deepEqual([single?.firstDay, single?.lastDay], ['2026-10-19', '2026-10-22']);
    const [open] = events(cal(ev('UID:o', 'DTSTART;VALUE=DATE:20261020', 'RRULE:FREQ=WEEKLY', 'SUMMARY:O')));
    assert.equal(open?.lastDay, '9999-12-31');
  });
});
