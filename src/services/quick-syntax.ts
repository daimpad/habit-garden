// Quick syntax for the capture sheet (Feinkonzept A.2 G2, PO decision 13.10.2026): one line such as
// "Steuer machen @finanzen morgen ! #geld/steuer 14:00" becomes title + flags + area + tags + due.
// Pure: no DOM, no Dexie; "today" and the named targets come in through the context.
//
// Rules (unit-tested in __tests__/quick-syntax.test.ts):
// - Tokens are whitespace-separated words. Recognised tokens are removed from the title; the rest is
//   joined with single spaces. Only whole words count ("Morgenroutine" is no date, "Rechnung!" stays:
//   a "!" glued to a word may just be prose, so it is never read as a flag).
// - "!" important, "!!" urgent, "!!!" (or longer) both. Several flag tokens add up.
// - "@name": the first resolvable one sets the target; until Phase 3 that is an area (decision: "@"
//   selects the area). Matching is case- and diacritics-insensitive (services/search normalisation):
//   the exact name wins, otherwise exactly one area whose name or one of whose words starts with the
//   query. Ambiguous or unknown → the word stays in the title. Phase 3 passes `resolveAt` to look up
//   projects first and fall back to areas (matchNamed is exported for that).
// - "#a/b": tag path, normalised like repo/tags normalizeTagPath (reimplemented here because repo/tags
//   imports the database; a test keeps both in step). A path needs a letter, so "#4711" stays.
// - Dates: heute, morgen, übermorgen/uebermorgen, weekdays (mo … so, optional ".", montag … sonntag:
//   the next such day, today included), "15.10." (this year, next year once past), "15.10.2026",
//   "15.10.26". Impossible dates (31.02.) stay in the title.
// - Times: "14:00", "9:30", "14 uhr", "14uhr", "14h", "14:30 uhr". A time without a date means today,
//   even when it has already passed (the task is then overdue at once, which the user can see in the
//   preview; guessing "tomorrow" would be wrong for an evening entry of a missed appointment).
// - Only the first date and the first time count; later ones stay in the title.
import type { Area, Day, Id } from '../model.js';
import { addDays, dayParts, daysInMonth, isoWeekday, makeDay } from '../util/date.js';
import { normalizeForSearch } from './search.js';

/** Syntax markers; the capture hint is built from these so it always matches the parser. */
export const QUICK_IMPORTANT = '!';
export const QUICK_URGENT = '!!';
export const QUICK_AT = '@';
export const QUICK_TAG = '#';

export type QuickTokenKind = 'important' | 'urgent' | 'area' | 'project' | 'tag' | 'date' | 'time';

/** A recognised token; start/end are offsets into the input (end exclusive). */
export interface QuickToken { start: number; end: number; kind: QuickTokenKind }

/** What "@name" resolved to. Phase 1/2 only produce areas. */
export interface QuickTarget { kind: 'area' | 'project'; id: Id }

export interface NamedTarget { id: Id; name: string }

export interface QuickContext {
  today: Day;
  areas: readonly Pick<Area, 'id' | 'name'>[];
  /** Overrides the "@" lookup (Phase 3: projects first, then matchNamed(query, areas)). */
  resolveAt?: (query: string) => QuickTarget | undefined;
}

export interface QuickParse {
  title: string;
  important: 0 | 1;
  urgent: 0 | 1;
  areaId?: Id;
  target?: QuickTarget;
  tagPaths: string[];
  dueDay?: Day;
  /** "HH:MM"; when set, dueDay is set as well. */
  time?: string;
  tokens: QuickToken[];
}

interface Word { text: string; start: number; end: number }

const MAX_TAG_PATH = 200;

/** Same rule as repo/tags normalizeTagPath (kept pure here). */
export function normalizeTagPathPure(input: string): string {
  const path = input
    .normalize('NFC')
    .trim()
    .replace(/^#+/u, '')
    .toLocaleLowerCase('de')
    .normalize('NFC')
    .split('/')
    .map((segment) => segment.trim().replace(/\s+/gu, '-'))
    .filter((segment) => segment !== '')
    .join('/');
  return path.length > MAX_TAG_PATH ? '' : path;
}

/**
 * The single target whose normalised name equals the query, or else the single one whose name or
 * one of whose words starts with it; 'ambiguous' when several match, undefined when none does.
 */
export function matchNamed<T extends NamedTarget>(query: string, items: readonly T[]): T | 'ambiguous' | undefined {
  const q = normalizeForSearch(query.trim());
  if (q === '') return undefined;
  const exact = items.filter((item) => normalizeForSearch(item.name).trim() === q);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return 'ambiguous';
  const hits = items.filter((item) => {
    const name = normalizeForSearch(item.name).trim();
    return name.startsWith(q) || name.split(/[^\p{L}\p{N}]+/u).some((word) => word !== '' && word.startsWith(q));
  });
  if (hits.length === 1) return hits[0];
  return hits.length > 1 ? 'ambiguous' : undefined;
}

function defaultResolver(areas: readonly Pick<Area, 'id' | 'name'>[]): (query: string) => QuickTarget | undefined {
  return (query) => {
    const hit = matchNamed(query, areas);
    return hit && hit !== 'ambiguous' ? { kind: 'area', id: hit.id } : undefined;
  };
}

const RELATIVE_DAYS: Readonly<Record<string, number>> = { heute: 0, morgen: 1, ubermorgen: 2, uebermorgen: 2 };

// ISO weekday by name (normalised); abbreviations may carry a trailing dot ("Fr.").
const WEEKDAYS: Readonly<Record<string, number>> = {
  mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6, so: 7,
  montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonntag: 7,
};

const NUMERIC_DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?$/u;
const CLOCK_RE = /^(\d{1,2}):(\d{2})(?:uhr|h)?$/u;
const HOUR_RE = /^(\d{1,2})(uhr|h)?$/u;

const pad = (n: number): string => String(n).padStart(2, '0');

function validDay(year: number, month: number, date: number): Day | undefined {
  if (month < 1 || month > 12 || date < 1 || date > daysInMonth(year, month)) return undefined;
  return makeDay(year, month, date);
}

/** Day for one date word, or undefined. */
function parseDate(word: string, today: Day): Day | undefined {
  const key = normalizeForSearch(word);
  const relative = RELATIVE_DAYS[key];
  if (relative !== undefined) return addDays(today, relative);
  const weekday = WEEKDAYS[key] ?? (key.length === 3 && key.endsWith('.') ? WEEKDAYS[key.slice(0, 2)] : undefined);
  if (weekday !== undefined) return addDays(today, (weekday - isoWeekday(today) + 7) % 7);
  const match = NUMERIC_DATE_RE.exec(key);
  if (!match) return undefined;
  const date = Number(match[1]);
  const month = Number(match[2]);
  if (match[3] !== undefined) {
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return validDay(year, month, date);
  }
  const { year } = dayParts(today);
  const thisYear = validDay(year, month, date);
  if (thisYear !== undefined && thisYear >= today) return thisYear;
  return validDay(year + 1, month, date);
}

function clock(hours: number, minutes: number): string | undefined {
  return hours <= 23 && minutes <= 59 ? `${pad(hours)}:${pad(minutes)}` : undefined;
}

/** Time starting at words[i]; `used` is 2 when a separate "uhr" word belongs to it. */
function parseTime(words: readonly Word[], i: number): { time: string; used: number } | undefined {
  const key = normalizeForSearch(words[i]?.text ?? '');
  const nextIsUhr = normalizeForSearch(words[i + 1]?.text ?? '') === 'uhr';
  const full = CLOCK_RE.exec(key);
  if (full) {
    const time = clock(Number(full[1]), Number(full[2]));
    const glued = key.endsWith('uhr') || key.endsWith('h');
    return time ? { time, used: nextIsUhr && !glued ? 2 : 1 } : undefined;
  }
  const hour = HOUR_RE.exec(key);
  if (!hour) return undefined;
  // A bare number is only a time with "uhr"/"h" glued on or "uhr" as the next word.
  if (hour[2] === undefined && !nextIsUhr) return undefined;
  const time = clock(Number(hour[1]), 0);
  return time ? { time, used: hour[2] === undefined ? 2 : 1 } : undefined;
}

function flagsOf(word: string): { important: boolean; urgent: boolean } | undefined {
  if (!/^!+$/u.test(word)) return undefined;
  if (word.length === 1) return { important: true, urgent: false };
  if (word.length === 2) return { important: false, urgent: true };
  return { important: true, urgent: true };
}

export function parseQuickSyntax(input: string, ctx: QuickContext): QuickParse {
  const words: Word[] = [...input.matchAll(/\S+/gu)].map((m) => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
  const resolveAt = ctx.resolveAt ?? defaultResolver(ctx.areas);
  const out: QuickParse = { title: '', important: 0, urgent: 0, tagPaths: [], tokens: [] };
  const rest: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i] as Word;
    const text = word.text;
    const token = (kind: QuickTokenKind, end = word.end): void => {
      out.tokens.push({ start: word.start, end, kind });
    };

    const flags = flagsOf(text);
    if (flags) {
      // "!!!" yields two tokens over the same word.
      if (flags.important) {
        out.important = 1;
        token('important');
      }
      if (flags.urgent) {
        out.urgent = 1;
        token('urgent');
      }
      continue;
    }
    if (text.startsWith(QUICK_AT) && text.length > 1 && out.target === undefined) {
      const target = resolveAt(text.slice(1));
      if (target) {
        out.target = target;
        if (target.kind === 'area') out.areaId = target.id;
        token(target.kind);
        continue;
      }
    }
    if (text.startsWith(QUICK_TAG)) {
      const path = normalizeTagPathPure(text);
      if (path !== '' && /\p{L}/u.test(path)) {
        if (!out.tagPaths.includes(path)) out.tagPaths.push(path);
        token('tag');
        continue;
      }
    }
    if (out.dueDay === undefined) {
      const day = parseDate(text, ctx.today);
      if (day !== undefined) {
        out.dueDay = day;
        token('date');
        continue;
      }
    }
    if (out.time === undefined) {
      const time = parseTime(words, i);
      if (time) {
        out.time = time.time;
        const last = words[i + time.used - 1] as Word;
        token('time', last.end);
        i += time.used - 1;
        continue;
      }
    }
    rest.push(text);
  }

  // A time without a date means today (also when that time has passed already).
  if (out.time !== undefined && out.dueDay === undefined) out.dueDay = ctx.today;
  out.title = rest.join(' ').trim();
  return out;
}
