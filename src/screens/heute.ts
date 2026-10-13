// HEUTE (F §4.13, A.3 Screen 1, A.2 H1–H6/H10, B.4, D.1/D.2).
// Rendering contract (S7): the skeleton is rendered once per mount; every liveQuery emission patches keyed
// rows in place (attributes, textContent), so focus, running animations and component state survive.
// The rendered day is fixed per mount: main.ts re-mounts the screen on a day change (onDayChange → refresh)
// and every write uses this day (S6).
//
// Details of this implementation:
// - Focus ring = done/n of the filled slots (approved decision 2), hidden when n = 0. Checking the last open
//   focus task closes the ring, sparks at the ring, label in primary for 2 s, confirm haptic.
// - Routines: one section per period (Morgen / Routinen / Abend); the order follows the hour (H6, S18).
//   timesPerWeek rows show x/y instead of the flame streak (S19). The plant and toggle of a row stay
//   untouched while its toggleLog runs and until the snapshot shows the result, so grow/wobble survive.
// - Rows open their sheet by tapping the title (keyboard equivalent) or a 350 ms long press on the row (S16);
//   the click after a long press is swallowed; callout and selection are suppressed in CSS.
// - Fällig heute = dueOn(day) minus today's focus ids; a checked row stays 1.5 s, then collapses (B.4);
//   rows coming back (undo) expand at their position.
// - Content stays invisible until the first data arrived (no sections popping in); the card stagger (B.4)
//   runs on the first render after page load only.
// - The missed-reminders toast ("Fällig heute", S13/D.5.3) reveals that section once the data is
//   complete: the list expands, scrolls into view and its heading takes focus.
// - Habit Garden redesign (decision of 12.10.2026): a hero with date, greeting by time of day, watering
//   progress and landscape replaces the app bar; since 13.10.2026 the Garten-Insel (screens/garden.ts,
//   components/island.ts, services/island.ts) replaces the flat meadow: every area has a place whose
//   flourish follows its routines, a tap on a place opens its sheet (sheets/place.ts) with the same
//   toggle flow as the cards, Keimi says one short sentence (services/island keimiLine); routines are
//   large cards (plant in an arch, stage, "Noch n Tage bis …", streak, "Heute gießen", 12-week heatmap);
//   "Melde dich bei" suggests up to three people whose contact rhythm is due (services/contacts.ts).
//   Order: hero, first steps, backup, routines, people, focus, mood, due today.
// - Heatmap cells on a card toggle past days like the habit sheet (toast with Rückgängig); today's cell
//   runs the same flow as the card's toggle.
// TODO(phase-3): swipe left on a focus row removes it from the focus (A.3); Phase 1 uses the task sheet.
// - Evening card "Morgen vorbereiten" (Phase 2, H7): from settings.eveningHour on, above "Fällig heute";
//   it lists tomorrow's focus (each removable) and opens the focus picker for tomorrow. Dismissing it
//   stores the day in Profile.eveningCardDismissedFor, so it returns the next evening.
// - Focus and due rows show the subtask progress "2/5" next to the title (Phase 2, decision 13.10.2026).
// - The date in the hero is a button that opens the calendar sheet (H8, sheets/calendar.ts).
// - Sundays show the card "Deine Woche" (H9) and the hero offers "Rückblick" at any time (screens/review.ts).
import { liveQuery, type Observable, type Subscription } from 'dexie';
import { butterfly, flower, petalColor } from '../components/flora.js';
import type { IslandArea } from '../components/island.js';
import type { CheckboxChange } from '../components/ol-checkbox.js';
import type { HabitToggleChange } from '../components/ol-habit-toggle.js';
import type { OlHeatmap, ToggleDayDetail } from '../components/ol-heatmap.js';
import { particles } from '../components/ol-particles.js';
import type { OlPlant } from '../components/ol-plant.js';
import { onModalChange, topModal, type OlSheet } from '../components/ol-sheet.js';
import { showToast } from '../components/ol-toast.js';
import { fmt, stageName, t } from '../i18n/de.js';
import {
  DEFAULT_SETTINGS, GENERIC_TINT, MAX_FOCUS,
  type Area, type Contact, type ContactLog, type Day, type FirstStepId, type FlowerId, type Habit, type HabitLog,
  type Id, type MoodLog, type Profile, type Stage, type Task,
} from '../model.js';
import { areas$ } from '../repo/areas.js';
import { contactLogs$, contacts$, logContact, undoLogContact } from '../repo/contacts.js';
import { addToFocus, anyFocusEver, getFocus, removeFromFocus } from '../repo/dayPlans.js';
import { habitLogId, logsByHabit$, toggleLog, type ToggleResult } from '../repo/habitLogs.js';
import { habits$ } from '../repo/habits.js';
import { mood$, setMood } from '../repo/moodLogs.js';
import { noteCount$ } from '../repo/notes.js';
import { profile$, updateProfile } from '../repo/profile.js';
import { compareDue, completeTask, dueOn, getTask, reopenTask, subtaskProgress$, type CompleteResult } from '../repo/tasks.js';
import type { Route } from '../router.js';
import {
  butterflyColor, closeness, contactStatuses, lastContactText, rhythmLabel, suggestions, type ContactStatus,
} from '../services/contacts.js';
import { bestStreak, isScheduledOn, nextStage, stageFor, streak, weekProgress } from '../services/growth.js';
import {
  assignPlaces, balancePercent, balanceState, balanceWord, decorLevel, fillSlots, flourishLevel, keimiLine, percentText,
  pickPeople, placeLabel, shortAreaName,
} from '../services/island.js';
import { backupCardState } from '../services/storage-hints.js';
import { percent, showWeekCard, weekSummary } from '../services/review.js';
import { takeRevealDue } from '../services/reminders.js';
import {
  addDays, currentHour, formatDayFull, formatDayLong, formatDayShort, formatTime, formatWeekdayLong, now, nowIso, today,
} from '../util/date.js';
import { emit, h, HAPTIC, icon, motionReduced, raw, render, setVar, vibrate, type SafeHtml } from '../util/dom.js';
import { attachLongPress } from '../util/long-press.js';
import { attachSwipe } from '../util/swipe.js';
import { exportWithNotice } from './export-flow.js';
import {
  applyHabitToggle, applySky, dayPhase, greetingLine, greetingMarkup, Island, islandMarkup, nextText, skyMarkup, sunPosition,
  todayStatus, type DayPhase, type IslandPerson, type IslandPill, type IslandSpot, type IslandView,
} from './garden.js';
import { openCalendar } from './sheets/calendar.js';
import { openCapture, type CaptureType } from './sheets/capture.js';
import { openFocusPick } from './sheets/focus-pick.js';
import { openHabitEditor, rhythmText } from './sheets/habit.js';
import { openJournal } from './sheets/journal.js';
import { openPeopleSheet, openPersonSheet } from './sheets/people.js';
import { openPlaceSheet, type PlaceGroupData, type PlaceSheet } from './sheets/place.js';
import { doneMessage } from './sheets/task.js';

type Period = Habit['period'];
type MoodValue = 1 | 2 | 3 | 4 | 5;

const PERIODS: readonly Period[] = ['morning', 'any', 'evening'];
const MOODS: readonly MoodValue[] = [1, 2, 3, 4, 5];
const NOON = 12;
const LEAVE_MS = 1500;
const DUE_COLLAPSED = 3;
const MILESTONES: readonly number[] = [7, 30, 100];
const COMPLETE_LABEL_MS = 2000;
const MOOD_FLASH_MS = 1500;
const EXPECT_TIMEOUT_MS = 2000;
/** A confirm dialog has finished closing (fade 150 ms) and handed focus back by then. */
const DIALOG_SETTLE_MS = 400;
const REVEAL_TIMEOUT_MS = 800;
const HEAT_WEEKS = 12;
const PEOPLE_MAX = 3;
/** Island candidate for routines without (active) area. */
const NO_AREA_GROUP = 'none';
/** Island ids are unique per mount (two islands never share gradients). */
let islandSeq = 0;
const RING_R = 11.5;
const RING_C = 2 * Math.PI * RING_R;
const EASE_ENTER = 'cubic-bezier(0,0,0,1)';
const EASE_EXIT = 'cubic-bezier(.3,0,1,1)';
const EASE_STANDARD = 'cubic-bezier(.2,0,0,1)';

interface FirstStep { id: FirstStepId; icon: string; text: string; label: string }

const FIRST_STEPS: readonly FirstStep[] = [
  { id: 'focus', icon: 'list-checks', text: t.firstStepFocus, label: t.actionFocusPick },
  { id: 'habit', icon: 'sprout', text: t.firstStepHabit, label: t.actionCreateHabit },
  { id: 'note', icon: 'notebook-pen', text: t.firstStepNote, label: t.firstStepNoteAction },
];

const PERIOD_HEADINGS: Readonly<Record<Period, string>> = {
  morning: t.sectionRoutinesMorning,
  any: t.sectionRoutines,
  evening: t.sectionRoutinesEvening,
};

/** The stagger runs once per page load (B.4 "nur beim ersten Rendern eines Screens"). */
let staggerDone = false;

interface FocusData { ids: Id[]; tasks: Task[] }

interface Leaving {
  task: Task;
  timer: number;
  /** The snapshot no longer lists the task (completeTask has landed). */
  confirmed: boolean;
  /** Unchecked or undone: the row stays until the task is listed again. */
  cancelled: boolean;
  collapsing: boolean;
}

interface RoutineSection { section: HTMLElement; list: HTMLElement; counter: HTMLElement }

/** An area (or the routines without area) as it appears on the island. */
interface IslandCandidate { key: string; areaId: Id | null; name: string; flower: FlowerId; tint: string; habits: Habit[] }

/** The focused element that opened a sheet, with its row position (focus fallback, 5.12.c). */
interface Opener { list: HTMLElement | null; index: number; inRoutines: boolean }

interface Els {
  root: HTMLElement;
  hero: HTMLElement;
  greeting: HTMLElement;
  greetLine: HTMLElement;
  progress: HTMLElement;
  progressFill: HTMLElement;
  progressCount: HTMLElement;
  island: HTMLElement;
  gardenAdd: HTMLElement;
  people: HTMLElement;
  peopleHeading: HTMLElement;
  peopleEmpty: HTMLElement;
  peopleEmptyText: HTMLElement;
  peopleAdd: HTMLElement;
  peopleList: HTMLElement;
  first: HTMLElement;
  steps: HTMLElement;
  backup: HTMLElement;
  backupText: HTMLElement;
  backupExport: HTMLElement;
  backupSettings: HTMLElement;
  backupDismiss: HTMLElement;
  focusHeading: HTMLElement;
  ring: HTMLElement;
  ringLabel: HTMLElement;
  ringArc: SVGCircleElement;
  focusEmpty: HTMLElement;
  focusList: HTMLElement;
  slot: HTMLButtonElement;
  routines: HTMLElement;
  routine: Record<Period, RoutineSection>;
  routineEmpty: HTMLElement;
  routineEmptyState: HTMLElement;
  moodHeading: HTMLElement;
  moodMeta: HTMLElement;
  moods: HTMLElement;
  journal: HTMLElement;
  evening: HTMLElement;
  eveningText: HTMLElement;
  eveningList: HTMLElement;
  eveningPick: HTMLElement;
  eveningDismiss: HTMLElement;
  due: HTMLElement;
  dueHeading: HTMLElement;
  dueCount: HTMLElement;
  dueToggle: HTMLElement;
  dueList: HTMLElement;
}

export function mount(view: HTMLElement, route: Route): () => void {
  void route;
  const screen = new HeuteScreen(view, today());
  screen.start();
  return () => screen.destroy();
}

// ---------------------------------------------------------------------------
// Helpers

function req<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`heute: missing ${selector}`);
  return el;
}

function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function rowsOf(list: HTMLElement): HTMLElement[] {
  return [...list.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
}

function rowById(list: HTMLElement, id: string): HTMLElement | null {
  return rowsOf(list).find((row) => row.dataset['id'] === id) ?? null;
}

function firstControl(root: Element): HTMLElement | null {
  return root.querySelector<HTMLElement>('ol-checkbox:not([disabled]), button:not([disabled]), [tabindex="0"]');
}

function isLost(active: Element | null): boolean {
  return !active || active === document.body || !active.isConnected || active.closest('[hidden]') !== null;
}

/** Moves focus out of a row that is about to disappear: next visible row, previous one, else fallback. */
function moveFocusFrom(row: HTMLElement, fallback: () => HTMLElement | null): void {
  const candidates: Element[] = [];
  for (let el = row.nextElementSibling; el; el = el.nextElementSibling) candidates.push(el);
  for (let el = row.previousElementSibling; el; el = el.previousElementSibling) candidates.push(el);
  for (const el of candidates) {
    if (!(el instanceof HTMLElement) || el.hidden) continue;
    const control = firstControl(el);
    if (control) {
      control.focus({ preventScroll: true });
      return;
    }
  }
  fallback()?.focus({ preventScroll: true });
}

/**
 * Patches a keyed list in place (S7): reuses rows by data-id, creates missing ones, removes stale ones
 * (moving focus out first) and fixes the order. Focus survives moves. Returns the created rows.
 */
function syncKeyed<T>(
  list: HTMLElement,
  items: readonly T[],
  keyOf: (item: T) => string,
  create: (item: T) => HTMLElement,
  update: (row: HTMLElement, item: T) => void,
  fallback: () => HTMLElement | null,
): HTMLElement[] {
  const active = document.activeElement;
  const existing = new Map<string, HTMLElement>();
  for (const row of rowsOf(list)) existing.set(row.dataset['id'] ?? '', row);
  const keys = new Set(items.map(keyOf));
  for (const [key, row] of existing) {
    if (keys.has(key)) continue;
    if (row.contains(document.activeElement)) moveFocusFrom(row, fallback);
    row.remove();
    existing.delete(key);
  }
  const created: HTMLElement[] = [];
  items.forEach((item, i) => {
    const key = keyOf(item);
    let row = existing.get(key);
    if (!row) {
      row = create(item);
      row.dataset['id'] = key;
      created.push(row);
    }
    const at = list.children[i] ?? null;
    if (at !== row) list.insertBefore(row, at);
    update(row, item);
  });
  if (active instanceof HTMLElement && active.isConnected && document.activeElement !== active && list.contains(active)) {
    active.focus({ preventScroll: true });
  }
  return created;
}

/** Morning first between dayStartHour and eveningHour (12 is the fixed noon), else evening first (S18). */
function periodOrder(hour: number, settings: Profile['settings']): readonly Period[] {
  const morning = hour >= settings.dayStartHour && hour < Math.max(NOON, settings.eveningHour);
  return morning ? ['morning', 'any', 'evening'] : ['evening', 'any', 'morning'];
}

function periodOf(habit: Habit): Period {
  return habit.period === 'morning' || habit.period === 'evening' ? habit.period : 'any';
}

/** "17 Tage", "1 Tag", "3 Wochen" for a streak value in the habit's unit. */
function countText(habit: Habit, n: number): string {
  if (habit.schedule.kind === 'timesPerWeek') return n === 1 ? t.streakWeeksOne : fmt(t.streakWeeks, { n });
  return n === 1 ? t.dayCountOne : fmt(t.dayCount, { n });
}

/** The logs of a habit after toggling day to done/undone (immutable copy for growth.ts). */
function withDay(logs: readonly HabitLog[], habit: Habit, day: Day, done: boolean): HabitLog[] {
  const next = logs.filter((log) => log.day !== day);
  if (done) next.push({ id: habitLogId(habit.id, day), habitId: habit.id, day, status: 'done', loggedAt: nowIso() });
  return next;
}

/**
 * Mood glyph (S21): a circle whose fill grows 0, ¼, ½, ¾, 1 for the values 1 → 5 (a pie from 12 o'clock).
 * Generator output built from numbers only, hence raw().
 */
function moodGlyph(value: MoodValue): SafeHtml {
  const c = 14;
  const r = 11;
  const share = (value - 1) / 4;
  let fill = '';
  if (share >= 1) {
    fill = `<circle class="ol-heute__mood-fill" cx="${c}" cy="${c}" r="${r}"/>`;
  } else if (share > 0) {
    const angle = share * 2 * Math.PI;
    const x = (c + r * Math.sin(angle)).toFixed(2);
    const y = (c - r * Math.cos(angle)).toFixed(2);
    fill = `<path class="ol-heute__mood-fill" d="M${c} ${c}L${c} ${c - r}A${r} ${r} 0 ${share > 0.5 ? 1 : 0} 1 ${x} ${y}Z"/>`;
  }
  return raw(
    `<svg class="ol-heute__mood-svg" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" focusable="false">`
    + `<circle class="ol-heute__mood-bg" cx="${c}" cy="${c}" r="${r}"/>${fill}`
    + `<circle class="ol-heute__mood-ring" cx="${c}" cy="${c}" r="${r}"/></svg>`,
  );
}

// ---------------------------------------------------------------------------
// Screen

class HeuteScreen {
  private readonly view: HTMLElement;
  private readonly day: Day;
  private readonly els: Els;
  private readonly subs: Subscription[] = [];
  private readonly timers = new Set<number>();
  private readonly detach: Array<() => void> = [];
  private destroyed = false;

  private logsSub: Subscription | null = null;
  private logsKey: string | null = null;

  private profile: Profile | null = null;
  private areas = new Map<Id, Area>();
  private areasLoaded = false;
  private focus: FocusData | null = null;
  private habits: Habit[] | null = null;
  private logs: Map<Id, HabitLog[]> | null = null;
  private mood: MoodLog | undefined;
  private moodLoaded = false;
  private due: Task[] | null = null;
  private tomorrow: FocusData | null = null;
  private progress = new Map<Id, { done: number; total: number }>();
  private progressSub: Subscription | null = null;
  private progressKey: string | null = null;
  private contacts: Contact[] | null = null;
  private contactLogs: ContactLog[] | null = null;
  /** People just marked "Kontaktiert" whose log has not reached the snapshot yet. */
  private readonly contactedNow = new Set<Id>();
  private anyFocus: boolean | null = null;
  private noteCount: number | null = null;

  private revealed = false;
  private focusRendered = false;
  private dueRendered = false;
  private dueExpanded = false;
  private routineOrder = '';
  private readonly leaving = new Map<Id, Leaving>();
  /** Checked/unchecked focus tasks whose write has not reached the snapshot yet (no flicker back). */
  private readonly focusOverride = new Map<Id, boolean>();
  private readonly pendingHabits = new Set<Id>();
  /** Latest check/uncheck per task: a write that finishes after a newer one shows no feedback. */
  private readonly checkSeq = new Map<Id, number>();
  private checkCounter = 0;
  private readonly expectLog = new Map<Id, { done: boolean; timer: number }>();
  private pendingMood: MoodValue | null = null;
  private moodSeq = 0;
  private moodFlashUntil = 0;
  private completeTimer = 0;
  private opener: Opener | null = null;
  private readonly island: Island;
  /** Island candidates (areas, "Ohne Bereich") per spot and by key, as of the last island render. */
  private spots = new Map<IslandSpot, IslandCandidate[]>();
  private candidates = new Map<string, IslandCandidate>();
  /** The open place sheet and the candidates it lists (kept even if the island reassigns the spot). */
  private placeSheet: { sheet: PlaceSheet; keys: string[] } | null = null;

  constructor(view: HTMLElement, day: Day) {
    this.view = view;
    this.day = day;
    this.els = this.renderSkeleton();
    this.island = new Island(this.els.island, `hgi${++islandSeq}-`, day);
    this.bindEvents();
  }

  start(): void {
    const day = this.day;
    this.watch(profile$(), (profile) => {
      this.profile = profile;
      this.renderHero();
      this.renderFirstSteps();
      this.renderBackup();
      this.renderEvening();
      this.renderRoutines();
    });
    this.watch(areas$(true), (list) => {
      this.areas = new Map(list.map((a) => [a.id, a]));
      this.areasLoaded = true;
      this.renderFocus();
      this.renderRoutines();
    });
    this.watch(
      liveQuery(async (): Promise<FocusData> => {
        const ids = await getFocus(day);
        const tasks = await Promise.all(ids.map((id) => getTask(id)));
        return { ids, tasks: tasks.filter((task): task is Task => task !== undefined).slice(0, MAX_FOCUS) };
      }),
      (focus) => {
        this.focus = focus;
        this.renderFocus();
        this.renderDue();
        this.watchProgress();
      },
    );
    this.watch(habits$(true), (list) => {
      this.habits = list;
      this.watchLogs(list);
      this.renderRoutines();
      this.renderFirstSteps();
    });
    this.watch(mood$(day), (mood) => {
      this.mood = mood;
      this.moodLoaded = true;
      this.renderMood();
    });
    this.watch(dueOn(day), (list) => {
      this.due = list;
      this.renderDue();
      this.watchProgress();
    });
    const tomorrow = addDays(day, 1);
    this.watch(
      liveQuery(async (): Promise<FocusData> => {
        const ids = await getFocus(tomorrow);
        const tasks = await Promise.all(ids.map((id) => getTask(id)));
        return { ids, tasks: tasks.filter((task): task is Task => task !== undefined).slice(0, MAX_FOCUS) };
      }),
      (focus) => {
        this.tomorrow = focus;
        this.renderEvening();
      },
    );
    this.watch(contacts$(), (list) => {
      this.contacts = list;
      this.renderPeople();
      this.renderRoutines();
    });
    this.watch(contactLogs$(), (list) => {
      this.contactLogs = list;
      for (const id of [...this.contactedNow]) {
        if (list.some((log) => log.contactId === id && log.day === day)) this.contactedNow.delete(id);
      }
      this.renderPeople();
      this.renderRoutines();
    });
    this.watch(liveQuery(() => anyFocusEver()), (any) => {
      this.anyFocus = any;
      this.renderFirstSteps();
    });
    this.watch(noteCount$(), (n) => {
      this.noteCount = n;
      this.renderFirstSteps();
    });
    this.later(() => this.reveal(), REVEAL_TIMEOUT_MS);
    this.armHourTimer();
    this.detach.push(onModalChange(() => this.onModalChange()));
    const onRevealDue = (): void => this.maybeRevealDue();
    document.addEventListener('ol-reveal-due', onRevealDue);
    this.detach.push(() => document.removeEventListener('ol-reveal-due', onRevealDue));
  }

  destroy(): void {
    this.destroyed = true;
    for (const sub of this.subs) sub.unsubscribe();
    this.subs.length = 0;
    this.logsSub?.unsubscribe();
    this.logsSub = null;
    this.island.destroy();
    this.progressSub?.unsubscribe();
    this.progressSub = null;
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
    for (const entry of this.leaving.values()) window.clearTimeout(entry.timer);
    for (const entry of this.expectLog.values()) window.clearTimeout(entry.timer);
    for (const off of this.detach) off();
    this.detach.length = 0;
  }

  // --- Plumbing ---

  private watch<T>(source: Observable<T>, next: (value: T) => void): void {
    this.subs.push(source.subscribe({
      next: (value: T) => {
        if (this.destroyed) return;
        try {
          next(value);
        } catch (err) {
          console.error(err);
        }
        this.maybeReveal();
      },
      error: (err: unknown) => console.error(err),
    }));
  }

  private watchLogs(habits: readonly Habit[]): void {
    const ids = habits.map((hb) => hb.id).sort();
    const key = ids.join('|');
    if (key === this.logsKey) return;
    this.logsKey = key;
    this.logsSub?.unsubscribe();
    this.logsSub = logsByHabit$(ids).subscribe({
      next: (logs: Map<Id, HabitLog[]>) => {
        if (this.destroyed) return;
        this.logs = logs;
        try {
          this.renderRoutines();
        } catch (err) {
          console.error(err);
        }
        this.maybeReveal();
      },
      error: (err: unknown) => console.error(err),
    });
  }

  private later(fn: () => void, ms: number): number {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      if (!this.destroyed) fn();
    }, ms);
    this.timers.add(timer);
    return timer;
  }

  private clearLater(timer: number): void {
    window.clearTimeout(timer);
    this.timers.delete(timer);
  }

  private armHourTimer(): void {
    const n = now();
    const next = new Date(n.getFullYear(), n.getMonth(), n.getDate(), n.getHours() + 1, 0, 1);
    this.later(() => {
      this.renderHero();
      this.renderRoutines();
      this.renderEvening();
      this.armHourTimer();
    }, Math.max(1000, next.getTime() - n.getTime()));
  }

  private navigate(from: Element, path: string): void {
    this.rememberOpener();
    emit(from, 'ol-navigate', { path });
  }

  /**
   * Notes where keyboard focus was before a sheet opens. A sheet returns focus to its opener; when the
   * opener is gone by then (the task was deleted, the "Erste Schritte" card or the empty state disappeared),
   * focus continues at the same row position instead of falling back to <body> (5.12.c).
   */
  private rememberOpener(): void {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !this.view.contains(active)) {
      this.opener = null;
      return;
    }
    const row = active.closest<HTMLElement>('li[data-id]');
    const list = row?.parentElement ?? null;
    this.opener = {
      list: row && list && this.view.contains(list) ? list : null,
      index: row && list ? rowsOf(list).indexOf(row) : -1,
      inRoutines: this.els.routines.contains(active),
    };
  }

  private onModalChange(): void {
    if (this.destroyed || topModal()) return;
    const opener = this.opener;
    this.opener = null;
    if (!opener) return;
    // A sheet leaves the modal stack when closing starts; check once it has restored focus and is gone.
    const closing = [...document.querySelectorAll<OlSheet>('ol-sheet[dismissing]')].map((sheet) => sheet.closed);
    void Promise.allSettled(closing).then(() => {
      if (this.destroyed || !isLost(document.activeElement)) return;
      let target: HTMLElement | null = null;
      if (opener.list?.isConnected) {
        const rows = rowsOf(opener.list).filter((row) => !row.hidden);
        const row = rows[Math.min(Math.max(opener.index, 0), rows.length - 1)];
        target = row ? firstControl(row) : null;
      }
      if (!target && opener.inRoutines) {
        const rows = PERIODS.flatMap((p) => (this.els.routine[p].section.hidden ? [] : rowsOf(this.els.routine[p].list)));
        target = rows[0]?.querySelector<HTMLElement>('.ol-heute__title') ?? null;
      }
      (target ?? (this.els.slot.hidden ? this.els.focusHeading : this.els.slot)).focus({ preventScroll: true });
    });
  }

  private openTask(row: HTMLElement): void {
    const id = row.dataset['id'];
    if (id) this.navigate(row, `/aufgabe/${encodeURIComponent(id)}`);
  }

  private openHabit(row: HTMLElement): void {
    const id = row.dataset['id'];
    if (id) this.navigate(row, `/gewohnheit/${encodeURIComponent(id)}`);
  }

  private editHabit(row: HTMLElement): void {
    const id = row.dataset['id'];
    if (!id) return;
    this.rememberOpener();
    try {
      openHabitEditor(id);
    } catch (err) {
      console.error(err);
    }
  }

  private openPeople(): void {
    this.rememberOpener();
    try {
      openPeopleSheet();
    } catch (err) {
      console.error(err);
    }
  }

  private openPerson(id?: Id): void {
    this.rememberOpener();
    try {
      openPersonSheet(id);
    } catch (err) {
      console.error(err);
    }
  }

  private capture(type: CaptureType): void {
    this.rememberOpener();
    try {
      openCapture({ type });
    } catch (err) {
      console.error(err);
    }
  }

  /** Focus picker for another day (evening card: tomorrow); focus returns to the opener. */
  private openPickerFor(day: Day): void {
    this.rememberOpener();
    try {
      openFocusPick(day);
    } catch (err) {
      console.error(err);
    }
  }

  private openPicker(): void {
    this.rememberOpener();
    let sheet: OlSheet;
    try {
      sheet = openFocusPick(this.day);
    } catch (err) {
      console.error(err);
      return;
    }
    // The slot that opened the picker may be hidden now (3 tasks): continue at the last focus row.
    void sheet.closed.then(() => {
      if (this.destroyed || !isLost(document.activeElement)) return;
      const rows = rowsOf(this.els.focusList);
      const last = rows[rows.length - 1];
      const target = last?.querySelector<HTMLElement>('.ol-heute__title') ?? (this.els.slot.hidden ? this.els.focusHeading : this.els.slot);
      target.focus({ preventScroll: true });
    });
  }

  private openJournalSheet(): void {
    this.rememberOpener();
    try {
      openJournal(this.day);
    } catch (err) {
      console.error(err);
    }
  }

  // --- Skeleton ---

  private renderSkeleton(): Els {
    const view = this.view;
    const routineSection = (period: Period): SafeHtml => h`
      <section class="ol-section ol-heute__routine" data-period="${period}" aria-labelledby="heute-r-${period}" hidden>
        <div class="ol-section__head">
          <h2 class="ol-label" id="heute-r-${period}">${PERIOD_HEADINGS[period]}</h2>
          <span class="ol-heute__counter ol-caption ol-num"></span>
        </div>
        <ul class="ol-heute__list ol-garden-grid"></ul>
      </section>`;
    render(view, h`
      <div class="ol-heute" data-loading>
        <header class="ol-hero">
          ${skyMarkup()}
          <div class="ol-hero__top">
            <span class="ol-hero__brand"><span class="ol-hero__brand-mark" aria-hidden="true">${icon('sprout', 20)}</span><span class="ol-hero__brand-name">${t.appName}</span></span>
            <ol-icon-button class="ol-heute__settings" icon="settings" label="${t.actionSettings}"></ol-icon-button>
          </div>
          <div class="ol-hero__body">
          <div class="ol-hero__content">
            <h1 class="ol-hero__title">
              <button type="button" class="ol-hero__date ol-hero__date-btn" aria-haspopup="dialog" aria-describedby="heute-date-hint"><span class="ol-hero__date-text">${formatWeekdayLong(this.day)}, <span class="ol-hero__date-accent">${formatDayFull(this.day)}</span></span>${icon('calendar', 20)}</button>
              <span class="ol-hero__greeting"></span>
            </h1>
            <span class="ol-visually-hidden" id="heute-date-hint">${t.calendarOpenHint}</span>
            <p class="ol-hero__line"></p>
            <div class="ol-hero__progress" hidden>
              <span class="ol-hero__bar" aria-hidden="true"><span class="ol-hero__bar-fill"></span></span>
              <span class="ol-hero__progress-text"><strong class="ol-hero__progress-count ol-num"></strong> ${t.heroProgressText}</span>
            </div>
            <button type="button" class="ol-hero__review">${icon('bar-chart-3', 20)}<span>${t.reviewEntry}</span></button>
          </div>
          ${islandMarkup()}
          </div>
        </header>
        <section class="ol-section ol-heute__first" aria-labelledby="heute-first" hidden>
          <div class="ol-section__head"><h2 class="ol-label" id="heute-first">${t.sectionFirstSteps}</h2></div>
          <ul class="ol-heute__steps"></ul>
        </section>
        <ol-card class="ol-heute__backup" hidden>
          <div class="ol-heute__backup-head">
            <span class="ol-heute__backup-icon">${icon('hard-drive')}</span>
            <div class="ol-heute__backup-text">
              <h2 class="ol-heading">${t.backupCardTitle}</h2>
              <p class="ol-body-s ol-text-2"></p>
            </div>
            <ol-icon-button class="ol-heute__backup-dismiss" icon="x" label="${fmt(t.cardDismissNamed, { label: t.backupCardTitle })}"></ol-icon-button>
          </div>
          <div class="ol-heute__backup-actions">
            <ol-button class="ol-heute__backup-export" variant="tonal" icon="download" label="${t.backupCardAction}"></ol-button>
            <ol-button class="ol-heute__backup-settings" variant="ghost" label="${t.backupCardSettings}"></ol-button>
          </div>
        </ol-card>
        <ol-card class="ol-heute__review" hidden>
          <div class="ol-heute__review-head">
            <span class="ol-heute__review-icon" aria-hidden="true">${icon('bar-chart-3')}</span>
            <div class="ol-heute__review-text">
              <h2 class="ol-heading">${t.reviewWeekTitle}</h2>
              <p class="ol-body-s ol-text-2"></p>
            </div>
            <ol-icon-button class="ol-heute__review-dismiss" icon="x" label="${fmt(t.cardDismissNamed, { label: t.reviewWeekTitle })}"></ol-icon-button>
          </div>
          <div class="ol-heute__review-actions">
            <ol-button class="ol-heute__review-open" variant="tonal" label="${t.reviewWeekOpen}"></ol-button>
          </div>
        </ol-card>
        <div class="ol-heute__routines">
          <section class="ol-section ol-heute__routine-empty" aria-labelledby="heute-r-empty" hidden>
            <div class="ol-section__head"><h2 class="ol-label" id="heute-r-empty" tabindex="-1">${t.sectionRoutines}</h2></div>
            <ol-card class="ol-heute__card"><ol-empty-state compact icon="sprout"></ol-empty-state></ol-card>
          </section>
          ${PERIODS.map(routineSection)}
        </div>
        <button type="button" class="ol-garden-add" hidden>${icon('plus')}<span>${t.gardenAdd}</span></button>
        <section class="ol-section ol-heute__people" aria-labelledby="heute-people">
          <div class="ol-section__head">
            <h2 class="ol-label" id="heute-people" tabindex="-1">${t.sectionPeopleDue}</h2>
            <ol-button class="ol-heute__people-all" variant="ghost" size="sm" icon="users" label="${t.heutePeopleAll}"></ol-button>
          </div>
          <ol-card class="ol-heute__card">
            <div class="ol-heute__people-empty" hidden>
              <p class="ol-body-s ol-text-2"></p>
              <ol-button class="ol-heute__people-add" variant="tonal" size="sm" icon="user-plus" label="${t.heutePeopleAdd}"></ol-button>
            </div>
            <ul class="ol-heute__list ol-heute__people-list"></ul>
          </ol-card>
        </section>
        <section class="ol-section ol-heute__focus" aria-labelledby="heute-focus">
          <div class="ol-section__head">
            <h2 class="ol-label" id="heute-focus" tabindex="-1">${t.sectionFocus}</h2>
            <div class="ol-heute__ring" role="progressbar" aria-valuemin="0" hidden>
              <span class="ol-heute__ring-label ol-num" aria-hidden="true"></span>
              <svg class="ol-heute__ring-svg" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" focusable="false">
                <circle class="ol-heute__ring-track" cx="14" cy="14" r="${RING_R}"></circle>
                <circle class="ol-heute__ring-arc" cx="14" cy="14" r="${RING_R}" transform="rotate(-90 14 14)"
                  stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}"></circle>
              </svg>
            </div>
          </div>
          <ol-card class="ol-heute__card">
            <p class="ol-heute__focus-empty ol-body-s" hidden>${t.emptyFocus}</p>
            <ul class="ol-heute__list ol-heute__focus-list"></ul>
            <button type="button" class="ol-heute__slot" hidden>${icon('plus')}<span>${t.focusSlotEmpty}</span></button>
          </ol-card>
        </section>
        <section class="ol-section ol-heute__mood-section" aria-labelledby="heute-mood">
          <div class="ol-section__head">
            <h2 class="ol-label" id="heute-mood" tabindex="-1">${t.sectionMood}</h2>
            <span class="ol-heute__mood-meta ol-caption ol-num" hidden></span>
          </div>
          <ol-card class="ol-heute__card ol-heute__mood-card">
            <div class="ol-heute__moods" role="radiogroup" aria-label="${t.moodGroupAria}">
              ${MOODS.map((v) => h`<button type="button" class="ol-heute__mood" role="radio" aria-checked="false" data-value="${v}"
                aria-label="${fmt(t.moodChoiceAria, { n: v })}" tabindex="${v === 1 ? 0 : -1}">${moodGlyph(v)}<span class="ol-heute__mood-n ol-num" aria-hidden="true">${v}</span></button>`)}
            </div>
            <div class="ol-heute__mood-foot">
              <ol-button class="ol-heute__journal" variant="ghost" size="sm" label="${t.actionAddNote}"></ol-button>
            </div>
          </ol-card>
        </section>
        <ol-card class="ol-heute__evening" hidden>
          <div class="ol-heute__evening-head">
            <span class="ol-heute__evening-icon" aria-hidden="true">${icon('moon')}</span>
            <div class="ol-heute__evening-text">
              <h2 class="ol-heading" id="heute-evening" tabindex="-1">${t.eveningTitle}</h2>
              <p class="ol-body-s ol-text-2"></p>
            </div>
            <ol-icon-button class="ol-heute__evening-dismiss" icon="x" label="${fmt(t.cardDismissNamed, { label: t.eveningTitle })}"></ol-icon-button>
          </div>
          <ul class="ol-heute__evening-list"></ul>
          <div class="ol-heute__evening-actions">
            <ol-button class="ol-heute__evening-pick" variant="tonal" icon="list-checks" label="${t.eveningPick}"></ol-button>
          </div>
        </ol-card>
        <section class="ol-section ol-heute__due" aria-labelledby="heute-due" hidden>
          <div class="ol-section__head">
            <h2 class="ol-label" id="heute-due" tabindex="-1">${t.sectionDueToday} <span class="ol-heute__due-count ol-num"></span></h2>
            <ol-button class="ol-heute__due-toggle" variant="ghost" size="sm" icon="chevron-down" label="${t.actionExpandList}" hidden></ol-button>
          </div>
          <ol-card class="ol-heute__card"><ul class="ol-heute__list ol-heute__due-list" id="heute-due-list"></ul></ol-card>
        </section>
      </div>`);

    const routine = {} as Record<Period, RoutineSection>;
    for (const period of PERIODS) {
      const section = req<HTMLElement>(view, `.ol-heute__routine[data-period="${period}"]`);
      routine[period] = {
        section,
        list: req<HTMLElement>(section, '.ol-heute__list'),
        counter: req<HTMLElement>(section, '.ol-heute__counter'),
      };
    }
    const backup = req<HTMLElement>(view, '.ol-heute__backup');
    const hero = req<HTMLElement>(view, '.ol-hero');
    const people = req<HTMLElement>(view, '.ol-heute__people');
    const peopleEmpty = req<HTMLElement>(people, '.ol-heute__people-empty');
    const ring = req<HTMLElement>(view, '.ol-heute__ring');
    const routineEmpty = req<HTMLElement>(view, '.ol-heute__routine-empty');
    const due = req<HTMLElement>(view, '.ol-heute__due');
    const evening = req<HTMLElement>(view, '.ol-heute__evening');
    return {
      root: req<HTMLElement>(view, '.ol-heute'),
      hero,
      greeting: req<HTMLElement>(hero, '.ol-hero__greeting'),
      greetLine: req<HTMLElement>(hero, '.ol-hero__line'),
      progress: req<HTMLElement>(hero, '.ol-hero__progress'),
      progressFill: req<HTMLElement>(hero, '.ol-hero__bar-fill'),
      progressCount: req<HTMLElement>(hero, '.ol-hero__progress-count'),
      island: req<HTMLElement>(hero, '.ol-isl'),
      gardenAdd: req<HTMLElement>(view, '.ol-garden-add'),
      people,
      peopleHeading: req<HTMLElement>(people, '#heute-people'),
      peopleEmpty,
      peopleEmptyText: req<HTMLElement>(peopleEmpty, 'p'),
      peopleAdd: req<HTMLElement>(peopleEmpty, '.ol-heute__people-add'),
      peopleList: req<HTMLElement>(people, '.ol-heute__people-list'),
      first: req<HTMLElement>(view, '.ol-heute__first'),
      steps: req<HTMLElement>(view, '.ol-heute__steps'),
      backup,
      backupText: req<HTMLElement>(backup, '.ol-heute__backup-text p'),
      backupExport: req<HTMLElement>(backup, '.ol-heute__backup-export'),
      backupSettings: req<HTMLElement>(backup, '.ol-heute__backup-settings'),
      backupDismiss: req<HTMLElement>(backup, '.ol-heute__backup-dismiss'),
      focusHeading: req<HTMLElement>(view, '#heute-focus'),
      ring,
      ringLabel: req<HTMLElement>(ring, '.ol-heute__ring-label'),
      ringArc: req<SVGCircleElement>(ring, '.ol-heute__ring-arc'),
      focusEmpty: req<HTMLElement>(view, '.ol-heute__focus-empty'),
      focusList: req<HTMLElement>(view, '.ol-heute__focus-list'),
      slot: req<HTMLButtonElement>(view, '.ol-heute__slot'),
      routines: req<HTMLElement>(view, '.ol-heute__routines'),
      routine,
      routineEmpty,
      routineEmptyState: req<HTMLElement>(routineEmpty, 'ol-empty-state'),
      moodHeading: req<HTMLElement>(view, '#heute-mood'),
      moodMeta: req<HTMLElement>(view, '.ol-heute__mood-meta'),
      moods: req<HTMLElement>(view, '.ol-heute__moods'),
      journal: req<HTMLElement>(view, '.ol-heute__journal'),
      due,
      dueHeading: req<HTMLElement>(due, '#heute-due'),
      dueCount: req<HTMLElement>(due, '.ol-heute__due-count'),
      dueToggle: req<HTMLElement>(due, '.ol-heute__due-toggle'),
      dueList: req<HTMLElement>(due, '.ol-heute__due-list'),
      evening,
      eveningText: req<HTMLElement>(evening, '.ol-heute__evening-text p'),
      eveningList: req<HTMLElement>(evening, '.ol-heute__evening-list'),
      eveningPick: req<HTMLElement>(evening, '.ol-heute__evening-pick'),
      eveningDismiss: req<HTMLElement>(evening, '.ol-heute__evening-dismiss'),
    };
  }

  private bindEvents(): void {
    const els = this.els;
    // The input that reveals a new day (util/date re-checks on pointerdown/keydown) re-mounts this
    // screen asynchronously; until then no click may write into the old day.
    this.view.addEventListener('click', (event) => {
      if (today() === this.day) return;
      event.stopPropagation();
      event.preventDefault();
    }, { capture: true });
    req<HTMLElement>(this.view, '.ol-heute__settings').addEventListener('click', (event) => {
      if (event.currentTarget instanceof Element) this.navigate(event.currentTarget, '/einstellungen');
    });
    // H8: the date opens the calendar sheet.
    req<HTMLElement>(this.view, '.ol-hero__date-btn').addEventListener('click', () => {
      this.rememberOpener();
      try {
        openCalendar(this.day);
      } catch (err) {
        console.error(err);
      }
    });

    // Erste Schritte
    els.steps.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest<HTMLElement>('[data-id]');
      const id = row?.dataset['id'] as FirstStepId | undefined;
      if (!target || !id) return;
      if (target.closest('.ol-heute__step-dismiss')) void this.dismissStep(id);
      else if (target.closest('.ol-heute__step-action')) this.runStep(id);
    });

    // Daten sichern
    els.backupExport.addEventListener('click', () => void this.exportBackup());
    els.backupSettings.addEventListener('click', (event) => {
      if (event.currentTarget instanceof Element) this.navigate(event.currentTarget, '/einstellungen/daten');
    });
    els.backupDismiss.addEventListener('click', () => {
      this.els.focusHeading.focus({ preventScroll: true });
      updateProfile({ backupCardDismissedAt: nowIso() }).catch(() => showToast(t.toastError));
    });

    // Rückblick (H9): entry in the hero, Sunday card "Deine Woche"
    const openReview = (event: Event): void => {
      if (event.currentTarget instanceof Element) this.navigate(event.currentTarget, '/heute/rueckblick');
    };
    req<HTMLElement>(this.view, '.ol-hero__review').addEventListener('click', openReview);
    req<HTMLElement>(this.view, '.ol-heute__review-open').addEventListener('click', openReview);
    req<HTMLElement>(this.view, '.ol-heute__review-dismiss').addEventListener('click', () => {
      this.els.focusHeading.focus({ preventScroll: true });
      updateProfile({ reviewCardDismissedFor: this.day }).catch(() => showToast(t.toastError));
    });

    // Fokus
    els.slot.addEventListener('click', () => this.openPicker());
    els.focusList.addEventListener('ol-change', (event) => {
      const row = this.rowOfEvent(event, els.focusList, 'ol-checkbox');
      if (row && event instanceof CustomEvent) void this.onFocusCheck(row, (event.detail as CheckboxChange).checked);
    });
    els.focusList.addEventListener('click', (event) => {
      const row = this.rowOfEvent(event, els.focusList, '.ol-heute__title');
      if (row) this.openTask(row);
    });
    this.detach.push(attachLongPress(els.focusList, (row) => this.openTask(row)));
    // Swipe left takes a task out of today's focus (A.3 Fokus); the ⋯ sheet offers the same.
    this.detach.push(attachSwipe(els.focusList, {
      rowSelector: 'li[data-id]',
      actionFor: (_row, direction) => (direction === 'left' ? { label: t.swipeUnfocus, icon: 'x', tone: 'neutral' } : null),
      onSwipe: (row) => void this.unfocus(row),
      renderLayer: (layer, action) => render(layer, h`<span class="ol-swipe-layer__icon">${icon(action.icon, 20)}</span><span class="ol-swipe-layer__label">${action.label}</span>`),
    }));

    // Routinen
    els.routines.addEventListener('ol-change', (event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('ol-habit-toggle') : null;
      const row = target?.closest<HTMLElement>('li[data-id]');
      if (target && row && event instanceof CustomEvent) void this.onHabitToggle(row, target, (event.detail as HabitToggleChange).done);
    });
    els.routines.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest<HTMLElement>('li[data-id]');
      if (!target || !row) return;
      if (target.closest('.ol-heute__title')) this.openHabit(row);
      else if (target.closest('.ol-garden-card__edit')) this.editHabit(row);
    });
    els.routines.addEventListener('ol-toggle-day', (event) => {
      const day = event instanceof CustomEvent ? (event.detail as ToggleDayDetail | null)?.day : undefined;
      const row = event.target instanceof Element ? event.target.closest<HTMLElement>('li[data-id]') : null;
      if (day && row) this.onHeatmapDay(row, day);
    });
    els.routineEmptyState.addEventListener('ol-action', () => this.capture('habit'));
    els.gardenAdd.addEventListener('click', () => this.capture('habit'));

    // Insel: a place or its balance pill opens the place sheet, a figure its person, "+n" all people, a tap
    // on Keimi's bubble hides it for today.
    els.island.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const placeButton = target.closest<HTMLElement>('.ol-isl__place, .ol-isl__pill[data-place]');
      const spot = placeButton?.dataset['place'];
      if (spot) {
        this.openPlace(spot as IslandSpot);
        return;
      }
      const figure = target.closest<HTMLElement>('.ol-isl__fig');
      const id = figure?.closest<HTMLElement>('li[data-id]')?.dataset['id'];
      if (id) {
        this.openPerson(id);
        return;
      }
      if (target.closest('.ol-isl__more-people')) {
        this.openPeople();
        return;
      }
      if (target.closest('.ol-isl__bubble')) this.island.hideBubble();
    });

    // Melde dich bei
    req<HTMLElement>(this.view, '.ol-heute__people-all').addEventListener('click', () => this.openPeople());
    els.peopleAdd.addEventListener('click', () => this.openPerson());
    els.peopleList.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest<HTMLElement>('li[data-id]');
      const id = row?.dataset['id'];
      if (!target || !row || !id) return;
      if (target.closest('.ol-heute__contacted')) void this.onContacted(row, id);
      else if (target.closest('.ol-heute__title')) this.openPerson(id);
    });

    // Stimmung
    els.moods.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>('.ol-heute__mood') : null;
      const value = Number(button?.dataset['value']);
      if (button && MOODS.includes(value as MoodValue)) void this.selectMood(value as MoodValue);
    });
    els.moods.addEventListener('keydown', (event) => this.onMoodKey(event));
    els.journal.addEventListener('click', () => this.openJournalSheet());

    // Morgen vorbereiten
    els.eveningPick.addEventListener('click', () => this.openPickerFor(addDays(this.day, 1)));
    els.eveningDismiss.addEventListener('click', () => {
      this.els.focusHeading.focus({ preventScroll: true });
      updateProfile({ eveningCardDismissedFor: this.day }).catch(() => showToast(t.toastError));
    });
    els.eveningList.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('.ol-heute__evening-remove') : null;
      const id = button?.closest<HTMLElement>('li[data-id]')?.dataset['id'];
      if (id) void this.removeTomorrow(id);
    });

    // Fällig heute
    els.dueToggle.addEventListener('click', () => {
      this.dueExpanded = !this.dueExpanded;
      this.renderDue();
    });
    els.dueList.addEventListener('ol-change', (event) => {
      const row = this.rowOfEvent(event, els.dueList, 'ol-checkbox');
      if (row && event instanceof CustomEvent) void this.onDueCheck(row, (event.detail as CheckboxChange).checked);
    });
    els.dueList.addEventListener('click', (event) => {
      const row = this.rowOfEvent(event, els.dueList, '.ol-heute__title');
      if (row) this.openTask(row);
    });
    this.detach.push(attachLongPress(els.dueList, (row) => this.openTask(row)));
  }

  private rowOfEvent(event: Event, list: HTMLElement, selector: string): HTMLElement | null {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(selector)) return null;
    const row = target.closest<HTMLElement>('li[data-id]');
    return row && row.parentElement === list ? row : null;
  }

  // --- Reveal and stagger ---

  private dataReady(): boolean {
    return this.profile !== null && this.areasLoaded && this.focus !== null && this.habits !== null
      && this.logs !== null && this.moodLoaded && this.due !== null && this.anyFocus !== null && this.noteCount !== null
      && this.contacts !== null && this.contactLogs !== null && this.tomorrow !== null;
  }

  private maybeReveal(): void {
    if (!this.revealed && this.dataReady()) this.reveal();
    this.maybeRevealDue();
  }

  /** Reveals "Fällig heute" when the reminders toast asked for it and the data is complete. */
  private maybeRevealDue(): void {
    if (this.destroyed || !this.revealed || !this.dataReady() || !takeRevealDue()) return;
    const els = this.els;
    if (els.due.hidden) {
      els.focusHeading.focus({ preventScroll: false });
      return;
    }
    if (!this.dueExpanded && !els.dueToggle.hidden) {
      this.dueExpanded = true;
      this.renderDue();
    }
    els.due.scrollIntoView({ block: 'start', behavior: motionReduced() ? 'auto' : 'smooth' });
    els.dueHeading.focus({ preventScroll: true });
  }

  private reveal(): void {
    if (this.revealed) return;
    this.revealed = true;
    this.els.root.removeAttribute('data-loading');
    if (staggerDone) return;
    staggerDone = true;
    if (motionReduced()) return;
    const parts: HTMLElement[] = [];
    for (const child of this.els.root.children) {
      if (!(child instanceof HTMLElement) || child.hidden) continue;
      if (child === this.els.routines) {
        for (const section of child.children) if (section instanceof HTMLElement && !section.hidden) parts.push(section);
      } else {
        parts.push(child);
      }
    }
    parts.forEach((el, i) => {
      el.animate(
        [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }],
        { duration: 300, delay: i * 40, easing: EASE_ENTER, fill: 'backwards' },
      );
    });
  }

  // --- Erste Schritte (E1, S22) ---

  private renderFirstSteps(): void {
    const { profile, habits, anyFocus, noteCount } = this;
    if (!profile || !habits || anyFocus === null || noteCount === null) return;
    const dismissed = new Set(profile.firstStepsDismissed ?? []);
    const done: Record<FirstStepId, boolean> = { focus: anyFocus, habit: habits.length > 0, note: noteCount > 0 };
    const steps = FIRST_STEPS.filter((step) => !dismissed.has(step.id) && !done[step.id]);
    syncKeyed(
      this.els.steps,
      steps,
      (step) => step.id,
      (step) => {
        const li = document.createElement('li');
        li.className = 'ol-heute__step';
        render(li, h`<ol-card class="ol-heute__step-card">
          <button type="button" class="ol-heute__step-action">${icon(step.icon)}<span>${step.text}</span></button>
          <ol-icon-button class="ol-heute__step-dismiss" icon="x" label="${fmt(t.cardDismissNamed, { label: step.label })}"></ol-icon-button>
        </ol-card>`);
        return li;
      },
      () => undefined,
      () => this.els.focusHeading,
    );
    this.els.first.hidden = steps.length === 0;
  }

  private runStep(id: FirstStepId): void {
    if (id === 'focus') this.openPicker();
    else this.capture(id === 'habit' ? 'habit' : 'note');
  }

  private async dismissStep(id: FirstStepId): Promise<void> {
    const current = this.profile?.firstStepsDismissed ?? [];
    if (!this.profile || current.includes(id)) return;
    try {
      await updateProfile({ firstStepsDismissed: [...current, id] });
    } catch {
      showToast(t.toastError);
    }
  }

  // --- Daten sichern (H10, S22) ---

  private renderBackup(): void {
    const profile = this.profile;
    if (!profile) return;
    const state = backupCardState(profile, now());
    const card = this.els.backup;
    if (!state.show) {
      if (!card.hidden && card.contains(document.activeElement)) this.els.focusHeading.focus({ preventScroll: true });
      card.hidden = true;
      return;
    }
    setText(this.els.backupText, state.days === null ? t.backupCardBodyNever : fmt(t.backupCardBodyDays, { n: state.days }));
    card.hidden = false;
  }

  /** S25: the plaintext notice comes first; the card hides itself once lastExportAt is set. */
  private async exportBackup(): Promise<void> {
    const button = this.els.backupExport;
    if (button.hasAttribute('loading')) return;
    const exported = await exportWithNotice(button);
    // The closing dialog returns focus to the export button, which the export hides: continue at FOKUS.
    if (exported) {
      this.later(() => {
        if (isLost(document.activeElement)) this.els.focusHeading.focus({ preventScroll: true });
      }, DIALOG_SETTLE_MS);
    }
  }

  // --- Fokus (H1, H2, D.1, decision 2) ---

  private async unfocus(row: HTMLElement): Promise<void> {
    const id = row.dataset['id'];
    if (!id) return;
    const day = this.day;
    try {
      await removeFromFocus(day, id);
      showToast(t.toastFocusRemoved, { action: { label: t.actionUndo, onAction: () => void addToFocus(day, id).catch(() => showToast(t.toastError)) } });
    } catch {
      showToast(t.toastError);
    }
  }

  private createTaskRow(): HTMLElement {
    const li = document.createElement('li');
    li.className = 'ol-heute__row ol-heute__task';
    render(li, h`<ol-checkbox></ol-checkbox><button type="button" class="ol-heute__title"></button><span class="ol-heute__progress ol-caption ol-num" hidden></span><span class="ol-heute__meta ol-caption"></span>`);
    return li;
  }

  private renderFocus(): void {
    const data = this.focus;
    if (!data || !this.areasLoaded) return;
    const tasks = data.tasks;
    for (const task of tasks) {
      const override = this.focusOverride.get(task.id);
      if (override !== undefined && override === (task.status === 'done')) this.focusOverride.delete(task.id);
    }
    const n = tasks.length;
    const done = tasks.filter((task) => this.focusDone(task)).length;
    const els = this.els;

    const slotHidden = n >= MAX_FOCUS;
    if (slotHidden && !els.slot.hidden && els.slot === document.activeElement) {
      const last = rowsOf(els.focusList).pop();
      (last ? firstControl(last) : els.focusHeading)?.focus({ preventScroll: true });
    }
    els.slot.hidden = slotHidden;
    els.focusEmpty.hidden = n > 0;

    const created = syncKeyed(
      els.focusList,
      tasks,
      (task) => task.id,
      () => this.createTaskRow(),
      (row, task) => this.updateFocusRow(row, task),
      () => (els.slot.hidden ? els.focusHeading : els.slot),
    );
    if (this.focusRendered) for (const row of created) this.fadeIn(row);
    this.focusRendered = true;
    this.updateRing(done, n);
    this.renderIsland();
  }

  private focusDone(task: Task): boolean {
    return this.focusOverride.get(task.id) ?? task.status === 'done';
  }

  private updateFocusRow(row: HTMLElement, task: Task): void {
    this.updateProgress(row);
    const done = this.focusDone(task);
    const box = row.querySelector('ol-checkbox');
    if (box) {
      box.toggleAttribute('checked', done);
      setAttr(box, 'label', task.title);
    }
    const title = row.querySelector('.ol-heute__title');
    if (title) setText(title, task.title);
    const meta = row.querySelector('.ol-heute__meta');
    if (meta) setText(meta, this.areas.get(task.areaId)?.name ?? t.noArea);
    row.toggleAttribute('data-done', done);
  }

  private updateRing(done: number, n: number): void {
    const { ring, ringLabel, ringArc } = this.els;
    ring.hidden = n === 0;
    if (n === 0) return;
    setText(ringLabel, fmt(t.habitWeekProgress, { done, target: n }));
    setAttr(ring, 'aria-valuenow', String(done));
    setAttr(ring, 'aria-valuemax', String(n));
    setAttr(ring, 'aria-label', fmt(t.focusProgressAria, { done, n }));
    const offset = (RING_C * (1 - Math.min(1, done / n))).toFixed(2);
    if (ringArc.style.strokeDashoffset !== offset) ringArc.style.strokeDashoffset = offset;
  }

  private async onFocusCheck(row: HTMLElement, checked: boolean): Promise<void> {
    const id = row.dataset['id'];
    const tasks = this.focus?.tasks ?? [];
    if (!id || !tasks.some((task) => task.id === id)) return;
    const seq = this.nextCheck(id);
    this.focusOverride.set(id, checked);
    this.renderFocus();
    if (!checked) {
      try {
        await reopenTask(id);
      } catch {
        this.focusOverride.delete(id);
        showToast(t.toastError);
        this.renderFocus();
      }
      return;
    }
    let result: CompleteResult;
    try {
      result = await completeTask(id);
    } catch {
      this.focusOverride.delete(id);
      showToast(t.toastError);
      this.renderFocus();
      return;
    }
    // Unchecked again meanwhile: no toast, no celebration for an open task.
    if (this.destroyed || this.checkSeq.get(id) !== seq) return;
    const current = this.focus?.tasks ?? [];
    const completesAll = current.length >= 1 && current.every((task) => this.focusDone(task));
    showToast(doneMessage(result), {
      action: {
        label: t.actionUndo,
        onAction: () => {
          if (this.focusOverride.has(id)) this.focusOverride.set(id, false);
          void reopenTask(id).catch(() => showToast(t.toastError));
        },
      },
    });
    if (completesAll) this.celebrateFocus(current.length);
  }

  private nextCheck(id: Id): number {
    const seq = ++this.checkCounter;
    this.checkSeq.set(id, seq);
    return seq;
  }

  /** B.4 "Fokus vollständig" (n/n): the ring closes, 4 sparks at the ring, label in primary for 2 s, confirm. */
  private celebrateFocus(n: number): void {
    const ring = this.els.ring;
    this.updateRing(n, n);
    ring.setAttribute('data-complete', '');
    if (this.completeTimer) this.clearLater(this.completeTimer);
    this.completeTimer = this.later(() => {
      this.completeTimer = 0;
      ring.removeAttribute('data-complete');
    }, COMPLETE_LABEL_MS);
    const svg = ring.querySelector('svg');
    if (svg && !ring.hidden) {
      const box = svg.getBoundingClientRect();
      particles().sparks(box.left + box.width / 2, box.top + box.height / 2);
    }
    vibrate(HAPTIC.confirm);
  }

  private fadeIn(row: HTMLElement): void {
    if (typeof row.animate !== 'function') return;
    row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: motionReduced() ? 120 : 200, easing: 'linear' });
  }

  // --- Routinen (H3, H6, D.2, F "Erledigungsablauf Routine") ---

  private flowerOf(habit: Habit): { flower: FlowerId; tint: string } {
    const area = habit.areaId ? this.areas.get(habit.areaId) : undefined;
    return area ? { flower: area.flower, tint: area.tint } : { flower: 'generic', tint: GENERIC_TINT };
  }

  private createHabitCard(): HTMLElement {
    const li = document.createElement('li');
    li.className = 'ol-garden-card';
    const legend = [0, 1, 2, 3, 4].map((level) => h`<span class="ol-garden-card__swatch l${level}"></span>`);
    render(li, h`<div class="ol-garden-card__head">
        <span class="ol-garden-card__icon" aria-hidden="true"></span>
        <div class="ol-garden-card__titles">
          <button type="button" class="ol-heute__title ol-garden-card__name"></button>
          <span class="ol-garden-card__sub ol-caption"></span>
        </div>
        <ol-icon-button class="ol-garden-card__edit" icon="pencil"></ol-icon-button>
      </div>
      <div class="ol-garden-card__arch">
        <ol-plant class="ol-heute__plant" size="150"></ol-plant>
        <span class="ol-garden-card__stage"></span>
        <span class="ol-garden-card__next"></span>
      </div>
      <div class="ol-garden-card__foot">
        <p class="ol-garden-card__streak">
          <span class="ol-garden-card__streak-n ol-num"></span>
          <span class="ol-garden-card__streak-text"><span class="ol-garden-card__streak-unit"></span><span class="ol-garden-card__hint"></span></span>
        </p>
        <ol-habit-toggle caption="${t.cardWater}" caption-done="${t.cardWatered}"></ol-habit-toggle>
      </div>
      <div class="ol-garden-card__heat">
        <ol-heatmap weeks="${HEAT_WEEKS}"></ol-heatmap>
        <div class="ol-garden-card__legend ol-caption" aria-hidden="true">
          <span>${fmt(t.heatmapWeeksLabel, { n: HEAT_WEEKS })}</span>
          <span class="ol-garden-card__scale">${t.heatmapLess}${legend}${t.heatmapMore}</span>
        </div>
      </div>`);
    return li;
  }

  private renderRoutines(): void {
    const habits = this.habits;
    const logs = this.logs;
    if (!habits || !logs || !this.areasLoaded) return;
    const day = this.day;
    const active = habits.filter((hb) => hb.archived === 0);
    const shown = active.filter((hb) => isScheduledOn(hb, day));
    this.orderRoutines();

    for (const period of PERIODS) {
      const { section, list, counter } = this.els.routine[period];
      const items = shown.filter((hb) => periodOf(hb) === period);
      syncKeyed(
        list,
        items,
        (hb) => hb.id,
        () => this.createHabitCard(),
        (row, hb) => this.updateHabitRow(row, hb, logs.get(hb.id) ?? []),
        () => this.els.moodHeading,
      );
      section.hidden = items.length === 0;
      const done = items.filter((hb) => this.habitDoneToday(hb, logs.get(hb.id) ?? [])).length;
      const key = `${done}/${items.length}`;
      if (counter.dataset['key'] !== key) {
        counter.dataset['key'] = key;
        render(counter, h`<span aria-hidden="true">${fmt(t.habitWeekProgress, { done, target: items.length })}</span><span class="ol-visually-hidden">${fmt(t.routinesDoneAria, { done, n: items.length })}</span>`);
      }
    }

    const empty = this.els.routineEmpty;
    if (shown.length > 0 && !empty.hidden && empty.contains(document.activeElement)) this.els.moodHeading.focus({ preventScroll: true });
    empty.hidden = shown.length > 0;
    this.els.gardenAdd.hidden = shown.length === 0;
    const state = this.els.routineEmptyState;
    setAttr(state, 'message', active.length === 0 ? t.emptyRoutines : t.emptyRoutinesToday);
    setAttr(state, 'action', active.length === 0 ? t.actionCreateHabit : '');

    const watered = shown.filter((hb) => this.habitDoneToday(hb, logs.get(hb.id) ?? [])).length;
    this.renderProgress(watered, shown.length);
    this.renderIsland();
    this.renderReviewCard(active, logs);
  }

  /** Sunday card "Deine Woche" (H9): on Sundays with active routines, until dismissed for this ISO week. */
  private renderReviewCard(active: readonly Habit[], logs: Map<Id, HabitLog[]>): void {
    const card = req<HTMLElement>(this.view, '.ol-heute__review');
    const profile = this.profile;
    if (!profile || active.length === 0 || !showWeekCard(this.day, profile.reviewCardDismissedFor)) {
      if (!card.hidden && card.contains(document.activeElement)) this.els.focusHeading.focus({ preventScroll: true });
      card.hidden = true;
      return;
    }
    const week = weekSummary(active, logs, this.day);
    const pct = percent(week.rate);
    setText(req<HTMLElement>(card, '.ol-heute__review-text p'),
      pct === null ? t.reviewWeekTextNone : fmt(t.reviewWeekText, { done: week.done, pct }));
    card.hidden = false;
  }

  // --- Hero (greeting, landscape, progress) ---

  private renderHero(): void {
    const settings = this.profile?.settings ?? DEFAULT_SETTINGS;
    const n = now();
    const hour = currentHour();
    const phase = dayPhase(hour, settings);
    applySky(this.els.hero, phase, sunPosition(hour, n.getMinutes(), settings));
    const greeting = this.els.greeting;
    if (greeting.dataset['phase'] !== phase) {
      greeting.dataset['phase'] = phase;
      render(greeting, greetingMarkup(phase));
    }
    this.renderGreetingLine();
    this.renderIsland();
  }

  private renderGreetingLine(): void {
    const phase = this.els.greeting.dataset['phase'];
    const allDone = this.els.hero.hasAttribute('data-all-watered');
    const line = allDone ? t.heroAllWatered
      : phase === 'morning' || phase === 'day' || phase === 'evening' || phase === 'night' ? greetingLine(phase) : '';
    setText(this.els.greetLine, line);
  }

  private renderProgress(done: number, n: number): void {
    const els = this.els;
    els.progress.hidden = n === 0;
    els.hero.toggleAttribute('data-all-watered', n > 0 && done >= n);
    this.renderGreetingLine();
    if (n === 0) return;
    setText(els.progressCount, fmt(t.heroProgressCount, { done, n }));
    setAttr(els.progress, 'aria-label', fmt(t.heroProgressAria, { done, n }));
    setVar(els.progressFill, '--progress', (Math.min(1, done / n)).toFixed(3));
  }

  // --- Insel (Garten-Insel, Teil 1) ---

  /** The logs of a habit as the screen shows them: an optimistic toggle result wins until the snapshot catches up. */
  private shownLogs(habit: Habit): readonly HabitLog[] {
    const logs = this.logs?.get(habit.id) ?? [];
    const expected = this.expectLog.get(habit.id);
    return expected && (todayStatus(logs, this.day) === 'done') !== expected.done ? withDay(logs, habit, this.day, expected.done) : logs;
  }

  /** Active areas in order (plus archived ones that still hold routines), routines without area last. */
  private islandCandidates(active: readonly Habit[]): IslandCandidate[] {
    const byArea = new Map<string, Habit[]>();
    for (const habit of active) {
      const key = habit.areaId && this.areas.has(habit.areaId) ? habit.areaId : NO_AREA_GROUP;
      const list = byArea.get(key) ?? [];
      list.push(habit);
      byArea.set(key, list);
    }
    const out: IslandCandidate[] = [];
    for (const area of this.areas.values()) {
      const habits = byArea.get(area.id) ?? [];
      if (area.archived === 1 && habits.length === 0) continue;
      out.push({ key: area.id, areaId: area.id, name: area.name, flower: area.flower, tint: area.tint, habits });
    }
    const loose = byArea.get(NO_AREA_GROUP);
    if (loose) out.push({ key: NO_AREA_GROUP, areaId: null, name: t.noArea, flower: 'generic', tint: GENERIC_TINT, habits: loose });
    return out;
  }

  /** The people as figures (services/island pickPeople: at most five, overdue first) and how many are left out. */
  private islandPeople(): { people: IslandPerson[]; more: number } {
    const contacts = this.contacts;
    const logs = this.contactLogs;
    if (!contacts || !logs) return { people: [], more: 0 };
    const list = contactStatuses(contacts, logs, this.day).map((found) => {
      // Contacted just now (optimistic until the log arrives): as if contacted today.
      const status: ContactStatus = this.contactedNow.has(found.contact.id)
        ? { ...found, lastDay: this.day, daysSince: 0, dueIn: found.contact.rhythmDays, due: false, contactedToday: true }
        : found;
      const pct = fmt(t.reviewPercent, { n: closeness(status) });
      const state: IslandPerson['state'] = status.due ? 'due' : 'fresh';
      const lower = (text: string): string => text.charAt(0).toLocaleLowerCase('de') + text.slice(1);
      const person: IslandPerson & { urgency: number } = {
        id: status.contact.id,
        name: status.contact.name,
        color: butterflyColor(status.contact),
        state,
        pct,
        label: fmt(t.islandPersonAria, {
          name: status.contact.name, last: lower(lastContactText(status)), rhythm: lower(rhythmLabel(status.contact.rhythmDays)), pct,
        }),
        urgency: state === 'fresh' ? (status.contactedToday ? 1 : 0)
          : status.daysSince === null ? Number.POSITIVE_INFINITY : (status.daysSince - status.contact.rhythmDays) / status.contact.rhythmDays,
      };
      return person;
    });
    const { shown, more } = pickPeople(list);
    return { people: shown.map(({ urgency: _urgency, ...person }) => person), more };
  }

  private phase(): DayPhase {
    return dayPhase(currentHour(), this.profile?.settings ?? DEFAULT_SETTINGS);
  }

  /** Builds the island view (places, flourish, slots, summary, people, Keimi) and patches the hero and an open place sheet. */
  private renderIsland(): void {
    const habits = this.habits;
    if (!habits || !this.logs || !this.areasLoaded || !this.contacts || !this.contactLogs || !this.focus) return;
    const day = this.day;
    const active = habits.filter((hb) => hb.archived === 0);
    const candidates = this.islandCandidates(active);
    const { places, extra } = assignPlaces(candidates);
    const byKey = new Map(candidates.map((c) => [c.key, c]));
    const stageOf = (habit: Habit): Stage => stageFor(habit, this.shownLogs(habit), day);
    const counts = (list: readonly Habit[]): { done: number; scheduled: number } => {
      const scheduled = list.filter((hb) => isScheduledOn(hb, day));
      return { done: scheduled.filter((hb) => this.habitDoneToday(hb, this.logs?.get(hb.id) ?? [])).length, scheduled: scheduled.length };
    };
    const islandArea = (list: readonly Habit[], flower: FlowerId, tint: string): IslandArea => {
      const items = list.map((habit) => ({ stage: stageOf(habit), wet: this.habitDoneToday(habit, this.logs?.get(habit.id) ?? []) }));
      const { shown, more } = fillSlots(items);
      return { lvl: flourishLevel(items.map((i) => i.stage)), flower, tint, plants: shown, more };
    };

    const spots = new Map<IslandSpot, IslandCandidate[]>();
    const art: IslandView['art'] = { areas: {}, extra: null, decor: decorLevel(active.map(stageOf)) };
    const placeList: Array<{ key: IslandSpot; label: string }> = [];
    for (const [key, candidateKey] of places) {
      const c = byKey.get(candidateKey);
      if (!c) continue;
      spots.set(key, [c]);
      art.areas[key] = islandArea(c.habits, c.flower, c.tint);
    }
    const extras = extra.map((k) => byKey.get(k)).filter((c): c is IslandCandidate => c !== undefined);
    if (extras.length > 0) {
      spots.set('extra', extras);
      art.extra = islandArea(extras.flatMap((c) => c.habits), 'generic', GENERIC_TINT);
    }
    // Places row by row, left to right (back, middle, front of the island) for a sensible tab order.
    const ORDER: readonly IslandSpot[] = ['work', 'home', 'bonds', 'health', 'wealth', 'growth', 'extra', 'leisure'];
    // Balance (Teil 2): fulfilment over the last 30 days with the Rückblick rules, per place and overall.
    const logsShown = new Map(active.map((habit) => [habit.id, this.shownLogs(habit)] as const));
    const balanceOf = (list: readonly Habit[]): number | null => balancePercent(list, logsShown, day);
    const withBalance = (place: string, list: readonly Habit[], pct: number | null): string => (list.length === 0 ? place
      : fmt(t.islandWithBalance, { place, balance: pct === null ? t.islandBalanceNone : fmt(t.islandBalanceAria, { pct: percentText(pct) }) }));
    const pills: IslandPill[] = [];
    for (const key of ORDER) {
      const list = spots.get(key);
      if (!list) continue;
      const all = list.flatMap((c) => c.habits);
      const { done, scheduled } = counts(all);
      const first = list[0];
      const name = key === 'extra' ? t.islandMoreAreas : first?.name ?? '';
      const label = placeLabel(name, done, scheduled, all.length);
      placeList.push({ key, label });
      const pct = all.length === 0 ? null : balanceOf(all);
      pills.push({
        key,
        short: key === 'extra' || !first ? t.islandShortMore : shortAreaName(first.name, first.flower),
        pct: percentText(pct),
        tint: key === 'extra' || !first ? GENERIC_TINT : first.tint,
        label: withBalance(label, all, pct),
      });
    }
    const totalPct = balanceOf(active);
    const word = balanceWord(balanceState(totalPct));
    const total = {
      text: fmt(t.islandTotal, { state: word }),
      detail: totalPct === null ? '' : fmt(t.islandTotalDetail, { pct: percentText(totalPct) }),
    };
    const summary = candidates.map((c) => {
      const { done, scheduled } = counts(c.habits);
      return withBalance(placeLabel(c.name, done, scheduled, c.habits.length), c.habits, c.habits.length === 0 ? null : balanceOf(c.habits));
    });
    if (active.length > 0) {
      summary.push(totalPct === null ? t.islandSummaryTotalNone : fmt(t.islandSummaryTotal, { pct: percentText(totalPct), state: word }));
    }

    const phase = this.phase();
    const shown = active.filter((hb) => isScheduledOn(hb, day));
    const pending = shown.filter((hb) => !this.habitDoneToday(hb, this.logs?.get(hb.id) ?? [])).length;
    const focusOpen = this.focus.tasks.filter((task) => !this.focusDone(task)).length;
    const due = suggestions(this.contacts.filter((c) => c.archived === 0), this.contactLogs, day, PEOPLE_MAX)
      .find((st) => !this.contactedNow.has(st.contact.id));
    const bubble = keimiLine({
      night: phase === 'night', evening: phase === 'evening', habits: active.length, scheduled: shown.length, pending,
      focusOpen, dueContact: due?.contact.name ?? null,
    }).text;

    this.spots = spots;
    this.candidates = byKey;
    const { people, more } = this.islandPeople();
    this.island.update({ art, places: placeList, summary, people, morePeople: more, pills, total, bubble });
    this.renderPlaceSheet();
  }

  /** Groups of the place sheet: one per area (candidate key), rows for the area's active routines. */
  private placeGroups(keys: readonly string[]): PlaceGroupData[] {
    return keys.map((key) => this.candidates.get(key)).filter((c): c is IslandCandidate => c !== undefined).map((c) => ({
      key: c.key,
      name: c.name,
      areaId: c.areaId,
      rows: c.habits.map((habit) => ({
        habit,
        logs: this.shownLogs(habit),
        flower: c.flower,
        tint: c.tint,
        scheduled: isScheduledOn(habit, this.day),
        pending: this.pendingHabits.has(habit.id),
        frozen: this.pendingHabits.has(habit.id) || this.expectLog.has(habit.id),
      })),
    }));
  }

  private openPlace(spot: IslandSpot): void {
    const list = this.spots.get(spot);
    if (!list || list.length === 0) return;
    const title = spot === 'extra' ? t.islandMoreAreas : list[0]?.name ?? '';
    const keys = list.map((c) => c.key);
    this.placeSheet?.sheet.close();
    let sheet: PlaceSheet;
    try {
      sheet = openPlaceSheet(title, this.day, this.placeGroups(keys), {
        toggle: (id, toggle, plant) => {
          const habit = this.habits?.find((hb) => hb.id === id);
          if (habit) void this.toggleHabit(habit, toggle, this.cardRow(id), plant);
        },
        openHabit: (id) => emit(document.body, 'ol-navigate', { path: `/gewohnheit/${encodeURIComponent(id)}` }),
        create: (areaId) => {
          try {
            openCapture({ type: 'habit', ...(areaId ? { areaId } : {}) });
          } catch (err) {
            console.error(err);
          }
        },
      });
    } catch (err) {
      console.error(err);
      return;
    }
    const entry = { sheet, keys };
    this.placeSheet = entry;
    void sheet.closed.then(() => {
      if (this.placeSheet === entry) this.placeSheet = null;
    });
  }

  private renderPlaceSheet(): void {
    const open = this.placeSheet;
    if (!open) return;
    const groups = this.placeGroups(open.keys);
    if (groups.length === 0) {
      open.sheet.close();
      return;
    }
    open.sheet.update(groups);
  }

  /** The routine card of a habit (scheduled today), if rendered. */
  private cardRow(id: Id): HTMLElement | null {
    for (const period of PERIODS) {
      const row = rowById(this.els.routine[period].list, id);
      if (row) return row;
    }
    return null;
  }

  private orderRoutines(): void {
    const order = periodOrder(currentHour(), this.profile?.settings ?? DEFAULT_SETTINGS);
    const key = order.join(',');
    if (key === this.routineOrder) return;
    this.routineOrder = key;
    const container = this.els.routines;
    const active = document.activeElement;
    for (const period of order) container.append(this.els.routine[period].section);
    if (active instanceof HTMLElement && active.isConnected && document.activeElement !== active) active.focus({ preventScroll: true });
  }

  /** Today's log (as the snapshot or an optimistic state shows it) is done. */
  private habitDoneToday(habit: Habit, logs: readonly HabitLog[]): boolean {
    const expected = this.expectLog.get(habit.id);
    if (expected) return expected.done;
    return todayStatus(logs, this.day) === 'done';
  }

  private updateHabitRow(row: HTMLElement, habit: Habit, logs: readonly HabitLog[]): void {
    const title = row.querySelector('.ol-heute__title');
    if (title) {
      setText(title, habit.name);
      setAttr(title, 'aria-label', fmt(t.habitOpenAria, { name: habit.name }));
    }
    const expected = this.expectLog.get(habit.id);
    if (expected && (todayStatus(logs, this.day) === 'done') === expected.done) {
      window.clearTimeout(expected.timer);
      this.expectLog.delete(habit.id);
    }
    // Plant and toggle belong to the running toggle flow until the snapshot has caught up (S7).
    if (this.pendingHabits.has(habit.id) || this.expectLog.has(habit.id)) return;
    this.applyHabitState(row, habit, logs, true);
  }

  /** Writes a card from `logs`: head, plant (stage only when `stage` is set), stage badge, streak, toggle, heatmap. */
  private applyHabitState(row: HTMLElement, habit: Habit, logs: readonly HabitLog[], stage: boolean): void {
    const day = this.day;
    const { flower: flowerId, tint } = this.flowerOf(habit);
    const count = streak(habit, logs, day);
    const weekly = habit.schedule.kind === 'timesPerWeek';
    setVar(row, '--tint', tint);

    const glyph = row.querySelector<HTMLElement>('.ol-garden-card__icon');
    if (glyph && glyph.dataset['flower'] !== flowerId) {
      glyph.dataset['flower'] = flowerId;
      render(glyph, raw(flower(flowerId, 22)));
    }
    const title = row.querySelector('.ol-heute__title');
    if (title) {
      setText(title, habit.name);
      setAttr(title, 'aria-label', fmt(t.habitOpenAria, { name: habit.name }));
    }
    const sub = row.querySelector('.ol-garden-card__sub');
    if (sub) setText(sub, fmt(t.cardSub, { rhythm: rhythmText(habit.schedule), best: countText(habit, bestStreak(habit, logs, day)) }));
    const edit = row.querySelector('.ol-garden-card__edit');
    if (edit) setAttr(edit, 'label', fmt(t.cardEditAria, { name: habit.name }));

    const plant = row.querySelector<OlPlant>('ol-plant');
    if (plant) {
      setAttr(plant, 'flower', flowerId);
      setAttr(plant, 'tint', tint);
      if (stage) setAttr(plant, 'stage', String(stageFor(habit, logs, day)));
      setAttr(plant, 'streak', String(count));
      if (weekly) setAttr(plant, 'streak-unit', 'weeks');
      else plant.removeAttribute('streak-unit');
    }
    const next = nextStage(habit, logs, day);
    const badge = row.querySelector('.ol-garden-card__stage');
    if (badge) setText(badge, stageName(next.stage));
    const nextEl = row.querySelector('.ol-garden-card__next');
    if (nextEl) setText(nextEl, nextText(habit, next));

    const status = todayStatus(logs, day);
    const progress = weekProgress(habit, logs, day);
    const target = Math.max(1, progress.target);
    const weekDone = Math.min(progress.done, target);
    const number = row.querySelector('.ol-garden-card__streak-n');
    if (number) setText(number, String(count));
    const unit = row.querySelector('.ol-garden-card__streak-unit');
    if (unit) {
      setText(unit, weekly
        ? (count === 1 ? t.cardStreakWeekOne : t.cardStreakWeeks)
        : (count === 1 ? t.cardStreakDayOne : t.cardStreakDays));
    }
    const hint = row.querySelector('.ol-garden-card__hint');
    if (hint) {
      setText(hint, weekly ? fmt(t.habitWeekProgressAria, { done: weekDone, target })
        : status === 'done' ? t.cardHintDone : count > 0 ? t.cardHintKeep : t.cardHintStart);
    }

    const toggle = row.querySelector<HTMLElement>('ol-habit-toggle');
    if (toggle) applyHabitToggle(toggle, habit, logs, day, this.pendingHabits.has(habit.id));
    row.toggleAttribute('data-watered', status === 'done');
    row.querySelector<OlHeatmap>('ol-heatmap')?.setData(habit, logs, day);
  }

  private async onHabitToggle(row: HTMLElement, toggle: HTMLElement, requested: boolean): Promise<void> {
    void requested;
    const habit = this.habits?.find((hb) => hb.id === row.dataset['id']);
    if (habit) await this.toggleHabit(habit, toggle, row, row.querySelector<OlPlant>('ol-plant'));
  }

  /**
   * Toggles today's log (F "Erledigungsablauf Routine") from a card or from the place sheet: `cardRow` is
   * the routine's card (state, streak sparks), `plant` the plant that plays grow/wobble and the particles
   * (the card's or the sheet's).
   */
  private async toggleHabit(habit: Habit, toggle: HTMLElement, cardRow: HTMLElement | null, plant: OlPlant | null): Promise<void> {
    const id = habit.id;
    if (this.pendingHabits.has(id)) return;
    this.pendingHabits.add(id);
    toggle.setAttribute('disabled', '');
    let result: ToggleResult;
    try {
      result = await toggleLog(id, this.day);
    } catch {
      this.pendingHabits.delete(id);
      if (!this.destroyed) {
        showToast(t.toastError);
        toggle.removeAttribute('disabled');
        if (cardRow) this.applyHabitState(cardRow, habit, this.logs?.get(id) ?? [], true);
        this.renderRoutines();
      }
      return;
    }
    this.pendingHabits.delete(id);
    if (this.destroyed) return;
    const snapshot = this.logs?.get(id) ?? [];
    const next = withDay(snapshot, habit, this.day, result.done);
    if ((todayStatus(snapshot, this.day) === 'done') !== result.done) {
      const timer = window.setTimeout(() => {
        this.expectLog.delete(id);
        if (!this.destroyed) this.renderRoutines();
      }, EXPECT_TIMEOUT_MS);
      this.expectLog.set(id, { done: result.done, timer });
    }
    if (cardRow) {
      this.applyHabitState(cardRow, habit, next, false);
      // Toggled in the place sheet: the card's plant follows without its own animation.
      const cardPlant = cardRow.querySelector<OlPlant>('ol-plant');
      if (cardPlant && cardPlant !== plant && cardPlant.stage !== result.after) cardPlant.setAttribute('stage', String(result.after));
    }
    if (toggle !== cardRow?.querySelector('ol-habit-toggle')) toggle.removeAttribute('disabled');
    this.animateHabit(plant, cardRow, habit, result, next);
    this.renderRoutines();
  }

  /** F "Erledigungsablauf Routine" and B.4 (Routine erledigt, Stufenwechsel, Streak 7/30/100, Rücknahme). */
  private animateHabit(plant: OlPlant | null, cardRow: HTMLElement | null, habit: Habit, result: ToggleResult, logs: readonly HabitLog[]): void {
    if (!plant) return;
    const { before, after, done } = result;
    if (!done) {
      // Rücknahme: no particles; a lower stage crossfades.
      if (plant.stage !== after) void plant.crossfadeTo(after);
      return;
    }
    if (plant.stage !== after) plant.setAttribute('stage', String(after));
    const grown = after > before;
    const reduced = motionReduced();
    const points = plant.anchorPoints();
    let confirm = false;
    if (!(grown && reduced)) void plant.wobble();
    particles().drops(points.soil.x, points.soil.y);
    if (grown) {
      void plant.grow();
      const { flower, tint } = this.flowerOf(habit);
      particles().burst(points.head.x, points.head.y, petalColor(flower, tint), after === 4);
      showToast(fmt(t.toastStageReached, { name: habit.name, stage: stageName(after) }));
      confirm = true;
    }
    if (habit.schedule.kind !== 'timesPerWeek' && MILESTONES.includes(streak(habit, logs, this.day))) {
      const number = cardRow?.querySelector('.ol-garden-card__streak-n');
      const box = (number && cardRow?.contains(plant) ? number : plant).getBoundingClientRect();
      particles().sparks(box.left + box.width / 2, box.top + box.height / 2);
      confirm = true;
    }
    if (confirm) vibrate(HAPTIC.confirm);
  }

  /** A heatmap cell on a card: today runs the card's toggle flow, past days toggle with a toast (like the habit sheet). */
  private onHeatmapDay(row: HTMLElement, day: Day): void {
    const id = row.dataset['id'];
    const habit = this.habits?.find((hb) => hb.id === id);
    if (!id || !habit) return;
    if (day === this.day) {
      const toggle = row.querySelector<HTMLElement>('ol-habit-toggle');
      if (toggle) void this.onHabitToggle(row, toggle, true);
      return;
    }
    const run = (restoreStartDay?: Day, offerUndo = true): void => {
      toggleLog(id, day, restoreStartDay === undefined ? {} : { restoreStartDay }).then((result) => {
        if (this.destroyed) return;
        const date = formatDayLong(day);
        const message = fmt(result.done ? t.toastDayDone : t.toastDayReset, { date });
        showToast(message, offerUndo ? { action: { label: t.actionUndo, onAction: () => run(result.startDayBefore, false) } } : {});
      }, () => showToast(t.toastError));
    };
    run();
  }

  // --- Melde dich bei (people whose contact rhythm is due) ---

  private renderPeople(): void {
    const contacts = this.contacts;
    const logs = this.contactLogs;
    if (!contacts || !logs) return;
    const els = this.els;
    const active = contacts.filter((c) => c.archived === 0);
    const list = suggestions(active, logs, this.day, PEOPLE_MAX).filter((st) => !this.contactedNow.has(st.contact.id));
    syncKeyed(
      els.peopleList,
      list,
      (st) => st.contact.id,
      () => this.createPersonRow(),
      (row, st) => this.updatePersonRow(row, st),
      () => els.peopleHeading,
    );
    const empty = list.length === 0;
    els.peopleEmpty.hidden = !empty;
    els.peopleAdd.hidden = active.length > 0;
    setText(els.peopleEmptyText, active.length === 0 ? t.heutePeopleEmpty : t.heutePeopleInRhythm);
  }

  private createPersonRow(): HTMLElement {
    const li = document.createElement('li');
    li.className = 'ol-heute__row ol-heute__person';
    render(li, h`<span class="ol-heute__person-glyph" aria-hidden="true"></span>
      <span class="ol-heute__person-text">
        <button type="button" class="ol-heute__title"></button>
        <span class="ol-heute__meta ol-caption"></span>
      </span>
      <ol-button class="ol-heute__contacted" variant="tonal" size="sm" icon="check" label="${t.heuteContacted}"></ol-button>`);
    return li;
  }

  private updatePersonRow(row: HTMLElement, status: ContactStatus): void {
    const { contact } = status;
    const color = butterflyColor(contact);
    const glyph = row.querySelector<HTMLElement>('.ol-heute__person-glyph');
    if (glyph && glyph.dataset['color'] !== color) {
      glyph.dataset['color'] = color;
      render(glyph, raw(butterfly(color, 28)));
    }
    const title = row.querySelector('.ol-heute__title');
    if (title) {
      setText(title, contact.name);
      setAttr(title, 'aria-label', fmt(t.heuteContactOpenAria, { name: contact.name }));
    }
    const meta = row.querySelector('.ol-heute__meta');
    if (meta) setText(meta, `${lastContactText(status)} · ${rhythmLabel(contact.rhythmDays)}`);
    const button = row.querySelector('.ol-heute__contacted');
    if (button) setAttr(button, 'aria-label', fmt(t.heuteContactedAria, { name: contact.name }));
  }

  /** "Kontaktiert": logs today, the row leaves, the butterfly takes off; the toast offers Rückgängig. */
  private async onContacted(row: HTMLElement, id: Id): Promise<void> {
    const contact = this.contacts?.find((c) => c.id === id);
    if (!contact || this.contactedNow.has(id)) return;
    this.contactedNow.add(id);
    if (row.contains(document.activeElement)) moveFocusFrom(row, () => this.els.peopleHeading);
    this.renderPeople();
    this.renderRoutines();
    this.island.hop(id);
    vibrate(HAPTIC.tick);
    try {
      const result = await logContact(id, this.day);
      if (this.destroyed) return;
      showToast(fmt(t.heuteContactLogged, { name: contact.name }), {
        action: {
          label: t.actionUndo,
          onAction: () => {
            this.contactedNow.delete(id);
            void undoLogContact(result).catch(() => showToast(t.toastError));
          },
        },
      });
    } catch {
      this.contactedNow.delete(id);
      if (this.destroyed) return;
      showToast(t.toastError);
      this.renderPeople();
      this.renderRoutines();
    }
  }

  // --- Stimmung (H4, S21) ---

  private renderMood(): void {
    if (!this.moodLoaded) return;
    const value = this.pendingMood ?? this.mood?.value ?? null;
    const buttons = this.els.moods.querySelectorAll<HTMLElement>('.ol-heute__mood');
    buttons.forEach((button) => {
      const v = Number(button.dataset['value']);
      setAttr(button, 'aria-checked', String(v === value));
      const tabbable = value === null ? v === 1 : v === value;
      setAttr(button, 'tabindex', tabbable ? '0' : '-1');
    });
    this.els.moods.toggleAttribute('data-selected', value !== null);

    const meta = this.els.moodMeta;
    const mood = this.mood;
    if (!mood) {
      meta.hidden = true;
      return;
    }
    const time = formatTime(mood.loggedAt);
    const flash = performance.now() < this.moodFlashUntil;
    const key = `${flash ? 'saved' : 'time'}|${time}`;
    if (meta.dataset['key'] !== key) {
      meta.dataset['key'] = key;
      render(meta, flash
        ? h`${fmt(t.moodSavedAt, { time })}`
        : h`<span class="ol-visually-hidden">${fmt(t.moodLoggedAtAria, { time })}</span><span aria-hidden="true">${time}</span>`);
    }
    meta.hidden = false;
  }

  private async selectMood(value: MoodValue): Promise<void> {
    const current = this.pendingMood ?? this.mood?.value ?? null;
    if (current === value) return;
    const seq = ++this.moodSeq;
    this.pendingMood = value;
    this.renderMood();
    vibrate(HAPTIC.tick);
    try {
      const entry = await setMood(this.day, value);
      if (this.destroyed || seq !== this.moodSeq) return;
      this.mood = entry;
      this.moodFlashUntil = performance.now() + MOOD_FLASH_MS;
      this.later(() => this.renderMood(), MOOD_FLASH_MS + 20);
    } catch {
      if (!this.destroyed) showToast(t.toastError);
    } finally {
      if (seq === this.moodSeq && !this.destroyed) {
        this.pendingMood = null;
        this.renderMood();
      }
    }
  }

  /** Radio group keys (ARIA APG): arrows move and select, Home/End jump. */
  private onMoodKey(event: KeyboardEvent): void {
    const buttons = [...this.els.moods.querySelectorAll<HTMLElement>('.ol-heute__mood')];
    const index = buttons.findIndex((b) => b === document.activeElement);
    if (index < 0) return;
    let next = index;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (index + 1) % buttons.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (index - 1 + buttons.length) % buttons.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = buttons.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const button = buttons[next];
    if (!button) return;
    button.focus();
    const value = Number(button.dataset['value']);
    if (MOODS.includes(value as MoodValue)) void this.selectMood(value as MoodValue);
  }

  // --- Morgen vorbereiten (Phase 2, H7) ---

  private renderEvening(): void {
    const data = this.tomorrow;
    const profile = this.profile;
    if (!data || !profile) return;
    const els = this.els;
    const settings = profile.settings ?? DEFAULT_SETTINGS;
    const show = currentHour() >= settings.eveningHour && profile.eveningCardDismissedFor !== this.day;
    if (!show) {
      if (!els.evening.hidden && els.evening.contains(document.activeElement)) els.focusHeading.focus({ preventScroll: true });
      els.evening.hidden = true;
      return;
    }
    const n = data.tasks.length;
    setText(els.eveningText, n === 0 ? t.eveningEmpty : n >= MAX_FOCUS ? t.eveningFull : fmt(t.eveningSome, { n }));
    syncKeyed(
      els.eveningList,
      data.tasks,
      (task) => task.id,
      () => {
        const li = document.createElement('li');
        li.className = 'ol-heute__evening-row';
        render(li, h`<span class="ol-heute__evening-title"></span><ol-icon-button class="ol-heute__evening-remove" icon="x"></ol-icon-button>`);
        return li;
      },
      (row, task) => {
        const title = row.querySelector('.ol-heute__evening-title');
        if (title) setText(title, task.title);
        const remove = row.querySelector('.ol-heute__evening-remove');
        if (remove) setAttr(remove, 'label', fmt(t.eveningRemoveAria, { title: task.title }));
      },
      () => els.eveningPick,
    );
    if (n >= MAX_FOCUS && els.eveningPick.contains(document.activeElement)) els.eveningList.querySelector<HTMLElement>('ol-icon-button')?.focus();
    els.eveningPick.hidden = n >= MAX_FOCUS;
    els.evening.hidden = false;
  }

  private async removeTomorrow(id: Id): Promise<void> {
    const tomorrow = addDays(this.day, 1);
    try {
      await removeFromFocus(tomorrow, id);
      showToast(t.eveningRemoved, { action: { label: t.actionUndo, onAction: () => void addToFocus(tomorrow, id).catch(() => showToast(t.toastError)) } });
    } catch {
      showToast(t.toastError);
    }
  }

  // --- Unteraufgaben: progress "2/5" in focus and due rows ---

  private watchProgress(): void {
    const ids = [...new Set([...(this.focus?.ids ?? []), ...(this.due ?? []).map((task) => task.id)])].sort();
    const key = ids.join('|');
    if (key === this.progressKey) return;
    this.progressKey = key;
    this.progressSub?.unsubscribe();
    this.progressSub = subtaskProgress$(ids).subscribe({
      next: (map: Map<Id, { done: number; total: number }>) => {
        if (this.destroyed) return;
        this.progress = map;
        for (const list of [this.els.focusList, this.els.dueList]) {
          for (const row of rowsOf(list)) this.updateProgress(row);
        }
      },
      error: (err: unknown) => console.error(err),
    });
  }

  /** Writes the subtask progress of a task row ("2/5", hidden without subtasks). */
  private updateProgress(row: HTMLElement): void {
    const id = row.dataset['id'];
    const el = row.querySelector<HTMLElement>('.ol-heute__progress');
    if (!id || !el) return;
    const p = this.progress.get(id);
    el.hidden = !p;
    if (!p) return;
    setText(el, fmt(t.subtaskProgress, { done: p.done, total: p.total }));
    setAttr(el, 'aria-label', fmt(t.subtaskProgressAria, { done: p.done, total: p.total }));
  }

  // --- Fällig heute (H5, S16, B.4) ---

  private renderDue(): void {
    const due = this.due;
    const focus = this.focus;
    if (!due || !focus) return;
    const focusIds = new Set(focus.ids);
    const data = due.filter((task) => !focusIds.has(task.id));
    const listed = new Set(data.map((task) => task.id));
    for (const [id, entry] of this.leaving) {
      if (!listed.has(id)) {
        entry.confirmed = true;
      } else if ((entry.confirmed || entry.cancelled) && !entry.collapsing) {
        window.clearTimeout(entry.timer);
        this.leaving.delete(id);
      }
    }
    const rows = [...data];
    for (const [id, entry] of this.leaving) if (!listed.has(id)) rows.push(entry.task);
    rows.sort(compareDue);

    const els = this.els;
    const count = data.filter((task) => !this.leaving.has(task.id)).length;
    setText(els.dueCount, fmt(t.dueCount, { n: count }));

    const created = syncKeyed(
      els.dueList,
      rows,
      (task) => task.id,
      () => this.createTaskRow(),
      (row, task) => this.updateDueRow(row, task),
      () => (els.dueToggle.hidden ? els.moodHeading : els.dueToggle),
    );
    const expandable = rows.length > DUE_COLLAPSED;
    if (!expandable) this.dueExpanded = false;
    rowsOf(els.dueList).forEach((row, i) => {
      const hide = !this.dueExpanded && i >= DUE_COLLAPSED;
      if (hide && !row.hidden && row.contains(document.activeElement)) els.dueToggle.focus();
      row.hidden = hide;
    });
    const toggleHidden = !expandable;
    if (toggleHidden && !els.dueToggle.hidden && els.dueToggle.contains(document.activeElement)) {
      (rowsOf(els.dueList).find((r) => !r.hidden) ?? null)?.querySelector<HTMLElement>('ol-checkbox')?.focus();
    }
    els.dueToggle.hidden = toggleHidden;
    setAttr(els.dueToggle, 'label', this.dueExpanded ? t.actionCollapseList : t.actionExpandList);
    setAttr(els.dueToggle, 'icon', this.dueExpanded ? 'chevron-up' : 'chevron-down');
    const inner = els.dueToggle.querySelector('button');
    if (inner) {
      setAttr(inner, 'aria-expanded', String(this.dueExpanded));
      setAttr(inner, 'aria-controls', 'heute-due-list');
    }

    const empty = rows.length === 0;
    if (empty && !els.due.hidden && els.due.contains(document.activeElement)) els.moodHeading.focus({ preventScroll: true });
    els.due.hidden = empty;
    if (this.dueRendered) for (const row of created) if (!row.hidden) this.expandIn(row);
    this.dueRendered = true;
  }

  private updateDueRow(row: HTMLElement, task: Task): void {
    this.updateProgress(row);
    const leaving = this.leaving.get(task.id);
    const checked = leaving !== undefined && !leaving.cancelled;
    const box = row.querySelector('ol-checkbox');
    if (box) {
      box.toggleAttribute('checked', checked);
      setAttr(box, 'label', task.title);
    }
    row.toggleAttribute('data-done', checked);
    const title = row.querySelector('.ol-heute__title');
    if (title) setText(title, task.title);
    const meta = row.querySelector<HTMLElement>('.ol-heute__meta');
    if (!meta) return;
    const overdue = task.dueDay !== undefined && task.dueDay < this.day;
    const time = !overdue && task.dueHasTime === 1 && task.dueAt ? formatTime(task.dueAt) : '';
    const key = overdue ? `o|${task.dueDay ?? ''}` : `t|${time}`;
    if (meta.dataset['key'] === key) return;
    meta.dataset['key'] = key;
    render(meta, overdue && task.dueDay
      ? h`<span class="ol-heute__overdue">${t.overdueLabel}</span> <span class="ol-heute__overdue ol-num">${formatDayShort(task.dueDay)}</span>`
      : h`<span class="ol-num">${time}</span>`);
  }

  private async onDueCheck(row: HTMLElement, checked: boolean): Promise<void> {
    const id = row.dataset['id'];
    if (!id) return;
    const task = this.due?.find((x) => x.id === id) ?? this.leaving.get(id)?.task;
    if (!task) return;
    const seq = this.nextCheck(id);
    if (!checked) {
      this.cancelLeaving(id);
      row.removeAttribute('data-done');
      try {
        await reopenTask(id);
      } catch {
        this.leaving.delete(id);
        showToast(t.toastError);
        this.renderDue();
      }
      return;
    }
    const existing = this.leaving.get(id);
    if (existing) window.clearTimeout(existing.timer);
    const entry: Leaving = {
      task,
      confirmed: false,
      cancelled: false,
      collapsing: false,
      timer: window.setTimeout(() => this.collapseDue(id), LEAVE_MS),
    };
    this.leaving.set(id, entry);
    row.setAttribute('data-done', '');
    this.renderDue();
    let result: CompleteResult;
    try {
      result = await completeTask(id);
    } catch {
      window.clearTimeout(entry.timer);
      this.leaving.delete(id);
      if (!this.destroyed) {
        showToast(t.toastError);
        this.renderDue();
      }
      return;
    }
    if (this.destroyed || this.checkSeq.get(id) !== seq || entry.cancelled) return;
    showToast(doneMessage(result), { action: { label: t.actionUndo, onAction: () => this.undoDue(id) } });
  }

  private undoDue(id: Id): void {
    this.cancelLeaving(id);
    reopenTask(id).catch(() => {
      this.leaving.delete(id);
      showToast(t.toastError);
      if (!this.destroyed) this.renderDue();
    });
  }

  /** Stops the collapse of a checked row; the row stays until the task is listed again. */
  private cancelLeaving(id: Id): void {
    const entry = this.leaving.get(id);
    if (!entry || entry.collapsing) return;
    window.clearTimeout(entry.timer);
    entry.cancelled = true;
  }

  /** B.4: the checked row stays 1.5 s, then its height collapses (fade under reduced motion). */
  private collapseDue(id: Id): void {
    if (this.destroyed) return;
    const entry = this.leaving.get(id);
    if (!entry || entry.cancelled) return;
    const list = this.els.dueList;
    const row = rowById(list, id);
    if (!row || row.hidden || typeof row.animate !== 'function') {
      this.leaving.delete(id);
      this.renderDue();
      return;
    }
    entry.collapsing = true;
    const height = row.offsetHeight;
    row.classList.add('is-collapsing');
    const anim = motionReduced()
      ? row.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'linear', fill: 'forwards' })
      : row.animate(
        [{ height: `${height}px`, opacity: 1 }, { height: '0px', opacity: 0 }],
        { duration: 250, easing: EASE_EXIT, fill: 'forwards' },
      );
    anim.finished.catch(() => undefined).then(() => {
      this.leaving.delete(id);
      if (this.destroyed) return;
      if (row.contains(document.activeElement)) moveFocusFrom(row, () => this.els.moodHeading);
      anim.cancel();
      row.remove();
      this.renderDue();
    }, () => undefined);
  }

  /** B.4 "Rückgängig": the row expands at its old position (fade under reduced motion). */
  private expandIn(row: HTMLElement): void {
    if (typeof row.animate !== 'function') return;
    if (motionReduced()) {
      row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear' });
      return;
    }
    const height = row.offsetHeight;
    row.classList.add('is-collapsing');
    const anim = row.animate(
      [{ height: '0px', opacity: 0 }, { height: `${height}px`, opacity: 1 }],
      { duration: 200, easing: EASE_STANDARD },
    );
    anim.finished.catch(() => undefined).then(() => row.classList.remove('is-collapsing'), () => undefined);
  }
}
