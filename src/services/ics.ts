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
// - Timed tasks (dueHasTime 1 with dueAt): DTSTART/DTEND in UTC ("…Z"). Tasks have no duration in the
//   data model, so every timed event lasts DEFAULT_DURATION_MIN (30) minutes.
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
// - Timed recurring events are anchored in UTC (C.4: times in UTC). When the UTC date of DTSTART
//   differs from the local due day (e.g. 00:30 in Berlin = 22:30Z on the previous day), BYDAY and
//   BYMONTHDAY are shifted to the UTC date so the series stays on the right days. Known limitation:
//   a UTC anchored series keeps its UTC time, so after a DST change calendars show it one hour off
//   the local wall time (a TZID with VTIMEZONE would be needed to avoid that).
// - Reminders → VALARM (ACTION:DISPLAY, DESCRIPTION = title): relative ones → TRIGGER:-PT{n}M
//   (relative to DTSTART; skipped for all-day tasks, which have no due time to count from, matching
//   services/reminders fireTime); absolute ones → TRIGGER;VALUE=DATE-TIME:…Z, skipped once dismissed
//   (they already fired; a relative reminder stays because it applies to every instance of a series).
//
// exportProjectIcs exports the open (status open or doing), dated top-level tasks of one project
// (subtasks are steps of their task, done tasks are history) and hands the file to downloadIcs.
import { db } from '../db.js';
import { fmt, t } from '../i18n/de.js';
import type { Day, ISO, Project, Recurrence, Reminder, Task } from '../model.js';
import { addDays, compareIso, dayOfIso, isDay, isoAt, isoWeekday, now, today } from '../util/date.js';

export const DEFAULT_DURATION_MIN = 30;
/** SEQUENCE counts seconds from here (before the first release, so it is never negative in practice). */
export const SEQUENCE_EPOCH = Date.UTC(2024, 0, 1);
const PRODID = '-//Habit Garden//Habit Garden 0.1//DE';
const CRLF = '\r\n';
const MAX_OCTETS = 75;
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

export interface IcsOptions { calendarName: string; now: Date }

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

/** BYDAY codes for ISO weekdays, shifted by `shift` days (UTC date − local date), in week order. */
function byDay(weekdays: readonly number[], shift: number): string {
  const set = new Set<number>();
  for (const d of weekdays) {
    if (Number.isInteger(d) && d >= 1 && d <= 7) set.add(((d - 1 + shift) % 7 + 7) % 7);
  }
  return [...set].sort((a, b) => a - b).map((i) => BYDAY[i]).join(',');
}

/**
 * BYMONTHDAY (+ BYSETPOS) for day N or 'last', shifted by `shift` ∈ {-1, 0, 1} days (UTC date − local
 * date of DTSTART). Days above 28 are clamped to the month's last day, like services/recurrence.
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
 * difference in days between the UTC date of DTSTART and `day` (0 for all-day events).
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

/** Content lines (unfolded) of one VEVENT; [] for a task without a date. */
function eventLines(task: Task, stamp: string): string[] {
  const day = dueDayOf(task);
  if (!day) return [];
  const startMs = task.dueHasTime === 1 && task.dueAt ? Date.parse(task.dueAt) : Number.NaN;
  const timed = Number.isFinite(startMs);
  const lines = ['BEGIN:VEVENT', `UID:${task.id}`, `DTSTAMP:${stamp}`];
  let shift = 0;
  if (timed) {
    const start = new Date(startMs);
    lines.push(`DTSTART:${icsUtc(start)}`, `DTEND:${icsUtc(new Date(startMs + DEFAULT_DURATION_MIN * 60_000))}`);
    const utcDay = `${pad(start.getUTCFullYear(), 4)}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`;
    shift = utcDay === day ? 0 : utcDay < day ? -1 : 1;
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
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opts.calendarName)}`,
  ];
  for (const task of tasks) lines.push(...eventLines(task, stamp));
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}

// ---------------------------------------------------------------------------
// Files

// Transliteration for file names; escapes keep German literals out of code (check-src).
const TRANSLIT: Readonly<Record<string, string>> = {
  'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss',
};
const SLUG_MAX = 40;

/** "Steuererklärung 2026" → "steuererklaerung-2026"; "" when nothing usable is left. */
export function slugify(name: string): string {
  const lowered = name.toLowerCase().replace(/[äöüß]/gu, (ch) => TRANSLIT[ch] ?? ch);
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
export async function downloadIcs(fileName: string, text: string): Promise<IcsDelivery> {
  const type = 'text/calendar';
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
