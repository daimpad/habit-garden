// services/contacts: contact status (never contacted, in rhythm, due exactly at the rhythm, future
// logs ignored), suggestions (order, limit, contacted today, archived) and the text helpers.
// services/transfer: validation of the contacts tables (files without them stay importable).
// Runs against the tsc output (npm test); scripts/run-tests.mjs sets TZ=Europe/Berlin.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Contact, ContactKind, ContactLog, Day } from '../model.js';
import {
  BUTTERFLY_COLORS, butterflyColor, contactKindLabel, contactStatus, contactStatuses, lastContactText, rhythmLabel,
  suggestions,
} from '../services/contacts.js';
import { ImportError, validateExport } from '../services/transfer.js';
import { addDays } from '../util/date.js';

process.env.TZ = 'Europe/Berlin';

const TODAY: Day = '2026-10-12';
const ago = (n: number): Day => addDays(TODAY, -n);

const person = (id: string, rhythmDays: number, sortKey = 'V', archived: 0 | 1 = 0): Contact => ({
  id, name: id, rhythmDays, archived, sortKey, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

const log = (contactId: string, day: Day, kind?: ContactKind): ContactLog => ({
  id: `${contactId}:${day}`, contactId, day, loggedAt: `${day}T10:00:00.000Z`, ...(kind ? { kind } : {}),
});

describe('contactStatus', () => {
  test('never contacted: due, dueIn 0, no last day', () => {
    const s = contactStatus(person('a', 14), [], TODAY);
    assert.equal(s.lastDay, null);
    assert.equal(s.daysSince, null);
    assert.equal(s.dueIn, 0);
    assert.equal(s.due, true);
    assert.equal(s.contactedToday, false);
  });

  test('in rhythm: not due, dueIn counts the remaining days', () => {
    const s = contactStatus(person('a', 14), [log('a', ago(3)), log('a', ago(20))], TODAY);
    assert.equal(s.lastDay, ago(3));
    assert.equal(s.daysSince, 3);
    assert.equal(s.dueIn, 11);
    assert.equal(s.due, false);
  });

  test('exactly at the rhythm: due with dueIn 0', () => {
    const s = contactStatus(person('a', 7), [log('a', ago(7))], TODAY);
    assert.equal(s.daysSince, 7);
    assert.equal(s.dueIn, 0);
    assert.equal(s.due, true);
  });

  test('one day before the rhythm: not due', () => {
    assert.equal(contactStatus(person('a', 7), [log('a', ago(6))], TODAY).due, false);
  });

  test('overdue: negative dueIn', () => {
    const s = contactStatus(person('a', 30), [log('a', ago(40))], TODAY);
    assert.equal(s.dueIn, -10);
    assert.equal(s.due, true);
  });

  test('contacted today', () => {
    const s = contactStatus(person('a', 7), [log('a', TODAY, 'call')], TODAY);
    assert.equal(s.contactedToday, true);
    assert.equal(s.daysSince, 0);
    assert.equal(s.due, false);
  });

  test('future logs are ignored', () => {
    const s = contactStatus(person('a', 7), [log('a', ago(10)), log('a', addDays(TODAY, 1))], TODAY);
    assert.equal(s.lastDay, ago(10));
    assert.equal(s.due, true);
    assert.equal(contactStatus(person('a', 7), [log('a', addDays(TODAY, 2))], TODAY).lastDay, null);
  });

  test("other people's logs are ignored", () => {
    const s = contactStatus(person('a', 7), [log('b', TODAY), log('a', ago(9))], TODAY);
    assert.equal(s.lastDay, ago(9));
  });

  test('calendar days across the DST change (2026-10-25)', () => {
    const s = contactStatus(person('a', 7), [log('a', '2026-10-24')], '2026-10-31');
    assert.equal(s.daysSince, 7);
    assert.equal(s.due, true);
  });
});

describe('contactStatuses', () => {
  test('archived people are excluded, input order is kept', () => {
    const people = [person('c', 7, 'X'), person('a', 7, 'V', 1), person('b', 7, 'W')];
    assert.deepEqual(contactStatuses(people, [], TODAY).map((s) => s.contact.id), ['c', 'b']);
  });
});

describe('suggestions', () => {
  const anna = person('anna', 14, 'V');
  const ben = person('ben', 30, 'W');
  const ilse = person('ilse', 7, 'X');
  const lena = person('lena', 90, 'Y');
  const jonas = person('jonas', 14, 'Z');
  const people = [anna, ben, ilse, lena, jonas];
  const logs = [log('anna', ago(3)), log('ben', ago(40)), log('ilse', ago(9)), log('lena', ago(20))];

  test('never contacted first, then by overdue ratio; people in rhythm do not appear', () => {
    // ben: (40 − 30) / 30 ≈ .33, ilse: (9 − 7) / 7 ≈ .29.
    assert.deepEqual(suggestions(people, logs, TODAY).map((s) => s.contact.id), ['jonas', 'ben', 'ilse']);
  });

  test('ratio beats absolute days: 14 days over a weekly rhythm before 20 days over a quarterly one', () => {
    const weekly = person('w', 7, 'B');
    const quarterly = person('q', 90, 'A');
    const out = suggestions([quarterly, weekly], [log('w', ago(21)), log('q', ago(110))], TODAY);
    assert.deepEqual(out.map((s) => s.contact.id), ['w', 'q']);
  });

  test('never contacted people keep sortKey order (not input order)', () => {
    const out = suggestions([person('z', 7, 'Z'), person('m', 7, 'M'), person('a', 7, 'A')], [], TODAY);
    assert.deepEqual(out.map((s) => s.contact.id), ['a', 'm', 'z']);
  });

  test('limit: default 3, custom max, 0', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id, i) => person(id, 7, String.fromCharCode(65 + i)));
    assert.equal(suggestions(many, [], TODAY).length, 3);
    assert.equal(suggestions(many, [], TODAY, 1).length, 1);
    assert.equal(suggestions(many, [], TODAY, 10).length, 5);
    assert.equal(suggestions(many, [], TODAY, 0).length, 0);
  });

  test('people contacted today never appear', () => {
    const out = suggestions(people, [...logs, log('jonas', TODAY), log('ben', TODAY, 'meeting')], TODAY);
    assert.deepEqual(out.map((s) => s.contact.id), ['ilse']);
  });

  test('archived people never appear', () => {
    const archived = { ...jonas, archived: 1 as const };
    const out = suggestions([anna, ben, ilse, lena, archived], logs, TODAY);
    assert.deepEqual(out.map((s) => s.contact.id), ['ben', 'ilse']);
  });

  test('equal ratio: more days overdue first, then sortKey', () => {
    const a = person('a', 7, 'B');
    const b = person('b', 14, 'A');
    const c = person('c', 7, 'C');
    // a: 7 over 7 (ratio 1), b: 14 over 14 (ratio 1, more days), c like a but later sortKey.
    const out = suggestions([a, b, c], [log('a', ago(14)), log('b', ago(28)), log('c', ago(14))], TODAY);
    assert.deepEqual(out.map((s) => s.contact.id), ['b', 'a', 'c']);
  });
});

describe('texts', () => {
  test('rhythmLabel', () => {
    assert.equal(rhythmLabel(7), 'Wöchentlich');
    assert.equal(rhythmLabel(14), 'Alle 2 Wochen');
    assert.equal(rhythmLabel(30), 'Monatlich');
    assert.equal(rhythmLabel(90), 'Vierteljährlich');
    assert.equal(rhythmLabel(10), 'Alle 10 Tage');
  });

  test('lastContactText', () => {
    const p = person('a', 7);
    assert.equal(lastContactText(contactStatus(p, [], TODAY)), 'Noch kein Kontakt');
    assert.equal(lastContactText(contactStatus(p, [log('a', TODAY)], TODAY)), 'Heute kontaktiert');
    assert.equal(lastContactText(contactStatus(p, [log('a', ago(1))], TODAY)), 'Gestern kontaktiert');
    assert.equal(lastContactText(contactStatus(p, [log('a', ago(9))], TODAY)), 'Zuletzt vor 9 Tagen');
  });

  test('contactKindLabel', () => {
    assert.equal(contactKindLabel('call'), 'Anruf');
    assert.equal(contactKindLabel('message'), 'Nachricht');
    assert.equal(contactKindLabel('meeting'), 'Treffen');
  });
});

describe('butterflyColor', () => {
  test('stable per id and from the palette', () => {
    const p = person('5f0c0a7e-1111-4222-8333-944455556666', 7);
    assert.equal(butterflyColor(p), butterflyColor({ ...p, name: 'Other' }));
    assert.ok(BUTTERFLY_COLORS.includes(butterflyColor(p)));
  });

  test('spreads over the palette', () => {
    const colors = new Set(Array.from({ length: 60 }, (_, i) => butterflyColor(person(`id-${i}`, 7))));
    assert.ok(colors.size >= 4);
  });
});

describe('transfer validation of people', () => {
  const V1_TABLES = ['profile', 'areas', 'projects', 'tasks', 'habits', 'habitLogs', 'notes', 'tags', 'moodLogs', 'dayPlans'];
  const file = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    format: 'olife', version: 1, exportedAt: '2026-10-01T10:00:00.000Z',
    tables: { ...Object.fromEntries(V1_TABLES.map((name) => [name, []])), ...extra },
  });
  const contact = { ...person('c1', 14), note: 'Mag Tee' };

  test('a file without contacts and contactLogs imports them as empty tables', () => {
    const { tables } = validateExport(file());
    assert.deepEqual(tables.contacts, []);
    assert.deepEqual(tables.contactLogs, []);
  });

  test('valid people and logs pass; an empty note is dropped', () => {
    const { tables } = validateExport(file({
      contacts: [contact, { ...person('c2', 90), note: '  ' }],
      contactLogs: [log('c1', '2026-10-01', 'call'), log('c2', '2026-09-20')],
    }));
    assert.equal(tables.contacts.length, 2);
    assert.equal(tables.contacts[0]?.note, 'Mag Tee');
    assert.equal(tables.contacts[1] && 'note' in tables.contacts[1], false);
    assert.equal(tables.contactLogs[0]?.kind, 'call');
    assert.equal(tables.contactLogs[1] && 'kind' in tables.contactLogs[1], false);
  });

  const rejects = (extra: Record<string, unknown>): void => {
    assert.throws(() => validateExport(file(extra)), ImportError);
  };

  test('rhythmDays must be an integer 1–365', () => {
    for (const rhythmDays of [0, 366, 1.5, '7', null]) rejects({ contacts: [{ ...contact, rhythmDays }] });
    assert.equal(validateExport(file({ contacts: [{ ...contact, rhythmDays: 365 }] })).tables.contacts[0]?.rhythmDays, 365);
  });

  test('required contact fields', () => {
    for (const key of ['id', 'name', 'archived', 'sortKey', 'createdAt', 'updatedAt']) {
      const broken: Record<string, unknown> = { ...contact };
      delete broken[key];
      rejects({ contacts: [broken] });
    }
    rejects({ contacts: [{ ...contact, name: '   ' }] });
  });

  test('logs: kind from the union, valid day, id = contactId:day', () => {
    rejects({ contactLogs: [{ ...log('c1', '2026-10-01'), kind: 'letter' }] });
    rejects({ contactLogs: [{ ...log('c1', '2026-10-01'), day: '2026-02-30', id: 'c1:2026-02-30' }] });
    rejects({ contactLogs: [{ ...log('c1', '2026-10-01'), id: 'c1:2026-10-02' }] });
    rejects({ contactLogs: [log('c1', '2026-10-01'), log('c1', '2026-10-01')] });
  });

  test('present but not an array is rejected', () => {
    rejects({ contacts: {} });
    rejects({ contactLogs: null });
  });
});
