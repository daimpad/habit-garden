// Calendar events in the UI (decision of 20.10.2026): one row markup for HEUTE and the day view, and the event
// sheet (when, where, calendar, note, "Als Aufgabe übernehmen"). Events are read-only copies of the user's own
// calendars; the sheet offers to turn one into a task (repo/calendars taskFromOccurrence) and the toast then
// opens it.
import '../components/ol-button.js';
import { createSheet, type OlSheet } from '../components/ol-sheet.js';
import { showToast } from '../components/ol-toast.js';
import { fmt, t } from '../i18n/de.js';
import type { Day } from '../model.js';
import { taskFromOccurrence, type DayEvents } from '../repo/calendars.js';
import { timeRange, type Occurrence } from '../services/ical.js';
import { formatDayLong, formatTime } from '../util/date.js';
import { emit, h, render, setVar, type SafeHtml } from '../util/dom.js';

/** "09:00" / "ganztägig" / "bis 11:00" for the time column, and the rest of the range for the meta line. */
export function timeLabel(o: Occurrence, day: Day): { main: string; rest: string } {
  const r = timeRange(o, day);
  if (!r) return { main: t.eventAllDay, rest: '' };
  if (r.from && r.to) return { main: r.from, rest: fmt(t.eventUntil, { time: r.to }) };
  if (r.from) return { main: r.from, rest: '' };
  if (r.to) return { main: fmt(t.eventUntil, { time: r.to }), rest: '' };
  return { main: t.eventAllDay, rest: '' };
}

const titleOf = (o: Occurrence): string => o.title || t.eventUntitled;

/** One row: time, calendar dot, title, "bis 10:30 · Ort". The row is one button that opens the sheet. */
export function eventRowMarkup(o: Occurrence, day: Day): SafeHtml {
  const { main, rest } = timeLabel(o, day);
  const meta = [rest, o.location ?? ''].filter(Boolean).join(' · ');
  return h`<button type="button" class="ol-event" data-key="e:${o.key}" aria-label="${fmt(t.eventOpenAria, { title: titleOf(o) })}">
    <span class="ol-event__time ol-num">${main}</span>
    <span class="ol-event__dot" aria-hidden="true"></span>
    <span class="ol-event__text"><span class="ol-event__title">${titleOf(o)}</span>${meta ? h`<span class="ol-event__meta ol-caption">${meta}</span>` : ''}</span>
  </button>`;
}

/** The list items of a day's events (li[data-ev] > button). */
export function eventItemsMarkup(data: DayEvents, day: Day): SafeHtml {
  return h`${data.occurrences.map((o) => h`<li class="ol-events__item" data-ev="${o.key}">${eventRowMarkup(o, day)}</li>`)}`;
}

/** Colours each item by its calendar (CSP: a custom property, no style attribute); `now` marks past timed events. */
export function paintEventList(list: HTMLElement, data: DayEvents, now: number | null): void {
  for (const li of list.querySelectorAll<HTMLElement>('li[data-ev]')) {
    const o = data.occurrences.find((x) => x.key === li.dataset['ev']);
    if (!o) continue;
    setVar(li, '--tint', data.colors.get(o.sourceId) ?? '#5B7FB5');
    li.toggleAttribute('data-past', now !== null && !o.allDay && o.end !== undefined && Date.parse(o.end) <= now);
  }
}

/** Fills a list element with event rows and paints them. */
export function renderEventList(list: HTMLElement, data: DayEvents, day: Day, now: number | null): void {
  render(list, eventItemsMarkup(data, day));
  paintEventList(list, data, now);
}

/** Details of an occurrence in one line each, also used as the description of a task made from it. */
function details(o: Occurrence, calendar: string): string {
  const when = o.allDay ? `${formatDayLong(o.startDay)}, ${t.eventAllDay}`
    : `${formatDayLong(o.startDay)}, ${fmt(t.eventRange, { from: formatTime(o.start ?? ''), to: formatTime(o.end ?? '') })}`;
  return [when, o.location ?? '', calendar ? `${t.eventCalendar}: ${calendar}` : '', o.description ?? ''].filter(Boolean).join('\n');
}

/** The event sheet; "Als Aufgabe übernehmen" creates the task and offers "Öffnen" in the toast. */
export function openEventSheet(o: Occurrence, data: DayEvents, opener: Element | null): OlSheet {
  const calendar = data.names.get(o.sourceId) ?? '';
  const sheet = createSheet({ title: t.eventSheetTitle, fit: true });
  const when = o.allDay
    ? (o.endDay !== o.startDay ? `${formatDayLong(o.startDay)} – ${formatDayLong(o.endDay)}` : `${formatDayLong(o.startDay)}, ${t.eventAllDay}`)
    : `${formatDayLong(o.startDay)}, ${fmt(t.eventRange, { from: formatTime(o.start ?? ''), to: formatTime(o.end ?? '') })}`;
  render(sheet.bodyEl, h`<div class="ol-event-sheet">
    <h3 class="ol-event-sheet__title">${titleOf(o)}</h3>
    <dl class="ol-event-sheet__facts">
      <div><dt>${t.eventWhen}</dt><dd>${when}</dd></div>
      ${o.location ? h`<div><dt>${t.eventWhere}</dt><dd>${o.location}</dd></div>` : ''}
      ${calendar ? h`<div><dt>${t.eventCalendar}</dt><dd><span class="ol-event__dot" aria-hidden="true"></span>${calendar}</dd></div>` : ''}
      ${o.description ? h`<div><dt>${t.eventNotes}</dt><dd class="ol-event-sheet__notes">${o.description}</dd></div>` : ''}
    </dl>
  </div>`);
  setVar(sheet.bodyEl, '--tint', data.colors.get(o.sourceId) ?? '#5B7FB5');
  render(sheet.footerEl, h`<ol-button class="ol-event-sheet__task" variant="tonal" icon="list-checks" label="${t.eventToTask}"></ol-button>`);
  const button = sheet.footerEl.querySelector<HTMLElement>('.ol-event-sheet__task');
  button?.addEventListener('click', () => {
    if (button.hasAttribute('loading')) return;
    button.setAttribute('loading', '');
    taskFromOccurrence(o, details(o, calendar)).then((task) => {
      sheet.close('action');
      showToast(t.eventTaskDone, {
        action: { label: t.eventTaskOpen, onAction: () => emit(opener?.isConnected ? opener : document, 'ol-navigate', { path: `/aufgabe/${encodeURIComponent(task.id)}` }) },
      });
    }, () => {
      button.removeAttribute('loading');
      showToast(t.toastError);
    });
  });
  sheet.open();
  return sheet;
}
