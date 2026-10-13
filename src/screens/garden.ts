// Hero of HEUTE (Habit Garden redesign, decisions of 12.10.2026 and 13.10.2026 "Garten-Insel", Teil 1).
// - Sky: the phase of the day (morning / day / evening / night, from dayStartHour and eveningHour)
//   colours the sky; the sun moves along an arc over the right half of the hero, at night a moon shows.
// - Island (replaces the flat meadow): components/island.ts draws the artwork from data prepared by
//   heute.ts with the rules of services/island.ts. This module lays the interactive parts over it:
//   one transparent button per place (opens the place sheet), Keimi's speech bubble (tap hides it for
//   the day, remembered in sessionStorage), people as butterflies around the big tree and a visually
//   hidden summary of every area with its watering count.
// - The SVG is rebuilt only when its input changes (signature), not per liveQuery emission.
// - People: in rhythm they flutter in the air around the big tree, overdue they rest pale on its crown
//   (CSS; motion stops under reduced motion). At most six of each show; all
//   people stay reachable through "Melde dich bei" and "Alle Personen".
import { butterfly } from '../components/flora.js';
import { ANCHORS, HIT_BOXES, islandSvg, PEOPLE_SPOTS, VIEW_H, VIEW_W, type IslandInput } from '../components/island.js';
import { fmt, stageName, t } from '../i18n/de.js';
import type { Day, Habit, HabitLog, Id, Profile } from '../model.js';
import { weekProgress, type NextStage } from '../services/growth.js';
import type { PlaceKey } from '../services/island.js';
import { h, raw, render, setVar, type SafeHtml } from '../util/dom.js';

export type DayPhase = 'morning' | 'day' | 'evening' | 'night';

/** Hour at which the sun sets in the hero (night begins); evening starts at settings.eveningHour. */
const NIGHT_HOUR = 22;
const NOON = 12;

export function dayPhase(hour: number, settings: Profile['settings']): DayPhase {
  const morning = Math.min(settings.dayStartHour, NOON - 1);
  const evening = Math.max(settings.eveningHour, NOON + 1);
  if (hour < morning || hour >= NIGHT_HOUR) return 'night';
  if (hour < 11) return 'morning';
  if (hour < evening) return 'day';
  return 'evening';
}

/**
 * Sun position as fractions of the sky box: x from 0.56 (sunrise) to 0.94 (sunset), y on an arc
 * (0 = top, 1 = horizon). Night returns the moon's fixed place.
 */
export function sunPosition(hour: number, minute: number, settings: Profile['settings']): { x: number; y: number } {
  const rise = Math.min(settings.dayStartHour, NOON - 1);
  const set = NIGHT_HOUR;
  const time = hour + minute / 60;
  if (time < rise || time >= set) return { x: 0.86, y: 0.12 };
  const p = (time - rise) / (set - rise);
  return { x: 0.56 + p * 0.38, y: 0.62 - Math.sin(p * Math.PI) * 0.52 };
}

const GREETINGS: Readonly<Record<DayPhase, { template: string; accent: string; line: string }>> = {
  morning: { template: t.greetMorning, accent: t.greetMorningAccent, line: t.greetMorningLine },
  day: { template: t.greetDay, accent: t.greetDayAccent, line: t.greetDayLine },
  evening: { template: t.greetEvening, accent: t.greetEveningAccent, line: t.greetEveningLine },
  night: { template: t.greetNight, accent: t.greetNightAccent, line: t.greetNightLine },
};

/** "Guten <em>Abend</em>." */
export function greetingMarkup(phase: DayPhase): SafeHtml {
  const { template, accent } = GREETINGS[phase];
  const [before = '', after = ''] = template.split('{accent}');
  return h`${before}<em class="ol-hero__accent">${accent}</em>${after}`;
}

export function greetingLine(phase: DayPhase): string {
  return GREETINGS[phase].line;
}

/** Static sky: sun, moon, stars and two clouds (aria-hidden; colours per phase in CSS). */
export function skyMarkup(): SafeHtml {
  return raw(
    '<div class="ol-hero__sky" aria-hidden="true">'
    + '<span class="ol-hero__sun"></span><span class="ol-hero__moon"></span>'
    + '<span class="ol-hero__stars"></span>'
    + '<svg class="ol-hero__cloud ol-hero__cloud--a" viewBox="0 0 120 40" width="120" height="40" focusable="false"><path d="M18 34h84c9 0 14-6 12-12-2-7-10-9-16-6C96 7 85 2 74 6 68-2 52-2 46 8 38 4 27 8 26 16 16 14 8 20 10 28c1 4 4 6 8 6Z"/></svg>'
    + '<svg class="ol-hero__cloud ol-hero__cloud--b" viewBox="0 0 120 40" width="90" height="30" focusable="false"><path d="M18 34h84c9 0 14-6 12-12-2-7-10-9-16-6C96 7 85 2 74 6 68-2 52-2 46 8 38 4 27 8 26 16 16 14 8 20 10 28c1 4 4 6 8 6Z"/></svg>'
    + '</div>',
  );
}

/** Places sun/moon and sets the phase attribute on the hero. */
export function applySky(hero: HTMLElement, phase: DayPhase, position: { x: number; y: number }): void {
  if (hero.dataset['phase'] !== phase) hero.dataset['phase'] = phase;
  setVar(hero, '--sun-x', position.x.toFixed(3));
  setVar(hero, '--sun-y', position.y.toFixed(3));
}


// ---------------------------------------------------------------------------
// Routine helpers shared by the cards (heute.ts) and the place sheet (sheets/place.ts)

/** Today's status of a routine: 'done' wins over 'skipped'. */
export function todayStatus(logs: readonly HabitLog[], day: Day): HabitLog['status'] | undefined {
  let status: HabitLog['status'] | undefined;
  for (const log of logs) if (log.day === day && (log.status === 'done' || status === undefined)) status = log.status;
  return status;
}

/** "Noch 2 Tage bis Blätter" (daily every day), "Noch 2× gießen bis …" (other rhythms), weeks for timesPerWeek. */
export function nextText(habit: Habit, next: NextStage): string {
  if (next.next === null) return t.cardFullBloom;
  const stage = stageName(next.next);
  const n = next.remaining;
  if (next.unit === 'weeks') return n === 1 ? fmt(t.cardNextWeekOne, { stage }) : fmt(t.cardNextWeeks, { n, stage });
  if (habit.schedule.kind === 'daily' && habit.schedule.interval <= 1) {
    return n === 1 ? fmt(t.cardNextDayOne, { stage }) : fmt(t.cardNextDays, { n, stage });
  }
  return n === 1 ? fmt(t.cardNextTimesOne, { stage }) : fmt(t.cardNextTimes, { n, stage });
}

function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** Writes an ol-habit-toggle from `logs` (daily: today's state; timesPerWeek: week progress + today dot). */
export function applyHabitToggle(toggle: HTMLElement, habit: Habit, logs: readonly HabitLog[], day: Day, disabled: boolean): void {
  const status = todayStatus(logs, day);
  if (habit.schedule.kind === 'timesPerWeek') {
    const progress = weekProgress(habit, logs, day);
    const target = Math.max(1, progress.target);
    const done = Math.min(progress.done, target);
    setAttr(toggle, 'progress', (done / target).toFixed(3));
    setAttr(toggle, 'state', progress.done >= target ? 'done' : progress.done > 0 ? 'partial' : 'pending');
    toggle.toggleAttribute('today-done', status === 'done');
    setAttr(toggle, 'label', fmt(t.habitToggleWeekAria, { name: habit.name, done, target }));
  } else {
    toggle.removeAttribute('progress');
    toggle.removeAttribute('today-done');
    setAttr(toggle, 'state', status === 'done' ? 'done' : status === 'skipped' ? 'skipped' : 'pending');
    setAttr(toggle, 'label', fmt(t.habitToggleAria, { name: habit.name }));
  }
  toggle.toggleAttribute('disabled', disabled);
}

// ---------------------------------------------------------------------------
// Island (interactive layer)

export type IslandSpot = PlaceKey | 'extra';

export interface IslandPerson {
  id: Id;
  name: string;
  color: string;
  /** In rhythm (flutters) or overdue (rests in the grass). */
  state: 'fresh' | 'due';
  /** "Zuletzt vor 3 Tagen" and similar, for the accessible name. */
  last: string;
}

export interface IslandView {
  art: Omit<IslandInput, 'prefix'>;
  /** Tappable places with their accessible names ("Gesundheit & Fitness: 2 von 3 heute gegossen"). */
  places: ReadonlyArray<{ key: IslandSpot; label: string }>;
  /** One line per area (also areas sharing the extra bed), in area order. */
  summary: readonly string[];
  people: readonly IslandPerson[];
  /** Keimi's sentence. */
  bubble: string;
}

const PEOPLE_MAX = 6;
const BUBBLE_KEY = 'hg-keimi-hidden';

/** Island skeleton inside the hero (filled by Island.update). */
export function islandMarkup(): SafeHtml {
  return h`<section class="ol-isl" aria-labelledby="heute-isl">
    <h2 class="ol-visually-hidden" id="heute-isl">${t.islandLabel}</h2>
    <ul class="ol-visually-hidden ol-isl__summary" aria-label="${t.islandSummary}"></ul>
    <div class="ol-isl__stage">
      <div class="ol-isl__art"></div>
      <button type="button" class="ol-isl__bubble" hidden><span class="ol-isl__bubble-text"></span><span class="ol-visually-hidden"> ${t.islandBubbleHide}</span></button>
      <div class="ol-isl__places" role="group" aria-label="${t.islandPlaces}"></div>
      <ul class="ol-isl__people"></ul>
    </div>
  </section>`;
}

/** Position of an overlay in viewBox units, as fractions for CSS (left/top in %). */
function place(el: HTMLElement, x: number, y: number): void {
  setVar(el, '--x', (x / VIEW_W).toFixed(4));
  setVar(el, '--y', (y / VIEW_H).toFixed(4));
}

function children(el: Element): HTMLElement[] {
  return [...el.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
}

/** Keyed patch of a list (reuse by data-id, create, remove, reorder); focus survives moves. */
function syncList<T>(list: HTMLElement, items: readonly T[], keyOf: (item: T) => string,
  create: (item: T) => HTMLElement, update: (el: HTMLElement, item: T, index: number) => void): void {
  const active = document.activeElement;
  const existing = new Map<string, HTMLElement>();
  for (const el of children(list)) existing.set(el.dataset['id'] ?? '', el);
  const keys = new Set(items.map(keyOf));
  for (const [key, el] of existing) {
    if (keys.has(key)) continue;
    el.remove();
    existing.delete(key);
  }
  items.forEach((item, i) => {
    const key = keyOf(item);
    let el = existing.get(key);
    if (!el) {
      el = create(item);
      el.dataset['id'] = key;
    }
    const at = list.children[i] ?? null;
    if (at !== el) list.insertBefore(el, at);
    update(el, item, i);
  });
  if (active instanceof HTMLElement && active.isConnected && document.activeElement !== active && list.contains(active)) {
    active.focus({ preventScroll: true });
  }
}

function readHidden(): string | null {
  try {
    return sessionStorage.getItem(BUBBLE_KEY);
  } catch {
    return null;
  }
}

/** The interactive layer of the island in the hero; one instance per HEUTE mount. */
export class Island {
  private readonly art: HTMLElement;
  private readonly places: HTMLElement;
  private readonly people: HTMLElement;
  private readonly summary: HTMLElement;
  readonly bubble: HTMLButtonElement;
  private signature = '';
  /** Day for which Keimi's bubble is hidden (also kept in memory when sessionStorage fails). */
  private hiddenFor: string | null = readHidden();

  constructor(readonly root: HTMLElement, private readonly prefix: string, private readonly day: Day) {
    const q = <T extends Element>(sel: string): T => {
      const el = root.querySelector<T>(sel);
      if (!el) throw new Error(`island: missing ${sel}`);
      return el;
    };
    this.art = q('.ol-isl__art');
    this.places = q('.ol-isl__places');
    this.people = q('.ol-isl__people');
    this.summary = q('.ol-isl__summary');
    this.bubble = q('.ol-isl__bubble');
    place(this.bubble, ANCHORS.keimiHead[0], ANCHORS.keimiHead[1]);
  }

  update(view: IslandView): void {
    const signature = JSON.stringify(view.art);
    if (signature !== this.signature) {
      this.signature = signature;
      render(this.art, raw(islandSvg({ ...view.art, prefix: this.prefix })));
    }
    this.syncPlaces(view.places);
    this.syncSummary(view.summary);
    this.syncPeople(view.people);
    const text = this.bubble.querySelector('.ol-isl__bubble-text');
    if (text) setText(text, view.bubble);
    this.bubble.hidden = this.hiddenFor === this.day;
  }

  /** Hides Keimi's bubble for today (tap on it); focus moves to the first place. */
  hideBubble(): void {
    this.hiddenFor = this.day;
    try {
      sessionStorage.setItem(BUBBLE_KEY, this.day);
    } catch {
      // Storage blocked: the bubble stays hidden while this screen is mounted.
    }
    const focused = this.bubble.contains(document.activeElement);
    this.bubble.hidden = true;
    if (focused) this.places.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }

  private syncPlaces(places: IslandView['places']): void {
    syncList(this.places, places, (p) => p.key, () => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ol-isl__place';
      return button;
    }, (button, p) => {
      const [x, y, w, hh] = HIT_BOXES[p.key];
      setVar(button, '--x', (x / VIEW_W).toFixed(4));
      setVar(button, '--y', (y / VIEW_H).toFixed(4));
      setVar(button, '--w', (w / VIEW_W).toFixed(4));
      setVar(button, '--h', (hh / VIEW_H).toFixed(4));
      button.dataset['place'] = p.key;
      setAttr(button, 'aria-label', p.label);
    });
  }

  private syncSummary(lines: readonly string[]): void {
    const key = lines.join('\n');
    if (this.summary.dataset['key'] === key) return;
    this.summary.dataset['key'] = key;
    render(this.summary, h`${lines.map((line) => h`<li>${line}</li>`)}`);
  }

  private syncPeople(people: readonly IslandPerson[]): void {
    const fresh = people.filter((p) => p.state === 'fresh').slice(0, PEOPLE_MAX);
    const due = people.filter((p) => p.state === 'due').slice(0, PEOPLE_MAX);
    const shown = [...fresh, ...due];
    syncList(this.people, shown, (p) => p.id, () => {
      const li = document.createElement('li');
      li.className = 'ol-isl__flyer';
      render(li, h`<button type="button" class="ol-isl__butterfly"><span class="ol-isl__wings"></span></button>`);
      return li;
    }, (li, person) => {
      const list = person.state === 'fresh' ? fresh : due;
      const i = list.indexOf(person);
      const spots = PEOPLE_SPOTS[person.state];
      const [x, y] = spots[i % spots.length] ?? [476, 90];
      place(li, x, y);
      setVar(li, '--bd', `${(-(i % 5) * 1.3).toFixed(1)}s`);
      setAttr(li, 'data-state', person.state);
      const wings = li.querySelector<HTMLElement>('.ol-isl__wings');
      if (wings && wings.dataset['color'] !== person.color) {
        wings.dataset['color'] = person.color;
        render(wings, raw(butterfly(person.color, 28)));
      }
      const button = li.querySelector('.ol-isl__butterfly');
      if (button) setAttr(button, 'aria-label', fmt(t.islandButterflyAria, { name: person.name, last: person.last }));
    });
  }

  /** Lets a butterfly take off (after "Kontaktiert"); CSS plays the flight, then the state attribute rules. */
  lift(contactId: Id): void {
    for (const li of this.people.querySelectorAll<HTMLElement>('.ol-isl__flyer')) {
      if (li.dataset['id'] !== contactId) continue;
      li.removeAttribute('data-lift');
      // Restart the animation on repeated contacts.
      void li.offsetWidth;
      li.setAttribute('data-lift', '');
      window.setTimeout(() => li.removeAttribute('data-lift'), 1600);
    }
  }
}
