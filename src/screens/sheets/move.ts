// "Verschieben" sheet (A.3 Liste: Swipe links ⇡ Heute / Morgen / Wochenende / Datum). A small sheet with
// one button per target plus "Ohne Datum" and a date field; the change keeps a task's time of day
// (updateTask with dueDay) and the toast offers Rückgängig with the previous due fields.
import '../../components/ol-button.js';
import '../../components/ol-input.js';
import type { OlInput } from '../../components/ol-input.js';
import { createSheet, type OlSheet } from '../../components/ol-sheet.js';
import { showToast } from '../../components/ol-toast.js';
import { fmt, t } from '../../i18n/de.js';
import type { Day, Task } from '../../model.js';
import { updateTask } from '../../repo/tasks.js';
import { weekendDay } from '../../services/move-day.js';
import { addDays, formatDayShort, isDay, today } from '../../util/date.js';
import { h, icon, render } from '../../util/dom.js';
import { failed } from './task.js';

/** Moves `task` to `day` (undefined removes the date) with a toast and Rückgängig. */
export async function moveTask(task: Task, day: Day | undefined): Promise<void> {
  const before: Partial<Task> = task.dueAt ? { dueAt: task.dueAt, dueHasTime: task.dueHasTime } : { dueAt: undefined };
  await updateTask(task.id, day ? { dueDay: day } : { dueAt: undefined });
  showToast(day ? fmt(t.toastMoved, { date: formatDayShort(day) }) : t.toastMovedNoDate, {
    action: { label: t.actionUndo, onAction: () => void updateTask(task.id, before).catch(failed) },
  });
}

export function openMoveSheet(task: Task): OlSheet {
  const d = today();
  const targets: ReadonlyArray<{ key: string; label: string; day: Day | undefined; icon: string }> = [
    { key: 'today', label: t.moveToday, day: d, icon: 'sun' },
    { key: 'tomorrow', label: t.moveTomorrow, day: addDays(d, 1), icon: 'sunrise' },
    { key: 'weekend', label: t.moveWeekend, day: weekendDay(d), icon: 'coffee' },
    { key: 'none', label: t.moveNoDate, day: undefined, icon: 'x' },
  ];
  const sheet = createSheet({ title: t.moveTitle, fit: true });
  render(sheet.bodyEl, h`<div class="ol-move" role="group" aria-label="${t.moveOptionsAria}">
    ${targets.map((x) => h`<button type="button" class="ol-move__target" data-key="${x.key}">
      <span class="ol-move__icon" aria-hidden="true">${icon(x.icon, 20)}</span>
      <span class="ol-move__label">${x.label}</span>
      <span class="ol-move__date ol-caption ol-num">${x.day ? formatDayShort(x.day) : ''}</span>
    </button>`)}
    <div class="ol-move__pick">
      <ol-input class="ol-move__date-input" type="date" label="${t.moveDateLabel}"></ol-input>
      <ol-button class="ol-move__apply" variant="tonal" label="${t.moveApply}"></ol-button>
    </div>
  </div>`);
  let busy = false;
  const go = (day: Day | undefined): void => {
    if (busy) return;
    busy = true;
    sheet.close('action');
    void sheet.closed.then(() => moveTask(task, day)).catch(failed);
  };
  sheet.bodyEl.addEventListener('click', (event) => {
    const key = event.target instanceof Element ? event.target.closest<HTMLElement>('.ol-move__target')?.dataset['key'] : undefined;
    const target = targets.find((x) => x.key === key);
    if (target) go(target.day);
  });
  const input = sheet.bodyEl.querySelector<OlInput>('.ol-move__date-input');
  if (input && task.dueDay) input.value = task.dueDay;
  sheet.bodyEl.querySelector('.ol-move__apply')?.addEventListener('click', () => {
    const value = input?.value ?? '';
    if (isDay(value)) go(value);
    else input?.focusInput();
  });
  sheet.open();
  return sheet;
}
