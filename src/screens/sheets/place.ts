// Place sheet of the Garten-Insel (HEUTE, Teil 1): a tap on a place of the island lists the routines of
// its area with their watering toggles; a name opens the routine (/gewohnheit/<id>).
// The shared flower bed ("Weitere Bereiche") lists every area on it under its own heading.
//
// Details of this implementation:
// - The sheet only renders; HEUTE owns the data and the toggle flow (toggleLog, toast on a new stage,
//   particles at this sheet's plant, haptics) and calls update() on every data change while it is open.
// - Rows are keyed by routine id and patched in place, so focus and running plant animations survive.
//   A row whose toggle is still being written (`frozen`) keeps its plant and toggle untouched.
// - Routines not scheduled today show "Heute frei" instead of a toggle.
// - An area without routines shows a short note and "Routine anlegen" (capture sheet with the area).
// - A name closes this sheet first, then navigates (like the calendar sheet), so Back from the routine
//   returns to HEUTE.
import '../../components/ol-button.js';
import '../../components/ol-habit-toggle.js';
import '../../components/ol-plant.js';
import type { OlPlant } from '../../components/ol-plant.js';
import { createSheet, type OlSheet } from '../../components/ol-sheet.js';
import { fmt, stageName, t } from '../../i18n/de.js';
import type { Day, FlowerId, Habit, HabitLog, Id } from '../../model.js';
import { nextStage, streak } from '../../services/growth.js';
import { h, render } from '../../util/dom.js';
import { applyHabitToggle, nextText } from '../garden.js';

export interface PlaceRowData {
  habit: Habit;
  logs: readonly HabitLog[];
  flower: FlowerId;
  tint: string;
  /** Scheduled today (has a toggle). */
  scheduled: boolean;
  /** toggleLog is running (toggle disabled). */
  pending: boolean;
  /** Plant and toggle belong to a running toggle flow until the snapshot has caught up. */
  frozen: boolean;
}

export interface PlaceGroupData {
  key: string;
  name: string;
  areaId: Id | null;
  rows: readonly PlaceRowData[];
}

export interface PlaceSheetHandlers {
  toggle(habitId: Id, toggle: HTMLElement, plant: OlPlant | null): void;
  openHabit(habitId: Id): void;
  create(areaId: Id | null): void;
}

function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export class PlaceSheet {
  readonly sheet: OlSheet;
  private readonly root: HTMLElement;
  private signature = '';

  constructor(title: string, private readonly day: Day, private readonly handlers: PlaceSheetHandlers) {
    this.sheet = createSheet({ title, detent: 'full', fit: true });
    render(this.sheet.bodyEl, h`<div class="ol-place"></div>`);
    const root = this.sheet.bodyEl.querySelector<HTMLElement>('.ol-place');
    if (!root) throw new Error('place sheet: markup missing');
    this.root = root;
    root.addEventListener('ol-change', this.onChange);
    root.addEventListener('click', this.onClick);
  }

  get closed(): Promise<unknown> {
    return this.sheet.closed;
  }

  open(): void {
    this.sheet.open();
  }

  close(): void {
    this.sheet.close('action');
  }

  update(groups: readonly PlaceGroupData[]): void {
    const headings = groups.length > 1;
    // The group skeleton is rebuilt only when groups or their routines change; rows are patched below.
    const signature = JSON.stringify(groups.map((g) => [g.key, g.name, headings, g.rows.map((r) => `${r.habit.id}:${r.scheduled ? 1 : 0}`)]));
    if (signature !== this.signature) {
      this.signature = signature;
      this.build(groups, headings);
    }
    for (const group of groups) for (const row of group.rows) this.updateRow(row);
  }

  private build(groups: readonly PlaceGroupData[], headings: boolean): void {
    const active = document.activeElement;
    const hadFocus = active instanceof HTMLElement && this.root.contains(active);
    // Keep existing rows (plants mid-animation) and move them into the new skeleton.
    const rows = new Map<string, HTMLElement>();
    for (const row of this.root.querySelectorAll<HTMLElement>('.ol-place__row')) rows.set(row.dataset['id'] ?? '', row);
    render(this.root, h`${groups.map((g) => h`<section class="ol-place__group" data-key="${g.key}">
      ${headings ? h`<h3 class="ol-place__heading ol-label">${g.name}</h3>` : ''}
      ${g.rows.length === 0
    ? h`<div class="ol-place__empty"><p class="ol-body-s ol-text-2">${t.placeSheetEmpty}</p>
          <ol-button class="ol-place__create" variant="tonal" size="sm" icon="plus" label="${t.placeSheetCreate}" data-area="${g.areaId ?? ''}"></ol-button></div>`
    : h`<ul class="ol-place__list"></ul>`}
    </section>`)}`);
    for (const group of groups) {
      const list = this.root.querySelector<HTMLElement>(`.ol-place__group[data-key="${CSS.escape(group.key)}"] .ol-place__list`);
      if (!list) continue;
      for (const data of group.rows) {
        const existing = rows.get(data.habit.id);
        const row = existing && existing.dataset['scheduled'] === String(data.scheduled) ? existing : this.createRow(data);
        list.append(row);
      }
    }
    // Moved rows lose focus on the way; give it back (or to the first control when the row is gone).
    if (hadFocus && document.activeElement !== active) {
      const target = active.isConnected ? active : this.root.querySelector<HTMLElement>('button, ol-habit-toggle, ol-button');
      target?.focus({ preventScroll: true });
    }
  }

  private createRow(data: PlaceRowData): HTMLElement {
    const li = document.createElement('li');
    li.className = 'ol-place__row';
    li.dataset['id'] = data.habit.id;
    li.dataset['scheduled'] = String(data.scheduled);
    render(li, h`<ol-plant class="ol-place__plant" size="44" stage="0"></ol-plant>
      <span class="ol-place__text">
        <button type="button" class="ol-place__name"></button>
        <span class="ol-place__meta ol-caption"></span>
      </span>
      ${data.scheduled ? h`<ol-habit-toggle class="ol-place__toggle"></ol-habit-toggle>` : h`<span class="ol-place__off ol-caption">${t.placeSheetOff}</span>`}`);
    return li;
  }

  private updateRow(data: PlaceRowData): void {
    const { habit, logs } = data;
    const row = this.root.querySelector<HTMLElement>(`.ol-place__row[data-id="${CSS.escape(habit.id)}"]`);
    if (!row) return;
    const name = row.querySelector('.ol-place__name');
    if (name) {
      setText(name, habit.name);
      setAttr(name, 'aria-label', fmt(t.habitOpenAria, { name: habit.name }));
    }
    const next = nextStage(habit, logs, this.day);
    const meta = row.querySelector('.ol-place__meta');
    const toggle = row.querySelector<HTMLElement>('ol-habit-toggle');
    if (toggle) toggle.toggleAttribute('disabled', data.pending);
    if (data.frozen) return;
    if (meta) setText(meta, `${stageName(next.stage)} · ${nextText(habit, next)}`);
    const plant = row.querySelector<OlPlant>('ol-plant');
    if (plant) {
      setAttr(plant, 'flower', data.flower);
      setAttr(plant, 'tint', data.tint);
      setAttr(plant, 'stage', String(next.stage));
      setAttr(plant, 'streak', String(streak(habit, logs, this.day)));
      if (habit.schedule.kind === 'timesPerWeek') setAttr(plant, 'streak-unit', 'weeks');
      else plant.removeAttribute('streak-unit');
    }
    if (toggle) applyHabitToggle(toggle, habit, logs, this.day, data.pending);
  }

  private readonly onChange = (event: Event): void => {
    const toggle = event.target instanceof Element ? event.target.closest<HTMLElement>('ol-habit-toggle') : null;
    const row = toggle?.closest<HTMLElement>('.ol-place__row');
    const id = row?.dataset['id'];
    if (!toggle || !row || !id) return;
    this.handlers.toggle(id, toggle, row.querySelector<OlPlant>('ol-plant'));
  };

  private readonly onClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const name = target.closest('.ol-place__name');
    const id = name?.closest<HTMLElement>('.ol-place__row')?.dataset['id'];
    if (name && id) {
      this.close();
      this.handlers.openHabit(id);
      return;
    }
    const create = target.closest<HTMLElement>('.ol-place__create');
    if (create) this.handlers.create(create.dataset['area'] || null);
  };
}

/** Opens the sheet of a place; HEUTE keeps it updated until it closes. */
export function openPlaceSheet(title: string, day: Day, groups: readonly PlaceGroupData[], handlers: PlaceSheetHandlers): PlaceSheet {
  const sheet = new PlaceSheet(title, day, handlers);
  sheet.update(groups);
  sheet.open();
  return sheet;
}
