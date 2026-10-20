// Imported calendars (decision of 20.10.2026: calendar sync over files). The parsing and the recurrence rules
// live in services/ical.ts; this module stores the rows and reads them back as live occurrences.
// - importCalendar: one .ics file is one calendar. Its name comes from X-WR-CALNAME, else from the file name.
//   A calendar with the same name (case-insensitive) is replaced (events and import time), so importing the
//   newest file again is the update. A new calendar takes the file's colour or the next free one.
// - Hidden calendars stay stored but show nowhere; removing deletes the calendar and its events.
import { liveQuery, type Observable } from 'dexie';
import { db } from '../db.js';
import { t } from '../i18n/de.js';
import type { CalendarEvent, CalendarSource, Day, Id, Task } from '../model.js';
import {
  CALENDAR_COLORS, expandEvents, KEEP_PAST_DAYS, parseIcal, storedEvents, type Occurrence,
} from '../services/ical.js';
import { addDays, nowIso, today } from '../util/date.js';
import { newId } from '../util/ids.js';
import { isZip, readZipTexts } from '../util/zip.js';
import { firstActiveArea } from './areas.js';
import { createTask } from './tasks.js';

export class CalendarImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarImportError';
  }
}

export interface CalendarImportResult { source: CalendarSource; count: number; replaced: boolean }

/** "Privat.ics" → "Privat"; Google's "name@gmail.com.ics" → "name@gmail.com". */
export function nameFromFile(fileName: string): string {
  // Google's ZIP entries look like "Privat_abc123@group.calendar.google.com.ics": the part before "_" is the name.
  const base = fileName.replace(/\.(ics|ical|ifb|icalendar)$/iu, '');
  const google = /^(.+?)_[^_]+@(?:group\.)?(?:calendar\.google\.com|gmail\.com|import\.calendar\.google\.com)$/u.exec(base);
  return (google?.[1] ?? base).replace(/_+/gu, ' ').trim() || t.settingsCalendar;
}

export async function importCalendar(text: string, fileName: string): Promise<CalendarImportResult> {
  if (!/BEGIN:VCALENDAR/iu.test(text)) throw new CalendarImportError('no VCALENDAR');
  const parsed = parseIcal(text);
  const name = (parsed.name ?? nameFromFile(fileName)).slice(0, 80);
  return db.transaction('rw', db.calendars, db.calendarEvents, async () => {
    const all = await db.calendars.toArray();
    const existing = all.find((c) => c.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'));
    const used = new Set(all.map((c) => c.color));
    const color = existing?.color ?? parsed.color ?? CALENDAR_COLORS.find((c) => !used.has(c)) ?? CALENDAR_COLORS[all.length % CALENDAR_COLORS.length] ?? '#5B7FB5';
    const id = existing?.id ?? newId();
    const rows = storedEvents(parsed.events, id, addDays(today(), -KEEP_PAST_DAYS));
    const source: CalendarSource = {
      id, name, color, fileName: fileName.slice(0, 200), importedAt: nowIso(), eventCount: rows.length, hidden: existing?.hidden ?? 0,
    };
    if (existing) await db.calendarEvents.where('sourceId').equals(id).delete();
    await db.calendarEvents.bulkPut(rows);
    await db.calendars.put(source);
    return { source, count: rows.length, replaced: existing !== undefined };
  });
}

export function calendars$(): Observable<CalendarSource[]> {
  return liveQuery(async () => (await db.calendars.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'de')));
}

export function setCalendarHidden(id: Id, hidden: boolean): Promise<number> {
  return db.calendars.update(id, { hidden: hidden ? 1 : 0 });
}

export function removeCalendar(id: Id): Promise<void> {
  return db.transaction('rw', db.calendars, db.calendarEvents, async () => {
    await db.calendarEvents.where('sourceId').equals(id).delete();
    await db.calendars.delete(id);
  });
}

export interface DayEvents { occurrences: Occurrence[]; colors: Map<Id, string>; names: Map<Id, string> }

async function readEvents(from: Day, to: Day): Promise<DayEvents> {
  const sources = await db.calendars.toArray();
  const visible = new Set(sources.filter((s) => s.hidden === 0).map((s) => s.id));
  if (visible.size === 0) return { occurrences: [], colors: new Map(), names: new Map() };
  const rows: CalendarEvent[] = await db.calendarEvents.where('firstDay').belowOrEqual(to)
    .filter((e) => e.lastDay >= from && visible.has(e.sourceId)).toArray();
  // An override moved to another day still hides its master's occurrence in this window: load overrides by
  // their original date as well.
  const moved = await db.calendarEvents.where('recurrenceDay').between(addDays(from, -2), addDays(to, 2), true, true)
    .filter((e) => visible.has(e.sourceId)).toArray();
  const byId = new Map<string, CalendarEvent>();
  for (const e of [...rows, ...moved]) byId.set(e.id, e);
  return {
    occurrences: expandEvents([...byId.values()], from, to),
    colors: new Map(sources.map((s) => [s.id, s.color])),
    names: new Map(sources.map((s) => [s.id, s.name])),
  };
}

/** liveQuery: occurrences of the visible calendars on the local days from … to. */
export function events$(from: Day, to: Day): Observable<DayEvents> {
  return liveQuery(() => readEvents(from, to));
}

/** One-off read (the island's next event, the calendar markers). */
export function eventsBetween(from: Day, to: Day): Promise<DayEvents> {
  return readEvents(from, to);
}

/**
 * "Als Aufgabe übernehmen": a task with the event's title in the first active area, due on the occurrence's
 * day (timed events at their start time); the description carries time, place and calendar.
 */
export async function taskFromOccurrence(o: Occurrence, details: string): Promise<Task> {
  const area = await firstActiveArea();
  if (!area) throw new CalendarImportError('no active area');
  return createTask({
    title: o.title || details,
    areaId: area.id,
    ...(o.start && !o.allDay ? { dueAt: o.start, dueHasTime: 1 as const } : { dueDay: o.startDay }),
    ...(details ? { description: details } : {}),
  });
}

/** One picked file: a single .ics, or a .zip with one .ics per calendar (Google's export). */
export async function importCalendarFile(file: File): Promise<CalendarImportResult[]> {
  const buffer = await file.arrayBuffer();
  if (isZip(new Uint8Array(buffer))) {
    const entries = await readZipTexts(buffer, /\.ics$/iu);
    const results: CalendarImportResult[] = [];
    for (const entry of entries) {
      if (/BEGIN:VCALENDAR/iu.test(entry.text)) results.push(await importCalendar(entry.text, entry.name));
    }
    if (results.length === 0) throw new CalendarImportError('no calendar in zip');
    return results;
  }
  return [await importCalendar(new TextDecoder('utf-8').decode(buffer), file.name)];
}
