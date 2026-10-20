// Read-only queries for the calendar sheet and the day view (A.2 H8). The rules live in
// services/calendar.ts; this module only collects the rows (liveQuery, so both views stay live).
import Dexie, { liveQuery, type Observable } from 'dexie';
import { db } from '../db.js';
import type { Day, HabitLog, Note, Task } from '../model.js';
import {
  firstOfMonth, futureDay, lastOfMonth, monthDays, pastDay, summarizeDays,
  type DaySummary, type FutureDay, type Month, type PastDay,
} from '../services/calendar.js';
import { dayOfIso } from '../util/date.js';
import { eventCounts } from '../services/ical.js';
import { eventsBetween } from './calendars.js';

/** liveQuery: marker data of every day of the month (see services/calendar summarizeDays). */
export function monthSummary$(month: Month, today: Day): Observable<Map<Day, DaySummary>> {
  const from = firstOfMonth(month);
  const to = lastOfMonth(month);
  return liveQuery(async () => {
    const [tasks, habits, logs, moods] = await Promise.all([
      db.tasks.where('dueDay').between(from, to, true, true).toArray(),
      db.habits.toArray(),
      db.habitLogs.where('day').between(from, to, true, true).toArray(),
      db.moodLogs.where('day').between(from, to, true, true).toArray(),
    ]);
    const days = monthDays(month);
    const summaries = summarizeDays(days, { tasks, habits, logs, moods }, today);
    // Calendar sync: events of the imported calendars as a fourth marker.
    const counts = eventCounts((await eventsBetween(from, to)).occurrences, days);
    for (const [day, n] of counts) {
      const s = summaries.get(day);
      if (s) s.events = n;
      else summaries.set(day, { due: 0, dueOpen: 0, habitsDone: 0, habitsDue: 0, events: n });
    }
    return summaries;
  });
}

/** The journal note of day (the oldest one, as repo/notes). */
async function journalOf(day: Day): Promise<Note | undefined> {
  const rows = await db.notes.where('journalDay').equals(day).filter((n) => n.kind === 'journal').toArray();
  rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return rows[0];
}

/** liveQuery: everything a past day shows (focus, completions, habit logs, mood, journal, contacts). */
export function pastDay$(day: Day): Observable<PastDay> {
  return liveQuery(async () => {
    const plan = await db.dayPlans.get(day);
    const planned = (await db.tasks.bulkGet(plan?.mitTaskIds ?? [])).filter((task): task is Task => task !== undefined);
    const completed = await db.tasks.filter((task) => task.completedAt !== undefined && dayOfIso(task.completedAt) === day).toArray();
    const tasks = new Map<string, Task>();
    for (const task of [...planned, ...completed]) tasks.set(task.id, task);

    const dayLogs = await db.habitLogs.where('day').equals(day).toArray();
    const habitIds = [...new Set(dayLogs.map((log) => log.habitId))];
    const habits = (await db.habits.bulkGet(habitIds)).filter((habit) => habit !== undefined);
    // The stage on that day needs the logs up to it.
    const logs: HabitLog[] = [];
    for (const id of habitIds) {
      logs.push(...await db.habitLogs.where('[habitId+day]').between([id, Dexie.minKey], [id, day], true, true).toArray());
    }
    const [moods, journal, contactLogs] = await Promise.all([
      db.moodLogs.where('day').equals(day).toArray(),
      journalOf(day),
      db.contactLogs.where('day').equals(day).toArray(),
    ]);
    const contacts = (await db.contacts.bulkGet([...new Set(contactLogs.map((log) => log.contactId))]))
      .filter((contact) => contact !== undefined);
    return pastDay(day, { plan, tasks: [...tasks.values()], habits, logs, moods, journal, contacts, contactLogs });
  });
}

/** liveQuery: the planning view of a future day (focus, open tasks due, scheduled habits). */
export function futureDay$(day: Day): Observable<FutureDay> {
  return liveQuery(async () => {
    const plan = await db.dayPlans.get(day);
    const [planned, due, habits] = await Promise.all([
      db.tasks.bulkGet(plan?.mitTaskIds ?? []),
      db.tasks.where('dueDay').equals(day).toArray(),
      db.habits.where('archived').equals(0).toArray(),
    ]);
    const tasks = new Map<string, Task>();
    for (const task of [...planned, ...due]) if (task) tasks.set(task.id, task);
    return futureDay(day, { plan, tasks: [...tasks.values()], habits });
  });
}
