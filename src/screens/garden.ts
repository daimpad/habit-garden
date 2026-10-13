// Hero of HEUTE (Habit Garden redesign, decisions of 12.10.2026 and 13.10.2026 "Garten-Insel", Teil 1 and 2).
// - Sky: the phase of the day (morning / day / evening / night, from dayStartHour and eveningHour)
//   colours the sky; the sun moves along an arc over the right half of the hero, at night a moon shows.
// - Island (replaces the flat meadow): components/island.ts draws the artwork from data prepared by
//   heute.ts with the rules of services/island.ts. This module lays the interactive parts over it:
//   one transparent button per place (opens the place sheet), Keimi's speech bubble (tap hides it for
//   the day, remembered in sessionStorage), people as sprout figures by the big tree and a visually
//   hidden summary of every area with its watering count and 30-day balance.
// - The SVG is rebuilt only when its input changes (signature), not per liveQuery emission.
// - Teil 2: a segmented switch "Garten · Balance" (ol-segmented, remembered per browser in localStorage,
//   default Garten). Balance shows one pill per place ("Gesundheit 60 %", dot in the area tint; tap opens
//   the place sheet) and the chip "Insgesamt: <Zustand>"; Keimi's bubble hides. In that view the pills are
//   the keyboard targets of the places (the transparent place buttons leave the tab order).
// - People (Teil 2): up to five sprout figures (services/island pickPeople, the rest as "+n" which opens
//   "Alle Personen"); in rhythm close together in the grove, overdue a little apart, paler and with
//   drooping leaves. Each figure is one button (opens the person) whose pill "Lena · 80 %" is part of it.
//   Pills show in the balance view, and in the garden view when there is room (stage ≥ 560 px) or at most
//   three people; and only when all of them find a spot near their figures (all or none). A figure hops
//   when the person is contacted (CSS; not under reduced motion, where the move to the group and the new
//   percent show the change).
// - Labels are laid out after every change and on resize (services/island layoutLabels, measured in
//   pixels): no pill overlaps another pill, Keimi, a figure, the bubble or the stage edge (a pill may
//   lie over part of a place's large tap area); person pills without a free spot near their figures stay hidden (the figure's name
//   carries the information).
import '../components/ol-segmented.js';
import {
  ANCHORS, HIT_BOXES, islandSvg, KEIMI_BOX, PEOPLE_SPOTS, sproutFigure, VIEW_H, VIEW_W, type IslandInput,
} from '../components/island.js';
import { fmt, stageName, t } from '../i18n/de.js';
import type { Day, Habit, HabitLog, Id, Profile } from '../model.js';
import { weekProgress, type NextStage } from '../services/growth.js';
import { figureSlots, layoutLabels, showPeoplePills, type Box, type LabelRequest, type PlaceKey } from '../services/island.js';
import { h, icon, raw, render, setVar, type SafeHtml } from '../util/dom.js';

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
export type IslandMode = 'garden' | 'balance';

export interface IslandPerson {
  id: Id;
  name: string;
  color: string;
  /** In rhythm (close together in the grove) or overdue (apart, paler, drooping leaves). */
  state: 'fresh' | 'due';
  /** "Lena: zuletzt vor 3 Tagen, Rhythmus wöchentlich, 80 %". */
  label: string;
  /** "80 %" for the pill. */
  pct: string;
}

export interface IslandPill {
  key: IslandSpot;
  /** "Gesundheit" */
  short: string;
  /** "60 %" or "–" */
  pct: string;
  tint: string;
  /** Accessible name: place label and balance. */
  label: string;
}

export interface IslandView {
  art: Omit<IslandInput, 'prefix'>;
  /** Tappable places with their accessible names ("Gesundheit & Fitness: 2 von 3 heute gegossen"). */
  places: ReadonlyArray<{ key: IslandSpot; label: string }>;
  /** One line per area (also areas sharing the extra bed), in area order, plus the overall line. */
  summary: readonly string[];
  /** The people shown as figures (at most PEOPLE_MAX, in rhythm first) and how many are left out. */
  people: readonly IslandPerson[];
  morePeople: number;
  /** Balance view: one pill per place (same order as places) and the overall chip. */
  pills: readonly IslandPill[];
  total: { text: string; detail: string };
  /** Keimi's sentence. */
  bubble: string;
}

const BUBBLE_KEY = 'hg-keimi-hidden';
const MODE_KEY = 'hg-island-mode';
/** From this stage width on the person pills always fit (tablet and desktop). */
const ROOMY_PX = 560;
/** How far a pill may move from its anchor (px): places and the chip, people. */
const REACH_PLACE = 72;
const REACH_PERSON = 24;
const HOP_MS = 900;

/** Island skeleton inside the hero (filled by Island.update). */
export function islandMarkup(): SafeHtml {
  return h`<section class="ol-isl" aria-labelledby="heute-isl" data-mode="garden">
    <h2 class="ol-visually-hidden" id="heute-isl">${t.islandLabel}</h2>
    <ul class="ol-visually-hidden ol-isl__summary" aria-label="${t.islandSummary}"></ul>
    <div class="ol-isl__stage">
      <div class="ol-isl__art"></div>
      <button type="button" class="ol-isl__bubble" hidden><span class="ol-isl__bubble-text"></span><span class="ol-visually-hidden"> ${t.islandBubbleHide}</span></button>
      <div class="ol-isl__places" role="group" aria-label="${t.islandPlaces}"></div>
      <div class="ol-isl__labels" role="group" aria-label="${t.islandBalanceGroup}" hidden>
        <div class="ol-isl__pills"></div>
        <p class="ol-isl__total"><span class="ol-isl__total-icon" aria-hidden="true">${icon('trending-up', 20)}</span><span class="ol-isl__total-text"></span><span class="ol-visually-hidden ol-isl__total-detail"></span></p>
      </div>
      <ul class="ol-isl__people" aria-label="${t.islandPeople}"></ul>
      <button type="button" class="ol-isl__more-people" hidden></button>
    </div>
    <ol-segmented class="ol-isl__mode" label="${t.islandModeAria}" value="garden"><button type="button" data-value="garden">${t.islandModeGarden}</button><button type="button" data-value="balance">${t.islandModeBalance}</button></ol-segmented>
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

function readMode(): IslandMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'balance' ? 'balance' : 'garden';
  } catch {
    return 'garden';
  }
}

/** "Gesundheit" + "60 %" as the pill content (dot is decoration). */
function pillMarkup(name: string, pct: string): SafeHtml {
  return h`<span class="ol-isl__dot" aria-hidden="true"></span><span class="ol-isl__pill-name">${name}</span><span class="ol-isl__pill-pct">${pct}</span>`;
}

/** "Lena · 80 %": the name may be cut with an ellipsis, the percent never. */
function personPillMarkup(name: string, pct: string): SafeHtml {
  const [before = '', after = ''] = t.islandPersonPill.split('{name}');
  return h`<span class="ol-isl__dot" aria-hidden="true"></span>${before}<span class="ol-isl__pill-name">${name}</span><span class="ol-isl__pill-pct">${fmt(after, { pct })}</span>`;
}

/** Box of `el` relative to `origin` (both measured on screen). */
function relBox(el: Element, origin: DOMRect): Box {
  const r = el.getBoundingClientRect();
  return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
}

/** The interactive layer of the island in the hero; one instance per HEUTE mount. */
export class Island {
  private readonly stage: HTMLElement;
  private readonly art: HTMLElement;
  private readonly places: HTMLElement;
  private readonly people: HTMLElement;
  private readonly morePeople: HTMLButtonElement;
  private readonly summary: HTMLElement;
  private readonly labels: HTMLElement;
  private readonly pills: HTMLElement;
  private readonly total: HTMLElement;
  private readonly switcher: HTMLElement;
  readonly bubble: HTMLButtonElement;
  private signature = '';
  private layoutKey = '';
  private frame = 0;
  private readonly resize: ResizeObserver | null = null;
  private mode: IslandMode = readMode();
  /** Day for which Keimi's bubble is hidden (also kept in memory when sessionStorage fails). */
  private hiddenFor: string | null = readHidden();

  constructor(readonly root: HTMLElement, private readonly prefix: string, private readonly day: Day) {
    const q = <T extends Element>(sel: string): T => {
      const el = root.querySelector<T>(sel);
      if (!el) throw new Error(`island: missing ${sel}`);
      return el;
    };
    this.stage = q('.ol-isl__stage');
    this.art = q('.ol-isl__art');
    this.places = q('.ol-isl__places');
    this.people = q('.ol-isl__people');
    this.morePeople = q('.ol-isl__more-people');
    this.summary = q('.ol-isl__summary');
    this.labels = q('.ol-isl__labels');
    this.pills = q('.ol-isl__pills');
    this.total = q('.ol-isl__total');
    this.switcher = q('.ol-isl__mode');
    this.bubble = q('.ol-isl__bubble');
    place(this.bubble, ANCHORS.keimiHead[0], ANCHORS.keimiHead[1]);
    place(this.total, ANCHORS.total[0], ANCHORS.total[1]);
    const [mx, my] = PEOPLE_SPOTS.more;
    place(this.morePeople, mx, my);
    this.switcher.setAttribute('value', this.mode);
    this.switcher.addEventListener('ol-change', (event) => {
      const value = event instanceof CustomEvent ? (event.detail as { value?: string } | null)?.value : undefined;
      this.setMode(value === 'balance' ? 'balance' : 'garden');
    });
    if (typeof ResizeObserver === 'function') {
      this.resize = new ResizeObserver(() => this.scheduleLayout(true));
      this.resize.observe(this.stage);
    }
    void document.fonts?.ready.then(() => this.scheduleLayout(true));
  }

  /** Stops observing (screen unmount). */
  destroy(): void {
    this.resize?.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  update(view: IslandView): void {
    const signature = JSON.stringify(view.art);
    if (signature !== this.signature) {
      this.signature = signature;
      render(this.art, raw(islandSvg({ ...view.art, prefix: this.prefix })));
    }
    this.syncPlaces(view.places);
    this.syncSummary(view.summary);
    this.syncPills(view.pills, view.total);
    this.syncPeople(view.people, view.morePeople);
    const text = this.bubble.querySelector('.ol-isl__bubble-text');
    if (text) setText(text, view.bubble);
    this.applyMode();
    const key = JSON.stringify([view.pills, view.total, view.people, view.morePeople, view.bubble]);
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      this.scheduleLayout(false);
    }
  }

  get viewMode(): IslandMode {
    return this.mode;
  }

  /** Switches between the garden and the balance view (remembered per browser). */
  setMode(mode: IslandMode): void {
    this.mode = mode;
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // Storage blocked: the choice holds while this screen is mounted.
    }
    if (this.switcher.getAttribute('value') !== mode) this.switcher.setAttribute('value', mode);
    this.applyMode();
    this.scheduleLayout(false);
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
    this.scheduleLayout(false);
  }

  /** Lets a figure hop (after "Kontaktiert"); also plays when a person turns from overdue to in rhythm. */
  hop(contactId: Id): void {
    for (const li of this.people.querySelectorAll<HTMLElement>('.ol-isl__person')) {
      if (li.dataset['id'] !== contactId) continue;
      li.removeAttribute('data-hop');
      // Restart the animation on repeated contacts.
      void li.offsetWidth;
      li.setAttribute('data-hop', '');
      window.setTimeout(() => li.removeAttribute('data-hop'), HOP_MS);
    }
  }

  private applyMode(): void {
    const balance = this.mode === 'balance';
    if (this.root.dataset['mode'] !== this.mode) this.root.dataset['mode'] = this.mode;
    const focusInPlaces = balance && this.places.contains(document.activeElement);
    const focusInPills = !balance && this.labels.contains(document.activeElement);
    this.labels.hidden = !balance;
    for (const button of children(this.places)) {
      if (balance) {
        setAttr(button, 'tabindex', '-1');
        setAttr(button, 'aria-hidden', 'true');
      } else {
        button.removeAttribute('tabindex');
        button.removeAttribute('aria-hidden');
      }
    }
    const bubbleFocused = this.bubble.contains(document.activeElement);
    this.bubble.hidden = balance || this.hiddenFor === this.day;
    // Keep the keyboard where it was: a place moves to its pill and back.
    if (focusInPlaces || focusInPills || (bubbleFocused && this.bubble.hidden)) {
      const key = document.activeElement instanceof HTMLElement ? document.activeElement.dataset['place'] : undefined;
      const target = balance
        ? this.pills.querySelector<HTMLElement>(`[data-place="${key ?? ''}"]`) ?? this.pills.querySelector<HTMLElement>('button')
        : this.places.querySelector<HTMLElement>(`[data-place="${key ?? ''}"]`) ?? this.places.querySelector<HTMLElement>('button');
      target?.focus({ preventScroll: true });
    }
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

  private syncPills(pills: readonly IslandPill[], total: IslandView['total']): void {
    syncList(this.pills, pills, (p) => p.key, (p) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ol-isl__pill';
      const [x, y] = ANCHORS[p.key];
      place(button, x, y);
      return button;
    }, (button, p) => {
      button.dataset['place'] = p.key;
      setAttr(button, 'aria-label', p.label);
      setVar(button, '--tint', p.tint);
      const key = `${p.short}|${p.pct}`;
      if (button.dataset['key'] !== key) {
        button.dataset['key'] = key;
        render(button, pillMarkup(p.short, p.pct));
      }
    });
    const text = this.total.querySelector('.ol-isl__total-text');
    const detail = this.total.querySelector('.ol-isl__total-detail');
    if (text) setText(text, total.text);
    if (detail) setText(detail, total.detail);
  }

  private syncPeople(people: readonly IslandPerson[], more: number): void {
    const slots = figureSlots(people.map((p) => p.state));
    syncList(this.people, people, (p) => p.id, () => {
      const li = document.createElement('li');
      li.className = 'ol-isl__person';
      render(li, h`<button type="button" class="ol-isl__fig"><span class="ol-isl__fig-art"></span><span class="ol-isl__pill ol-isl__pill--person" aria-hidden="true" data-off></span></button>`);
      return li;
    }, (li, person, i) => {
      const slot = slots[i] ?? 0;
      const [x, y] = PEOPLE_SPOTS.slots[slot] ?? PEOPLE_SPOTS.more;
      place(li, x, y);
      li.dataset['slot'] = String(slot);
      setVar(li, '--bd', `${(-(slot % 5) * 0.9).toFixed(1)}s`);
      const before = li.dataset['state'];
      setAttr(li, 'data-state', person.state);
      if (before === 'due' && person.state === 'fresh') this.hop(person.id);
      const art = li.querySelector<HTMLElement>('.ol-isl__fig-art');
      const look = `${person.color}|${person.state}`;
      if (art && art.dataset['look'] !== look) {
        art.dataset['look'] = look;
        render(art, raw(sproutFigure(person.color, person.state)));
      }
      const button = li.querySelector<HTMLElement>('.ol-isl__fig');
      if (button) setAttr(button, 'aria-label', person.label);
      const pill = li.querySelector<HTMLElement>('.ol-isl__pill--person');
      if (pill) {
        setVar(pill, '--tint', person.color);
        const key = `${person.name}|${person.pct}`;
        if (pill.dataset['key'] !== key) {
          pill.dataset['key'] = key;
          render(pill, personPillMarkup(person.name, person.pct));
        }
      }
    });
    this.morePeople.hidden = more <= 0;
    if (more > 0) {
      setText(this.morePeople, fmt(t.islandPeopleMore, { n: more }));
      setAttr(this.morePeople, 'aria-label', more === 1 ? t.islandPeopleMoreOne : fmt(t.islandPeopleMoreMany, { n: more }));
    }
  }

  /** Lays the pills out in the next frame (`force` also when nothing changed, e.g. on resize). */
  private scheduleLayout(force: boolean): void {
    if (force) this.layoutKey = '';
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      try {
        this.layout();
      } catch (err) {
        console.error(err);
      }
    });
  }

  /**
   * Places the visible pills without overlaps (pixels, measured): in the balance view the place pills
   * (anchors) and the overall chip first, then the person pills above their figures (in slot order). Obstacles: Keimi,
   * the figures, "+n", the visible bubble and the switch where it overlaps the stage. Pills may lie over part of
   * a place's (large) tap area; the rest of it stays reachable.
   */
  private layout(): void {
    const origin = this.stage.getBoundingClientRect();
    const W = origin.width;
    const H = origin.height;
    if (W === 0 || H === 0) return;
    const k = W / VIEW_W;
    const [kx, ky, kw, kh] = KEIMI_BOX;
    const obstacles: Box[] = [{ x: kx * k, y: ky * k, w: kw * k, h: kh * k }];
    if (!this.bubble.hidden) obstacles.push(relBox(this.bubble, origin));
    const sw = relBox(this.switcher, origin);
    if (sw.y < H && sw.y + sw.h > 0) obstacles.push(sw);
    if (!this.morePeople.hidden) obstacles.push(relBox(this.morePeople, origin));
    const figures = [...this.people.querySelectorAll<HTMLElement>('.ol-isl__person')].map((li) => {
      const button = li.querySelector<HTMLElement>('.ol-isl__fig');
      const pill = li.querySelector<HTMLElement>('.ol-isl__pill--person');
      return { li, button, pill, box: button ? relBox(button, origin) : null };
    });
    for (const f of figures) if (f.box) obstacles.push(f.box);

    const requests: LabelRequest[] = [];
    const balance = this.mode === 'balance';
    const pillEls = children(this.pills);
    if (balance) {
      for (const el of pillEls) {
        const key = el.dataset['place'] as IslandSpot | undefined;
        if (!key) continue;
        const [x, y] = ANCHORS[key];
        requests.push({ id: `p:${key}`, cx: x * k, cy: y * k, w: el.offsetWidth, h: el.offsetHeight, reach: REACH_PLACE, required: true });
      }
      const [tx, ty] = ANCHORS.total;
      requests.push({ id: 'total', cx: tx * k, cy: ty * k, w: this.total.offsetWidth, h: this.total.offsetHeight, reach: REACH_PLACE, required: true });
    }
    const peoplePills = showPeoplePills(this.mode, figures.length, W >= ROOMY_PX);
    // In slot order (from the bench outwards), the order the slots were laid out for.
    const bySlot = [...figures].sort((a, b) => Number(a.li.dataset['slot'] ?? 0) - Number(b.li.dataset['slot'] ?? 0));
    for (const f of bySlot) {
      if (!f.pill || !f.box) continue;
      f.pill.toggleAttribute('data-off', !peoplePills);
      if (!peoplePills) continue;
      const w = f.pill.offsetWidth;
      const hh = f.pill.offsetHeight;
      const { x, y, w: fw, h: fh } = f.box;
      requests.push({
        id: `f:${f.li.dataset['id'] ?? ''}`, cx: x + fw / 2, cy: y - hh / 2 - 2, w, h: hh, reach: REACH_PERSON, required: false,
        // Below, right and left of the figure when the space above is taken.
        alternatives: [[x + fw / 2, y + fh + hh / 2 + 2], [x + fw + w / 2 + 2, y + fh / 2], [x - w / 2 - 2, y + fh / 2]],
      });
    }
    const result = layoutLabels(requests, obstacles, { x: 4, y: 2, w: W - 8, h: H - 4 });

    for (const el of pillEls) {
      const box = result.get(`p:${el.dataset['place'] ?? ''}`);
      if (box) {
        setVar(el, '--x', ((box.x + box.w / 2) / W).toFixed(4));
        setVar(el, '--y', ((box.y + box.h / 2) / H).toFixed(4));
      }
    }
    const totalBox = result.get('total');
    if (totalBox) {
      setVar(this.total, '--x', ((totalBox.x + totalBox.w / 2) / W).toFixed(4));
      setVar(this.total, '--y', ((totalBox.y + totalBox.h / 2) / H).toFixed(4));
    }
    // All or none: a person without a number next to the others would read as missing data.
    const allFit = figures.every((f) => !f.pill || !f.box || result.get(`f:${f.li.dataset['id'] ?? ''}`));
    for (const f of figures) {
      if (!f.pill || !f.box || !f.button || !peoplePills) continue;
      const box = result.get(`f:${f.li.dataset['id'] ?? ''}`);
      f.pill.toggleAttribute('data-off', !box || !allFit);
      if (!box || !allFit) continue;
      // The pill sits inside the figure button: offsets from the button's top-left corner.
      setVar(f.pill, '--dx', `${(box.x + box.w / 2 - f.box.x).toFixed(1)}px`);
      setVar(f.pill, '--dy', `${(box.y + box.h / 2 - f.box.y).toFixed(1)}px`);
    }
  }
}
