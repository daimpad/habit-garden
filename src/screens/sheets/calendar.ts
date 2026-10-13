// Calendar sheet (A.2 H8): "Datum tippen → Kalender-Sheet → /heute/tag/{Datum}". Opened from the date in
// the HEUTE hero and from the day view.
// Layout (full detent, height follows the content, history push so Back closes it):
// - Head: previous month · "Oktober 2026" (h3, aria-live polite) · next month.
// - Month grid (table, Monday first, weekday short names from util/date with the long name for screen
//   readers): one button per day of the month; days outside the month stay empty cells.
//   Today: filled circle and aria-current="date"; the selected day (the day the sheet was opened for)
//   has a ring. Below the number up to three small markers (services/calendar summarizeDays): fällige
//   Aufgaben (dot, with the count from 2 on), Routinen gegossen (ring filled by done/due, up to today
//   only), Stimmung (pie filled by (value − 1)/4 as on HEUTE). A legend explains them; every day button
//   carries the summary in its aria-label ("Dienstag, 13. Oktober 2026, heute, 2 Aufgaben fällig, …").
// - Footer: "Heute" jumps to the current month and focuses today.
// Keyboard (date-picker pattern): roving tabindex in the grid; arrows ±1/±7 days, Home/End Monday/Sunday,
// PageUp/PageDown one month (Shift: one year), clamped; moving past the month edge turns the page.
// Enter/Space (native button) or a tap navigates: the sheet closes first, then /heute/tag/<day> (today:
// /heute itself).
//
// Details of this implementation:
// - The grid is rebuilt on every page turn; markers are patched into the existing buttons whenever the
//   month's liveQuery emits, so focus and the roving tabindex survive data changes.
// - The month buttons keep focus while paging; the focused day follows (same date, clamped).
// - A day change while the sheet is open (midnight) re-renders the grid, so the today mark moves along.
import '../../components/ol-button.js';
import '../../components/ol-icon-button.js';
import type { Subscription } from 'dexie';
import { createSheet, type OlSheet } from '../../components/ol-sheet.js';
import { fmt, t } from '../../i18n/de.js';
import type { Day } from '../../model.js';
import { monthSummary$ } from '../../repo/calendar.js';
import { addMonthsClamped, monthGrid, monthOf, moveDay, sameMonth, type DaySummary, type Month } from '../../services/calendar.js';
import {
  addDays, dayParts, formatDayFull, formatWeekdayLong, formatWeekdayShort, isDay, onDayChange, today,
} from '../../util/date.js';
import { emit, h, raw, render, type SafeHtml } from '../../util/dom.js';

const MONTH_FMT = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
/** Any Monday: the weekday header is derived from the seven days that follow it. */
const A_MONDAY: Day = '2026-10-12';
const R = 4;
const C = 2 * Math.PI * R;

function monthTitle(m: Month): string {
  return MONTH_FMT.format(new Date(m.year, m.month - 1, 1));
}

/** Tiny ring filled by share (0…1): habits done of due. */
function ringMarker(share: number): SafeHtml {
  const dash = (Math.max(0, Math.min(1, share)) * C).toFixed(2);
  return raw(
    `<svg class="ol-cal__ring" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">`
    + `<circle class="ol-cal__ring-track" cx="6" cy="6" r="${R}"/>`
    + `<circle class="ol-cal__ring-arc" cx="6" cy="6" r="${R}" transform="rotate(-90 6 6)" stroke-dasharray="${dash} ${C.toFixed(2)}"/></svg>`,
  );
}

/** Mood pie as on HEUTE: share (value − 1)/4 filled; also used by the day view (larger size). */
export function moodMarker(value: number, size = 10): SafeHtml {
  const share = (value - 1) / 4;
  const c = 6;
  const r = 4.5;
  let fill = '';
  if (share >= 1) fill = `<circle class="ol-cal__mood-fill" cx="${c}" cy="${c}" r="${r}"/>`;
  else if (share > 0) {
    const angle = share * 2 * Math.PI;
    const x = (c + r * Math.sin(angle)).toFixed(2);
    const y = (c - r * Math.cos(angle)).toFixed(2);
    fill = `<path class="ol-cal__mood-fill" d="M${c} ${c}L${c} ${c - r}A${r} ${r} 0 ${share > 0.5 ? 1 : 0} 1 ${x} ${y}Z"/>`;
  }
  return raw(
    `<svg class="ol-cal__mood" viewBox="0 0 12 12" width="${size}" height="${size}" aria-hidden="true" focusable="false">`
    + `<circle class="ol-cal__mood-bg" cx="${c}" cy="${c}" r="${r}"/>${fill}<circle class="ol-cal__mood-ring" cx="${c}" cy="${c}" r="${r}"/></svg>`,
  );
}

function markers(summary: DaySummary | undefined): SafeHtml {
  if (!summary) return h``;
  const due = summary.due > 0
    ? h`<span class="ol-cal__due ol-num" data-many="${summary.due > 1 ? 'true' : 'false'}">${summary.due > 1 ? (summary.due > 9 ? '9+' : String(summary.due)) : ''}</span>`
    : '';
  const habits = summary.habitsDue > 0 ? ringMarker(summary.habitsDone / summary.habitsDue) : '';
  const mood = summary.mood !== undefined ? moodMarker(summary.mood) : '';
  return h`${due}${habits}${mood}`;
}

/** "Dienstag, 13. Oktober 2026, heute, 2 Aufgaben fällig, 3 von 5 Routinen gegossen, Stimmung 4 von 5" */
export function dayAriaLabel(day: Day, summary: DaySummary | undefined, current: Day): string {
  const parts = [`${formatWeekdayLong(day)}, ${formatDayFull(day)}`];
  if (day === current) parts.push(t.calendarTodayMark);
  if (summary) {
    if (summary.due > 0) parts.push(summary.due === 1 ? t.calendarDueOne : fmt(t.calendarDueMany, { n: summary.due }));
    if (summary.habitsDue > 0) parts.push(fmt(t.calendarHabits, { done: summary.habitsDone, total: summary.habitsDue }));
    if (summary.mood !== undefined) parts.push(fmt(t.calendarMood, { n: summary.mood }));
  }
  return parts.join(', ');
}

function req<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`calendar: missing ${selector}`);
  return el;
}

class CalendarSheet {
  private month: Month;
  private focusDay: Day;
  private current: Day = today();
  private summaries = new Map<Day, DaySummary>();
  private sub: Subscription | null = null;
  private stopDay: (() => void) | null = null;
  private done = false;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;

  constructor(private readonly sheet: OlSheet, private readonly selected: Day) {
    this.focusDay = selected;
    this.month = monthOf(selected);
    const key = sheet.sheetKey;
    const weekdays = Array.from({ length: 7 }, (_, i) => addDays(A_MONDAY, i));
    render(sheet.bodyEl, h`<div class="ol-cal">
  <div class="ol-cal__head">
    <ol-icon-button class="ol-cal__prev" icon="chevron-left" label="${t.calendarPrevMonth}"></ol-icon-button>
    <h3 class="ol-cal__month" id="${key}-month" aria-live="polite"></h3>
    <ol-icon-button class="ol-cal__next" icon="chevron-right" label="${t.calendarNextMonth}"></ol-icon-button>
  </div>
  <table class="ol-cal__grid" aria-labelledby="${key}-month" aria-describedby="${key}-keys">
    <thead><tr>${weekdays.map((d) => h`<th scope="col"><span aria-hidden="true">${formatWeekdayShort(d)}</span><span class="ol-visually-hidden">${formatWeekdayLong(d)}</span></th>`)}</tr></thead>
    <tbody></tbody>
  </table>
  <p class="ol-visually-hidden" id="${key}-keys">${t.calendarKeysHint}</p>
  <ul class="ol-cal__legend ol-caption" aria-hidden="true">
    <li><span class="ol-cal__due" data-many="false"></span>${t.calendarLegendDue}</li>
    <li>${ringMarker(0.66)}${t.calendarLegendHabits}</li>
    <li>${moodMarker(4)}${t.calendarLegendMood}</li>
  </ul>
</div>`);
    render(sheet.footerEl, h`<ol-button class="ol-cal__today" variant="tonal" icon="calendar" label="${t.calendarToday}"></ol-button>`);
    this.title = req<HTMLElement>(sheet.bodyEl, '.ol-cal__month');
    this.body = req<HTMLElement>(sheet.bodyEl, 'tbody');
  }

  start(): void {
    const sheet = this.sheet;
    req<HTMLElement>(sheet.bodyEl, '.ol-cal__prev').addEventListener('click', () => this.page(-1));
    req<HTMLElement>(sheet.bodyEl, '.ol-cal__next').addEventListener('click', () => this.page(1));
    req<HTMLElement>(sheet.footerEl, '.ol-cal__today').addEventListener('click', () => this.goToday());
    this.body.addEventListener('click', this.onClick);
    this.body.addEventListener('keydown', this.onKey);
    this.body.addEventListener('focusin', this.onFocusIn);
    sheet.addEventListener('ol-dismiss', (event) => {
      if (event.target === sheet) this.cleanup();
    });
    void sheet.closed.then(() => this.cleanup(), () => this.cleanup());
    this.stopDay = onDayChange((day) => {
      this.current = day;
      this.renderGrid(false);
    });
    this.renderGrid(false, true);
    sheet.open();
  }

  private cleanup(): void {
    this.done = true;
    this.sub?.unsubscribe();
    this.sub = null;
    this.stopDay?.();
    this.stopDay = null;
  }

  private watchMonth(): void {
    this.sub?.unsubscribe();
    const month = this.month;
    this.summaries = new Map();
    this.sub = monthSummary$(month, this.current).subscribe({
      next: (map: Map<Day, DaySummary>) => {
        if (this.done || !sameMonth(month, this.month)) return;
        this.summaries = map;
        this.patchMarkers();
      },
      error: (err: unknown) => console.error(err),
    });
  }

  /** Rebuilds the grid for this.month; focus moves to the focused day when asked. */
  private renderGrid(focus: boolean, initial = false): void {
    const weeks = monthGrid(this.month);
    const current = this.current;
    const cell = (day: Day | null): SafeHtml => {
      if (day === null) return h`<td class="ol-cal__empty"></td>`;
      const isFocus = day === this.focusDay;
      return h`<td><button type="button" class="ol-cal__day" data-day="${day}" tabindex="${isFocus ? '0' : '-1'}"
        ${day === current ? raw('aria-current="date"') : ''} ${day === this.selected ? raw('data-selected') : ''}
        ${initial && isFocus ? raw('autofocus') : ''}><span class="ol-cal__num ol-num">${dayParts(day).date}</span><span class="ol-cal__marks"></span></button></td>`;
    };
    render(this.body, h`${weeks.map((week) => h`<tr>${week.map(cell)}</tr>`)}`);
    this.title.textContent = monthTitle(this.month);
    this.patchMarkers();
    this.watchMonth();
    if (focus) this.buttonFor(this.focusDay)?.focus();
  }

  private patchMarkers(): void {
    for (const button of this.body.querySelectorAll<HTMLButtonElement>('.ol-cal__day')) {
      const day = button.dataset['day'];
      if (!day || !isDay(day)) continue;
      const summary = this.summaries.get(day);
      render(req<HTMLElement>(button, '.ol-cal__marks'), markers(summary));
      button.setAttribute('aria-label', dayAriaLabel(day, summary, this.current));
    }
  }

  private buttonFor(day: Day): HTMLButtonElement | null {
    return this.body.querySelector<HTMLButtonElement>(`.ol-cal__day[data-day="${day}"]`);
  }

  private setFocusDay(day: Day, focus: boolean): void {
    this.focusDay = day;
    const month = monthOf(day);
    if (!sameMonth(month, this.month)) {
      this.month = month;
      this.renderGrid(focus);
      return;
    }
    for (const button of this.body.querySelectorAll<HTMLButtonElement>('.ol-cal__day')) {
      button.tabIndex = button.dataset['day'] === day ? 0 : -1;
    }
    if (focus) this.buttonFor(day)?.focus();
  }

  /** Turns the page; the focused day keeps its date (clamped). focusDay always lies in this.month. */
  private page(delta: number): void {
    this.focusDay = addMonthsClamped(this.focusDay, delta);
    this.month = monthOf(this.focusDay);
    this.renderGrid(false);
  }

  private goToday(): void {
    this.setFocusDay(this.current, true);
  }

  private readonly onFocusIn = (event: FocusEvent): void => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.ol-cal__day') : null;
    const day = button?.dataset['day'];
    if (day && isDay(day) && day !== this.focusDay) this.setFocusDay(day, false);
  };

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.ol-cal__day') : null;
    const day = button?.dataset['day'];
    if (!day || !isDay(day)) return;
    const next = moveDay(day, event.key, event.shiftKey);
    if (!next) return;
    event.preventDefault();
    this.setFocusDay(next, true);
  };

  private readonly onClick = (event: Event): void => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.ol-cal__day') : null;
    const day = button?.dataset['day'];
    if (!day || !isDay(day)) return;
    const path = day === today() ? '/heute' : `/heute/tag/${day}`;
    this.sheet.close('action');
    emit(document.body, 'ol-navigate', { path });
  };
}

/** Month calendar with markers; picking a day opens /heute/tag/<day>. */
export function openCalendar(selected?: Day): OlSheet {
  const day = selected !== undefined && isDay(selected) ? selected : today();
  const sheet = createSheet({ title: t.calendarTitle, detent: 'full', fit: true });
  new CalendarSheet(sheet, day).start();
  return sheet;
}
