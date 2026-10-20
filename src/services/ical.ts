// Calendar import (decision of 20.10.2026: sync over files, no account, no server). Pure: no DOM, no Dexie.
//
// parseIcal(text) reads an iCalendar file (RFC 5545) as Google, Apple/iCloud, Outlook and others export it:
// - Lines are unfolded (CRLF or LF followed by a space or tab), property parameters are read (quoted values
//   may contain ":" and ";"), TEXT values are unescaped (\n \N \, \; \\).
// - The calendar name comes from X-WR-CALNAME, its colour from X-APPLE-CALENDAR-COLOR / COLOR (#rrggbb).
// - Every VEVENT becomes one ParsedEvent (VTODO, VJOURNAL and VALARM are skipped): UID, SUMMARY, LOCATION,
//   DESCRIPTION, STATUS (CANCELLED), DTSTART with DTEND or DURATION, RRULE, EXDATE, RECURRENCE-ID.
// - DTSTART;VALUE=DATE:20261020 is all-day (DTEND exclusive; default one day). DTSTART:…Z is UTC; with TZID the
//   wall-clock time belongs to that zone; without both it is floating (the device's local time).
// - TZID: an IANA name is used as it is (a leading "/" or a "/mozilla.org/…/" prefix is dropped); Windows names
//   from Outlook ("W. Europe Standard Time") map to IANA through WINDOWS_ZONES; anything unknown is floating.
// - RRULE: FREQ DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL, BYDAY (with ordinals, e.g. 2MO, -1FR),
//   BYMONTHDAY, BYMONTH and BYSETPOS. Other frequencies (HOURLY …) are dropped: the event stays a single one.
//
// expandEvents(events, from, to, zone) lists the occurrences that touch the local days from … to (inclusive):
// - Recurrences are generated in the event's own wall-clock time (so a weekly 09:00 meeting stays at 09:00 in
//   its zone across DST), then converted to instants and to the local day/time of `zone` (default: the system).
// - COUNT counts generated occurrences before EXDATE removes some (RFC 5545 3.8.5.1); UNTIL is inclusive.
// - An override (RECURRENCE-ID) replaces the master's occurrence on that date; a cancelled override removes it.
// - A multi-day event appears on every local day it covers; all-day events end on the day before DTEND.
import type { CalendarEvent, Day, IcalRule, IcalWeekday, ISO } from '../model.js';
import { addDays, dayParts, daysInMonth, diffDays, isoWeekday, makeDay } from '../util/date.js';

export type ParsedEvent = Omit<CalendarEvent, 'id' | 'sourceId' | 'firstDay' | 'lastDay'> & { cancelled?: boolean };

export interface ParsedCalendar { name?: string; color?: string; events: ParsedEvent[] }

export interface Occurrence {
  /** Stable key of this occurrence: event id plus its wall-clock date. */
  key: string;
  eventId: string;
  sourceId: string;
  title: string;
  location?: string;
  description?: string;
  allDay: boolean;
  /** Local days covered (all-day: start … last day; timed: day of start … day of end). */
  startDay: Day;
  endDay: Day;
  /** Instants of timed occurrences. */
  start?: ISO;
  end?: ISO;
}

/** Outlook's Windows zone names → IANA (the common ones; others stay floating). */
export const WINDOWS_ZONES: Readonly<Record<string, string>> = {
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Atlantic Standard Time': 'America/Halifax',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC',
};

const WEEKDAYS: readonly IcalWeekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const OPEN_END: Day = '9999-12-31';
/** Safety limits: occurrences per event and window, and generator steps. */
const MAX_STEPS = 20_000;

// --- Lexing ---

interface Prop { name: string; params: Record<string, string>; value: string }

function unfold(text: string): string[] {
  return text.replace(/^﻿/u, '').replace(/\r\n|\r/gu, '\n').replace(/\n[ \t]/gu, '').split('\n');
}

function parseLine(line: string): Prop | null {
  let i = 0;
  let quoted = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const parts: string[] = [];
  let cur = '';
  quoted = false;
  for (const c of head) {
    if (c === '"') quoted = !quoted;
    if (c === ';' && !quoted) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  const name = (parts.shift() ?? '').toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/gu, '');
  }
  return name ? { name, params, value } : null;
}

export function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/gu, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

// --- Zones ---

const zoneCache = new Map<string, Intl.DateTimeFormat | null>();

function formatter(zone: string): Intl.DateTimeFormat | null {
  if (!zoneCache.has(zone)) {
    try {
      zoneCache.set(zone, new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      }));
    } catch {
      zoneCache.set(zone, null);
    }
  }
  return zoneCache.get(zone) ?? null;
}

/** IANA zone for a TZID, or undefined (floating) when it is unknown. */
export function normalizeZone(tzid: string | undefined): string | undefined {
  if (!tzid) return undefined;
  let z = tzid.trim().replace(/^"|"$/gu, '');
  const mozilla = /\/(?:mozilla\.org|citadel\.org)\/[^/]+\/(.+)$/u.exec(z);
  if (mozilla?.[1]) z = mozilla[1];
  z = z.replace(/^\/+/u, '');
  const mapped = WINDOWS_ZONES[z] ?? z;
  if (/^(?:UTC|GMT|Z|Etc\/UTC|Etc\/GMT)$/iu.test(mapped)) return 'UTC';
  return formatter(mapped) ? mapped : undefined;
}

/** Offset of `zone` at instant ms (zone wall clock − UTC), in ms. */
function offsetAt(zone: string, ms: number): number {
  const f = formatter(zone);
  if (!f) return 0;
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p['year'] ?? 1970, (p['month'] ?? 1) - 1, p['day'] ?? 1, (p['hour'] ?? 0) % 24, p['minute'] ?? 0, p['second'] ?? 0);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * Instant (ms) of a wall-clock time: in `zone` (IANA or 'UTC'), or local when zone is undefined. A time in a
 * spring-forward gap moves forward like the browser's Date does; an ambiguous fall-back time takes the first.
 */
export function wallToMs(day: Day, time: string, zone: string | undefined): number {
  const { year, month, date } = dayParts(day);
  const [hh = 0, mm = 0] = time.split(':').map(Number);
  if (!zone) return new Date(year, month - 1, date, hh, mm).getTime();
  const guess = Date.UTC(year, month - 1, date, hh, mm);
  if (zone === 'UTC') return guess;
  const first = guess - offsetAt(zone, guess);
  const second = guess - offsetAt(zone, first);
  return second;
}

// --- Values ---

interface DateValue { day: Day; time?: string; zone?: string; utc?: boolean }

function parseDateValue(prop: Prop): DateValue | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/u.exec(prop.value.trim());
  if (!m) return null;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  if (prop.params['VALUE'] === 'DATE' || m[4] === undefined) return { day };
  const time = `${m[4]}:${m[5]}`;
  if (m[7] === 'Z') return { day, time, zone: 'UTC', utc: true };
  return { day, time, zone: normalizeZone(prop.params['TZID']) };
}

/** Converts a date value to a wall-clock date/time in `zone` (for EXDATE/RECURRENCE-ID given in another zone). */
function toZone(v: DateValue, zone: string | undefined): DateValue {
  if (!v.time || v.zone === zone) return v;
  const ms = wallToMs(v.day, v.time, v.zone);
  return msToWall(ms, zone);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function msToWall(ms: number, zone: string | undefined): DateValue {
  if (!zone) {
    const d = new Date(ms);
    return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }
  const shifted = new Date(ms + (zone === 'UTC' ? 0 : offsetAt(zone, ms)));
  return { day: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`, time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`, zone };
}

/** Minutes (timed) of an ISO 8601 duration such as PT1H30M, P1D, P1W; null when invalid or negative. */
export function durationMinutes(value: string): number | null {
  const m = /^(\+)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/u.exec(value.trim());
  if (!m || value.trim().startsWith('-')) return null;
  const [w, d, h, min, s] = [m[2], m[3], m[4], m[5], m[6]].map((x) => Number(x ?? 0)) as [number, number, number, number, number];
  return w * 7 * 1440 + d * 1440 + h * 60 + min + Math.round(s / 60);
}

export function parseRule(value: string): IcalRule | undefined {
  const fields: Record<string, string> = {};
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) fields[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  const freq = fields['FREQ'];
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return undefined;
  const rule: IcalRule = { freq, interval: Math.max(1, Number(fields['INTERVAL'] ?? 1) || 1) };
  const count = Number(fields['COUNT']);
  if (Number.isInteger(count) && count > 0) rule.count = count;
  if (fields['UNTIL']) {
    const u = parseDateValue({ name: 'UNTIL', params: {}, value: fields['UNTIL'] });
    // Seconds matter for an inclusive UNTIL (…T225959Z), so they are added back here.
    const sec = Number(/T\d{4}(\d{2})/u.exec(fields['UNTIL'])?.[1] ?? 0);
    if (u) rule.until = u.time ? new Date(wallToMs(u.day, u.time, u.zone) + sec * 1000).toISOString() : u.day;
  }
  const ints = (key: string, lo: number, hi: number): number[] | undefined => {
    const list = (fields[key] ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n !== 0 && Math.abs(n) >= lo && Math.abs(n) <= hi);
    return list.length ? list : undefined;
  };
  const byMonthDay = ints('BYMONTHDAY', 1, 31);
  if (byMonthDay) rule.byMonthDay = byMonthDay;
  const byMonth = ints('BYMONTH', 1, 12)?.filter((n) => n > 0);
  if (byMonth?.length) rule.byMonth = byMonth;
  const bySetPos = ints('BYSETPOS', 1, 366);
  if (bySetPos) rule.bySetPos = bySetPos;
  if (fields['BYDAY']) {
    const byDay: { n?: number; wd: IcalWeekday }[] = [];
    for (const item of fields['BYDAY'].split(',')) {
      const m = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/u.exec(item.trim().toUpperCase());
      if (!m) continue;
      const wd = m[2] as IcalWeekday;
      byDay.push(m[1] ? { n: Number(m[1]), wd } : { wd });
    }
    if (byDay.length) rule.byDay = byDay;
  }
  return rule;
}

// --- Parsing ---

export function parseIcal(text: string): ParsedCalendar {
  const out: ParsedCalendar = { events: [] };
  let depth: string[] = [];
  let props: Prop[] = [];
  for (const line of unfold(text)) {
    if (!line.trim()) continue;
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === 'BEGIN') {
      depth.push(prop.value.toUpperCase());
      if (prop.value.toUpperCase() === 'VEVENT') props = [];
      continue;
    }
    if (prop.name === 'END') {
      const kind = prop.value.toUpperCase();
      if (kind === 'VEVENT' && depth[depth.length - 1] === 'VEVENT') {
        const event = buildEvent(props);
        if (event) out.events.push(event);
      }
      const at = depth.lastIndexOf(kind);
      depth = at >= 0 ? depth.slice(0, at) : depth;
      continue;
    }
    const top = depth[depth.length - 1];
    if (top === 'VEVENT') props.push(prop);
    else if (top === 'VCALENDAR') {
      if (prop.name === 'X-WR-CALNAME' && prop.value.trim()) out.name = unescapeText(prop.value.trim());
      if ((prop.name === 'X-APPLE-CALENDAR-COLOR' || prop.name === 'COLOR' || prop.name === 'X-WR-CALCOLOR') && /^#[0-9a-f]{6}/iu.test(prop.value)) {
        out.color = prop.value.slice(0, 7).toUpperCase();
      }
    }
  }
  return out;
}

function buildEvent(props: Prop[]): ParsedEvent | null {
  const get = (name: string): Prop | undefined => props.find((p) => p.name === name);
  const startProp = get('DTSTART');
  const start = startProp ? parseDateValue(startProp) : null;
  if (!start) return null;
  const uid = get('UID')?.value.trim() || `${start.day}T${start.time ?? ''}:${get('SUMMARY')?.value ?? ''}`;
  const title = unescapeText(get('SUMMARY')?.value ?? '').trim();
  const event: ParsedEvent = { uid, title, allDay: start.time ? 0 : 1, startDay: start.day, duration: start.time ? 60 : 1 };
  const location = unescapeText(get('LOCATION')?.value ?? '').trim();
  if (location) event.location = location;
  const description = unescapeText(get('DESCRIPTION')?.value ?? '').trim();
  if (description) event.description = description.slice(0, 4000);
  if (get('STATUS')?.value.trim().toUpperCase() === 'CANCELLED') event.cancelled = true;
  if (start.time) {
    event.startTime = start.time;
    if (start.zone) event.tz = start.zone;
  }
  // Length from DTEND (preferred) or DURATION.
  const endProp = get('DTEND');
  const end = endProp ? parseDateValue(endProp) : null;
  if (end && event.allDay === 1) {
    event.duration = Math.max(1, diffDays(end.day, start.day));
  } else if (end && end.time && start.time) {
    const ms = wallToMs(end.day, end.time, end.zone) - wallToMs(start.day, start.time, start.zone);
    event.duration = Math.max(0, Math.round(ms / 60_000));
  } else {
    const dur = get('DURATION');
    const minutes = dur ? durationMinutes(dur.value) : null;
    if (minutes !== null) event.duration = event.allDay === 1 ? Math.max(1, Math.round(minutes / 1440)) : minutes;
  }
  const rrule = get('RRULE');
  const rule = rrule ? parseRule(rrule.value) : undefined;
  if (rule) event.rule = rule;
  const ex: Day[] = [];
  for (const p of props.filter((q) => q.name === 'EXDATE')) {
    for (const v of p.value.split(',')) {
      const d = parseDateValue({ ...p, value: v });
      if (d) ex.push(toZone(d, event.tz).day);
    }
  }
  if (ex.length) event.exDays = [...new Set(ex)].sort();
  const rid = get('RECURRENCE-ID');
  const r = rid ? parseDateValue(rid) : null;
  if (r) event.recurrenceDay = toZone(r, event.tz).day;
  return event;
}

// --- Recurrence ---

const wdIndex = (wd: IcalWeekday): number => WEEKDAYS.indexOf(wd) + 1;

/** The n-th (negative: from the end) weekday of a month, or null. */
function nthWeekday(year: number, month: number, wd: number, n: number): Day | null {
  const days = daysInMonth(year, month);
  const list: Day[] = [];
  for (let d = 1; d <= days; d++) {
    const day = makeDay(year, month, d);
    if (isoWeekday(day) === wd) list.push(day);
  }
  return (n > 0 ? list[n - 1] : list[list.length + n]) ?? null;
}

function monthCandidates(year: number, month: number, rule: IcalRule, startDate: number): Day[] {
  const days = daysInMonth(year, month);
  let out: Day[] = [];
  if (rule.byMonthDay) {
    for (const md of rule.byMonthDay) {
      const d = md > 0 ? md : days + md + 1;
      if (d >= 1 && d <= days) out.push(makeDay(year, month, d));
    }
  } else if (rule.byDay) {
    for (const { n, wd } of rule.byDay) {
      if (n !== undefined) {
        const day = nthWeekday(year, month, wdIndex(wd), n);
        if (day) out.push(day);
      } else {
        for (let d = 1; d <= days; d++) {
          const day = makeDay(year, month, d);
          if (isoWeekday(day) === wdIndex(wd)) out.push(day);
        }
      }
    }
  } else if (startDate <= days) {
    out.push(makeDay(year, month, startDate));
  }
  out = [...new Set(out)].sort();
  if (rule.bySetPos) {
    const picked: Day[] = [];
    for (const pos of rule.bySetPos) {
      const day = pos > 0 ? out[pos - 1] : out[out.length + pos];
      if (day) picked.push(day);
    }
    out = [...new Set(picked)].sort();
  }
  return out;
}

/**
 * Wall-clock start dates of an event's series in order (the first is DTSTART), up to `until` (a wall date),
 * honouring COUNT/UNTIL. `untilOk` checks a candidate date against the rule's UNTIL.
 */
function* seriesDays(start: Day, rule: IcalRule, last: Day, untilOk: (day: Day) => boolean): Generator<Day> {
  let produced = 0;
  let steps = 0;
  const emit = function* (day: Day): Generator<Day, boolean> {
    if (day < start) return true;
    if (!untilOk(day) || day > last) return false;
    if (rule.count !== undefined && produced >= rule.count) return false;
    produced++;
    yield day;
    return true;
  };
  const { year: sy, month: sm, date: sd } = dayParts(start);
  if (rule.freq === 'DAILY') {
    // Skip ahead when nothing counts the skipped occurrences.
    let k = 0;
    if (rule.count === undefined) k = Math.max(0, Math.floor((diffDays(last, start) - 400) / rule.interval));
    for (; steps++ < MAX_STEPS; k++) {
      const day = addDays(start, k * rule.interval);
      if (rule.byMonth && !rule.byMonth.includes(dayParts(day).month)) {
        if (day > last) return;
        continue;
      }
      if (!(yield* emit(day))) return;
    }
    return;
  }
  if (rule.freq === 'WEEKLY') {
    const wds = rule.byDay?.length ? [...new Set(rule.byDay.map((b) => wdIndex(b.wd)))].sort() : [isoWeekday(start)];
    const week0 = addDays(start, 1 - isoWeekday(start));
    let k = 0;
    if (rule.count === undefined) k = Math.max(0, Math.floor((diffDays(last, week0) / 7 - 60) / rule.interval));
    for (; steps++ < MAX_STEPS; k++) {
      const monday = addDays(week0, k * 7 * rule.interval);
      if (monday > last) return;
      for (const wd of wds) {
        if (!(yield* emit(addDays(monday, wd - 1)))) return;
      }
    }
    return;
  }
  if (rule.freq === 'MONTHLY') {
    for (let k = 0; steps++ < MAX_STEPS; k++) {
      const index = (sm - 1) + k * rule.interval;
      const year = sy + Math.floor(index / 12);
      const month = (index % 12) + 1;
      if (makeDay(year, month, 1) > last) return;
      if (rule.byMonth && !rule.byMonth.includes(month)) continue;
      for (const day of monthCandidates(year, month, rule, sd)) {
        if (!(yield* emit(day))) return;
      }
    }
    return;
  }
  // YEARLY
  for (let k = 0; steps++ < MAX_STEPS; k++) {
    const year = sy + k * rule.interval;
    if (makeDay(year, 1, 1) > last) return;
    const months = rule.byMonth ?? [sm];
    const days: Day[] = [];
    for (const month of months) {
      if (rule.byMonthDay || rule.byDay) days.push(...monthCandidates(year, month, { ...rule, bySetPos: undefined }, sd));
      else if (sd <= daysInMonth(year, month)) days.push(makeDay(year, month, sd));
    }
    for (const day of [...new Set(days)].sort()) {
      if (!(yield* emit(day))) return;
    }
  }
}

function localDay(ms: number): Day {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function occurrenceOf(ev: CalendarEvent, wallDay: Day, zone: string | undefined): Occurrence {
  const base = {
    key: `${ev.id}@${wallDay}`, eventId: ev.id, sourceId: ev.sourceId, title: ev.title,
    ...(ev.location ? { location: ev.location } : {}), ...(ev.description ? { description: ev.description } : {}),
  };
  if (ev.allDay === 1) {
    return { ...base, allDay: true, startDay: wallDay, endDay: addDays(wallDay, Math.max(1, ev.duration) - 1) };
  }
  const startMs = wallToMs(wallDay, ev.startTime ?? '00:00', ev.tz ?? zone);
  const endMs = startMs + Math.max(0, ev.duration) * 60_000;
  // An event ending exactly at midnight does not reach into the next day.
  const lastMs = endMs > startMs ? endMs - 1 : endMs;
  return {
    ...base, allDay: false, startDay: localDay(startMs), endDay: localDay(lastMs),
    start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(),
  };
}

/** Local-day range an event can touch (for indexed queries), with a day of margin for zone offsets. */
export function eventRange(ev: Pick<CalendarEvent, 'startDay' | 'allDay' | 'duration' | 'rule'>): { firstDay: Day; lastDay: Day } {
  const firstDay = addDays(ev.startDay, -1);
  const span = ev.allDay === 1 ? Math.max(1, ev.duration) : Math.ceil(Math.max(0, ev.duration) / 1440) + 1;
  if (!ev.rule) return { firstDay, lastDay: addDays(ev.startDay, span + 1) };
  if (ev.rule.until) {
    const until = ev.rule.until.length > 10 ? ev.rule.until.slice(0, 10) : ev.rule.until;
    return { firstDay, lastDay: addDays(until, span + 1) };
  }
  if (ev.rule.count !== undefined) {
    // Generous bound: COUNT steps of the longest period of the frequency.
    const per = { DAILY: 1, WEEKLY: 7, MONTHLY: 31, YEARLY: 366 }[ev.rule.freq] * ev.rule.interval;
    const lastStart = addDays(ev.startDay, Math.min(ev.rule.count * per, 365 * 200));
    return { firstDay, lastDay: addDays(lastStart, span + 1) };
  }
  return { firstDay, lastDay: OPEN_END };
}

/**
 * Occurrences of `events` (masters, singles and overrides of possibly several calendars) that touch the local
 * days from … to, sorted by start (all-day first on a day, then by time, then title).
 */
export function expandEvents(events: readonly CalendarEvent[], from: Day, to: Day, zone?: string): Occurrence[] {
  const overrides = new Map<string, CalendarEvent>();
  for (const ev of events) if (ev.recurrenceDay) overrides.set(`${ev.sourceId}:${ev.uid}@${ev.recurrenceDay}`, ev);
  const out: Occurrence[] = [];
  const touches = (o: Occurrence): boolean => o.startDay <= to && o.endDay >= from;
  for (const ev of events) {
    if (ev.recurrenceDay) {
      // Cancelled overrides are stored with duration -1 (see repo); they only hide their master's instance.
      if (ev.duration >= 0) {
        const o = occurrenceOf(ev, ev.startDay, zone);
        if (touches(o)) out.push(o);
      }
      continue;
    }
    if (!ev.rule) {
      const o = occurrenceOf(ev, ev.startDay, zone);
      if (touches(o)) out.push(o);
      continue;
    }
    const spanDays = ev.allDay === 1 ? Math.max(1, ev.duration) : Math.ceil(Math.max(0, ev.duration) / 1440) + 1;
    const scanFrom = addDays(from, -spanDays - 1);
    const last = addDays(to, 1);
    const untilOk = (day: Day): boolean => {
      const u = ev.rule?.until;
      if (!u) return true;
      if (u.length <= 10) return day <= u;
      return wallToMs(day, ev.startTime ?? '00:00', ev.tz ?? zone) <= Date.parse(u);
    };
    const ex = new Set(ev.exDays ?? []);
    for (const day of seriesDays(ev.startDay, ev.rule, last, untilOk)) {
      if (day < scanFrom || ex.has(day)) continue;
      if (overrides.has(`${ev.sourceId}:${ev.uid}@${day}`)) continue;
      const o = occurrenceOf(ev, day, zone);
      if (touches(o)) out.push(o);
    }
  }
  out.sort((a, b) => (a.startDay !== b.startDay ? (a.startDay < b.startDay ? -1 : 1)
    : a.allDay !== b.allDay ? (a.allDay ? -1 : 1)
      : (a.start ?? '') !== (b.start ?? '') ? ((a.start ?? '') < (b.start ?? '') ? -1 : 1)
        : a.title.localeCompare(b.title, 'de')));
  return out;
}

/** Occurrences on one local day (multi-day events included on each of their days). */
export function occurrencesOn(events: readonly CalendarEvent[], day: Day, zone?: string): Occurrence[] {
  return expandEvents(events, day, day, zone);
}

/** "09:00–10:30", "ab 09:00" (ends another day), "bis 11:00" (began earlier) or null for all-day. */
export function timeRange(o: Occurrence, day: Day): { from?: string; to?: string } | null {
  if (o.allDay || !o.start || !o.end) return null;
  const s = new Date(o.start);
  const e = new Date(o.end);
  const hm = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const starts = o.startDay === day;
  const ends = o.endDay === day;
  if (starts && ends) return { from: hm(s), to: hm(e) };
  if (starts) return { from: hm(s) };
  if (ends) return { to: hm(e) };
  return null;
}

export const OPEN_END_DAY = OPEN_END;

// --- Storing ---

/** Calendar colours for imported calendars without their own colour (next to the app tokens). */
export const CALENDAR_COLORS: readonly string[] = ['#5B7FB5', '#C96A5A', '#8C6FB0', '#D8B24A', '#4F8F6A', '#E8963E'];
/** Single events that ended before this many days ago are left out of an import (the past view needs a year). */
export const KEEP_PAST_DAYS = 365;
/** At most this many events per calendar are kept (newest first). */
export const MAX_EVENTS = 20_000;

/**
 * Parsed events → stored rows of one calendar: cancelled single events are dropped, a cancelled override is
 * kept with duration -1 (it only hides its master's occurrence), single events that ended before `cutoff` are
 * dropped, ids are `${sourceId}:${uid}` (override: `…:${recurrenceDay}`, the later of two equal ids wins), and
 * firstDay/lastDay come from eventRange. Masters keep their recurrence even when they started long ago.
 */
export function storedEvents(parsed: readonly ParsedEvent[], sourceId: string, cutoff: Day): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  for (const p of parsed) {
    if (p.cancelled && !p.recurrenceDay) continue;
    const { cancelled, ...rest } = p;
    const id = p.recurrenceDay ? `${sourceId}:${p.uid}:${p.recurrenceDay}` : `${sourceId}:${p.uid}`;
    const row: CalendarEvent = { ...rest, id, sourceId, ...eventRange(p) };
    if (cancelled) row.duration = -1;
    if (!row.rule && row.lastDay < cutoff) continue;
    byId.set(id, row);
  }
  const rows = [...byId.values()];
  if (rows.length <= MAX_EVENTS) return rows;
  return rows.sort((a, b) => (a.lastDay > b.lastDay ? -1 : a.lastDay < b.lastDay ? 1 : 0)).slice(0, MAX_EVENTS);
}

/** Keimi's hint: the first timed occurrence running at `nowMs` or starting within `withinMin` minutes. */
export function nextEvent(list: readonly Occurrence[], nowMs: number, withinMin = 120): { title: string; time: string; running: boolean } | null {
  for (const o of list) {
    if (o.allDay || !o.start || !o.end) continue;
    const s = Date.parse(o.start);
    const e = Date.parse(o.end);
    if (e <= nowMs) continue;
    if (s <= nowMs) return { title: o.title, time: hm(s), running: true };
    if (s - nowMs <= withinMin * 60_000) return { title: o.title, time: hm(s), running: false };
  }
  return null;
}

function hm(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Number of occurrences touching each of `days` (multi-day events count on every day they cover). */
export function eventCounts(list: readonly Occurrence[], days: readonly Day[]): Map<Day, number> {
  const out = new Map<Day, number>();
  for (const day of days) {
    const n = list.filter((o) => o.startDay <= day && o.endDay >= day).length;
    if (n > 0) out.set(day, n);
  }
  return out;
}
