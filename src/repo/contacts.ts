// People ("Personen") and their contact logs.
// ContactLog.id is `${contactId}:${day}`; the primary key guarantees one log per person and day
// (logging a day again replaces that day's log). [contactId+day] is only an index for range scans.
// Names are trimmed and must not be empty; rhythmDays is an integer 1–365 (the range the JSON
// import accepts, so every stored person survives export and import). Invalid input rejects
// with a RangeError before anything is written.
import Dexie, { liveQuery, type Observable } from 'dexie';
import { db } from '../db.js';
import {
  DEFAULT_CONTACT_RHYTHM, type Contact, type ContactKind, type ContactLog, type Day, type Id,
} from '../model.js';
import { isDay, nowIso, today } from '../util/date.js';
import { newId, sortKeyBetween } from '../util/ids.js';

export type ContactInput = Pick<Contact, 'name'> & Partial<Pick<Contact, 'rhythmDays' | 'note'>>;

const bySortKey = (a: Contact, b: Contact): number => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

export function contactLogId(contactId: Id, day: Day): ContactLog['id'] {
  return `${contactId}:${day}`;
}

function checkName(name: string): void {
  if (name === '') throw new RangeError('empty contact name');
}

function checkRhythm(days: number): void {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new RangeError(`invalid contact rhythm ${days}`);
}

/** A note that is empty after trimming is no note. */
function cleanNote(note: string | undefined): string | undefined {
  const trimmed = note?.trim();
  return trimmed ? trimmed : undefined;
}

/** Trims the name; rhythmDays defaults to DEFAULT_CONTACT_RHYTHM, sortKey to the end; an empty note is omitted. */
export function createContact(input: ContactInput): Promise<Contact> {
  const name = input.name.trim();
  const rhythmDays = input.rhythmDays ?? DEFAULT_CONTACT_RHYTHM;
  try {
    checkName(name);
    checkRhythm(rhythmDays);
  } catch (err) {
    return Promise.reject(err);
  }
  return db.transaction('rw', db.contacts, async () => {
    const last = await db.contacts.orderBy('sortKey').last();
    const stamp = nowIso();
    const contact: Contact = {
      id: newId(),
      name,
      rhythmDays,
      archived: 0,
      sortKey: sortKeyBetween(last?.sortKey ?? null, null),
      createdAt: stamp,
      updatedAt: stamp,
    };
    const note = cleanNote(input.note);
    if (note !== undefined) contact.note = note;
    await db.contacts.add(contact);
    return contact;
  });
}

/** Patches a person; a patch with note '' or undefined removes the note. */
export function updateContact(id: Id, patch: Partial<Pick<Contact, 'name' | 'rhythmDays' | 'note' | 'archived'>>): Promise<void> {
  const name = patch.name?.trim();
  try {
    if (name !== undefined) checkName(name);
    if (patch.rhythmDays !== undefined) checkRhythm(patch.rhythmDays);
  } catch (err) {
    return Promise.reject(err);
  }
  return db.transaction('rw', db.contacts, async () => {
    const contact = await db.contacts.get(id);
    if (!contact) throw new Error(`unknown contact ${id}`);
    const next: Contact = { ...contact, id, updatedAt: nowIso() };
    if (name !== undefined) next.name = name;
    if (patch.rhythmDays !== undefined) next.rhythmDays = patch.rhythmDays;
    if (patch.archived !== undefined) next.archived = patch.archived;
    if ('note' in patch) {
      const note = cleanNote(patch.note);
      if (note !== undefined) next.note = note;
      else delete next.note;
    }
    await db.contacts.put(next);
  });
}

export interface DeletedContact { contact: Contact; logs: ContactLog[] }

/** Deletes the person and all their logs; returns both for "Rückgängig". */
export function deleteContact(id: Id): Promise<DeletedContact> {
  return db.transaction('rw', db.contacts, db.contactLogs, async () => {
    const contact = await db.contacts.get(id);
    if (!contact) throw new Error(`unknown contact ${id}`);
    const logs = await db.contactLogs.where('contactId').equals(id).toArray();
    await db.contactLogs.bulkDelete(logs.map((l) => l.id));
    await db.contacts.delete(id);
    return { contact, logs };
  });
}

export function restoreContact(deleted: DeletedContact): Promise<void> {
  return db.transaction('rw', db.contacts, db.contactLogs, async () => {
    await db.contacts.put(deleted.contact);
    if (deleted.logs.length > 0) await db.contactLogs.bulkPut(deleted.logs);
  });
}

export function getContact(id: Id): Promise<Contact | undefined> {
  return db.contacts.get(id);
}

export function contact$(id: Id): Observable<Contact | undefined> {
  return liveQuery(() => db.contacts.get(id));
}

/** Non-archived people ordered by sortKey (all people when includeArchived). */
export function contacts$(includeArchived = false): Observable<Contact[]> {
  return liveQuery(async () => {
    const rows = includeArchived ? await db.contacts.toArray() : await db.contacts.where('archived').equals(0).toArray();
    return rows.sort(bySortKey);
  });
}

/** liveQuery: all contact logs of all people (the data stays small). */
export function contactLogs$(): Observable<ContactLog[]> {
  return liveQuery(() => db.contactLogs.toArray());
}

/** liveQuery: the logs of one person, newest day first. */
export function contactLogsFor$(contactId: Id): Observable<ContactLog[]> {
  return liveQuery(() =>
    db.contactLogs
      .where('[contactId+day]')
      .between([contactId, Dexie.minKey], [contactId, Dexie.maxKey], true, true)
      .reverse()
      .toArray(),
  );
}

/** previous: the log of the same day that this log replaced (for "Rückgängig"). */
export interface LoggedContact { log: ContactLog; previous?: ContactLog }

/**
 * Logs a contact with the person on day (optionally with its kind). One log per person and day:
 * an existing log of that day is replaced and returned as `previous`. Invalid days and days
 * after today are rejected (RangeError); an unknown person rejects with an Error.
 */
export function logContact(contactId: Id, day: Day, kind?: ContactKind): Promise<LoggedContact> {
  if (!isDay(day)) return Promise.reject(new RangeError(`invalid day ${day}`));
  if (day > today()) return Promise.reject(new RangeError(`cannot log a future day ${day}`));
  return db.transaction('rw', db.contacts, db.contactLogs, async () => {
    if (!(await db.contacts.get(contactId))) throw new Error(`unknown contact ${contactId}`);
    const id = contactLogId(contactId, day);
    const previous = await db.contactLogs.get(id);
    const log: ContactLog = { id, contactId, day, loggedAt: nowIso() };
    if (kind !== undefined) log.kind = kind;
    await db.contactLogs.put(log);
    return previous ? { log, previous } : { log };
  });
}

/** Undoes logContact: restores the replaced log, or deletes the new one. A deleted person stays deleted. */
export function undoLogContact(result: LoggedContact): Promise<void> {
  return db.transaction('rw', db.contacts, db.contactLogs, async () => {
    const { log, previous } = result;
    if (previous && (await db.contacts.get(previous.contactId))) await db.contactLogs.put(previous);
    else await db.contactLogs.delete(log.id);
  });
}

/** Removes one log; returns it for "Rückgängig" (undefined when it did not exist). */
export function removeContactLog(id: ContactLog['id']): Promise<ContactLog | undefined> {
  return db.transaction('rw', db.contactLogs, async () => {
    const log = await db.contactLogs.get(id);
    if (log) await db.contactLogs.delete(id);
    return log;
  });
}

/** Writes a removed log back, unless its person has been deleted meanwhile. */
export function restoreContactLog(log: ContactLog): Promise<void> {
  return db.transaction('rw', db.contacts, db.contactLogs, async () => {
    if (await db.contacts.get(log.contactId)) await db.contactLogs.put(log);
  });
}
