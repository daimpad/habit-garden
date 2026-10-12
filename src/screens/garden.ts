// Hero landscape and meadow of HEUTE (Habit Garden redesign, decision of 12.10.2026).
// - Sky: the phase of the day (morning / day / evening / night, from dayStartHour and eveningHour)
//   colours the sky; the sun moves along an arc over the right half of the hero, at night a moon shows.
// - Meadow: one group per area (sign with flower and name above), every active routine as a plant
//   growing from the ground in its current stage with a small tag carrying its name; an area without
//   routines shows a seed. People are butterflies above the group of the area "Beziehungen"
//   (flower 'helianthus'), or in an own group "Menschen" when that area is missing: in rhythm they
//   fly in their colour above the plants, overdue they rest pale in the grass in front of the plants
//   (never on top of a plant, so every plant stays tappable).
// - Rendering is keyed (data-id) like the rest of HEUTE, so running grow/wobble animations survive
//   liveQuery emissions; plants whose toggle is still running are left alone (`frozen`).
// - Continuous motion (swaying plants, flying butterflies, drifting clouds) is CSS only and stops under
//   prefers-reduced-motion and the in-app setting "Animationen: reduziert".
import { butterfly, flower } from '../components/flora.js';
import type { OlPlant } from '../components/ol-plant.js';
import { fmt, stageName, t } from '../i18n/de.js';
import type { FlowerId, Habit, Id, Profile, Stage } from '../model.js';
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

/** Three hill crests on top of the meadow's ground; the front crest continues as the ground colour. */
export function hillsMarkup(): SafeHtml {
  return raw(
    '<svg class="ol-hero__hills" viewBox="0 0 400 110" preserveAspectRatio="none" aria-hidden="true" focusable="false">'
    + '<path class="ol-hero__hill ol-hero__hill--back" d="M0 40C60 10 130 6 200 24S330 34 400 12V110H0Z"/>'
    + '<path class="ol-hero__hill ol-hero__hill--mid" d="M0 62C80 40 160 44 240 56S360 60 400 46V110H0Z"/>'
    + '<path class="ol-hero__hill ol-hero__hill--front" d="M0 92C90 76 190 78 270 84S370 86 400 80V110H0Z"/>'
    + '</svg>',
  );
}

/** Places sun/moon and sets the phase attribute on the hero. */
export function applySky(hero: HTMLElement, phase: DayPhase, position: { x: number; y: number }): void {
  if (hero.dataset['phase'] !== phase) hero.dataset['phase'] = phase;
  setVar(hero, '--sun-x', position.x.toFixed(3));
  setVar(hero, '--sun-y', position.y.toFixed(3));
}

// ---------------------------------------------------------------------------
// Meadow

export interface MeadowPlant {
  habit: Habit;
  stage: Stage;
  streak: number;
  weeks: boolean;
}

export interface MeadowPerson {
  id: Id;
  name: string;
  color: string;
  /** In rhythm (flies) or overdue (rests on the ground). */
  state: 'fresh' | 'due';
  /** "Zuletzt vor 3 Tagen" and similar, for the accessible name. */
  last: string;
}

export interface MeadowGroup {
  key: string;
  name: string;
  flower: FlowerId;
  tint: string;
  plants: MeadowPlant[];
  people: MeadowPerson[];
}

function children(el: Element): HTMLElement[] {
  return [...el.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
}

/** Keyed patch of a list (reuse by data-id, create, remove, reorder). */
function syncList<T>(list: HTMLElement, items: readonly T[], keyOf: (item: T) => string,
  create: (item: T) => HTMLElement, update: (el: HTMLElement, item: T, index: number) => void): void {
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
}

function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function createGroup(): HTMLElement {
  const el = document.createElement('li');
  el.className = 'ol-meadow__group';
  render(el, h`<div class="ol-meadow__sign" aria-hidden="true"><span class="ol-meadow__sign-flower"></span><span class="ol-meadow__sign-name"></span></div>
    <div class="ol-meadow__bed">
      <ul class="ol-meadow__plants"></ul>
      <ul class="ol-meadow__butterflies"></ul>
    </div>`);
  return el;
}

function createPlant(): HTMLElement {
  const li = document.createElement('li');
  li.className = 'ol-meadow__slot';
  render(li, h`<button type="button" class="ol-meadow__plant"><ol-plant ground size="64" stage="0"></ol-plant><span class="ol-meadow__tag" aria-hidden="true"></span></button>`);
  return li;
}

function createSeed(): HTMLElement {
  const li = document.createElement('li');
  li.className = 'ol-meadow__slot ol-meadow__slot--seed';
  li.setAttribute('aria-hidden', 'true');
  render(li, h`<span class="ol-meadow__plant"><ol-plant ground size="64" stage="0"></ol-plant></span>`);
  return li;
}

function createButterfly(person: MeadowPerson): HTMLElement {
  const li = document.createElement('li');
  li.className = 'ol-meadow__flyer';
  render(li, h`<button type="button" class="ol-meadow__butterfly"><span class="ol-meadow__wings">${raw(butterfly(person.color, 28))}</span><span class="ol-meadow__name" aria-hidden="true"></span></button>`);
  return li;
}

/**
 * Renders the meadow groups into `list` (a <ul>). `frozen(habitId)`: the plant's stage belongs to a
 * running toggle animation and is not touched.
 */
export function syncMeadow(list: HTMLElement, groups: readonly MeadowGroup[], frozen: (habitId: Id) => boolean): void {
  syncList(list, groups, (g) => g.key, () => createGroup(), (el, group, gi) => {
    const sign = el.querySelector<HTMLElement>('.ol-meadow__sign-flower');
    if (sign && sign.dataset['flower'] !== group.flower) {
      sign.dataset['flower'] = group.flower;
      render(sign, raw(flower(group.flower, 16)));
    }
    const name = el.querySelector('.ol-meadow__sign-name');
    if (name) setText(name, group.name);
    setVar(el, '--tint', group.tint);
    const n = group.plants.length;
    setAttr(el, 'aria-label', n === 0
      ? fmt(t.meadowAreaEmpty, { area: group.name })
      : n === 1 ? fmt(t.meadowAreaAriaOne, { area: group.name }) : fmt(t.meadowAreaAria, { area: group.name, n }));
    setAttr(el, 'role', 'group');

    const plants = el.querySelector<HTMLElement>('.ol-meadow__plants');
    if (plants) {
      type Slot = { key: string; plant: MeadowPlant | null };
      const slots: Slot[] = n === 0 ? [{ key: 'seed', plant: null }] : group.plants.map((p) => ({ key: p.habit.id, plant: p }));
      syncList(plants, slots, (s) => s.key, (s) => (s.plant ? createPlant() : createSeed()), (slot, s, i) => {
        // Neighbouring plants sway out of step; the tag tilts alternately.
        setVar(slot, '--sway-delay', `${(-((gi * 3 + i) % 7) * 0.7).toFixed(1)}s`);
        slot.toggleAttribute('data-tilt', (gi + i) % 2 === 1);
        const plant = slot.querySelector<OlPlant>('ol-plant');
        if (!plant) return;
        setAttr(plant, 'flower', group.flower);
        setAttr(plant, 'tint', group.tint);
        if (!s.plant) return;
        const { habit, stage, streak, weeks } = s.plant;
        if (!frozen(habit.id)) setAttr(plant, 'stage', String(stage));
        setAttr(plant, 'streak', String(streak));
        if (weeks) setAttr(plant, 'streak-unit', 'weeks');
        else plant.removeAttribute('streak-unit');
        const button = slot.querySelector('.ol-meadow__plant');
        if (button) setAttr(button, 'aria-label', fmt(t.meadowPlantAria, { name: habit.name, stage: stageName(frozen(habit.id) ? plant.stage : stage) }));
        const tag = slot.querySelector('.ol-meadow__tag');
        if (tag) setText(tag, habit.name);
      });
    }

    const flyers = el.querySelector<HTMLElement>('.ol-meadow__butterflies');
    if (flyers) {
      const count = group.people.length;
      el.toggleAttribute('data-people', group.people.some((p) => p.state === 'fresh'));
      el.toggleAttribute('data-resting', group.people.some((p) => p.state === 'due'));
      setVar(el, '--people', String(count));
      syncList(flyers, group.people, (p) => p.id, (p) => createButterfly(p), (li, person, i) => {
        // Spread over the bed; flying ones alternate between two heights, resting ones sit on the ground.
        setVar(li, '--bx', `${(((i + 0.5) / Math.max(1, count)) * 100).toFixed(1)}%`);
        setVar(li, '--bd', `${(-(i % 5) * 1.3).toFixed(1)}s`);
        li.toggleAttribute('data-high', i % 2 === 0);
        setAttr(li, 'data-state', person.state);
        const wings = li.querySelector<HTMLElement>('.ol-meadow__wings');
        if (wings && wings.dataset['color'] !== person.color) {
          wings.dataset['color'] = person.color;
          render(wings, raw(butterfly(person.color, 28)));
        }
        const name = li.querySelector('.ol-meadow__name');
        if (name) setText(name, person.name);
        const button = li.querySelector('.ol-meadow__butterfly');
        if (button) setAttr(button, 'aria-label', fmt(t.meadowButterflyAria, { name: person.name, last: person.last }));
      });
    }
  });
}

/** The meadow plant of a routine (for grow/wobble together with the card). */
export function meadowPlant(list: HTMLElement, habitId: Id): OlPlant | null {
  for (const slot of list.querySelectorAll<HTMLElement>('.ol-meadow__slot')) {
    if (slot.dataset['id'] === habitId) return slot.querySelector<OlPlant>('ol-plant');
  }
  return null;
}

/** Lets a butterfly take off (after "Kontaktiert"); CSS plays the flight, then the state attribute rules. */
export function liftButterfly(list: HTMLElement, contactId: Id): void {
  for (const li of list.querySelectorAll<HTMLElement>('.ol-meadow__flyer')) {
    if (li.dataset['id'] !== contactId) continue;
    li.removeAttribute('data-lift');
    // Restart the animation on repeated contacts.
    void li.offsetWidth;
    li.setAttribute('data-lift', '');
    window.setTimeout(() => li.removeAttribute('data-lift'), 1600);
  }
}
