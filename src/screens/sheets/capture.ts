// Capture sheet (F §4.13, A.2 G1/G2, B.3 sheet layout): type chips Aufgabe/Gewohnheit/Notiz above a
// one-line title field that has focus at once; Save in the footer (thumb zone); Enter saves.
//
// Details of this implementation:
// - The sheet height follows its content (SheetOptions.fit, S27); history entry pushed (Back closes it).
// - The title field is focused synchronously inside open(), so iOS opens the keyboard from the FAB tap.
// - Task: first active area (or opts.areaId), no date, projectId null (D4). The task is reached in
//   Phase 1 through the focus picker's "Ohne Datum" group; the Inbox view is TODO(phase-3).
// - Habit: daily (interval 1), period 'any', startDay today, no area unless opts.areaId is given
//   (S17: generic flower); the toast offers "Bearbeiten" (habit editor).
// - Note: kind 'note' whose body is the title as well (D8); the notes list in WISSEN is TODO(phase-4).
// - Quick syntax (A.2 G2: "!", "@projekt", "#tag", dates): TODO(phase-2).
import '../../components/ol-button.js';
import '../../components/ol-chip.js';
import '../../components/ol-input.js';
import type { OlButton } from '../../components/ol-button.js';
import type { ChipChange } from '../../components/ol-chip.js';
import type { OlInput } from '../../components/ol-input.js';
import { createSheet, type OlSheet } from '../../components/ol-sheet.js';
import { showToast } from '../../components/ol-toast.js';
import { t } from '../../i18n/de.js';
import type { Id } from '../../model.js';
import { firstActiveArea } from '../../repo/areas.js';
import { createHabit } from '../../repo/habits.js';
import { createNote } from '../../repo/notes.js';
import { createTask } from '../../repo/tasks.js';
import { h, render } from '../../util/dom.js';
import { openHabitEditor } from './habit.js';
import { failed } from './task.js';

export type CaptureType = 'task' | 'habit' | 'note';
export interface CaptureOptions { type?: CaptureType; areaId?: Id; projectId?: Id | null }

const TYPES: ReadonlyArray<{ type: CaptureType; label: string; icon: string }> = [
  { type: 'task', label: t.captureTypeTask, icon: 'circle-check' },
  { type: 'habit', label: t.captureTypeHabit, icon: 'sprout' },
  { type: 'note', label: t.captureTypeNote, icon: 'notebook-pen' },
];

function isCaptureType(value: unknown): value is CaptureType {
  return value === 'task' || value === 'habit' || value === 'note';
}

async function defaultAreaId(areaId: Id | undefined): Promise<Id | undefined> {
  return areaId ?? (await firstActiveArea())?.id;
}

export function openCapture(opts: CaptureOptions = {}): OlSheet {
  let type: CaptureType = opts.type ?? 'task';
  let saving = false;
  const sheet = createSheet({ title: t.captureTitle, fit: true });
  render(
    sheet.bodyEl,
    h`<div class="ol-capture">
  <div class="ol-capture__types" role="radiogroup" aria-label="${t.captureTypeAria}">
    ${TYPES.map((o) => h`<ol-chip kind="radio" value="${o.type}" icon="${o.icon}" label="${o.label}" ${o.type === type ? 'selected' : ''}></ol-chip>`)}
  </div>
  <ol-input class="ol-capture__title" label="${t.captureFieldTitle}" autocomplete="off" autofocus></ol-input>
</div>`,
  );
  render(sheet.footerEl, h`<ol-button class="ol-capture__save" variant="filled" label="${t.actionSave}"></ol-button>`);

  const input = sheet.bodyEl.querySelector<OlInput>('.ol-capture__title');
  const types = sheet.bodyEl.querySelector<HTMLElement>('.ol-capture__types');
  const button = sheet.footerEl.querySelector<OlButton>('.ol-capture__save');
  if (!input || !types || !button) throw new Error('capture: markup missing');
  input.field?.setAttribute('enterkeyhint', 'done');

  const save = async (): Promise<void> => {
    if (saving) return;
    const title = input.value.trim();
    if (!title) {
      input.setAttribute('error', t.captureTitleRequired);
      input.focusInput();
      return;
    }
    saving = true;
    button.setAttribute('loading', '');
    try {
      if (type === 'task') {
        const areaId = await defaultAreaId(opts.areaId);
        if (!areaId) throw new Error('capture: no active area');
        await createTask({ title, areaId, projectId: opts.projectId ?? null });
        sheet.close('action');
        showToast(t.toastTaskCreated);
      } else if (type === 'habit') {
        const habit = await createHabit({
          name: title, schedule: { kind: 'daily', interval: 1 }, period: 'any', ...(opts.areaId ? { areaId: opts.areaId } : {}),
        });
        sheet.close('action');
        showToast(t.toastHabitCreated, { action: { label: t.actionEdit, onAction: () => void openHabitEditor(habit.id) } });
      } else {
        await createNote({ title, body: title });
        sheet.close('action');
        showToast(t.toastNoteCreated);
      }
    } catch (err) {
      saving = false;
      button.removeAttribute('loading');
      failed(err);
    }
  };

  types.addEventListener('ol-change', (event) => {
    const detail = event instanceof CustomEvent ? (event.detail as ChipChange) : null;
    if (detail?.selected && isCaptureType(detail.value)) type = detail.value;
  });
  input.addEventListener('input', () => {
    if (input.value.trim() !== '') input.removeAttribute('error');
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || event.shiftKey) return;
    event.preventDefault();
    void save();
  });
  button.addEventListener('click', () => void save());

  sheet.open();
  // Safety net when no [autofocus] target was focusable at open time.
  if (!input.contains(document.activeElement)) input.focusInput();
  return sheet;
}
