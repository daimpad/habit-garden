// ICS export (C.4, D.5): an iCalendar file (RFC 5545) with one VEVENT per dated task.
//
// Contract of buildIcs (pure, unit-tested):
// - VCALENDAR with VERSION:2.0, PRODID, CALSCALE:GREGORIAN, METHOD:PUBLISH and X-WR-CALNAME; CRLF line
//   endings (also after the last line); lines longer than 75 octets are folded (UTF-8 bytes are
//   counted, a multi-byte character is never split, continuation lines start with one space).
// - Tasks without a date (no dueDay and no dueAt) are skipped; every other task becomes one VEVENT.
//   buildIcs does not filter by status or nesting: the caller decides which tasks to pass.
// - UID = task id; DTSTAMP = opts.now (UTC); LAST-MODIFIED = updatedAt; SEQUENCE = whole seconds
//   between SEQUENCE_EPOCH and updatedAt (≥ 0), so it grows with every change of the task and a
//   re-import updates the existing event instead of duplicating it.
// - Timed tasks (dueHasTime 1 with dueAt) use the local wall-clock time of the time zone
//   (opts.timeZone, default: the system zone from Intl.DateTimeFormat().resolvedOptions()):
//   DTSTART;TZID=<IANA zone>:YYYYMMDDTHHMMSS and DTEND likewise. Tasks have no duration in the data
//   model, so every timed event lasts DEFAULT_DURATION_MIN (30) real minutes (01:45 CET + 30 min on
//   the spring-forward day ends at 03:15 CEST). A weekly 09:00 series therefore stays at 09:00 on
//   both sides of a DST change. Fallback to UTC ("…Z", no VTIMEZONE) when the zone is unknown or
//   empty, or a UTC-like zone (UTC, GMT, Etc/*, …).
// - One VTIMEZONE per used zone (only when at least one timed event uses a TZID), before the
//   VEVENTs, derived from the zone's real behaviour via Intl (no bundled tz database): offsets are
//   probed daily over a window of years (from the year before the earliest timed event, at least
//   TZ_WINDOW_YEARS, at most TZ_MAX_YEARS) and every offset change is located to the minute.
//   Transitions that fall on the same "n-th / last weekday of month" at the same local time in every
//   year of the window become STANDARD/DAYLIGHT with RRULE:FREQ=YEARLY;BYMONTH=m;BYDAY=nSU (or -1SU;
//   "last" wins when both fit); all other transitions are listed explicitly (DTSTART + RDATE, local
//   time before the change), so after the window such a zone keeps its last offset. DAYLIGHT = a
//   change to a larger offset. A zone without changes in the window gets one STANDARD with
//   TZOFFSETFROM = TZOFFSETTO. TZNAME only when Intl has a letter abbreviation (EST, EDT, …).
//   Observance DTSTART/RDATE are local times in the offset before the change (RFC 5545 3.6.5).
// - All-day tasks: DTSTART;VALUE=DATE = dueDay (local day), DTEND;VALUE=DATE = the following day
//   (DTEND is exclusive in RFC 5545).
// - SUMMARY = title, DESCRIPTION = description (when set); TEXT values escape \ ; , and newlines.
// - RRULE (recurring tasks; the exported task is the current, open instance of the series):
//   daily → FREQ=DAILY; weekly → FREQ=WEEKLY;BYDAY=… (ISO 1 = MO … 7 = SU; an empty list means the
//   weekday of the due day, WKST=MO when INTERVAL > 1 so the week alignment matches the app);
//   monthly → FREQ=MONTHLY;BYMONTHDAY=N ('last' → -1; N > 28 → BYMONTHDAY=28,…,N;BYSETPOS=-1, which
//   is the app's clamping to the month's last day); INTERVAL only when > 1.
//   afterCompletion gets no RRULE: its next date depends on the day the task is completed, which a
//   calendar cannot know, so only the current instance is exported. timesPerWeek applies to habits
//   only. Habits are not exported (C.4 lists them as optional).
// - Timed recurring events are anchored in the TZID wall-clock time; with the default zone (the
//   system zone) the date of DTSTART is the local due day, so BYDAY/BYMONTHDAY are written as they
//   are. Only when the date of DTSTART differs from the local due day (UTC fallback, e.g. 00:30 in
//   Berlin = 22:30Z on the previous day, or an explicit opts.timeZone other than the system zone)
//   are BYDAY and BYMONTHDAY shifted by that day so the series stays on the right days. RRULEs
//   carry no UNTIL, so no UTC conversion of an end date is needed.
// - Reminders → VALARM (ACTION:DISPLAY, DESCRIPTION = title): relative ones → TRIGGER:-PT{n}M
//   (relative to DTSTART; skipped for all-day tasks, which have no due time to count from, matching
//   services/reminders fireTime); absolute ones → TRIGGER;VALUE=DATE-TIME:…Z (always UTC, as
//   RFC 5545 3.8.6.3 requires), skipped once dismissed
//   (they already fired; a relative reminder stays because it applies to every instance of a series).
//
// exportProjectIcs exports the open (status open or doing), dated top-level tasks of one project
// (subtasks are steps of their task, done tasks are history) and hands the file to downloadIcs.
import { db } from '../db.js';
import { fmt, t } from '../i18n/de.js';
import type { Day, ISO, Project, Recurrence, Reminder, Task } from '../model.js';
import {
  addDays, compareIso, dayOfIso, daysInMonth, diffDays, isDay, isoAt, isoWeekday, now, today,
} from '../util/date.js';

export const DEFAULT_DURATION_MIN = 30;
/** VTIMEZONE: minimum number of years probed (and over which a yearly rule must hold). */
export const TZ_WINDOW_YEARS = 5;
/** VTIMEZONE: maximum number of years probed (far future due dates do not widen it further). */
export const TZ_MAX_YEARS = 12;
/** SEQUENCE counts seconds from here (before the first release, so it is never negative in practice). */
export const SEQUENCE_EPOCH = Date.UTC(2024, 0, 1);
const PRODID = '-//Habit Garden//Habit Garden 0.1//DE';
const CRLF = '\r\n';
const MAX_OCTETS = 75;
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

export interface IcsOptions {
  calendarName: string;
  now: Date;
  /** IANA zone for timed events (tests); default: the system zone (systemTimeZone). */
  timeZone?: string;
}

// ---------------------------------------------------------------------------
// Value formatting

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** "20261019T070000Z" */
export function icsUtc(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/** "2026-10-20" → "20261020" */
export function icsDate(day: Day): string {
  return day.replaceAll('-', '');
}

/** TEXT escaping (RFC 5545 3.3.11): backslash, semicolon, comma, newlines. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/gu, '\\\\')
    .replace(/;/gu, '\\;')
    .replace(/,/gu, '\\,')
    .replace(/\r\n|\r|\n/gu, '\\n');
}

const encoder = new TextEncoder();
const octets = (s: string): number => encoder.encode(s).length;

/**
 * Folds one content line (RFC 5545 3.1): at most 75 octets per physical line, continuation lines
 * start with a single space (which counts). Splits between code points, never inside one.
 */
export function foldLine(line: string): string {
  if (octets(line) <= MAX_OCTETS) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  let limit = MAX_OCTETS;
  for (const ch of line) {
    const n = octets(ch);
    if (size + n > limit) {
      parts.push(current);
      current = '';
      size = 0;
      limit = MAX_OCTETS - 1;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

/** Whole seconds between SEQUENCE_EPOCH and updatedAt (0 when before or unparsable). */
export function sequenceOf(updatedAt: ISO): number {
  const ms = Date.parse(updatedAt);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor((ms - SEQUENCE_EPOCH) / 1000));
}

/** Relative trigger: "-PT15M"; 0 → "PT0M". */
function relativeTrigger(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return m === 0 ? 'PT0M' : `-PT${m}M`;
}

// ---------------------------------------------------------------------------
// Recurrence

const intervalOf = (value: number): number => (Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1);

/** BYDAY codes for ISO weekdays, shifted by `shift` days (DTSTART date − local date), in week order. */
function byDay(weekdays: readonly number[], shift: number): string {
  const set = new Set<number>();
  for (const d of weekdays) {
    if (Number.isInteger(d) && d >= 1 && d <= 7) set.add(((d - 1 + shift) % 7 + 7) % 7);
  }
  return [...set].sort((a, b) => a - b).map((i) => BYDAY[i]).join(',');
}

/**
 * BYMONTHDAY (+ BYSETPOS) for day N or 'last', shifted by `shift` ∈ {-1, 0, 1} days (date written in
 * DTSTART − local due day). Days above 28 are clamped to the month's last day, like services/recurrence.
 */
function byMonthDay(day: number | 'last', shift: number): string {
  if (day === 'last') {
    if (shift < 0) return 'BYMONTHDAY=-2';
    // The day after the last one is the 1st of the following month.
    if (shift > 0) return 'BYMONTHDAY=1';
    return 'BYMONTHDAY=-1';
  }
  const n = Math.min(31, Math.max(1, Math.floor(day)));
  if (shift < 0) {
    if (n === 1) return 'BYMONTHDAY=-1';
    if (n <= 28) return `BYMONTHDAY=${n - 1}`;
    // The day before min(N, month end): N-1 in long months, the second to last day otherwise.
    return `BYMONTHDAY=${n - 1},-2;BYSETPOS=1`;
  }
  if (shift > 0 && n <= 27) return `BYMONTHDAY=${n + 1}`;
  // shift > 0 with N ≥ 28 cannot be expressed exactly (it may fall into the next month); the
  // unshifted rule is the closest approximation (only reachable in time zones west of UTC).
  if (n <= 28) return `BYMONTHDAY=${n}`;
  const days: number[] = [];
  for (let d = 28; d <= n; d++) days.push(d);
  return `BYMONTHDAY=${days.join(',')};BYSETPOS=-1`;
}

/**
 * RRULE value (without "RRULE:") for a task recurrence starting on the local `day`; `shift` is the
 * difference in days between the date written in DTSTART and `day` (0 for all-day events and for
 * TZID events in the system zone; ±1 only for the UTC fallback or a foreign opts.timeZone).
 * null when the rule cannot be expressed (afterCompletion, timesPerWeek).
 */
export function rrule(rec: Recurrence, day: Day, shift = 0): string | null {
  switch (rec.kind) {
    case 'daily': {
      const interval = intervalOf(rec.interval);
      return interval > 1 ? `FREQ=DAILY;INTERVAL=${interval}` : 'FREQ=DAILY';
    }
    case 'weekly': {
      const interval = intervalOf(rec.interval);
      const days = byDay(rec.weekdays.length > 0 ? rec.weekdays : [isoWeekday(day)], shift)
        || byDay([isoWeekday(day)], shift);
      return interval > 1 ? `FREQ=WEEKLY;INTERVAL=${interval};BYDAY=${days};WKST=MO` : `FREQ=WEEKLY;BYDAY=${days}`;
    }
    case 'monthly': {
      const interval = intervalOf(rec.interval);
      const head = interval > 1 ? `FREQ=MONTHLY;INTERVAL=${interval}` : 'FREQ=MONTHLY';
      return `${head};${byMonthDay(rec.day, shift)}`;
    }
    case 'afterCompletion':
    case 'timesPerWeek':
      return null;
  }
}

// ---------------------------------------------------------------------------
// Time zones (TZID + VTIMEZONE, derived from Intl)

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
/** Zones written as UTC ("…Z") instead of a TZID. */
const UTC_LIKE = /^(?:UTC|UCT|GMT|GMT0|Zulu|Universal|Greenwich|Etc\/.*)$/iu;
/** Letter abbreviations only ("EST"); Intl's "GMT+1" style names are left out. */
const TZNAME_RE = /^[A-Z]{2,6}$/u;

/** The system's IANA time zone; '' when Intl does not know it. */
export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

const formats = new Map<string, Intl.DateTimeFormat>();

/** Wall-clock formatter of a zone (throws a RangeError for an unknown zone). */
function wallFormat(zone: string): Intl.DateTimeFormat {
  let format = formats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formats.set(zone, format);
  }
  return format;
}

/** The zone to write as TZID, or null for the UTC fallback (empty, unknown or UTC-like zone). */
export function tzidZone(zone: string | undefined): string | null {
  if (!zone || UTC_LIKE.test(zone)) return null;
  try {
    wallFormat(zone);
    return zone;
  } catch {
    return null;
  }
}

/** Calendar and clock fields of a wall-clock time. */
interface Wall { y: number; mo: number; d: number; h: number; mi: number; s: number }

/** Wall-clock time of an instant in a zone. */
function wallOf(ms: number, zone: string): Wall {
  const parts = wallFormat(zone).formatToParts(ms);
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}

/** Wall-clock fields of an instant shifted by `offsetMin` (local time in a fixed offset). */
function wallAtOffset(ms: number, offsetMin: number): Wall {
  const date = new Date(ms + offsetMin * MIN_MS);
  return {
    y: date.getUTCFullYear(), mo: date.getUTCMonth() + 1, d: date.getUTCDate(),
    h: date.getUTCHours(), mi: date.getUTCMinutes(), s: date.getUTCSeconds(),
  };
}

/** "20261019T090000" (local / floating form). */
const icsWall = (w: Wall): string => `${pad(w.y, 4)}${pad(w.mo)}${pad(w.d)}T${pad(w.h)}${pad(w.mi)}${pad(w.s)}`;
const dayOfWall = (w: Wall): Day => `${pad(w.y, 4)}-${pad(w.mo)}-${pad(w.d)}`;

/** UTC offset of a zone at an instant, in whole minutes (east of UTC positive). */
export function zoneOffsetMinutes(ms: number, zone: string): number {
  const w = wallOf(ms, zone);
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MIN_MS);
}

/** "+0100", "-0430", "+0530" (TZOFFSETFROM/TO, RFC 5545 3.3.14). */
export function icsOffset(minutes: number): string {
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

interface Transition { at: number; from: number; to: number }

/**
 * Offset changes of a zone in [fromMs, toMs]: probed every day, each change located to the minute
 * by bisection (`at` = first minute of the new offset). Two changes within one day are not seen.
 */
function transitions(zone: string, fromMs: number, toMs: number): Transition[] {
  const out: Transition[] = [];
  let prevMs = fromMs;
  let prevOff = zoneOffsetMinutes(fromMs, zone);
  for (let ms = fromMs + DAY_MS; ms <= toMs; ms += DAY_MS) {
    const off = zoneOffsetMinutes(ms, zone);
    if (off !== prevOff) {
      let lo = prevMs;
      let hi = ms;
      while (hi - lo > MIN_MS) {
        const mid = lo + Math.floor((hi - lo) / 2 / MIN_MS) * MIN_MS;
        if (zoneOffsetMinutes(mid, zone) === prevOff) lo = mid;
        else hi = mid;
      }
      out.push({ at: hi, from: prevOff, to: zoneOffsetMinutes(hi, zone) });
    }
    prevMs = ms;
    prevOff = off;
  }
  return out;
}

function tzName(ms: number, zone: string): string | undefined {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(ms).find((p) => p.type === 'timeZoneName')?.value;
    return name && TZNAME_RE.test(name) ? name : undefined;
  } catch {
    return undefined;
  }
}

interface Observance {
  kind: 'STANDARD' | 'DAYLIGHT';
  from: number;
  to: number;
  /** Local start (offset `from`), sort key and DTSTART. */
  start: string;
  rrule?: string;
  rdates: string[];
  name?: string;
}

function observanceLines(o: Observance): string[] {
  const lines = [`BEGIN:${o.kind}`, `DTSTART:${o.start}`, `TZOFFSETFROM:${icsOffset(o.from)}`, `TZOFFSETTO:${icsOffset(o.to)}`];
  if (o.rrule) lines.push(`RRULE:${o.rrule}`);
  for (const rdate of o.rdates) lines.push(`RDATE:${rdate}`);
  if (o.name) lines.push(`TZNAME:${o.name}`);
  lines.push(`END:${o.kind}`);
  return lines;
}

const vtimezoneCache = new Map<string, string[]>();

/**
 * VTIMEZONE content lines (unfolded) for an IANA zone, covering the years fromYear … toYear (see the
 * contract at the top of this file for the rules). Cached per zone and window.
 */
export function vtimezone(zone: string, fromYear: number, toYear: number): string[] {
  const key = `${zone}|${fromYear}|${toYear}`;
  const cached = vtimezoneCache.get(key);
  if (cached) return cached;
  const years = toYear - fromYear + 1;
  // One day of margin on both sides: local years start up to 14 h before/after UTC years.
  const found = transitions(zone, Date.UTC(fromYear, 0, 1) - DAY_MS, Date.UTC(toYear + 1, 0, 1) + DAY_MS);
  const local = found
    .map((t) => ({ t, wall: wallAtOffset(t.at, t.from) }))
    .filter(({ wall }) => wall.y >= fromYear && wall.y <= toYear);

  const observances: Observance[] = [];
  if (local.length === 0) {
    const offset = zoneOffsetMinutes(Date.UTC(fromYear, 0, 1), zone);
    observances.push({
      kind: 'STANDARD', from: offset, to: offset, start: '19700101T000000', rdates: [],
      name: tzName(Date.UTC(fromYear, 0, 1), zone),
    });
  } else {
    // Yearly rules: the same kind, offsets, month, weekday and local time in every year of the window.
    const groups = new Map<string, typeof local>();
    for (const entry of local) {
      const { t, wall } = entry;
      const day = dayOfWall(wall);
      const groupKey = `${t.to > t.from ? 'D' : 'S'}|${t.from}|${t.to}|${wall.mo}|${isoWeekday(day)}|${icsWall(wall).slice(9)}`;
      const list = groups.get(groupKey) ?? [];
      list.push(entry);
      groups.set(groupKey, list);
    }
    const rest: typeof local = [];
    for (const list of groups.values()) {
      const first = list[0];
      const everyYear = years >= 3 && list.length === years && new Set(list.map(({ wall }) => wall.y)).size === years;
      let byDay: string | null = null;
      if (first && everyYear) {
        const code = BYDAY[isoWeekday(dayOfWall(first.wall)) - 1] ?? 'SU';
        const nth = new Set(list.map(({ wall }) => Math.ceil(wall.d / 7)));
        const allLast = list.every(({ wall }) => wall.d + 7 > daysInMonth(wall.y, wall.mo));
        const [n] = [...nth];
        if (allLast) byDay = `-1${code}`;
        else if (nth.size === 1 && n !== undefined && n <= 4) byDay = `${n}${code}`;
      }
      if (first && byDay) {
        observances.push({
          kind: first.t.to > first.t.from ? 'DAYLIGHT' : 'STANDARD', from: first.t.from, to: first.t.to,
          start: icsWall(first.wall), rrule: `FREQ=YEARLY;BYMONTH=${first.wall.mo};BYDAY=${byDay}`, rdates: [],
          name: tzName(first.t.at, zone),
        });
      } else {
        rest.push(...list);
      }
    }
    // Everything else explicitly: one observance per kind and offset pair, DTSTART + RDATEs.
    const explicit = new Map<string, Observance>();
    for (const { t, wall } of rest.sort((a, b) => a.t.at - b.t.at)) {
      const kind = t.to > t.from ? 'DAYLIGHT' : 'STANDARD';
      const obsKey = `${kind}|${t.from}|${t.to}`;
      const existing = explicit.get(obsKey);
      if (existing) existing.rdates.push(icsWall(wall));
      else explicit.set(obsKey, { kind, from: t.from, to: t.to, start: icsWall(wall), rdates: [], name: tzName(t.at, zone) });
    }
    observances.push(...explicit.values());
  }
  observances.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const lines = ['BEGIN:VTIMEZONE', `TZID:${zone}`, ...observances.flatMap(observanceLines), 'END:VTIMEZONE'];
  vtimezoneCache.set(key, lines);
  return lines;
}

/** Window of years for a VTIMEZONE covering timed events in the given years. */
export function tzWindow(eventYears: readonly number[]): { fromYear: number; toYear: number } {
  const first = Math.min(...eventYears);
  const last = Math.max(...eventYears);
  const fromYear = first - 1;
  const toYear = Math.min(fromYear + TZ_MAX_YEARS - 1, Math.max(last, fromYear + TZ_WINDOW_YEARS - 1));
  return { fromYear, toYear };
}

// ---------------------------------------------------------------------------
// Events

/** Local due day of a task (dueDay, else derived from dueAt); undefined when it has no date. */
function dueDayOf(task: Task): Day | undefined {
  if (task.dueDay && isDay(task.dueDay)) return task.dueDay;
  if (task.dueAt && Number.isFinite(Date.parse(task.dueAt))) return dayOfIso(task.dueAt);
  return undefined;
}

function alarm(trigger: string, title: string): string[] {
  return ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(title)}`, trigger, 'END:VALARM'];
}

function alarms(reminders: readonly Reminder[], title: string, timed: boolean): string[] {
  const out: string[] = [];
  for (const reminder of reminders) {
    if (reminder.mode === 'relative') {
      if (timed && typeof reminder.offsetMinutes === 'number' && Number.isFinite(reminder.offsetMinutes)) {
        out.push(...alarm(`TRIGGER:${relativeTrigger(reminder.offsetMinutes)}`, title));
      }
    } else if (reminder.at && !reminder.dismissedAt) {
      const ms = Date.parse(reminder.at);
      if (Number.isFinite(ms)) out.push(...alarm(`TRIGGER;VALUE=DATE-TIME:${icsUtc(new Date(ms))}`, title));
    }
  }
  return out;
}

/** Start instant (ms) of a timed task; NaN for all-day tasks. */
function timedStart(task: Task): number {
  return task.dueHasTime === 1 && task.dueAt ? Date.parse(task.dueAt) : Number.NaN;
}

/** Content lines (unfolded) of one VEVENT; [] for a task without a date. zone null = UTC. */
function eventLines(task: Task, stamp: string, zone: string | null): string[] {
  const day = dueDayOf(task);
  if (!day) return [];
  const startMs = timedStart(task);
  const timed = Number.isFinite(startMs);
  const lines = ['BEGIN:VEVENT', `UID:${task.id}`, `DTSTAMP:${stamp}`];
  let shift = 0;
  if (timed) {
    const endMs = startMs + DEFAULT_DURATION_MIN * MIN_MS;
    // Wall clock of DTSTART: in the TZID zone, or UTC for the fallback.
    const start = zone ? wallOf(startMs, zone) : wallAtOffset(startMs, 0);
    if (zone) lines.push(`DTSTART;TZID=${zone}:${icsWall(start)}`, `DTEND;TZID=${zone}:${icsWall(wallOf(endMs, zone))}`);
    else lines.push(`DTSTART:${icsUtc(new Date(startMs))}`, `DTEND:${icsUtc(new Date(endMs))}`);
    // 0 whenever the zone is the system zone; ±1 for the UTC fallback across midnight.
    shift = Math.sign(diffDays(dayOfWall(start), day));
  } else {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(day)}`, `DTEND;VALUE=DATE:${icsDate(addDays(day, 1))}`);
  }
  lines.push(`SUMMARY:${escapeText(task.title)}`);
  if (task.description && task.description.trim() !== '') lines.push(`DESCRIPTION:${escapeText(task.description)}`);
  const rule = task.recurrence ? rrule(task.recurrence, day, shift) : null;
  if (rule) lines.push(`RRULE:${rule}`);
  lines.push(`SEQUENCE:${sequenceOf(task.updatedAt)}`);
  const modified = Date.parse(task.updatedAt);
  if (Number.isFinite(modified)) lines.push(`LAST-MODIFIED:${icsUtc(new Date(modified))}`);
  lines.push(...alarms(task.reminders ?? [], task.title, timed), 'END:VEVENT');
  return lines;
}

/** The complete .ics text (see the contract at the top of this file). */
export function buildIcs(tasks: readonly Task[], opts: IcsOptions): string {
  const stamp = icsUtc(opts.now);
  const zone = tzidZone(opts.timeZone ?? systemTimeZone());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opts.calendarName)}`,
  ];
  if (zone) {
    const years = tasks
      .filter((task) => dueDayOf(task) !== undefined)
      .map(timedStart)
      .filter(Number.isFinite)
      .map((ms) => wallOf(ms, zone).y);
    if (years.length > 0) {
      const { fromYear, toYear } = tzWindow(years);
      lines.push(...vtimezone(zone, fromYear, toYear));
    }
  }
  for (const task of tasks) lines.push(...eventLines(task, stamp, zone));
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}

// ---------------------------------------------------------------------------
// Files

// Transliteration for file names; escapes keep German literals out of code (check-src).
const TRANSLIT: Readonly<Record<string, string>> = {
  '\u00e4': 'ae', '\u00f6': 'oe', '\u00fc': 'ue', '\u00df': 'ss',
};
const SLUG_MAX = 40;

/** "Steuererklärung 2026" → "steuererklaerung-2026"; "" when nothing usable is left. */
export function slugify(name: string): string {
  const lowered = name.toLowerCase().replace(/[\u00e4\u00f6\u00fc\u00df]/gu, (ch) => TRANSLIT[ch] ?? ch);
  const plain = lowered.normalize('NFKD').replace(/[̀-ͯ]/gu, '');
  return plain.replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, SLUG_MAX).replace(/-+$/u, '');
}

/** "habit-garden-<slug>-JJJJ-MM-TT.ics" ("habit-garden-JJJJ-MM-TT.ics" for an empty slug). */
export function icsFileName(name: string, day: Day = today()): string {
  const slug = slugify(name);
  return slug ? `habit-garden-${slug}-${day}.ics` : `habit-garden-${day}.ics`;
}

export type IcsDelivery = 'shared' | 'downloaded' | 'cancelled';

/** Touch devices get the share sheet (a phone has no download folder worth using); others download. */
function prefersShare(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Hands the file over: navigator.share({ files }) on touch devices where navigator.canShare accepts
 * the file (the user may cancel: 'cancelled'), otherwise a download via <a download> and a blob URL
 * (allowed by the CSP; same pattern as services/transfer exportJson). A failing share (other than a
 * cancel) falls back to the download. Must run close to the user's tap (share needs user activation).
 */
export async function downloadIcs(fileName: string, text: string, type = 'text/calendar'): Promise<IcsDelivery> {
  if (prefersShare() && typeof File === 'function') {
    const file = new File([text], fileName, { type });
    const data: ShareData = { files: [file] };
    if (typeof navigator.share === 'function' && navigator.canShare?.(data) === true) {
      try {
        await navigator.share(data);
        return 'shared';
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
        console.warn('ics: share failed, falling back to download', err);
      }
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Revoking synchronously can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return 'downloaded';
}

const startOf = (task: Task): ISO | undefined => task.dueAt ?? (task.dueDay ? isoAt(task.dueDay) : undefined);

/** Open (open/doing), dated, top-level tasks of a project, in due order. */
export async function projectIcsTasks(projectId: string): Promise<Task[]> {
  const rows = await db.tasks.where('projectId').equals(projectId).toArray();
  return rows
    .filter((task) => task.parentId === null && task.status !== 'done' && dueDayOf(task) !== undefined)
    .sort((a, b) => compareIso(startOf(a), startOf(b)) || (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
}

export interface IcsExportResult { events: number; delivery: IcsDelivery | 'empty' | 'failed' }

/**
 * "Exportieren (ICS)" of a project (⋯ menu in PLANUNG): exports its open, dated top-level tasks as
 * habit-garden-<projekt>-JJJJ-MM-TT.ics. Shows its own toasts and never rejects: "no dated tasks"
 * (nothing is written), "file with n events" after a download or share (none after a cancelled
 * share), an error toast on failure. The toast module is loaded lazily so this file stays
 * importable in the node unit tests (no custom elements there).
 */
export async function exportProjectIcs(project: Project): Promise<IcsExportResult> {
  const toast = async (message: string): Promise<void> => {
    const { showToast } = await import('../components/ol-toast.js');
    showToast(message);
  };
  try {
    const tasks = await projectIcsTasks(project.id);
    if (tasks.length === 0) {
      await toast(t.icsExportEmpty);
      return { events: 0, delivery: 'empty' };
    }
    const text = buildIcs(tasks, { calendarName: project.name, now: now() });
    const delivery = await downloadIcs(icsFileName(project.name), text);
    if (delivery !== 'cancelled') await toast(fmt(tasks.length === 1 ? t.icsExportDoneOne : t.icsExportDone, { n: tasks.length }));
    return { events: tasks.length, delivery };
  } catch (err) {
    console.error(err);
    await toast(t.icsExportFailed).catch(() => undefined);
    return { events: 0, delivery: 'failed' };
  }
}

/** Open (open/doing), dated, top-level tasks of all projects and areas, in due order (Einstellungen › Daten). */
export async function allIcsTasks(): Promise<Task[]> {
  const rows = await db.tasks.filter((task) => (task.parentId === null || task.parentId === undefined) && task.status !== 'done').toArray();
  return rows
    .filter((task) => dueDayOf(task) !== undefined)
    .sort((a, b) => compareIso(startOf(a), startOf(b)) || (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
}

/** "Aufgaben als Kalender (ICS)" in Einstellungen › Daten (W6): every open dated task; same toasts as a project. */
export async function exportAllIcs(): Promise<IcsExportResult> {
  const toast = async (message: string): Promise<void> => {
    const { showToast } = await import('../components/ol-toast.js');
    showToast(message);
  };
  try {
    const tasks = await allIcsTasks();
    if (tasks.length === 0) {
      await toast(t.icsExportAllEmpty);
      return { events: 0, delivery: 'empty' };
    }
    const text = buildIcs(tasks, { calendarName: t.appName, now: now() });
    const delivery = await downloadIcs(icsFileName(t.icsAllFileName), text);
    if (delivery !== 'cancelled') await toast(fmt(tasks.length === 1 ? t.icsExportDoneOne : t.icsExportDone, { n: tasks.length }));
    return { events: tasks.length, delivery };
  } catch (err) {
    console.error(err);
    await toast(t.icsExportFailed).catch(() => undefined);
    return { events: 0, delivery: 'failed' };
  }
}
