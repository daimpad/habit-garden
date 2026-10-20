// Day view /heute/tag/:day (A.2 H8): "Vergangenheit lesend, Zukunft planend". Reached from the calendar
// sheet (date in the HEUTE hero); level 1 below /heute.
// - App bar: back, the full date as <h1> ("Samstag, 10. Oktober 2026"), previous/next day. Below it the
//   distance to today ("Vor 3 Tagen · Rückblick", "Morgen · Planung") and "Kalender" (sheet for this day).
// - Past day (read-only): Fokus of that day with each task's status, tasks completed that day
//   (completedAt, local day), routine logs (plant at that day's stage, Gegossen/Ausgesetzt), mood, the
//   journal note (excerpt + link to /wissen/n/<id>) and the people contacted. Only sections with content
//   show; with none the view says so. Tasks open /aufgabe/<id>, routines /gewohnheit/<id>.
// - Future day (planning): Fokus of that day with "Fokus wählen" (openFocusPick(day); hidden at three),
//   open tasks due that day, "Aufgabe für diesen Tag" (capture sheet with the due day pre-filled) and
//   the routines scheduled that day (read-only).
// - Today redirects to /heute (replace): HEUTE is the view of today. An invalid day shows a calm
//   message with a way back to HEUTE.
//
// Details of this implementation:
// - Previous/next replace the history entry, so Back always returns to where the day view was opened
//   from (HEUTE); the step onto today lands on /heute itself.
// - Data stays live (repo/calendar liveQuery). Content is rebuilt only when what it shows changes; the
//   focused control (data-key) is restored afterwards. When a sheet opened from the view closes and its
//   opener has been rebuilt in the meantime, focus goes to the control with the same key.
// - Content stays invisible until the first data arrived (as on HEUTE).
import '../components/ol-app-bar.js';
import '../components/ol-button.js';
import '../components/ol-card.js';
import '../components/ol-empty-state.js';
import '../components/ol-flower.js';
import '../components/ol-icon-button.js';
import '../components/ol-plant.js';
import type { Subscription } from 'dexie';
import { onModalChange, topModal, type OlSheet } from '../components/ol-sheet.js';
import { fmt, moodLabel, stageName, t } from '../i18n/de.js';
import { GENERIC_TINT, MAX_FOCUS, type Area, type ContactKind, type Day, type FlowerId, type Habit, type Task } from '../model.js';
import { areas$ } from '../repo/areas.js';
import { futureDay$, pastDay$ } from '../repo/calendar.js';
import type { Route } from '../router.js';
import { excerpt, isPastDayEmpty, type FutureDay, type PastDay } from '../services/calendar.js';
import { contactKindLabel } from '../services/contacts.js';
import { appUrl } from '../util/base.js';
import { addDays, diffDays, formatDayFull, formatTime, formatWeekdayLong, isDay, today } from '../util/date.js';
import { emit, h, icon, render, type SafeHtml } from '../util/dom.js';
import { events$, type DayEvents } from '../repo/calendars.js';
import { eventItemsMarkup, openEventSheet, paintEventList } from './events-ui.js';
import { openCalendar, moodMarker } from './sheets/calendar.js';
import { openCapture } from './sheets/capture.js';
import { openFocusPick } from './sheets/focus-pick.js';
import { rhythmText } from './sheets/habit.js';

const KIND_ICON: Readonly<Record<ContactKind, string>> = { call: 'phone', message: 'message-circle', meeting: 'coffee' };

function statusText(task: Task): string {
  return task.status === 'done' ? t.taskStatusDone : task.status === 'doing' ? t.taskStatusDoing : t.taskStatusOpen;
}

/** "Gestern · Rückblick", "Vor 3 Tagen · Rückblick", "Morgen · Planung", "In 5 Tagen · Planung". */
function relativeText(day: Day, current: Day): string {
  const n = diffDays(day, current);
  if (n === -1) return t.dayYesterday;
  if (n === 1) return t.dayTomorrow;
  return n < 0 ? fmt(t.dayAgo, { n: -n }) : fmt(t.dayAhead, { n });
}

function pathFor(day: Day): string {
  return day === today() ? '/heute' : `/heute/tag/${day}`;
}

function section(key: string, heading: string, body: SafeHtml, extra: SafeHtml | string = ''): SafeHtml {
  return h`<section class="ol-section ol-day__section" aria-labelledby="day-${key}">
    <div class="ol-section__head"><h2 class="ol-label" id="day-${key}">${heading}</h2>${extra}</div>
    ${body}
  </section>`;
}

function taskRow(task: Task, meta: SafeHtml | string, prefix: string): SafeHtml {
  const done = task.status === 'done';
  return h`<li class="ol-day__row" ${done ? h`data-done` : ''}>
    <span class="ol-day__status" aria-hidden="true">${icon(done ? 'circle-check' : 'circle', 20)}</span>
    <button type="button" class="ol-day__title" data-key="${prefix}:${task.id}" data-task="${task.id}">${task.title}</button>
    <span class="ol-day__meta ol-caption">${meta}</span>
  </li>`;
}

function renderInvalid(view: HTMLElement): () => void {
  render(view, h`
    <ol-app-bar back heading="${t.calendarTitle}"></ol-app-bar>
    <div class="ol-day ol-day--invalid">
      <ol-empty-state icon="calendar" message="${t.dayInvalid}" action="${t.dayInvalidBack}"></ol-empty-state>
    </div>`);
  const onAction = (): void => {
    emit(view, 'ol-navigate', { path: '/heute', replace: true });
  };
  view.addEventListener('ol-action', onAction);
  return () => view.removeEventListener('ol-action', onAction);
}

class DayScreen {
  private readonly kind: 'past' | 'future';
  private readonly current: Day = today();
  private areas = new Map<string, Area>();
  private past: PastDay | null = null;
  private future: FutureDay | null = null;
  private events: DayEvents | null = null;
  private signature = '';
  private readonly subs: Subscription[] = [];
  private readonly detach: Array<() => void> = [];
  private destroyed = false;
  private openerKey: string | null = null;
  private readonly content: HTMLElement;
  private readonly root: HTMLElement;

  constructor(private readonly view: HTMLElement, private readonly day: Day) {
    this.kind = day < this.current ? 'past' : 'future';
    render(view, h`
      <ol-app-bar back heading="${formatWeekdayLong(day)}, ${formatDayFull(day)}">
        <ol-icon-button slot="actions" class="ol-day__prev" icon="chevron-left" label="${t.dayPrev}"></ol-icon-button>
        <ol-icon-button slot="actions" class="ol-day__next" icon="chevron-right" label="${t.dayNext}"></ol-icon-button>
      </ol-app-bar>
      <div class="ol-day" data-kind="${this.kind}" data-loading>
        <div class="ol-day__bar">
          <p class="ol-day__rel ol-body-s">${relativeText(day, this.current)}</p>
          <ol-button class="ol-day__calendar" data-key="calendar" variant="ghost" size="sm" icon="calendar" label="${t.dayOpenCalendar}"></ol-button>
        </div>
        <div class="ol-day__content"></div>
      </div>`);
    const root = view.querySelector<HTMLElement>('.ol-day');
    const content = view.querySelector<HTMLElement>('.ol-day__content');
    if (!root || !content) throw new Error('day: markup missing');
    this.root = root;
    this.content = content;
  }

  start(): void {
    const view = this.view;
    view.querySelector('.ol-day__prev')?.addEventListener('click', () => this.go(-1));
    view.querySelector('.ol-day__next')?.addEventListener('click', () => this.go(1));
    view.querySelector('.ol-day__calendar')?.addEventListener('click', () => this.withOpener('calendar', () => openCalendar(this.day)));
    this.content.addEventListener('click', this.onClick);
    this.detach.push(onModalChange(() => this.onModalChange()));

    const fail = (err: unknown): void => console.error(err);
    this.subs.push(areas$(true).subscribe({
      next: (list: Area[]) => {
        this.areas = new Map(list.map((a) => [a.id, a]));
        this.render();
      },
      error: fail,
    }));
    // Calendar sync: the day's events of the imported calendars, first on the page.
    this.subs.push(events$(this.day, this.day).subscribe({
      next: (data: DayEvents) => {
        this.events = data;
        this.render();
      },
      error: fail,
    }));
    if (this.kind === 'past') {
      this.subs.push(pastDay$(this.day).subscribe({
        next: (data: PastDay) => {
          this.past = data;
          this.render();
        },
        error: fail,
      }));
    } else {
      this.subs.push(futureDay$(this.day).subscribe({
        next: (data: FutureDay) => {
          this.future = data;
          this.render();
        },
        error: fail,
      }));
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const sub of this.subs) sub.unsubscribe();
    this.subs.length = 0;
    for (const off of this.detach) off();
    this.detach.length = 0;
  }

  private go(delta: number): void {
    emit(this.view, 'ol-navigate', { path: pathFor(addDays(this.day, delta)), replace: true });
  }

  private flowerOf(habit: Habit): { flower: FlowerId; tint: string } {
    const area = habit.areaId ? this.areas.get(habit.areaId) : undefined;
    return area ? { flower: area.flower, tint: area.tint } : { flower: 'generic', tint: GENERIC_TINT };
  }

  // --- Rendering ---

  private render(): void {
    if (this.destroyed) return;
    let markup: SafeHtml;
    if (!this.events) return;
    const events = this.eventsMarkup(this.events);
    if (this.kind === 'past') {
      if (!this.past) return;
      markup = this.events.occurrences.length > 0 && isPastDayEmpty(this.past) ? events : h`${events}${this.pastMarkup(this.past)}`;
    } else {
      if (!this.future) return;
      markup = h`${events}${this.futureMarkup(this.future)}`;
    }
    if (markup.html === this.signature) return;
    this.signature = markup.html;

    const active = document.activeElement;
    const focusKey = active instanceof HTMLElement && this.content.contains(active)
      ? active.closest<HTMLElement>('[data-key]')?.dataset['key'] ?? null
      : null;
    render(this.content, markup);
    const evList = this.content.querySelector<HTMLElement>('.ol-day__events');
    if (evList && this.events) paintEventList(evList, this.events, null);
    this.root.removeAttribute('data-loading');
    if (focusKey) this.focusKey(focusKey);
  }

  private eventsMarkup(data: DayEvents): SafeHtml {
    if (data.occurrences.length === 0) return h``;
    return section('events', t.dayEvents, h`<ol-card class="ol-day__card"><ul class="ol-events ol-day__events">${eventItemsMarkup(data, this.day)}</ul></ol-card>`);
  }

  private pastMarkup(data: PastDay): SafeHtml {
    if (isPastDayEmpty(data)) {
      return h`<ol-card class="ol-day__card ol-day__empty"><p class="ol-body-s ol-text-2">${t.dayEmptyPast}</p></ol-card>`;
    }
    const parts: SafeHtml[] = [];
    if (data.focus.length > 0) {
      parts.push(section('focus', t.sectionFocus, h`<ol-card class="ol-day__card"><ul class="ol-day__list">
        ${data.focus.map((task) => taskRow(task, statusText(task), 'f'))}</ul></ol-card>`));
    }
    if (data.completed.length > 0) {
      parts.push(section('done', t.daySectionCompleted, h`<ol-card class="ol-day__card"><ul class="ol-day__list">
        ${data.completed.map((task) => taskRow(task, h`<span class="ol-num">${task.completedAt ? formatTime(task.completedAt) : ''}</span>`, 'c'))}</ul></ol-card>`));
    }
    if (data.habits.length > 0) {
      parts.push(section('habits', t.sectionRoutines, h`<ol-card class="ol-day__card"><ul class="ol-day__list">
        ${data.habits.map(({ habit, status, stage }) => {
          const { flower, tint } = this.flowerOf(habit);
          const label = status === 'done' ? `${t.dayHabitDone} · ${stageName(stage)}` : t.dayHabitSkipped;
          return h`<li class="ol-day__row" data-status="${status}">
            <span class="ol-day__plant" aria-hidden="true"><ol-plant size="32" stage="${stage}" flower="${flower}" tint="${tint}"></ol-plant></span>
            <button type="button" class="ol-day__title" data-key="h:${habit.id}" data-habit="${habit.id}">${habit.name}</button>
            <span class="ol-day__meta ol-caption">${label}</span>
          </li>`;
        })}</ul></ol-card>`));
    }
    if (data.mood !== undefined) {
      const value = data.mood;
      parts.push(section('mood', t.sectionMood, h`<ol-card class="ol-day__card ol-day__mood">
        ${moodMarker(value, 28)}<p class="ol-body">${fmt(t.dayMoodText, { label: moodLabel(value), n: value })}</p></ol-card>`));
    }
    if (data.journal) {
      const note = data.journal;
      parts.push(section('journal', t.daySectionJournal, h`<ol-card class="ol-day__card ol-day__journal">
        <p class="ol-body-s ol-day__excerpt">${excerpt(note.body)}</p>
        <a class="ol-day__link" data-key="n:${note.id}" href="${appUrl(`/wissen/n/${encodeURIComponent(note.id)}`)}">${icon('notebook-pen', 20)}<span>${t.dayJournalOpen}</span></a>
      </ol-card>`));
    }
    if (data.contacts.length > 0) {
      parts.push(section('people', t.daySectionPeople, h`<ol-card class="ol-day__card"><ul class="ol-day__list">
        ${data.contacts.map(({ log, contact }) => h`<li class="ol-day__row ol-day__row--static">
          <span class="ol-day__status" aria-hidden="true">${icon(log.kind ? KIND_ICON[log.kind] : 'users', 20)}</span>
          <span class="ol-day__name">${contact?.name ?? ''}</span>
          <span class="ol-day__meta ol-caption">${log.kind ? contactKindLabel(log.kind) : ''}</span>
        </li>`)}</ul></ol-card>`));
    }
    return h`${parts}`;
  }

  private futureMarkup(data: FutureDay): SafeHtml {
    const full = data.focus.length >= MAX_FOCUS;
    const focusBody = h`<ol-card class="ol-day__card">
      ${data.focus.length > 0
        ? h`<ul class="ol-day__list">${data.focus.map((task) => taskRow(task, statusText(task), 'f'))}</ul>`
        : h`<p class="ol-day__none ol-body-s ol-text-2">${t.dayFocusEmptyFuture}</p>`}
      ${full
        ? h`<p class="ol-day__none ol-caption">${t.dayFocusFull}</p>`
        : h`<div class="ol-day__actions"><ol-button class="ol-day__pick" data-key="pick" variant="tonal" size="sm" icon="list-checks" label="${t.focusPickTitle}"></ol-button></div>`}
    </ol-card>`;
    const dueBody = h`<ol-card class="ol-day__card">
      ${data.due.length > 0
        ? h`<ul class="ol-day__list">${data.due.map((task) => taskRow(task, task.dueHasTime === 1 && task.dueAt ? h`<span class="ol-num">${formatTime(task.dueAt)}</span>` : '', 'd'))}</ul>`
        : h`<p class="ol-day__none ol-body-s ol-text-2">${t.dayDueEmpty}</p>`}
      <div class="ol-day__actions"><ol-button class="ol-day__add" data-key="add" variant="tonal" size="sm" icon="plus" label="${t.dayAddTask}"></ol-button></div>
    </ol-card>`;
    const habitsBody = h`<ol-card class="ol-day__card">
      ${data.habits.length > 0
        ? h`<ul class="ol-day__list">${data.habits.map((habit) => h`<li class="ol-day__row ol-day__row--static">
            <ol-flower class="ol-day__flower" flower="${this.flowerOf(habit).flower}" size="24"></ol-flower>
            <span class="ol-day__name">${habit.name}</span>
            <span class="ol-day__meta ol-caption">${rhythmText(habit.schedule)}</span>
          </li>`)}</ul>`
        : h`<p class="ol-day__none ol-body-s ol-text-2">${t.dayScheduledEmpty}</p>`}
    </ol-card>`;
    return h`${section('focus', t.sectionFocus, focusBody, h`<span class="ol-caption ol-num">${data.focus.length}/${MAX_FOCUS}</span>`)}
      ${section('due', t.daySectionDue, dueBody)}
      ${section('scheduled', t.daySectionScheduled, habitsBody)}`;
  }

  // --- Actions and focus ---

  private readonly onClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const evItem = target.closest<HTMLElement>('li[data-ev]');
    const occurrence = evItem && this.events?.occurrences.find((o) => o.key === evItem.dataset['ev']);
    if (evItem && occurrence && this.events) {
      const data = this.events;
      this.withOpener(`e:${occurrence.key}`, () => openEventSheet(occurrence, data, evItem.querySelector('button')));
      return;
    }
    const taskBtn = target.closest<HTMLElement>('[data-task]');
    const habitBtn = target.closest<HTMLElement>('[data-habit]');
    if (taskBtn?.dataset['task']) {
      this.openerKey = taskBtn.dataset['key'] ?? null;
      emit(taskBtn, 'ol-navigate', { path: `/aufgabe/${encodeURIComponent(taskBtn.dataset['task'])}` });
    } else if (habitBtn?.dataset['habit']) {
      this.openerKey = habitBtn.dataset['key'] ?? null;
      emit(habitBtn, 'ol-navigate', { path: `/gewohnheit/${encodeURIComponent(habitBtn.dataset['habit'])}` });
    } else if (target.closest('.ol-day__pick')) {
      this.withOpener('pick', () => openFocusPick(this.day));
    } else if (target.closest('.ol-day__add')) {
      this.withOpener('add', () => openCapture({ type: 'task', dueDay: this.day }));
    }
  };

  private withOpener(key: string, open: () => OlSheet): void {
    this.openerKey = key;
    try {
      open();
    } catch (err) {
      console.error(err);
    }
  }

  private focusKey(key: string): boolean {
    const el = this.view.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    if (!el) return false;
    const target = el.querySelector<HTMLElement>('button') ?? el;
    target.focus({ preventScroll: true });
    return true;
  }

  /** After a sheet closed: when its opener was rebuilt meanwhile, focus the control with the same key. */
  private onModalChange(): void {
    if (this.destroyed || topModal()) return;
    const key = this.openerKey;
    this.openerKey = null;
    if (!key) return;
    const closing = [...document.querySelectorAll<OlSheet>('ol-sheet[dismissing]')].map((sheet) => sheet.closed);
    void Promise.allSettled(closing).then(() => {
      if (this.destroyed || topModal()) return;
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      if (!this.focusKey(key)) this.view.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    });
  }
}

export function mount(view: HTMLElement, route: Route): () => void {
  const day = route.params['day'] ?? '';
  if (!isDay(day)) return renderInvalid(view);
  if (day === today()) {
    // HEUTE is the view of today.
    view.replaceChildren();
    emit(view, 'ol-navigate', { path: '/heute', replace: true });
    return () => undefined;
  }
  const screen = new DayScreen(view, day);
  screen.start();
  return () => screen.destroy();
}
