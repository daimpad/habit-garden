// Contact rhythm logic for people ("Personen"): pure functions, no DOM, no Dexie.
// A person is due when they were never contacted or when the days since the latest contact
// (calendar days, util/date) reach their rhythm. Logs after `today` are ignored, so a clock
// that moved back never counts a future contact. Suggestions ("Melde dich bei") are the due
// people, most overdue relative to their rhythm first.
import { fmt, t } from '../i18n/de.js';
import type { Contact, ContactKind, ContactLog, Day, Id } from '../model.js';
import { diffDays } from '../util/date.js';

export const CONTACT_KINDS: readonly ContactKind[] = ['call', 'message', 'meeting'];

export function isContactKind(value: unknown): value is ContactKind {
  return typeof value === 'string' && (CONTACT_KINDS as readonly string[]).includes(value);
}

export interface ContactStatus {
  contact: Contact;
  lastDay: Day | null;       // latest log day <= today
  daysSince: number | null;  // diffDays(today, lastDay)
  /** Days until the rhythm is reached (negative = overdue); 0 for a person never contacted. */
  dueIn: number;
  due: boolean;              // never contacted, or daysSince >= rhythmDays
  contactedToday: boolean;
}

function statusFor(contact: Contact, lastDay: Day | null, today: Day): ContactStatus {
  const daysSince = lastDay === null ? null : diffDays(today, lastDay);
  return {
    contact,
    lastDay,
    daysSince,
    dueIn: daysSince === null ? 0 : contact.rhythmDays - daysSince,
    due: daysSince === null || daysSince >= contact.rhythmDays,
    contactedToday: daysSince === 0,
  };
}

/** Latest log day (<= today) per person. */
function latestDays(logs: readonly ContactLog[], today: Day): Map<Id, Day> {
  const latest = new Map<Id, Day>();
  for (const log of logs) {
    if (log.day > today) continue;
    const seen = latest.get(log.contactId);
    if (seen === undefined || log.day > seen) latest.set(log.contactId, log.day);
  }
  return latest;
}

/** Status of one person; logs may contain other people's logs (they are ignored). */
export function contactStatus(contact: Contact, logs: readonly ContactLog[], today: Day): ContactStatus {
  return statusFor(contact, latestDays(logs, today).get(contact.id) ?? null, today);
}

/** Statuses of the non-archived people, in input order. */
export function contactStatuses(contacts: readonly Contact[], logs: readonly ContactLog[], today: Day): ContactStatus[] {
  const latest = latestDays(logs, today);
  return contacts.filter((c) => c.archived === 0).map((c) => statusFor(c, latest.get(c.id) ?? null, today));
}

const bySortKey = (a: ContactStatus, b: ContactStatus): number =>
  a.contact.sortKey < b.contact.sortKey ? -1 : a.contact.sortKey > b.contact.sortKey ? 1 : 0;

/** How far past the rhythm a contacted person is, relative to the rhythm ((daysSince − rhythm) / rhythm). */
function overdueRatio(status: ContactStatus): number {
  const rhythm = status.contact.rhythmDays;
  return ((status.daysSince ?? 0) - rhythm) / rhythm;
}

/**
 * Up to `max` due people, most overdue relative to their rhythm first ((daysSince - rhythm) / rhythm);
 * never contacted people first (in sortKey order); people contacted today never appear.
 * Ties: more days overdue first, then sortKey.
 */
export function suggestions(contacts: readonly Contact[], logs: readonly ContactLog[], today: Day, max = 3): ContactStatus[] {
  if (max <= 0) return [];
  const due = contactStatuses(contacts, logs, today).filter((s) => s.due && !s.contactedToday);
  due.sort((a, b) => {
    const neverA = a.daysSince === null;
    const neverB = b.daysSince === null;
    if (neverA !== neverB) return neverA ? -1 : 1;
    if (!neverA) {
      const ratio = overdueRatio(b) - overdueRatio(a);
      if (ratio !== 0) return ratio;
      if (a.dueIn !== b.dueIn) return a.dueIn - b.dueIn;
    }
    return bySortKey(a, b);
  });
  return due.slice(0, max);
}

/**
 * How close a person is to the desired rhythm, as an integer percent (Garten-Insel Teil 2):
 * - in rhythm (daysSince < rhythm): 100;
 * - from the day the rhythm is reached it falls linearly to 0 at twice the rhythm:
 *   round(100 × (2·rhythm − daysSince) / rhythm), at most 99 once due, so 100 % always means "in rhythm";
 * - never contacted, or daysSince ≥ 2·rhythm: 0.
 */
export function closeness(status: ContactStatus): number {
  const d = status.daysSince;
  const r = Math.max(1, status.contact.rhythmDays);
  if (d === null) return 0;
  if (d < r) return 100;
  return Math.max(0, Math.min(99, Math.round((100 * (2 * r - d)) / r)));
}

/** "Wöchentlich", "Alle 2 Wochen", "Monatlich", "Vierteljährlich"; other values "Alle {n} Tage". */
export function rhythmLabel(days: number): string {
  switch (days) {
    case 1: return t.contactRhythmDaily;
    case 7: return t.contactRhythmWeekly;
    case 14: return t.contactRhythmTwoWeeks;
    case 30: return t.contactRhythmMonthly;
    case 90: return t.contactRhythmQuarterly;
    default: return fmt(t.contactRhythmEveryNDays, { n: days });
  }
}

/** "Heute kontaktiert", "Gestern kontaktiert", "Zuletzt vor {n} Tagen", "Noch kein Kontakt". */
export function lastContactText(status: ContactStatus): string {
  const n = status.daysSince;
  if (n === null) return t.contactLastNever;
  if (n === 0) return t.contactLastToday;
  if (n === 1) return t.contactLastYesterday;
  return fmt(t.contactLastDays, { n });
}

const KIND_LABELS: Readonly<Record<ContactKind, string>> = {
  call: t.contactKindCall, message: t.contactKindMessage, meeting: t.contactKindMeeting,
};

/** "Anruf", "Nachricht", "Treffen". */
export function contactKindLabel(kind: ContactKind): string {
  return KIND_LABELS[kind];
}

/** Colours of the people's sprout figures: a warm palette next to the app tokens (sun, clay, area tints). */
export const PERSON_COLORS: readonly string[] = ['#E8963E', '#C96A5A', '#8C6FB0', '#5B7FB5', '#D8B24A', '#E9A8B8'];

/** FNV-1a (32 bit) over the UTF-16 code units: stable across sessions and devices. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** One of PERSON_COLORS, chosen by a stable hash of contact.id. */
export function personColor(contact: Contact): string {
  return PERSON_COLORS[hash(contact.id) % PERSON_COLORS.length] ?? '#E8963E';
}
