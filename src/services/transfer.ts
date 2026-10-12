// JSON export/import (F §4.14, D.4). The file is validated strictly and sanitized
// (only known fields survive, timestamps are normalized to UTC); merge and restore
// each run in one rw transaction over all tables. Import bulk writes keep the
// records' own updatedAt (the documented exception to "updatedAt is set by repo/*").
// Merging carries no deletions and may duplicate default areas created by two
// separate onboardings (different ids).
import { db, TABLES, type TableName } from '../db.js';
import {
  SCHEMA_VERSION, DEFAULT_SETTINGS,
  type Area, type Day, type DayPlan, type FirstStepId, type FlowerId, type Habit, type HabitLog,
  type HabitSchedule, type ISO, type MoodLog, type Note, type Profile, type Project, type Recurrence,
  type Reminder, type Tag, type Task,
} from '../model.js';
import { defaultProfile, updateProfile } from '../repo/profile.js';
import { ensureTags, normalizeTagPath, tagChain } from '../repo/tags.js';
import { compareIso, deriveDueDay, isDay, isoAt, nowIso, today } from '../util/date.js';

export interface ExportFile {
  format: 'olife';
  version: 1;
  exportedAt: ISO;
  tables: Record<TableName, unknown[]>;
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/** Typed table contents of a validated file. */
export interface ImportTables {
  profile: Profile[]; areas: Area[]; projects: Project[]; tasks: Task[]; habits: Habit[];
  habitLogs: HabitLog[]; notes: Note[]; tags: Tag[]; moodLogs: MoodLog[]; dayPlans: DayPlan[];
}

/** A file that passed parseImport: same shape, typed and sanitized tables. */
export interface ValidatedExport extends ExportFile {
  tables: ImportTables;
}

// ---------------------------------------------------------------------------
// Export

/** Snapshot of all ten tables (one read transaction, so the snapshot is consistent). */
export function buildExport(): Promise<ExportFile> {
  return db.transaction('r', [...TABLES], async () => {
    const tables = {} as Record<TableName, unknown[]>;
    for (const name of TABLES) tables[name] = await db.table(name).toArray();
    return { format: 'olife', version: 1, exportedAt: nowIso(), tables };
  });
}

/** "olife-backup-JJJJ-MM-TT.json" for the given (default: current) day. */
export function exportFileName(day: Day = today()): string {
  return `olife-backup-${day}.json`;
}

/** Downloads olife-backup-JJJJ-MM-TT.json via <a download>; sets profile.lastExportAt. */
export async function exportJson(): Promise<void> {
  const file = await buildExport();
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = exportFileName();
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Revoking synchronously can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  await updateProfile({ lastExportAt: file.exportedAt });
}

// ---------------------------------------------------------------------------
// Validation

type Json = Record<string, unknown>;

const SHORT = 2_000;
const LONG = 1_000_000;
const ID_MAX = 200;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/u;
const TINT_RE = /^#[0-9A-Fa-f]{6}$/u;
// Base-62 fractional keys never end with '0' (see util/ids); such a key would make
// sortKeyBetween loop.
const SORT_KEY_RE = /^[0-9A-Za-z]{0,199}[1-9A-Za-z]$/u;

const FLOWERS: readonly FlowerId[] = [
  'bellis', 'calendula', 'helianthus', 'centaurea', 'passiflora', 'matricaria', 'leucanthemum', 'generic',
];
const FIRST_STEPS: readonly FirstStepId[] = ['focus', 'habit', 'note'];

function fail(path: string, problem: string): never {
  throw new ImportError(`${path}: ${problem}`);
}

function asRecord(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'expected an object');
  return value as Json;
}

const present = (value: unknown): boolean => value !== undefined && value !== null;

function str(r: Json, key: string, path: string, max = SHORT, allowEmpty = true): string {
  const v = r[key];
  if (typeof v !== 'string') fail(`${path}.${key}`, 'expected a string');
  if (v.length > max) fail(`${path}.${key}`, 'too long');
  if (!allowEmpty && v.trim() === '') fail(`${path}.${key}`, 'empty');
  return v;
}

function optStr(r: Json, key: string, path: string, max = SHORT): string | undefined {
  return present(r[key]) ? str(r, key, path, max) : undefined;
}

const id = (r: Json, key: string, path: string): string => str(r, key, path, ID_MAX, false);
const optId = (r: Json, key: string, path: string): string | undefined => (present(r[key]) ? id(r, key, path) : undefined);

function nullableId(r: Json, key: string, path: string): string | null {
  return present(r[key]) ? id(r, key, path) : null;
}

function bit(r: Json, key: string, path: string): 0 | 1 {
  const v = r[key];
  if (v !== 0 && v !== 1) fail(`${path}.${key}`, 'expected 0 or 1');
  return v;
}

function oneOf<T extends string>(r: Json, key: string, values: readonly T[], path: string): T {
  const v = r[key];
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) fail(`${path}.${key}`, 'unknown value');
  return v as T;
}

function int(r: Json, key: string, path: string, min: number, max: number): number {
  const v = r[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) fail(`${path}.${key}`, `expected an integer ${min}–${max}`);
  return v;
}

function finite(r: Json, key: string, path: string): number {
  const v = r[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${path}.${key}`, 'expected a number');
  return v;
}

/** ISO timestamp, normalized to UTC ("…Z"). */
function iso(r: Json, key: string, path: string): ISO {
  const v = r[key];
  if (typeof v !== 'string' || !ISO_RE.test(v) || Number.isNaN(Date.parse(v))) fail(`${path}.${key}`, 'expected an ISO timestamp');
  return new Date(v).toISOString();
}

const optIso = (r: Json, key: string, path: string): ISO | undefined => (present(r[key]) ? iso(r, key, path) : undefined);

function day(r: Json, key: string, path: string): Day {
  const v = r[key];
  if (!isDay(v)) fail(`${path}.${key}`, 'expected a day YYYY-MM-DD');
  return v;
}

const optDay = (r: Json, key: string, path: string): Day | undefined => (present(r[key]) ? day(r, key, path) : undefined);

function sortKey(r: Json, key: string, path: string): string {
  const v = r[key];
  if (typeof v !== 'string' || !SORT_KEY_RE.test(v)) fail(`${path}.${key}`, 'invalid sort key');
  return v;
}

function tint(r: Json, key: string, path: string): string {
  const v = r[key];
  if (typeof v !== 'string' || !TINT_RE.test(v)) fail(`${path}.${key}`, 'expected a colour #RRGGBB');
  return v;
}

function strings(value: unknown, path: string, itemMax = ID_MAX, maxItems = 100_000): string[] {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  if (value.length > maxItems) fail(path, 'too many entries');
  return value.map((item, i) => {
    if (typeof item !== 'string' || item === '' || item.length > itemMax) fail(`${path}[${i}]`, 'expected a non-empty string');
    return item;
  });
}

function tagPaths(value: unknown, path: string): string[] {
  const list = strings(value, path, SHORT);
  list.forEach((p, i) => {
    if (normalizeTagPath(p) !== p) fail(`${path}[${i}]`, 'tag path is not normalized');
  });
  return [...new Set(list)];
}

/** Copies a defined optional value onto target. */
function setOpt<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

function recurrence(value: unknown, path: string, kinds: readonly Recurrence['kind'][]): Recurrence {
  const r = asRecord(value, path);
  const kind = oneOf(r, 'kind', kinds, path);
  switch (kind) {
    case 'daily':
      return { kind, interval: int(r, 'interval', path, 1, 366) };
    case 'weekly': {
      const weekdays = (Array.isArray(r.weekdays) ? r.weekdays : fail(`${path}.weekdays`, 'expected an array')).map((d, i) => {
        if (typeof d !== 'number' || !Number.isInteger(d) || d < 1 || d > 7) fail(`${path}.weekdays[${i}]`, 'expected 1–7');
        return d;
      });
      if (weekdays.length === 0) fail(`${path}.weekdays`, 'empty');
      return { kind, interval: int(r, 'interval', path, 1, 52), weekdays: [...new Set(weekdays)].sort((a, b) => a - b) };
    }
    case 'monthly': {
      const d = r.day === 'last' ? 'last' : int(r, 'day', path, 1, 31);
      return { kind, interval: int(r, 'interval', path, 1, 120), day: d };
    }
    case 'timesPerWeek':
      return { kind, times: int(r, 'times', path, 1, 7) };
    case 'afterCompletion':
      return { kind, days: int(r, 'days', path, 1, 3650) };
  }
}

function reminder(value: unknown, path: string): Reminder {
  const r = asRecord(value, path);
  const out: Reminder = { id: id(r, 'id', path), mode: oneOf(r, 'mode', ['absolute', 'relative'] as const, path) };
  setOpt(out, 'at', optIso(r, 'at', path));
  if (present(r.offsetMinutes)) out.offsetMinutes = int(r, 'offsetMinutes', path, -525_600, 525_600);
  setOpt(out, 'dismissedAt', optIso(r, 'dismissedAt', path));
  if (out.mode === 'absolute' && out.at === undefined) fail(`${path}.at`, 'missing for an absolute reminder');
  if (out.mode === 'relative' && out.offsetMinutes === undefined) fail(`${path}.offsetMinutes`, 'missing for a relative reminder');
  return out;
}

function validateProfile(value: unknown, path: string): Profile {
  const r = asRecord(value, path);
  if (r.key !== 'profile') fail(`${path}.key`, "expected 'profile'");
  const s = present(r.settings) ? asRecord(r.settings, `${path}.settings`) : {};
  const sp = `${path}.settings`;
  const settings: Profile['settings'] = { ...DEFAULT_SETTINGS };
  if (present(s.theme)) settings.theme = oneOf(s, 'theme', ['light', 'dark', 'system'] as const, sp);
  // S18: 0 ≤ dayStartHour < 12 ≤ eveningHour ≤ 23.
  if (present(s.dayStartHour)) settings.dayStartHour = int(s, 'dayStartHour', sp, 0, 11);
  if (present(s.eveningHour)) settings.eveningHour = int(s, 'eveningHour', sp, 12, 23);
  if (present(s.leftHanded)) {
    if (typeof s.leftHanded !== 'boolean') fail(`${sp}.leftHanded`, 'expected a boolean');
    settings.leftHanded = s.leftHanded;
  }
  if (present(s.reminderLeadMinutes)) settings.reminderLeadMinutes = int(s, 'reminderLeadMinutes', sp, 0, 10_080);
  if (present(s.animations)) settings.animations = oneOf(s, 'animations', ['system', 'reduced'] as const, sp);
  if (present(s.landscape)) settings.landscape = bit(s, 'landscape', sp);
  const profile: Profile = {
    key: 'profile',
    schemaVersion: present(r.schemaVersion) ? int(r, 'schemaVersion', path, 1, SCHEMA_VERSION) : SCHEMA_VERSION,
    settings,
    onboardingDone: bit(r, 'onboardingDone', path),
    createdAt: iso(r, 'createdAt', path),
  };
  setOpt(profile, 'lastExportAt', optIso(r, 'lastExportAt', path));
  setOpt(profile, 'backupCardDismissedAt', optIso(r, 'backupCardDismissedAt', path));
  if (present(r.firstStepsDismissed)) {
    const steps = strings(r.firstStepsDismissed, `${path}.firstStepsDismissed`);
    steps.forEach((step, i) => {
      if (!(FIRST_STEPS as readonly string[]).includes(step)) fail(`${path}.firstStepsDismissed[${i}]`, 'unknown value');
    });
    profile.firstStepsDismissed = [...new Set(steps)] as FirstStepId[];
  }
  return profile;
}

function validateArea(value: unknown, path: string): Area {
  const r = asRecord(value, path);
  return {
    id: id(r, 'id', path),
    name: str(r, 'name', path, 200, false),
    flower: oneOf(r, 'flower', FLOWERS, path),
    tint: tint(r, 'tint', path),
    sortKey: sortKey(r, 'sortKey', path),
    archived: bit(r, 'archived', path),
    updatedAt: iso(r, 'updatedAt', path),
  };
}

function validateProject(value: unknown, path: string): Project {
  const r = asRecord(value, path);
  const project: Project = {
    id: id(r, 'id', path),
    areaId: id(r, 'areaId', path),
    name: str(r, 'name', path, SHORT, false),
    status: oneOf(r, 'status', ['active', 'archived'] as const, path),
    sortKey: sortKey(r, 'sortKey', path),
    updatedAt: iso(r, 'updatedAt', path),
  };
  setOpt(project, 'description', optStr(r, 'description', path, LONG));
  setOpt(project, 'dueAt', optIso(r, 'dueAt', path));
  if (present(r.kanbanColumns)) project.kanbanColumns = strings(r.kanbanColumns, `${path}.kanbanColumns`, SHORT, 50);
  return project;
}

function validateTask(value: unknown, path: string): Task {
  const r = asRecord(value, path);
  const reminders = present(r.reminders)
    ? (Array.isArray(r.reminders) ? r.reminders : fail(`${path}.reminders`, 'expected an array')).map((x, i) =>
      reminder(x, `${path}.reminders[${i}]`))
    : [];
  const task: Task = {
    id: id(r, 'id', path),
    areaId: id(r, 'areaId', path),
    projectId: nullableId(r, 'projectId', path),
    parentId: nullableId(r, 'parentId', path),
    title: str(r, 'title', path),
    status: oneOf(r, 'status', ['open', 'doing', 'done'] as const, path),
    important: bit(r, 'important', path),
    urgent: bit(r, 'urgent', path),
    dueHasTime: present(r.dueHasTime) ? bit(r, 'dueHasTime', path) : 0,
    reminders,
    sortKey: sortKey(r, 'sortKey', path),
    createdAt: iso(r, 'createdAt', path),
    updatedAt: iso(r, 'updatedAt', path),
  };
  setOpt(task, 'description', optStr(r, 'description', path, LONG));
  setOpt(task, 'dueAt', optIso(r, 'dueAt', path));
  setOpt(task, 'dueDay', optDay(r, 'dueDay', path));
  setOpt(task, 'completedAt', optIso(r, 'completedAt', path));
  if (present(r.recurrence)) {
    task.recurrence = recurrence(r.recurrence, `${path}.recurrence`, ['daily', 'weekly', 'monthly', 'afterCompletion']);
  }
  setOpt(task, 'recurrenceAnchor', optDay(r, 'recurrenceAnchor', path));
  if (present(r.tagPaths)) task.tagPaths = tagPaths(r.tagPaths, `${path}.tagPaths`);
  if (present(r.linkedNoteIds)) task.linkedNoteIds = strings(r.linkedNoteIds, `${path}.linkedNoteIds`);
  // Due invariants: dueDay is stored as written (never re-derived across time zones);
  // a missing half is filled in.
  if (task.dueAt !== undefined && task.dueDay === undefined) setOpt(task, 'dueDay', deriveDueDay(task.dueAt));
  if (task.dueAt === undefined && task.dueDay !== undefined) {
    task.dueAt = isoAt(task.dueDay);
    task.dueHasTime = 0;
  }
  if (task.dueAt === undefined) task.dueHasTime = 0;
  return task;
}

function validateHabit(value: unknown, path: string): Habit {
  const r = asRecord(value, path);
  const habit: Habit = {
    id: id(r, 'id', path),
    name: str(r, 'name', path, SHORT, false),
    schedule: recurrence(r.schedule, `${path}.schedule`, ['daily', 'weekly', 'timesPerWeek']) as HabitSchedule,
    period: oneOf(r, 'period', ['morning', 'evening', 'any'] as const, path),
    startDay: day(r, 'startDay', path),
    archived: bit(r, 'archived', path),
    sortKey: sortKey(r, 'sortKey', path),
    updatedAt: iso(r, 'updatedAt', path),
  };
  setOpt(habit, 'areaId', optId(r, 'areaId', path));
  if (present(r.target)) {
    const t = asRecord(r.target, `${path}.target`);
    habit.target = { value: finite(t, 'value', `${path}.target`), unit: str(t, 'unit', `${path}.target`, 50) };
  }
  return habit;
}

function validateHabitLog(value: unknown, path: string): HabitLog {
  const r = asRecord(value, path);
  const habitId = id(r, 'habitId', path);
  const d = day(r, 'day', path);
  const logId = `${habitId}:${d}` as const;
  if (r.id !== logId) fail(`${path}.id`, 'expected habitId:day');
  const log: HabitLog = {
    id: logId,
    habitId,
    day: d,
    status: oneOf(r, 'status', ['done', 'skipped'] as const, path),
    loggedAt: iso(r, 'loggedAt', path),
  };
  if (present(r.value)) log.value = finite(r, 'value', path);
  return log;
}

function validateNote(value: unknown, path: string): Note {
  const r = asRecord(value, path);
  const note: Note = {
    id: id(r, 'id', path),
    kind: oneOf(r, 'kind', ['note', 'journal'] as const, path),
    title: str(r, 'title', path),
    body: str(r, 'body', path, LONG),
    tagPaths: present(r.tagPaths) ? tagPaths(r.tagPaths, `${path}.tagPaths`) : [],
    pinned: bit(r, 'pinned', path),
    archived: bit(r, 'archived', path),
    createdAt: iso(r, 'createdAt', path),
    updatedAt: iso(r, 'updatedAt', path),
  };
  setOpt(note, 'journalDay', optDay(r, 'journalDay', path));
  if (note.kind === 'journal' && note.journalDay === undefined) fail(`${path}.journalDay`, 'missing for a journal note');
  if (present(r.linkedTaskIds)) note.linkedTaskIds = strings(r.linkedTaskIds, `${path}.linkedTaskIds`);
  return note;
}

function validateTag(value: unknown, path: string): Tag {
  const r = asRecord(value, path);
  const tagPath = str(r, 'path', path, 200, false);
  if (normalizeTagPath(tagPath) !== tagPath) fail(`${path}.path`, 'tag path is not normalized');
  const expected = tagChain(tagPath).at(-1);
  const parentPath = present(r.parentPath) ? str(r, 'parentPath', path, 200) : null;
  if (!expected || parentPath !== expected.parentPath) fail(`${path}.parentPath`, 'does not match the path');
  const tag: Tag = { path: tagPath, parentPath, name: str(r, 'name', path, 200, false) };
  if (present(r.color)) tag.color = tint(r, 'color', path);
  return tag;
}

function validateMoodLog(value: unknown, path: string): MoodLog {
  const r = asRecord(value, path);
  const mood: MoodLog = {
    id: id(r, 'id', path),
    day: day(r, 'day', path),
    value: int(r, 'value', path, 1, 5) as MoodLog['value'],
    loggedAt: iso(r, 'loggedAt', path),
  };
  setOpt(mood, 'noteId', optId(r, 'noteId', path));
  return mood;
}

function validateDayPlan(value: unknown, path: string): DayPlan {
  const r = asRecord(value, path);
  const ids = strings(r.mitTaskIds, `${path}.mitTaskIds`);
  if (new Set(ids).size !== ids.length) fail(`${path}.mitTaskIds`, 'duplicate ids');
  if (ids.length > 3) fail(`${path}.mitTaskIds`, 'more than three tasks');
  const plan: DayPlan = { id: day(r, 'id', path), mitTaskIds: ids };
  setOpt(plan, 'preparedAt', optIso(r, 'preparedAt', path));
  return plan;
}

function rows<T>(value: unknown, name: TableName, check: (v: unknown, path: string) => T, key: (row: T) => string): T[] {
  if (!Array.isArray(value)) fail(`tables.${name}`, 'expected an array');
  const seen = new Set<string>();
  return value.map((item, i) => {
    const path = `${name}[${i}]`;
    const row = check(item, path);
    const k = key(row);
    if (seen.has(k)) fail(path, `duplicate key ${k}`);
    seen.add(k);
    return row;
  });
}

/** Validates an already parsed file object; returns a sanitized copy. Throws ImportError. */
export function validateExport(input: unknown): ValidatedExport {
  const r = asRecord(input, 'file');
  if (r.format !== 'olife') fail('format', "expected 'olife'");
  if (typeof r.version !== 'number' || !Number.isInteger(r.version)) fail('version', 'expected an integer');
  if (r.version !== 1) fail('version', `unsupported version ${r.version}`);
  const exportedAt = iso(r, 'exportedAt', 'file');
  const t = asRecord(r.tables, 'tables');
  for (const name of TABLES) if (!Array.isArray(t[name])) fail(`tables.${name}`, 'missing or not an array');
  const tables: ImportTables = {
    profile: rows(t.profile, 'profile', validateProfile, (p) => p.key),
    areas: rows(t.areas, 'areas', validateArea, (a) => a.id),
    projects: rows(t.projects, 'projects', validateProject, (p) => p.id),
    tasks: rows(t.tasks, 'tasks', validateTask, (x) => x.id),
    habits: rows(t.habits, 'habits', validateHabit, (h) => h.id),
    habitLogs: rows(t.habitLogs, 'habitLogs', validateHabitLog, (l) => l.id),
    notes: rows(t.notes, 'notes', validateNote, (n) => n.id),
    tags: rows(t.tags, 'tags', validateTag, (x) => x.path),
    moodLogs: rows(t.moodLogs, 'moodLogs', validateMoodLog, (m) => m.id),
    dayPlans: rows(t.dayPlans, 'dayPlans', validateDayPlan, (p) => p.id),
  };
  return { format: 'olife', version: 1, exportedAt, tables };
}

/**
 * Parses and validates a file (format, version, all tables are arrays,
 * every record has its key field with the right type). Throws ImportError.
 * Every record is checked field by field (types, enums, day keys, ISO
 * timestamps, colours, HabitLog id = habitId:day, ≤ 3 focus ids, normalized tags).
 */
export function parseImport(text: string): ExportFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError('not valid JSON');
  }
  return validateExport(data);
}

// ---------------------------------------------------------------------------
// Import

export interface MergeResult { created: number; updated: number; unchanged: number }

/** Rows of `incoming` that are new or carry a strictly newer updatedAt than the local row. */
function newer<T extends { updatedAt: ISO }>(incoming: readonly T[], local: readonly (T | undefined)[], result: MergeResult): T[] {
  const out: T[] = [];
  incoming.forEach((row, i) => {
    const mine = local[i];
    if (!mine) {
      out.push(row);
      result.created++;
    } else if (compareIso(row.updatedAt, mine.updatedAt) > 0) {
      out.push(row);
      result.updated++;
    } else {
      result.unchanged++;
    }
  });
  return out;
}

const ids = <T extends { id: string }>(list: readonly T[]): string[] => list.map((x) => x.id);

function laterIso(a: ISO | undefined, b: ISO | undefined): ISO | undefined {
  return compareIso(a, b) >= 0 ? a : b;
}

/**
 * "Zusammenführen" in one rw transaction: per key the newer updatedAt wins
 * (ties keep local); HabitLogs are united, 'done' beats 'skipped' (same status:
 * newer loggedAt); logs of unknown habits are dropped; tags united by path;
 * moodLogs: newer loggedAt wins per day; dayPlans: local wins (an imported plan
 * keeps only known task ids, at most 3); profile: local wins with
 * lastExportAt = max (file profile only when none exists locally).
 * The profile is not counted in the result.
 */
export function importMerge(file: ExportFile): Promise<MergeResult> {
  const { tables: data } = validateExport(file);
  const result: MergeResult = { created: 0, updated: 0, unchanged: 0 };
  return db.transaction('rw', [...TABLES], async () => {
    await db.areas.bulkPut(newer(data.areas, await db.areas.bulkGet(ids(data.areas)), result));
    await db.projects.bulkPut(newer(data.projects, await db.projects.bulkGet(ids(data.projects)), result));
    await db.tasks.bulkPut(newer(data.tasks, await db.tasks.bulkGet(ids(data.tasks)), result));
    await db.habits.bulkPut(newer(data.habits, await db.habits.bulkGet(ids(data.habits)), result));
    const notes = newer(data.notes, await db.notes.bulkGet(ids(data.notes)), result);
    await db.notes.bulkPut(notes);

    // Tags: union by path.
    const localTags = await db.tags.bulkGet(data.tags.map((x) => x.path));
    const newTags = data.tags.filter((_, i) => localTags[i] === undefined);
    result.created += newTags.length;
    result.unchanged += data.tags.length - newTags.length;
    await db.tags.bulkAdd(newTags);
    await ensureTags([...notes.flatMap((n) => n.tagPaths), ...newTags.map((x) => x.path)]);

    // HabitLogs: union.
    const habitIds = new Set((await db.habits.toCollection().primaryKeys()).map(String));
    const logs = data.habitLogs.filter((l) => habitIds.has(l.habitId));
    const localLogs = await db.habitLogs.bulkGet(logs.map((l) => l.id));
    const putLogs: HabitLog[] = [];
    logs.forEach((log, i) => {
      const mine = localLogs[i];
      if (!mine) {
        putLogs.push(log);
        result.created++;
        return;
      }
      const wins = log.status !== mine.status ? log.status === 'done' : compareIso(log.loggedAt, mine.loggedAt) > 0;
      if (wins) {
        putLogs.push(log);
        result.updated++;
      } else {
        result.unchanged++;
      }
    });
    await db.habitLogs.bulkPut(putLogs);

    // MoodLogs: one per day, newer loggedAt wins.
    const incomingByDay = new Map<Day, MoodLog>();
    for (const mood of data.moodLogs) {
      const seen = incomingByDay.get(mood.day);
      if (!seen || compareIso(mood.loggedAt, seen.loggedAt) > 0) incomingByDay.set(mood.day, mood);
    }
    const localMoods = await db.moodLogs.where('day').anyOf([...incomingByDay.keys()]).toArray();
    for (const [moodDay, mood] of incomingByDay) {
      const mine = localMoods.filter((m) => m.day === moodDay);
      const newest = mine.reduce<MoodLog | undefined>((a, m) => (!a || compareIso(m.loggedAt, a.loggedAt) > 0 ? m : a), undefined);
      if (!newest) {
        await db.moodLogs.put(mood);
        result.created++;
      } else if (compareIso(mood.loggedAt, newest.loggedAt) > 0) {
        await db.moodLogs.bulkDelete(mine.map((m) => m.id));
        await db.moodLogs.put(mood);
        result.updated++;
      } else {
        result.unchanged++;
      }
    }

    // DayPlans: local wins; imported plans keep known task ids only.
    const localPlans = await db.dayPlans.bulkGet(ids(data.dayPlans));
    const freshPlans = data.dayPlans.filter((_, i) => localPlans[i] === undefined);
    const known = await db.tasks.bulkGet(freshPlans.flatMap((p) => p.mitTaskIds));
    const knownIds = new Set(known.flatMap((x) => (x ? [x.id] : [])));
    for (const plan of freshPlans) {
      await db.dayPlans.put({ ...plan, mitTaskIds: plan.mitTaskIds.filter((x) => knownIds.has(x)).slice(0, 3) });
    }
    result.created += freshPlans.length;
    result.unchanged += data.dayPlans.length - freshPlans.length;

    // Profile: local wins; lastExportAt = max.
    const incomingProfile = data.profile[0];
    const localProfile = await db.profile.get('profile');
    if (!localProfile) {
      if (incomingProfile) await db.profile.put(incomingProfile);
    } else if (incomingProfile) {
      const last = laterIso(localProfile.lastExportAt, incomingProfile.lastExportAt);
      if (last !== undefined && last !== localProfile.lastExportAt) await db.profile.put({ ...localProfile, lastExportAt: last });
    }
    return result;
  });
}

/**
 * "Wiederherstellen": clears all tables and writes the file, atomically. Returns the record count.
 * Without a profile in the file a fresh default profile is written. onboardingDone is 1
 * whenever an active area exists (otherwise 0, so onboarding creates one); lastExportAt
 * becomes at least the file's exportedAt, since the data now equals that backup.
 */
export function importRestore(file: ExportFile): Promise<number> {
  const valid = validateExport(file);
  const data = valid.tables;
  return db.transaction('rw', [...TABLES], async () => {
    for (const name of TABLES) await db.table(name).clear();
    await db.areas.bulkPut(data.areas);
    await db.projects.bulkPut(data.projects);
    await db.tasks.bulkPut(data.tasks);
    await db.habits.bulkPut(data.habits);
    await db.habitLogs.bulkPut(data.habitLogs);
    await db.notes.bulkPut(data.notes);
    await db.tags.bulkPut(data.tags);
    await db.moodLogs.bulkPut(data.moodLogs);
    await db.dayPlans.bulkPut(data.dayPlans);
    await ensureTags([...data.notes.flatMap((n) => n.tagPaths), ...data.tags.map((x) => x.path)]);
    const profile = structuredClone(data.profile[0] ?? defaultProfile());
    profile.onboardingDone = data.areas.some((a) => a.archived === 0) ? 1 : 0;
    const last = laterIso(profile.lastExportAt, valid.exportedAt);
    if (last !== undefined) profile.lastExportAt = last;
    await db.profile.put(profile);
    return TABLES.reduce((sum, name) => sum + data[name].length, 0);
  });
}

/** "Alle Daten löschen": Dexie.delete() of the database. The caller then navigates to /start. */
export async function deleteAllData(): Promise<void> {
  // Auto-open stays enabled so live queries still running see an empty database
  // instead of failing until the page navigates away.
  await db.delete({ disableAutoOpen: false });
}
