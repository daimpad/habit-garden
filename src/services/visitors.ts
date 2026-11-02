// Besucher im Garten (Gamification Teil 2, decision of 02.11.2026): twelve small animals come to the island for
// a reason. Pure (no DOM, no Dexie; repo/visitors.ts gathers the history, unit-tested in __tests__/visitors.test.ts).
//
// - Everything derives from what is already stored (milestones, habit logs, the evening fire's journal entries,
//   contact logs, completed tasks): no table of its own, so backups, imports and "Rückgängig" just work. A visitor
//   counts as found from the first day its reason holds; if the history changes (a log taken back) the date moves
//   or the visitor is open again.
// - Reasons: Biene first full bloom · Rotkehlchen first run of 7 · Igel first evening fire · Schnecke watering again
//   after a pause of at least three days · Frosch the fifth day with everything watered · Meise the first contact
//   logged · Marienkäfer 10 tasks done · Ente the third full bloom · Eichhörnchen first run of 30 · Eule five evening
//   fires · Libelle 25 tasks done · Maulwurf 100 times watered.
// - On the island (rare and special): a visitor found within the last NEW_DAYS days is there; besides, known
//   visitors drop by now and then, chosen by the day (stable for the day): none, one or two. In winter the
//   insects, the frog, the snail and the hedgehog stay away (only as returning guests; a new one always comes).
//   At most ISLAND_MAX at once.
import { fmt, t } from '../i18n/de.js';
import type { Day } from '../model.js';
import type { Habit, HabitLog } from '../model.js';
import { addDays, formatDayMonth } from '../util/date.js';
import { isScheduledOn } from './growth.js';
import type { Season } from './season.js';

export type VisitorId =
  | 'bee' | 'robin' | 'hedgehog' | 'snail' | 'frog' | 'tit' | 'ladybug' | 'duck' | 'squirrel' | 'owl' | 'dragonfly' | 'mole';

/** Album order (roughly the order they usually arrive). */
export const VISITOR_IDS: readonly VisitorId[] = [
  'bee', 'robin', 'hedgehog', 'snail', 'frog', 'tit', 'ladybug', 'duck', 'squirrel', 'owl', 'dragonfly', 'mole',
];

export const NEW_DAYS = 3;
export const ISLAND_MAX = 3;
export const PAUSE_DAYS = 3;
const WINTER_AWAY: ReadonlySet<VisitorId> = new Set(['bee', 'ladybug', 'dragonfly', 'frog', 'snail', 'hedgehog']);

/** What the rules read; every list sorted ascending. */
export interface VisitorHistory {
  /** Full blooms (milestone kind bloom), with the routine's name. */
  blooms: ReadonlyArray<{ day: Day; name: string }>;
  streak7: ReadonlyArray<{ day: Day; name: string }>;
  streak30: ReadonlyArray<{ day: Day; name: string }>;
  /** Days with an answer at the evening fire (journal entry "Freude"). */
  joyDays: readonly Day[];
  /** One entry per done habit log (with repeats), ascending. */
  doneLogDays: readonly Day[];
  /** Days on which every routine scheduled that day was watered (at least one scheduled). */
  allDoneDays: readonly Day[];
  /** Days with a contact logged. */
  contactDays: readonly Day[];
  /** One entry per completed task (completedAt's day), ascending. */
  taskDays: readonly Day[];
}

export interface VisitorInfo {
  id: VisitorId;
  /** First day the reason held, null while still open. */
  day: Day | null;
  /** "kam am 14. Oktober, als Lesen voll blühte" (found) or the hint "Kommt …" (open). */
  text: string;
  /** Count-based reasons while open: how far along ("4 von 10"). */
  progress?: { n: number; of: number };
}

export const VISITOR_NAME: Readonly<Record<VisitorId, string>> = {
  bee: t.visitorBee, robin: t.visitorRobin, hedgehog: t.visitorHedgehog, snail: t.visitorSnail, frog: t.visitorFrog,
  tit: t.visitorTit, ladybug: t.visitorLadybug, duck: t.visitorDuck, squirrel: t.visitorSquirrel, owl: t.visitorOwl,
  dragonfly: t.visitorDragonfly, mole: t.visitorMole,
};

const HINT: Readonly<Record<VisitorId, string>> = {
  bee: t.visitorHintBee, robin: t.visitorHintRobin, hedgehog: t.visitorHintHedgehog, snail: t.visitorHintSnail,
  frog: t.visitorHintFrog, tit: t.visitorHintTit, ladybug: t.visitorHintLadybug, duck: t.visitorHintDuck,
  squirrel: t.visitorHintSquirrel, owl: t.visitorHintOwl, dragonfly: t.visitorHintDragonfly, mole: t.visitorHintMole,
};

/** The n-th entry (1-based) of an ascending list, if it is not after today. */
function nth(list: readonly Day[], n: number, today: Day): Day | null {
  const day = list[n - 1];
  return day !== undefined && day <= today ? day : null;
}

/** First day with a done log at least PAUSE_DAYS + 1 days after the previous one. */
export function returnDay(doneLogDays: readonly Day[], today: Day): Day | null {
  let prev: Day | null = null;
  for (const day of doneLogDays) {
    if (day > today) break;
    if (prev !== null && day !== prev && day > addDays(prev, PAUSE_DAYS)) return day;
    prev = day;
  }
  return null;
}

const upTo = (list: readonly Day[], today: Day): number => list.filter((d) => d <= today).length;

/** Every visitor with its day (or null) and the line for the album. */
export function visitorInfos(h: VisitorHistory, today: Day): VisitorInfo[] {
  const found = (id: VisitorId, day: Day | null, text: (date: string) => string, count?: { list: readonly Day[]; of: number }): VisitorInfo => {
    if (day !== null) return { id, day, text: text(formatDayMonth(day)) };
    const info: VisitorInfo = { id, day: null, text: HINT[id] };
    if (count) info.progress = { n: Math.min(upTo(count.list, today), count.of - 1), of: count.of };
    return info;
  };
  const named = (list: ReadonlyArray<{ day: Day; name: string }>, n: number): { day: Day; name: string } | null => {
    const e = list[n - 1];
    return e && e.day <= today ? e : null;
  };
  const bloom1 = named(h.blooms, 1);
  const bloom3 = named(h.blooms, 3);
  const run7 = named(h.streak7, 1);
  const run30 = named(h.streak30, 1);
  return [
    found('bee', bloom1?.day ?? null, (date) => fmt(t.visitorWhyBee, { date, name: bloom1?.name ?? '' })),
    found('robin', run7?.day ?? null, (date) => fmt(t.visitorWhyRobin, { date, name: run7?.name ?? '' })),
    found('hedgehog', nth(h.joyDays, 1, today), (date) => fmt(t.visitorWhyHedgehog, { date })),
    found('snail', returnDay(h.doneLogDays, today), (date) => fmt(t.visitorWhySnail, { date })),
    found('frog', nth(h.allDoneDays, 5, today), (date) => fmt(t.visitorWhyFrog, { date }), { list: h.allDoneDays, of: 5 }),
    found('tit', nth(h.contactDays, 1, today), (date) => fmt(t.visitorWhyTit, { date })),
    found('ladybug', nth(h.taskDays, 10, today), (date) => fmt(t.visitorWhyLadybug, { date }), { list: h.taskDays, of: 10 }),
    found('duck', bloom3?.day ?? null, (date) => fmt(t.visitorWhyDuck, { date }), { list: h.blooms.map((b) => b.day), of: 3 }),
    found('squirrel', run30?.day ?? null, (date) => fmt(t.visitorWhySquirrel, { date, name: run30?.name ?? '' })),
    found('owl', nth(h.joyDays, 5, today), (date) => fmt(t.visitorWhyOwl, { date }), { list: h.joyDays, of: 5 }),
    found('dragonfly', nth(h.taskDays, 25, today), (date) => fmt(t.visitorWhyDragonfly, { date }), { list: h.taskDays, of: 25 }),
    found('mole', nth(h.doneLogDays, 100, today), (date) => fmt(t.visitorWhyMole, { date }), { list: h.doneLogDays, of: 100 }),
  ];
}

/** Keimi's sentence when a visitor comes ("Eine Biene ist zu Besuch."). */
export const VISITOR_COMES: Readonly<Record<VisitorId, string>> = {
  bee: t.visitorComesBee, robin: t.visitorComesRobin, hedgehog: t.visitorComesHedgehog, snail: t.visitorComesSnail,
  frog: t.visitorComesFrog, tit: t.visitorComesTit, ladybug: t.visitorComesLadybug, duck: t.visitorComesDuck,
  squirrel: t.visitorComesSquirrel, owl: t.visitorComesOwl, dragonfly: t.visitorComesDragonfly, mole: t.visitorComesMole,
};

/**
 * Days on which every routine scheduled that day was watered (at least one scheduled). A routine counts from its
 * start day; an archived one only up to its last done day (when it was still in use). "x-mal pro Woche" routines
 * are left out (they are not due on a particular day).
 */
export function allDoneDays(habits: readonly Habit[], logs: readonly HabitLog[], today: Day): Day[] {
  const done = new Map<string, Set<Day>>();
  let first: Day | null = null;
  for (const log of logs) {
    if (log.status !== 'done' || log.day > today) continue;
    let set = done.get(log.habitId);
    if (!set) done.set(log.habitId, (set = new Set()));
    set.add(log.day);
    if (first === null || log.day < first) first = log.day;
  }
  if (first === null) return [];
  const lastDone = new Map<string, Day>();
  for (const [id, set] of done) lastDone.set(id, [...set].sort().pop() ?? '');
  const daily = habits.filter((h) => h.schedule.kind !== 'timesPerWeek');
  const out: Day[] = [];
  for (let day = first; day <= today; day = addDays(day, 1)) {
    const due = daily.filter((h) => h.startDay <= day && (h.archived === 0 || day <= (lastDone.get(h.id) ?? '')) && isScheduledOn(h, day));
    if (due.length > 0 && due.every((h) => done.get(h.id)?.has(day) === true)) out.push(day);
  }
  return out;
}

/** Small stable hash of a string (FNV-1a). */
function hash(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619) >>> 0;
  return x >>> 0;
}

export interface IslandVisitor { id: VisitorId; isNew: boolean }

/**
 * Who is on the island today: the newly found (newest first), then up to two known visitors chosen by the day
 * (about half of the days none, a third one, the rest two), at most ISLAND_MAX.
 */
export function islandVisitors(infos: readonly VisitorInfo[], today: Day, season: Season): IslandVisitor[] {
  const since = addDays(today, -(NEW_DAYS - 1));
  const fresh = infos.filter((v) => v.day !== null && v.day >= since && v.day <= today)
    .sort((a, b) => (b.day ?? '').localeCompare(a.day ?? ''))
    .map((v): IslandVisitor => ({ id: v.id, isNew: true }));
  const known = infos.filter((v) => v.day !== null && v.day < since && !(season === 'winter' && WINTER_AWAY.has(v.id)));
  const h = hash(`visit:${today}`);
  const want = h % 6 < 3 ? 0 : h % 6 < 5 ? 1 : 2;
  const pool = [...known];
  const back: IslandVisitor[] = [];
  for (let i = 0; i < want && pool.length > 0; i++) {
    const pick = hash(`${today}:${i}`) % pool.length;
    const [v] = pool.splice(pick, 1);
    if (v) back.push({ id: v.id, isNew: false });
  }
  return [...fresh, ...back].slice(0, ISLAND_MAX);
}

/** Visitors found between two snapshots (for the arrival moment): in `after`, missing or open in `before`, found today. */
export function newlyArrived(before: readonly VisitorInfo[], after: readonly VisitorInfo[], today: Day): VisitorId[] {
  const had = new Set(before.filter((v) => v.day !== null).map((v) => v.id));
  return after.filter((v) => v.day === today && !had.has(v.id)).map((v) => v.id);
}
