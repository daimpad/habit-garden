import type { Day, ISO } from '../model.js';

// All calendar arithmetic uses local calendar components (new Date(y, m, d + n)),
// never millisecond addition, so DST changes cannot shift a day.

// ---------------------------------------------------------------------------
// Clock. Overridable for tests and for simulating midnight (acceptance 10).

let clock: () => Date = () => new Date();

export function now(): Date {
  return clock();
}

/** Replaces the clock (null restores the system clock) and re-evaluates "today". */
export function setClock(fn: (() => Date) | null): void {
  clock = fn ?? (() => new Date());
  checkDay();
}

export function nowIso(): ISO {
  return now().toISOString();
}

// ---------------------------------------------------------------------------
// Day keys

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/u;

function parts(day: Day): { y: number; m: number; d: number } {
  const match = DAY_RE.exec(day);
  if (!match) throw new RangeError(`Invalid day key: ${day}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

export function isDay(value: unknown): value is Day {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return false;
  const { y, m, d } = parts(value);
  return dayKey(new Date(y, m - 1, d)) === value;
}

/** Local calendar day of a Date, "YYYY-MM-DD". */
export function dayKey(date: Date): Day {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight of a day key. */
export function parseDay(day: Day): Date {
  const { y, m, d } = parts(day);
  return new Date(y, m - 1, d);
}

export function today(): Day {
  return dayKey(now());
}

export function addDays(day: Day, n: number): Day {
  const { y, m, d } = parts(day);
  return dayKey(new Date(y, m - 1, d + n));
}

/** Calendar-day difference a − b (DST-safe). */
export function diffDays(a: Day, b: Day): number {
  const pa = parts(a);
  const pb = parts(b);
  return Math.round((Date.UTC(pa.y, pa.m - 1, pa.d) - Date.UTC(pb.y, pb.m - 1, pb.d)) / 86_400_000);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: Day): number {
  return ((parseDay(day).getDay() + 6) % 7) + 1;
}

/** Monday of the ISO week containing day. */
export function startOfWeek(day: Day): Day {
  return addDays(day, 1 - isoWeekday(day));
}

/** ISO week key "YYYY-Www" using the ISO week-numbering year. */
export function isoWeekKey(day: Day): string {
  const thursday = addDays(day, 4 - isoWeekday(day));
  const year = parts(thursday).y;
  const week = 1 + Math.floor(diffDays(thursday, `${pad(year, 4)}-01-01`) / 7);
  return `${pad(year, 4)}-W${pad(week)}`;
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

export function dayParts(day: Day): { year: number; month: number; date: number } {
  const { y, m, d } = parts(day);
  return { year: y, month: m, date: d };
}

export function makeDay(year: number, month1: number, date: number): Day {
  return dayKey(new Date(year, month1 - 1, date));
}

// ---------------------------------------------------------------------------
// Instants

/** Local calendar day of an ISO instant. */
export function dayOfIso(iso: ISO): Day {
  return dayKey(new Date(iso));
}

/** dueDay is derived from dueAt (local day); used only by the repository layer. */
export function deriveDueDay(dueAt: ISO | undefined): Day | undefined {
  return dueAt ? dayOfIso(dueAt) : undefined;
}

/** ISO instant for a local day and optional "HH:MM" (no time → local midnight). */
export function isoAt(day: Day, time?: string): ISO {
  const { y, m, d } = parts(day);
  const [hh, mm] = time ? time.split(':').map(Number) : [0, 0];
  return new Date(y, m - 1, d, hh ?? 0, mm ?? 0).toISOString();
}

/** Local "HH:MM" of an ISO instant. */
export function timeOfIso(iso: ISO): string {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function compareIso(a: ISO | undefined, b: ISO | undefined): number {
  const ta = a ? Date.parse(a) : Number.NEGATIVE_INFINITY;
  const tb = b ? Date.parse(b) : Number.NEGATIVE_INFINITY;
  return ta === tb ? 0 : ta < tb ? -1 : 1;
}

export function currentHour(): number {
  return now().getHours();
}

// ---------------------------------------------------------------------------
// German formatting

const fmtLong = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' });
const fmtFull = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtWeekdayShort = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
const fmtWeekdayLong = new Intl.DateTimeFormat('de-DE', { weekday: 'long' });

/** "Sonntag, 11. Oktober" */
export function formatDayLong(day: Day): string {
  return fmtLong.format(parseDay(day));
}

/** "11.10." */
export function formatDayShort(day: Day): string {
  return `${fmtShort.format(parseDay(day))}`;
}

/** "11. Oktober 2026" */
export function formatDayFull(day: Day): string {
  return fmtFull.format(parseDay(day));
}

/** "Sonntag" */
export function formatWeekdayLong(day: Day): string {
  return fmtWeekdayLong.format(parseDay(day));
}

/** "So" */
export function formatWeekdayShort(day: Day): string {
  return fmtWeekdayShort.format(parseDay(day)).replace('.', '');
}

/** "14:00" */
export function formatTime(iso: ISO): string {
  return timeOfIso(iso);
}

// ---------------------------------------------------------------------------
// Day watcher: "today" is re-evaluated on visibilitychange, focus, user input
// (pointerdown/keydown, capture phase: a timer may have stood still while the
// device slept with the page visible) and at the next local midnight; it is
// never held as a constant. checkDay notifies only on a real change.

type DayListener = (day: Day) => void;

const listeners = new Set<DayListener>();
let knownDay: Day | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let watching = false;

/** Milliseconds until the next local midnight (calendar based). */
export function msUntilNextMidnight(): number {
  const n = now();
  const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
  return Math.max(0, next.getTime() - n.getTime());
}

function arm(): void {
  if (timer !== undefined) clearTimeout(timer);
  if (!watching) return;
  // +250 ms so the callback lands after midnight; capped at 2^31−1.
  timer = setTimeout(checkDay, Math.min(msUntilNextMidnight() + 250, 2 ** 31 - 1));
}

/** Re-evaluates "today"; notifies listeners when the day changed. */
export function checkDay(): void {
  const day = today();
  if (knownDay !== null && day !== knownDay) {
    knownDay = day;
    for (const cb of [...listeners]) cb(day);
  } else {
    knownDay = day;
  }
  arm();
}

function startWatching(): void {
  if (watching) return;
  watching = true;
  knownDay = today();
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkDay();
    });
    document.addEventListener('pointerdown', checkDay, { capture: true, passive: true });
    document.addEventListener('keydown', checkDay, { capture: true });
  }
  if (typeof window !== 'undefined') window.addEventListener('focus', checkDay);
  arm();
}

/** Subscribes to day changes; returns an unsubscribe function. */
export function onDayChange(cb: DayListener): () => void {
  listeners.add(cb);
  startWatching();
  return () => listeners.delete(cb);
}
