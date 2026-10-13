// Task sheet /aufgabe/:id (F §4.13, A.3 Task-Sheet, D.1, D.5).
// Half detent: checkbox + title, due date and time (native inputs), Wiederholung row (A.2 P8: repeat
// icon + current rule, opens a small preset sheet), Wichtig/Dringend chips (icon and text, not colour
// alone), Status (radio chips Offen / In Arbeit / Erledigt), Bereich (radio chips with flowers), Projekt
// row (opens the project picker), "Mehr anzeigen"; footer: "In den Fokus" / "Aus dem Fokus nehmen" for
// today, disabled with the limit hint when three other tasks are in focus (D.1). Full detent:
// description, subtasks (checkbox list, progress "2 von 5" in the section head, one-line input to add),
// reminders (D.5), Verlauf (A.3: angelegt / zuletzt geändert / erledigt from createdAt, updatedAt,
// completedAt; no extra storage, PO decision 13.10.2026).
// Header: ⋯ opens a small menu sheet (A.3 "⋯ ⇡") with "Löschen" (destructive dialog, undo toast).
//
// Details of this implementation:
// - The sheet opens once the task is loaded; an unknown id closes it unopened (the router then goes back).
//   A task that disappears while the sheet is open (deleted elsewhere) closes it.
// - Live updates (task$, areas$, today's focus) patch the fields in place; a field that has focus is
//   never overwritten, so typing is not disturbed.
// - Text fields save on change (blur/Enter); pending edits are flushed again when the sheet closes.
// - "Mehr anzeigen" is the keyboard/tap path to the full detent (D7); dragging up works as well.
// - Wiederholung presets: Keine, Täglich, Werktags, Wöchentlich (due day's weekday), Monatlich (due day
//   of the month), N Tage nach Abschluss (1–365). A schedule preset on a task without date sets the
//   due date to today; the anchor follows the due day (repo/tasks). Rules from elsewhere (e.g. an
//   import) show as an extra chip and stay unless another preset is chosen.
// - Completing a recurring task: toast "Erledigt · nächste am {date}" with Rückgängig (reopenTask also
//   takes the untouched follow-up back).
// - Subtasks (one level, never recurring): Enter in the input adds one and keeps focus for the next;
//   checking uses completeTask/reopenTask; × removes with toast + Rückgängig. A subtask opened by its
//   own route shows neither the Wiederholung row nor the subtasks section.
// - Status (Phase 3): the chips and the checkbox show the same state. Erledigt goes through completeTask
//   (follow-up of a recurring task, toast with Rückgängig), leaving Erledigt through reopenTask, In Arbeit
//   / Offen otherwise through updateTask. Status writes run one after another; while they run, the
//   chips and the checkbox show the last choice instead of the intermediate states.
// - Projekt (Phase 3): the row opens a small sheet with "Kein Projekt" and the active projects of the
//   task's area (radio chips; the current project is listed as well when it is archived), plus a name
//   field "Neues Projekt" (Enter or the folder button creates it in the task's area and assigns it;
//   "Übernehmen" with a typed name does the same). Changing the area clears a project of another area;
//   repo/tasks updateTask passes area and project on to the subtasks. A subtask follows its parent:
//   its project row is disabled with a hint.
// - Linked notes: [Ext].
// - Shared helpers for the habit sheets: openActionMenu() and syncAreaChips().
import { liveQuery } from 'dexie';
import '../../components/ol-button.js';
import '../../components/ol-checkbox.js';
import '../../components/ol-chip.js';
import '../../components/ol-icon-button.js';
import '../../components/ol-input.js';
import '../../components/ol-segmented.js';
import type { OlButton } from '../../components/ol-button.js';
import type { CheckboxChange, OlCheckbox } from '../../components/ol-checkbox.js';
import type { ChipChange, OlChip } from '../../components/ol-chip.js';
import { confirmDialog } from '../../components/ol-dialog.js';
import type { OlInput } from '../../components/ol-input.js';
import type { OlSegmented, SegmentedChange } from '../../components/ol-segmented.js';
import { createSheet, type OlSheet } from '../../components/ol-sheet.js';
import { showToast } from '../../components/ol-toast.js';
import { fmt, t, weekdayShort } from '../../i18n/de.js';
import {
  GENERIC_TINT, MAX_FOCUS, type Area, type Day, type Id, type ISO, type Note, type Project, type Recurrence, type Reminder, type Task,
} from '../../model.js';
import { getNotes } from '../../repo/notes.js';
import { areas$ } from '../../repo/areas.js';
import { addToFocus, FocusFullError, getFocus, removeFromFocus } from '../../repo/dayPlans.js';
import { getProfile } from '../../repo/profile.js';
import { allProjects$, createProject } from '../../repo/projects.js';
import {
  addReminder, completeTask, createSubtask, deleteTask, getTask, removeReminder, reopenTask, restoreTask, subtasks$,
  task$, updateTask, type CompleteResult,
} from '../../repo/tasks.js';
import { presetOf, presetRecurrence, type RecurrencePreset } from '../../services/recurrence.js';
import { ensureReminderPermission, fireTime } from '../../services/reminders.js';
import {
  dayOfIso, formatDayFull, formatDayShort, formatTime, isDay, isoAt, isoWeekday, onDayChange, timeOfIso, today,
} from '../../util/date.js';
import { emit, h, icon, render } from '../../util/dom.js';

interface Sub { unsubscribe(): void }

let uidSeq = 0;
const uid = (prefix: string): string => `${prefix}-${++uidSeq}`;

/** Logs a failed write and tells the user (t.toastError). */
export function failed(err: unknown): void {
  console.error(err);
  showToast(t.toastError);
}

function isFocusedIn(el: Element): boolean {
  const active = document.activeElement;
  return active !== null && active !== document.body && el.contains(active);
}

/** Writes a live value into an ol-input unless the user is editing it. */
function setIfIdle(input: OlInput, value: string): void {
  if (!isFocusedIn(input) && input.value !== value) input.value = value;
}

/** Lets an auto-growing ol-input re-measure its content (it was filled while hidden). */
function refit(input: OlInput): void {
  input.field?.dispatchEvent(new Event('input'));
}

function detailOf<T>(event: Event): T | null {
  return event instanceof CustomEvent ? (event.detail as T) : null;
}

// ---------------------------------------------------------------------------
// Shared helpers (also used by the habit sheets)

export interface MenuItem { label: string; icon: string; danger?: boolean; run: () => void }

/**
 * The ⋯ menu as a small sheet (A.3 "⋯ ⇡"): full-width buttons, Tab/Enter operable, Esc and Back close it.
 * Choosing an item closes the menu and runs the item right away (a following dialog or sheet stacks on it).
 */
export function openActionMenu(title: string, items: readonly MenuItem[]): OlSheet {
  const sheet = createSheet({ title, fit: true });
  render(
    sheet.bodyEl,
    h`<div class="ol-menu-sheet">${items.map((item, i) => h`<ol-button class="ol-menu-sheet__item" variant="${item.danger ? 'danger' : 'ghost'}" icon="${item.icon}" label="${item.label}" data-index="${i}"></ol-button>`)}</div>`,
  );
  let chosen = false;
  sheet.bodyEl.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('ol-button[data-index]') : null;
    const item = target ? items[Number(target.dataset['index'])] : undefined;
    if (!item || chosen) return;
    chosen = true;
    sheet.close('action');
    item.run();
  });
  sheet.open();
  return sheet;
}

const areaSignatures = new WeakMap<HTMLElement, string>();

/**
 * Fills a radiogroup with one radio chip per active area (plus the selected one when it is archived),
 * optionally led by "Ohne Bereich" (value ''). Chips are rebuilt only when the areas change; focus stays
 * on the chip with the same value.
 */
export function syncAreaChips(group: HTMLElement, areas: readonly Area[], selected: string, withNone: boolean): void {
  const options = [
    ...(withNone ? [{ value: '', label: t.noArea, flower: 'generic', tint: GENERIC_TINT }] : []),
    ...areas
      .filter((a) => a.archived === 0 || a.id === selected)
      .map((a) => ({ value: a.id, label: a.name, flower: a.flower, tint: a.tint })),
  ];
  const signature = JSON.stringify(options);
  if (areaSignatures.get(group) !== signature) {
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && group.contains(active) ? active.closest<OlChip>('ol-chip')?.value ?? null : null;
    render(
      group,
      h`${options.map((o) => h`<ol-chip kind="radio" value="${o.value}" label="${o.label}" flower="${o.flower}" tint="${o.tint}"></ol-chip>`)}`,
    );
    areaSignatures.set(group, signature);
    if (focused !== null) {
      const chips = [...group.querySelectorAll<OlChip>('ol-chip')];
      (chips.find((c) => c.value === focused) ?? chips[0])?.focus();
    }
  }
  for (const chip of group.querySelectorAll<OlChip>('ol-chip')) {
    if (chip.selected !== (chip.value === selected)) chip.selected = chip.value === selected;
  }
}

// ---------------------------------------------------------------------------
// Wiederholung

/**
 * The rule as text ("Keine Wiederholung", "Täglich", "Werktags", "Wöchentlich am Mo", "Monatlich am
 * 15.", "3 Tage nach Abschluss"); `anchor` names the weekday of a weekly rule without weekdays.
 */
export function recurrenceText(rec: Recurrence | undefined, anchor?: Day): string {
  if (!rec) return t.recurrenceNone;
  switch (rec.kind) {
    case 'daily':
      return rec.interval > 1 ? fmt(t.recurrenceEveryNDays, { n: rec.interval }) : t.recurrenceDaily;
    case 'weekly': {
      if (presetOf(rec) === 'weekdays') return t.recurrenceWeekdays;
      const list = [...new Set(rec.weekdays)].sort((a, b) => a - b);
      if (list.length === 0 && anchor) list.push(isoWeekday(anchor));
      const days = list.map((d) => weekdayShort(d)).join(', ');
      return rec.interval > 1 ? fmt(t.recurrenceEveryNWeeks, { n: rec.interval, days }) : fmt(t.recurrenceWeekly, { days });
    }
    case 'monthly':
      if (rec.day === 'last') {
        return rec.interval > 1 ? fmt(t.recurrenceEveryNMonthsLast, { n: rec.interval }) : t.recurrenceMonthlyLast;
      }
      return rec.interval > 1
        ? fmt(t.recurrenceEveryNMonths, { n: rec.interval, day: rec.day })
        : fmt(t.recurrenceMonthly, { day: rec.day });
    case 'afterCompletion':
      return rec.days === 1 ? t.recurrenceAfterOneDay : fmt(t.recurrenceAfterDays, { n: rec.days });
    case 'timesPerWeek':
      return t.recurrenceNone;
  }
}

/** "Erledigt" or, for a recurring task, "Erledigt · nächste am 20.10.". */
export function doneMessage(result: CompleteResult): string {
  const day = result.followUp?.dueDay;
  return day ? fmt(t.toastDoneNext, { date: formatDayShort(day) }) : t.toastDone;
}

const SCHEDULE_PRESETS: ReadonlySet<string> = new Set<RecurrencePreset>(['daily', 'weekdays', 'weekly', 'monthly']);

/**
 * Small sheet with the Wiederholung presets (radio chips) and, for "Tage nach Abschluss", the number of
 * days (1–365). "Übernehmen" (or Enter in the number field) closes it and passes the patch to `apply`;
 * nothing is applied when the selection did not change.
 */
function openRecurrenceSheet(task: Task, apply: (patch: Partial<Task>) => void): OlSheet {
  const sheet = createSheet({ title: t.recurrenceTitle, fit: true });
  const day = task.dueDay ?? today();
  const current = presetOf(task.recurrence);
  const currentText = recurrenceText(task.recurrence, task.recurrenceAnchor ?? task.dueDay);
  // A weekly/monthly rule on another day than the due day is not what the preset would write now.
  const own = current === 'custom' || ((current === 'weekly' || current === 'monthly')
    && recurrenceText(presetRecurrence(current, day)) !== currentText);
  const selected = own ? 'custom' : current;
  const options: Array<{ value: RecurrencePreset | 'custom'; label: string }> = [
    ...(own ? [{ value: 'custom' as const, label: currentText }] : []),
    { value: 'none', label: t.recurrenceChipNone },
    { value: 'daily', label: t.recurrenceDaily },
    { value: 'weekdays', label: t.recurrenceWeekdays },
    { value: 'weekly', label: recurrenceText(presetRecurrence('weekly', day)) },
    { value: 'monthly', label: recurrenceText(presetRecurrence('monthly', day)) },
    { value: 'afterCompletion', label: t.recurrenceChipAfter },
  ];
  const days = task.recurrence?.kind === 'afterCompletion' ? task.recurrence.days : 1;
  render(
    sheet.bodyEl,
    h`<div class="ol-task-repeat">
  <div class="ol-task-repeat__options" role="radiogroup" aria-label="${t.recurrenceOptionsAria}">${options.map((o) => h`<ol-chip kind="radio" value="${o.value}" label="${o.label}"></ol-chip>`)}</div>
  <ol-input class="ol-task-repeat__days" type="number" inputmode="numeric" min="1" max="365" step="1" label="${t.recurrenceDaysLabel}" value="${String(days)}" hidden></ol-input>
  <p class="ol-task-repeat__hint ol-body-s" hidden>${t.recurrenceStartsToday}</p>
</div>`,
  );
  render(sheet.footerEl, h`<ol-button class="ol-task-repeat__apply" label="${t.recurrenceApply}"></ol-button>`);
  const group = sheet.bodyEl.querySelector<HTMLElement>('.ol-task-repeat__options');
  const daysInput = sheet.bodyEl.querySelector<OlInput>('.ol-task-repeat__days');
  const hint = sheet.bodyEl.querySelector<HTMLElement>('.ol-task-repeat__hint');
  if (!group || !daysInput || !hint) throw new Error('recurrence sheet: missing elements');
  const chips = [...group.querySelectorAll<OlChip>('ol-chip')];
  for (const chip of chips) chip.selected = chip.value === selected;
  const value = (): string => chips.find((c) => c.selected)?.value ?? selected;
  const sync = (): void => {
    const v = value();
    daysInput.hidden = v !== 'afterCompletion';
    hint.hidden = task.dueDay !== undefined || !SCHEDULE_PRESETS.has(v);
  };
  const readDays = (): number | null => {
    const raw = daysInput.value.trim();
    const n = Number(raw);
    if (raw === '' || !Number.isInteger(n) || n < 1 || n > 365) {
      daysInput.setAttribute('error', t.recurrenceDaysInvalid);
      daysInput.focusInput();
      return null;
    }
    return n;
  };
  let done = false;
  const submit = (): void => {
    if (done) return;
    const v = value();
    if (v === 'custom') {
      done = true;
      sheet.close('action');
      return;
    }
    const preset = v as RecurrencePreset;
    const n = preset === 'afterCompletion' ? readDays() : 1;
    if (n === null) return;
    done = true;
    sheet.close('action');
    const rec = presetRecurrence(preset, day, n);
    if (JSON.stringify(rec) === JSON.stringify(task.recurrence)) return;
    const patch: Partial<Task> = { recurrence: rec };
    if (!task.dueDay && SCHEDULE_PRESETS.has(preset)) {
      patch.dueAt = isoAt(day);
      patch.dueHasTime = 0;
    }
    apply(patch);
  };
  group.addEventListener('ol-change', sync);
  daysInput.addEventListener('input', () => daysInput.removeAttribute('error'));
  daysInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    submit();
  });
  sheet.footerEl.querySelector('ol-button')?.addEventListener('click', submit);
  sync();
  sheet.open();
  return sheet;
}

// ---------------------------------------------------------------------------
// Projekt

/** The project's name; archived projects say so. */
function projectLabel(project: Project): string {
  return project.status === 'archived' ? fmt(t.taskProjectArchived, { name: project.name }) : project.name;
}

/**
 * Small sheet to pick the task's project: "Kein Projekt" + the active projects of the task's area
 * (radio chips), and a name field to create a new project in that area. `apply` gets the chosen id
 * (null = no project); it is not called when nothing changed.
 */
function openProjectSheet(task: Task, projects: readonly Project[], apply: (projectId: Id | null) => void): OlSheet {
  const sheet = createSheet({ title: t.taskProjectPickerTitle, fit: true });
  const current = task.projectId ?? '';
  const inArea = projects.filter((p) => p.areaId === task.areaId && p.status === 'active');
  const own = current ? projects.find((p) => p.id === current) : undefined;
  const listed = own && !inArea.includes(own) ? [...inArea, own] : inArea;
  const options = [{ value: '', label: t.noProject }, ...listed.map((p) => ({ value: p.id, label: projectLabel(p) }))];
  render(
    sheet.bodyEl,
    h`<div class="ol-task-project">
  <div class="ol-task-project__options" role="radiogroup" aria-label="${t.taskProjectOptionsAria}">${options.map((o) => h`<ol-chip kind="radio" value="${o.value}" label="${o.label}" icon="${o.value ? 'folder' : ''}"></ol-chip>`)}</div>
  <p class="ol-task-project__empty ol-body-s" ${inArea.length > 0 ? 'hidden' : ''}>${t.taskProjectNoneInArea}</p>
  <div class="ol-task-project__new">
    <ol-input class="ol-task-project__name" label="${t.taskProjectNewLabel}" autocomplete="off" maxlength="200"></ol-input>
    <ol-icon-button class="ol-task-project__create" icon="folder-plus" label="${t.taskProjectCreateAria}"></ol-icon-button>
  </div>
</div>`,
  );
  render(sheet.footerEl, h`<ol-button class="ol-task-project__apply" label="${t.taskProjectApply}"></ol-button>`);
  const group = sheet.bodyEl.querySelector<HTMLElement>('.ol-task-project__options');
  const nameInput = sheet.bodyEl.querySelector<OlInput>('.ol-task-project__name');
  const createBtn = sheet.bodyEl.querySelector<HTMLElement>('.ol-task-project__create');
  if (!group || !nameInput || !createBtn) throw new Error('project sheet: missing elements');
  nameInput.field?.setAttribute('enterkeyhint', 'done');
  const chips = [...group.querySelectorAll<OlChip>('ol-chip')];
  for (const chip of chips) chip.selected = chip.value === current;
  let done = false;
  const typedName = (): string => nameInput.value.replace(/\s+/gu, ' ').trim();
  const create = (): void => {
    if (done) return;
    const name = typedName();
    if (!name) {
      nameInput.setAttribute('error', t.taskProjectNameRequired);
      nameInput.focusInput();
      return;
    }
    done = true;
    createProject({ areaId: task.areaId, name }).then((project) => {
      sheet.close('action');
      apply(project.id);
      showToast(fmt(t.toastTaskProjectCreated, { name: project.name }));
    }, (err: unknown) => {
      done = false;
      failed(err);
    });
  };
  const submit = (): void => {
    if (done) return;
    // A typed name is a clear intent: it wins over the chip selection.
    if (typedName()) {
      create();
      return;
    }
    done = true;
    sheet.close('action');
    const value = chips.find((c) => c.selected)?.value ?? current;
    if (value !== current) apply(value || null);
  };
  nameInput.addEventListener('input', () => nameInput.removeAttribute('error'));
  nameInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    create();
  });
  createBtn.addEventListener('click', create);
  sheet.footerEl.querySelector('ol-button')?.addEventListener('click', submit);
  sheet.open();
  return sheet;
}

// ---------------------------------------------------------------------------
// Task sheet

class TaskSheet {
  private task: Task | null = null;
  private areas: Area[] = [];
  private focusIds: Id[] = [];
  /** A focus add/remove is being written: further clicks are ignored until it settles. */
  private focusBusy = false;
  private leadMinutes = 10;
  private filled = false;
  private gone = false;
  private addingReminder = false;
  private removing = new Set<Id>();
  private reminderSig: string | null = null;
  private subtasks: Task[] = [];
  private subtaskSig: string | null = null;
  /** Subtask writes run one after another, so quickly added ones keep their order. */
  private subtaskQueue: Promise<unknown> = Promise.resolve();
  private subtaskBusy = new Set<Id>();
  private projects: Project[] = [];
  /** Status writes run one after another; `wantedStatus` is the last choice while some are pending. */
  private statusQueue: Promise<unknown> = Promise.resolve();
  private statusPending = 0;
  private wantedStatus: Task['status'] = 'open';
  private subs: Sub[] = [];
  private focusSub: Sub | null = null;
  private stopDay: (() => void) | null = null;

  private root!: HTMLElement;
  private check!: OlCheckbox;
  private title!: OlInput;
  private date!: OlInput;
  private time!: OlInput;
  private repeatBtn!: HTMLButtonElement;
  private repeatValue!: HTMLElement;
  private important!: OlChip;
  private urgent!: OlChip;
  private statusGroup!: HTMLElement;
  private areaGroup!: HTMLElement;
  private projectBtn!: HTMLButtonElement;
  private projectValue!: HTMLElement;
  private projectHint!: HTMLElement;
  private historyCreated!: HTMLElement;
  private historyUpdated!: HTMLElement;
  private historyCompletedRow!: HTMLElement;
  private historyCompleted!: HTMLElement;
  private moreBtn!: OlButton;
  private more!: HTMLElement;
  private description!: OlInput;
  private subtaskSection!: HTMLElement;
  private subtaskProgress!: HTMLElement;
  private subtaskList!: HTMLElement;
  private subtaskInput!: OlInput;
  private subtaskAdd!: HTMLElement;
  private reminderList!: HTMLElement;
  private mode!: OlSegmented;
  private offset!: OlInput;
  private needsDue!: HTMLElement;
  private at!: OlInput;
  private addBtn!: OlButton;
  private focusBtn!: OlButton;
  private focusHint!: HTMLElement;

  constructor(private readonly sheet: OlSheet, private readonly taskId: Id) {}

  async start(): Promise<void> {
    let task: Task | undefined;
    try {
      task = await getTask(this.taskId);
      this.leadMinutes = (await getProfile()).settings.reminderLeadMinutes;
    } catch (err) {
      console.error(err);
    }
    // The route may have been left while loading (the sheet is then already gone).
    if (!this.sheet.isConnected) return;
    if (!task) {
      this.sheet.close('action');
      return;
    }
    this.build();
    // Filled after open(): auto-growing fields can only measure their content while the dialog is shown.
    this.sheet.open();
    this.update(task);
    this.subscribe();
  }

  // --- Building ---

  private build(): void {
    const sheet = this.sheet;
    const areaLabel = uid('task-area');
    const statusLabel = uid('task-status');
    const historyLabel = uid('task-history');
    const projectHintId = uid('task-project-hint');
    const remindersLabel = uid('task-reminders');
    const subtasksLabel = uid('task-subtasks');
    const moreId = uid('task-more');
    const hintId = uid('task-focus-hint');
    render(sheet.headerActionsEl, h`<ol-icon-button icon="ellipsis" label="${t.actionMore}"></ol-icon-button>`);
    render(
      sheet.bodyEl,
      h`<div class="ol-task-sheet">
  <div class="ol-task-sheet__head">
    <ol-checkbox class="ol-task-sheet__check" label="${t.taskCheckAria}"></ol-checkbox>
    <ol-input class="ol-task-sheet__title" multiline rows-max="3" autocomplete="off"></ol-input>
  </div>
  <div class="ol-task-sheet__row">
    <ol-input class="ol-task-sheet__date" type="date" label="${t.fieldDueDate}"></ol-input>
    <ol-input class="ol-task-sheet__time" type="time" label="${t.fieldDueTime}"></ol-input>
  </div>
  <button type="button" class="ol-task-sheet__picker ol-task-sheet__repeat" aria-haspopup="dialog">
    <span class="ol-task-sheet__picker-icon">${icon('repeat', 20)}</span>
    <span class="ol-task-sheet__picker-text">
      <span class="ol-task-sheet__label">${t.recurrenceTitle}</span>
      <span class="ol-task-sheet__picker-value ol-task-sheet__repeat-value"></span>
    </span>
    <span class="ol-task-sheet__picker-chevron">${icon('chevron-right', 20)}</span>
  </button>
  <div class="ol-task-sheet__chips">
    <ol-chip class="ol-task-sheet__important" icon="flag" label="${t.flagImportant}" value="important"></ol-chip>
    <ol-chip class="ol-task-sheet__urgent" icon="alarm-clock" label="${t.flagUrgent}" value="urgent"></ol-chip>
  </div>
  <div class="ol-task-sheet__field">
    <p class="ol-task-sheet__label" id="${statusLabel}">${t.fieldStatus}</p>
    <div class="ol-task-sheet__status" role="radiogroup" aria-labelledby="${statusLabel}">
      <ol-chip kind="radio" value="open" label="${t.taskStatusOpen}"></ol-chip>
      <ol-chip kind="radio" value="doing" label="${t.taskStatusDoing}"></ol-chip>
      <ol-chip kind="radio" value="done" label="${t.taskStatusDone}"></ol-chip>
    </div>
  </div>
  <div class="ol-task-sheet__field">
    <p class="ol-task-sheet__label" id="${areaLabel}">${t.fieldArea}</p>
    <div class="ol-task-sheet__areas" role="radiogroup" aria-labelledby="${areaLabel}"></div>
  </div>
  <div class="ol-task-sheet__field">
    <button type="button" class="ol-task-sheet__picker ol-task-sheet__project" aria-haspopup="dialog">
      <span class="ol-task-sheet__picker-icon">${icon('folder', 20)}</span>
      <span class="ol-task-sheet__picker-text">
        <span class="ol-task-sheet__label">${t.fieldProject}</span>
        <span class="ol-task-sheet__picker-value ol-task-sheet__project-value">${t.noProject}</span>
      </span>
      <span class="ol-task-sheet__picker-chevron">${icon('chevron-right', 20)}</span>
    </button>
    <p class="ol-task-sheet__project-hint ol-body-s" id="${projectHintId}" hidden>${t.taskProjectSubtaskHint}</p>
  </div>
  <ol-button class="ol-task-sheet__more-btn" variant="ghost" icon="chevron-down" label="${t.actionShowMore}"></ol-button>
  <div class="ol-task-sheet__more" id="${moreId}" hidden>
    <ol-input class="ol-task-sheet__description" label="${t.fieldDescription}" multiline rows-max="8"></ol-input>
    <section class="ol-task-sheet__section ol-task-sheet__subtasks" aria-labelledby="${subtasksLabel}">
      <div class="ol-task-sheet__section-head">
        <h3 class="ol-label" id="${subtasksLabel}">${t.sectionSubtasksTitle}</h3>
        <span class="ol-task-sheet__progress ol-body-s ol-num" hidden></span>
      </div>
      <ul class="ol-task-sheet__subtask-list" hidden></ul>
      <div class="ol-task-sheet__subtask-add">
        <ol-input class="ol-task-sheet__subtask-input" placeholder="${t.subtaskAddLabel}" autocomplete="off" maxlength="500"></ol-input>
        <ol-icon-button class="ol-task-sheet__subtask-add-btn" icon="plus" label="${t.subtaskAddLabel}"></ol-icon-button>
      </div>
    </section>
    <section class="ol-task-sheet__section" aria-labelledby="${remindersLabel}">
      <h3 class="ol-label" id="${remindersLabel}">${t.sectionReminders}</h3>
      <ul class="ol-task-sheet__reminders" hidden></ul>
      <div class="ol-task-sheet__reminder-form">
        <ol-segmented class="ol-task-sheet__mode" label="${t.reminderModeAria}" value="relative">
          <button type="button" data-value="relative">${t.reminderModeRelative}</button>
          <button type="button" data-value="absolute">${t.reminderModeAbsolute}</button>
        </ol-segmented>
        <ol-input class="ol-task-sheet__offset" type="number" inputmode="numeric" min="0" step="1" label="${t.reminderOffsetLabel}"></ol-input>
        <p class="ol-task-sheet__needs-due ol-body-s" hidden>${t.reminderNeedsDue}</p>
        <ol-input class="ol-task-sheet__at" type="datetime-local" label="${t.reminderAtLabel}" hidden></ol-input>
        <ol-button class="ol-task-sheet__add" variant="tonal" icon="bell" label="${t.reminderAdd}"></ol-button>
      </div>
    </section>
    <section class="ol-task-sheet__section ol-task-sheet__linked" aria-labelledby="${historyLabel}-notes" hidden>
      <h3 class="ol-label" id="${historyLabel}-notes">${t.taskLinkedNotes}</h3>
      <ul class="ol-task-sheet__linked-list"></ul>
    </section>
    <section class="ol-task-sheet__section" aria-labelledby="${historyLabel}">
      <h3 class="ol-label" id="${historyLabel}">${t.sectionHistory}</h3>
      <dl class="ol-task-sheet__history ol-body-s">
        <div class="ol-task-sheet__history-row"><dt>${t.historyCreated}</dt><dd class="ol-task-sheet__history-created ol-num"></dd></div>
        <div class="ol-task-sheet__history-row"><dt>${t.historyUpdated}</dt><dd class="ol-task-sheet__history-updated ol-num"></dd></div>
        <div class="ol-task-sheet__history-row ol-task-sheet__history-completed-row" hidden><dt>${t.historyCompleted}</dt><dd class="ol-task-sheet__history-completed ol-num"></dd></div>
      </dl>
    </section>
  </div>
</div>`,
    );
    render(
      sheet.footerEl,
      h`<div class="ol-task-sheet__focus">
  <p class="ol-task-sheet__focus-hint ol-body-s" id="${hintId}" hidden>${t.focusLimitHint}</p>
  <ol-button class="ol-task-sheet__focus-btn" variant="tonal" label="${t.actionAddToFocus}"></ol-button>
</div>`,
    );

    const body = sheet.bodyEl;
    const q = <T extends Element>(root: ParentNode, selector: string): T => {
      const el = root.querySelector<T>(selector);
      if (!el) throw new Error(`task sheet: missing ${selector}`);
      return el;
    };
    this.root = q<HTMLElement>(body, '.ol-task-sheet');
    this.check = q<OlCheckbox>(body, '.ol-task-sheet__check');
    this.title = q<OlInput>(body, '.ol-task-sheet__title');
    this.date = q<OlInput>(body, '.ol-task-sheet__date');
    this.time = q<OlInput>(body, '.ol-task-sheet__time');
    this.repeatBtn = q<HTMLButtonElement>(body, '.ol-task-sheet__repeat');
    this.repeatValue = q<HTMLElement>(body, '.ol-task-sheet__repeat-value');
    this.important = q<OlChip>(body, '.ol-task-sheet__important');
    this.urgent = q<OlChip>(body, '.ol-task-sheet__urgent');
    this.statusGroup = q<HTMLElement>(body, '.ol-task-sheet__status');
    this.areaGroup = q<HTMLElement>(body, '.ol-task-sheet__areas');
    this.projectBtn = q<HTMLButtonElement>(body, '.ol-task-sheet__project');
    this.projectValue = q<HTMLElement>(body, '.ol-task-sheet__project-value');
    this.projectHint = q<HTMLElement>(body, '.ol-task-sheet__project-hint');
    this.historyCreated = q<HTMLElement>(body, '.ol-task-sheet__history-created');
    this.historyUpdated = q<HTMLElement>(body, '.ol-task-sheet__history-updated');
    this.historyCompletedRow = q<HTMLElement>(body, '.ol-task-sheet__history-completed-row');
    this.historyCompleted = q<HTMLElement>(body, '.ol-task-sheet__history-completed');
    this.moreBtn = q<OlButton>(body, '.ol-task-sheet__more-btn');
    this.more = q<HTMLElement>(body, '.ol-task-sheet__more');
    this.description = q<OlInput>(body, '.ol-task-sheet__description');
    this.subtaskSection = q<HTMLElement>(body, '.ol-task-sheet__subtasks');
    this.subtaskProgress = q<HTMLElement>(body, '.ol-task-sheet__progress');
    this.subtaskList = q<HTMLElement>(body, '.ol-task-sheet__subtask-list');
    this.subtaskInput = q<OlInput>(body, '.ol-task-sheet__subtask-input');
    this.subtaskAdd = q<HTMLElement>(body, '.ol-task-sheet__subtask-add-btn');
    this.reminderList = q<HTMLElement>(body, '.ol-task-sheet__reminders');
    this.mode = q<OlSegmented>(body, '.ol-task-sheet__mode');
    this.offset = q<OlInput>(body, '.ol-task-sheet__offset');
    this.needsDue = q<HTMLElement>(body, '.ol-task-sheet__needs-due');
    this.at = q<OlInput>(body, '.ol-task-sheet__at');
    this.addBtn = q<OlButton>(body, '.ol-task-sheet__add');
    this.focusBtn = q<OlButton>(sheet.footerEl, '.ol-task-sheet__focus-btn');
    this.focusHint = q<HTMLElement>(sheet.footerEl, '.ol-task-sheet__focus-hint');

    // The title field has no visible label (A.3 wireframe: checkbox and title on one line). It wraps
    // long titles (up to three lines) but stays one paragraph: Enter commits, line breaks become spaces.
    this.title.field?.setAttribute('aria-label', t.taskTitleLabel);
    this.title.field?.setAttribute('enterkeyhint', 'done');
    this.moreBtn.button?.setAttribute('aria-controls', moreId);
    this.moreBtn.button?.setAttribute('aria-expanded', 'false');
    this.focusBtn.button?.setAttribute('aria-describedby', hintId);
    this.projectBtn.setAttribute('aria-describedby', projectHintId);
    this.subtaskInput.field?.setAttribute('aria-label', t.subtaskAddLabel);
    this.subtaskInput.field?.setAttribute('enterkeyhint', 'enter');
    this.offset.value = String(this.leadMinutes);

    sheet.headerActionsEl.querySelector('ol-icon-button')?.addEventListener('click', this.onMore);
    this.check.addEventListener('ol-change', this.onCheck);
    this.title.addEventListener('ol-change', this.onTitleChange);
    this.title.addEventListener('input', this.onTitleInput);
    this.title.addEventListener('keydown', this.onTitleKeyDown);
    this.title.addEventListener('focusout', this.onTitleBlur);
    this.date.addEventListener('ol-change', this.onDueChange);
    this.time.addEventListener('ol-change', this.onDueChange);
    this.repeatBtn.addEventListener('click', this.onRepeat);
    this.important.addEventListener('ol-change', this.onFlagChange);
    this.urgent.addEventListener('ol-change', this.onFlagChange);
    this.statusGroup.addEventListener('ol-change', this.onStatusChange);
    this.areaGroup.addEventListener('ol-change', this.onAreaChange);
    this.projectBtn.addEventListener('click', this.onProject);
    this.moreBtn.addEventListener('click', this.onToggleDetent);
    this.description.addEventListener('ol-change', this.onDescriptionChange);
    this.subtaskList.addEventListener('ol-change', this.onSubtaskCheck);
    this.subtaskList.addEventListener('click', this.onSubtaskListClick);
    this.subtaskInput.addEventListener('keydown', this.onSubtaskKeyDown);
    this.subtaskAdd.addEventListener('click', this.onSubtaskAdd);
    this.reminderList.addEventListener('click', this.onReminderListClick);
    this.mode.addEventListener('ol-change', this.onModeChange);
    this.offset.addEventListener('input', () => this.offset.removeAttribute('error'));
    this.at.addEventListener('input', () => this.at.removeAttribute('error'));
    this.offset.addEventListener('keydown', this.onFormKeyDown);
    this.at.addEventListener('keydown', this.onFormKeyDown);
    this.addBtn.addEventListener('click', this.onAddReminder);
    this.focusBtn.addEventListener('click', this.onFocusClick);
    sheet.addEventListener('ol-detent-change', this.onDetentChange);
    sheet.addEventListener('ol-dismiss', (event) => {
      if (event.target !== sheet) return;
      this.flush();
      this.cleanup();
    });
    void sheet.closed.then(() => this.cleanup());
    this.syncMore();
  }

  private subscribe(): void {
    this.subs.push(
      task$(this.taskId).subscribe({
        next: (task) => {
          if (task) this.update(task);
          else if (!this.gone) {
            this.gone = true;
            this.sheet.close('action');
          }
        },
        error: (err: unknown) => console.error(err),
      }),
      subtasks$(this.taskId).subscribe({
        next: (list) => this.renderSubtasks(list),
        error: (err: unknown) => console.error(err),
      }),
      areas$(true).subscribe({
        next: (areas) => {
          this.areas = areas;
          if (this.task) syncAreaChips(this.areaGroup, areas, this.task.areaId, false);
        },
        error: (err: unknown) => console.error(err),
      }),
      allProjects$(true).subscribe({
        next: (projects) => {
          this.projects = projects;
          if (this.task) this.syncProject(this.task);
        },
        error: (err: unknown) => console.error(err),
      }),
    );
    this.subscribeFocus();
    this.stopDay = onDayChange(() => this.subscribeFocus());
  }

  /** Today's focus ids that still exist (addToFocus drops deleted ones before counting). */
  private subscribeFocus(): void {
    this.focusSub?.unsubscribe();
    const day = today();
    this.focusSub = liveQuery(async () => {
      const ids = await getFocus(day);
      const rows = await Promise.all(ids.map((id) => getTask(id)));
      return ids.filter((_, i) => rows[i] !== undefined);
    }).subscribe({
      next: (ids) => {
        this.focusIds = ids;
        this.syncFocus();
      },
      error: (err: unknown) => console.error(err),
    });
  }

  private cleanup(): void {
    for (const sub of this.subs) sub.unsubscribe();
    this.subs = [];
    this.focusSub?.unsubscribe();
    this.focusSub = null;
    this.stopDay?.();
    this.stopDay = null;
  }

  // --- Rendering ---

  private update(task: Task): void {
    this.task = task;
    this.syncStatus(this.statusPending > 0 ? this.wantedStatus : task.status);
    setIfIdle(this.title, task.title);

    const day = task.dueDay ?? '';
    const timed = task.dueHasTime === 1 && task.dueAt !== undefined;
    setIfIdle(this.date, day);
    setIfIdle(this.time, timed && task.dueAt ? timeOfIso(task.dueAt) : '');
    this.time.toggleAttribute('disabled', day === '');
    // Subtasks never recur and have no subtasks of their own.
    const isSubtask = task.parentId !== null && task.parentId !== undefined;
    this.repeatBtn.hidden = isSubtask;
    this.subtaskSection.hidden = isSubtask;
    this.repeatValue.textContent = recurrenceText(task.recurrence, task.recurrenceAnchor ?? task.dueDay);

    if (this.important.selected !== (task.important === 1)) this.important.selected = task.important === 1;
    if (this.urgent.selected !== (task.urgent === 1)) this.urgent.selected = task.urgent === 1;
    syncAreaChips(this.areaGroup, this.areas, task.areaId, false);
    this.syncProject(task);
    setIfIdle(this.description, task.description ?? '');
    this.syncHistory(task);

    if (!this.filled) {
      // First fill: relative reminders need a due time, so the form starts with the mode that works.
      this.filled = true;
      this.mode.value = timed ? 'relative' : 'absolute';
      if (timed && task.dueAt) this.at.value = `${day}T${timeOfIso(task.dueAt)}`;
    }
    this.syncReminderForm();
    this.renderReminders(task);
  }

  /** Checkbox, status chips and the done look for one status. */
  private syncStatus(status: Task['status']): void {
    const done = status === 'done';
    if (this.check.checked !== done) this.check.checked = done;
    this.root.toggleAttribute('data-done', done);
    for (const chip of this.statusGroup.querySelectorAll<OlChip>('ol-chip')) {
      if (chip.selected !== (chip.value === status)) chip.selected = chip.value === status;
    }
  }

  private syncProject(task: Task): void {
    const project = task.projectId ? this.projects.find((p) => p.id === task.projectId) : undefined;
    this.projectValue.textContent = project ? projectLabel(project) : t.noProject;
    // A subtask follows its parent's project.
    const isSubtask = task.parentId !== null && task.parentId !== undefined;
    this.projectBtn.disabled = isSubtask;
    this.projectHint.hidden = !isSubtask;
  }

  private syncHistory(task: Task): void {
    const stamp = (iso: ISO): string => fmt(t.historyStamp, { date: formatDayFull(dayOfIso(iso)), time: formatTime(iso) });
    this.historyCreated.textContent = stamp(task.createdAt);
    this.historyUpdated.textContent = stamp(task.updatedAt);
    const completed = task.status === 'done' && task.completedAt ? task.completedAt : undefined;
    this.historyCompletedRow.hidden = completed === undefined;
    this.historyCompleted.textContent = completed ? stamp(completed) : '';
    void this.syncLinkedNotes(task);
  }

  /** W5: notes this task was created from ("Aufgabe aus Zeile"); each opens the note in WISSEN. */
  private async syncLinkedNotes(task: Task): Promise<void> {
    const section = this.sheet.bodyEl.querySelector<HTMLElement>('.ol-task-sheet__linked');
    const list = section?.querySelector<HTMLElement>('.ol-task-sheet__linked-list');
    if (!section || !list) return;
    const ids = task.linkedNoteIds ?? [];
    const key = ids.join(',');
    if (list.dataset['key'] === key) return;
    list.dataset['key'] = key;
    const notes = ids.length ? (await getNotes(ids)).filter((n): n is Note => n !== undefined) : [];
    section.hidden = notes.length === 0;
    render(list, h`${notes.map((n) => h`<li><button type="button" class="ol-task-sheet__linked-note" data-note="${n.id}">${icon('notebook-pen', 20)}<span>${n.title || t.wissenUntitled}</span></button></li>`)}`);
    if (!list.dataset['bound']) {
      list.dataset['bound'] = '1';
      list.addEventListener('click', (event) => {
        const btn = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-note]') : null;
        const id = btn?.dataset['note'];
        if (btn && id) emit(btn, 'ol-navigate', { path: `/wissen/n/${encodeURIComponent(id)}` });
      });
    }
  }

  private syncMore(): void {
    const full = this.sheet.detent === 'full';
    const reveal = full && this.more.hidden;
    // Focus inside the section that is about to be hidden moves to the toggle button.
    const hadFocus = !full && isFocusedIn(this.more);
    this.more.hidden = !full;
    if (reveal) refit(this.description);
    this.moreBtn.setAttribute('label', full ? t.actionShowLess : t.actionShowMore);
    this.moreBtn.setAttribute('icon', full ? 'chevron-up' : 'chevron-down');
    this.moreBtn.button?.setAttribute('aria-expanded', String(full));
    if (hadFocus) this.moreBtn.focus();
  }

  private syncFocus(): void {
    const inFocus = this.focusIds.includes(this.taskId);
    const full = !inFocus && this.focusIds.length >= MAX_FOCUS;
    this.focusBtn.setAttribute('label', inFocus ? t.actionRemoveFromFocus : t.actionAddToFocus);
    this.focusBtn.toggleAttribute('disabled', full);
    this.focusHint.hidden = !full;
  }

  private timed(): boolean {
    return this.task?.dueHasTime === 1 && this.task.dueAt !== undefined;
  }

  private syncReminderForm(): void {
    const relative = this.mode.value !== 'absolute';
    const timed = this.timed();
    this.offset.hidden = !relative;
    this.offset.toggleAttribute('disabled', relative && !timed);
    this.needsDue.hidden = !relative || timed;
    this.at.hidden = relative;
    this.addBtn.toggleAttribute('disabled', relative && !timed);
  }

  private reminderText(reminder: Reminder): string {
    if (reminder.mode === 'relative') return fmt(t.reminderRelative, { n: reminder.offsetMinutes ?? 0 });
    const at = reminder.at ?? '';
    return at ? fmt(t.reminderAbsolute, { date: formatDayShort(dayOfIso(at)), time: formatTime(at) }) : '';
  }

  /** Active (not yet shown) reminders by fire time; rebuilt only when they change, focus kept. */
  private renderReminders(task: Task): void {
    const timeOf = (r: Reminder): number => {
      const iso = fireTime(task, r);
      return iso ? Date.parse(iso) : Number.POSITIVE_INFINITY;
    };
    const active = (task.reminders ?? []).filter((r) => !r.dismissedAt).sort((a, b) => timeOf(a) - timeOf(b));
    const items = active.map((r) => ({ id: r.id, text: this.reminderText(r) }));
    const signature = JSON.stringify(items);
    if (signature === this.reminderSig) return;
    this.reminderSig = signature;
    const list = this.reminderList;
    const activeEl = document.activeElement;
    const focusedId = activeEl instanceof HTMLElement && list.contains(activeEl)
      ? activeEl.closest<HTMLElement>('[data-reminder]')?.dataset['reminder'] ?? null
      : null;
    const before = focusedId ? [...list.querySelectorAll<HTMLElement>('[data-reminder]')].map((el) => el.dataset['reminder']) : [];
    // DOM ids come from the list position; reminder ids (possibly imported) stay in data-reminder only.
    const textId = (index: number): string => `${list.id || (list.id = uid('task-reminder-list'))}-r${index}`;
    render(
      list,
      h`${items.map((item, index) => h`<li class="ol-task-sheet__reminder">
  <span class="ol-task-sheet__reminder-icon">${icon('bell', 20)}</span>
  <span class="ol-task-sheet__reminder-text ol-num" id="${textId(index)}">${item.text}</span>
  <ol-icon-button icon="x" label="${t.reminderRemoveAria}" data-reminder="${item.id}" data-index="${String(index)}"></ol-icon-button>
</li>`)}`,
    );
    for (const btn of list.querySelectorAll<HTMLElement>('ol-icon-button[data-reminder]')) {
      btn.querySelector('button')?.setAttribute('aria-describedby', textId(Number(btn.dataset['index'])));
    }
    list.hidden = items.length === 0;
    if (focusedId === null) return;
    const buttons = [...list.querySelectorAll<HTMLElement>('ol-icon-button[data-reminder]')];
    const same = buttons.find((b) => b.dataset['reminder'] === focusedId);
    // The focused reminder was removed: the next one (or the add button) takes focus.
    const index = before.indexOf(focusedId);
    const next = same ?? buttons[Math.min(Math.max(index, 0), buttons.length - 1)];
    (next ?? this.addBtn).focus();
  }

  /**
   * Subtask rows: rebuilt only when ids or titles change (focus stays on the same row and control, or
   * moves to the next row / the input when its row went away); check states are patched in place.
   */
  private renderSubtasks(list: Task[]): void {
    this.subtasks = list;
    const done = list.filter((s) => s.status === 'done').length;
    this.subtaskProgress.hidden = list.length === 0;
    this.subtaskProgress.textContent = fmt(t.subtasksProgress, { done, total: list.length });
    const ul = this.subtaskList;
    const signature = JSON.stringify(list.map((s) => [s.id, s.title]));
    if (signature !== this.subtaskSig) {
      this.subtaskSig = signature;
      const active = document.activeElement;
      const focusedRow = active instanceof HTMLElement && ul.contains(active) ? active.closest<HTMLElement>('[data-subtask]') : null;
      const focusedId = focusedRow?.dataset['subtask'] ?? null;
      const focusedRole = active instanceof HTMLElement && active.closest('ol-icon-button') ? 'remove' : 'check';
      const before = [...ul.querySelectorAll<HTMLElement>('[data-subtask]')].map((el) => el.dataset['subtask']);
      const base = ul.id || (ul.id = uid('task-subtasks-list'));
      render(
        ul,
        h`${list.map((sub, index) => h`<li class="ol-task-sheet__subtask" data-subtask="${sub.id}">
  <ol-checkbox class="ol-task-sheet__subtask-check" label="${sub.title}"></ol-checkbox>
  <span class="ol-task-sheet__subtask-title" id="${`${base}-s${index}`}">${sub.title}</span>
  <ol-icon-button class="ol-task-sheet__subtask-remove" icon="x" label="${fmt(t.subtaskRemoveAria, { title: sub.title })}"></ol-icon-button>
</li>`)}`,
      );
      ul.hidden = list.length === 0;
      if (focusedId !== null) {
        const rows = [...ul.querySelectorAll<HTMLElement>('[data-subtask]')];
        const index = before.indexOf(focusedId);
        const row = rows.find((r) => r.dataset['subtask'] === focusedId) ?? rows[Math.min(Math.max(index, 0), rows.length - 1)];
        const target = row?.querySelector<HTMLElement>(focusedRole === 'remove' ? 'ol-icon-button' : 'ol-checkbox');
        if (target) target.focus();
        else this.subtaskInput.focusInput();
      }
    }
    for (const row of ul.querySelectorAll<HTMLElement>('[data-subtask]')) {
      const sub = list.find((s) => s.id === row.dataset['subtask']);
      if (!sub || this.subtaskBusy.has(sub.id)) continue;
      const checked = sub.status === 'done';
      const box = row.querySelector<OlCheckbox>('ol-checkbox');
      if (box && box.checked !== checked) box.checked = checked;
      row.toggleAttribute('data-done', checked);
    }
  }

  // --- Saving ---

  private save(patch: Partial<Task>): void {
    if (this.gone) return;
    updateTask(this.taskId, patch).catch(failed);
  }

  private titleValue(): string {
    return this.title.value.replace(/\s*\n\s*/gu, ' ').trim();
  }

  private saveTitle(): void {
    const title = this.titleValue();
    if (!title || !this.task || title === this.task.title) return;
    this.save({ title });
  }

  private saveDescription(): void {
    if (!this.task) return;
    const value = this.description.value;
    if (value === (this.task.description ?? '')) return;
    this.save({ description: value.trim() === '' ? undefined : value });
  }

  /** Pending text edits when the sheet closes (the change event may not fire before removal). */
  private flush(): void {
    if (this.gone || !this.task) return;
    this.saveTitle();
    this.saveDescription();
  }

  // --- Events ---

  private readonly onCheck = (event: Event): void => {
    const checked = detailOf<CheckboxChange>(event)?.checked ?? this.check.checked;
    this.setStatus(checked ? 'done' : 'open');
  };

  private readonly onStatusChange = (event: Event): void => {
    const detail = detailOf<ChipChange>(event);
    if (!detail?.selected) return;
    const value = detail.value;
    if (value === 'open' || value === 'doing' || value === 'done') this.setStatus(value);
  };

  /**
   * Writes a status (queued): Erledigt through completeTask (toast with Rückgängig, follow-up of a
   * recurring task), leaving Erledigt through reopenTask, In Arbeit / Offen through updateTask.
   */
  private setStatus(next: Task['status']): void {
    if (this.gone) return;
    const id = this.taskId;
    this.wantedStatus = next;
    this.statusPending += 1;
    this.syncStatus(next);
    this.statusQueue = this.statusQueue
      .then(async () => {
        const current = (await getTask(id))?.status;
        if (current === undefined || current === next) return;
        if (next === 'done') {
          const result = await completeTask(id);
          // Changed again while the write ran: no "Erledigt" toast for an open task.
          if (this.wantedStatus !== 'done') return;
          showToast(doneMessage(result), { action: { label: t.actionUndo, onAction: () => void reopenTask(id).catch(failed) } });
          return;
        }
        if (current === 'done') await reopenTask(id);
        if (next === 'doing' || current !== 'done') await updateTask(id, { status: next });
      })
      .catch(failed)
      .finally(() => {
        this.statusPending -= 1;
        if (this.statusPending === 0 && this.task) this.syncStatus(this.task.status);
      });
  }

  private readonly onTitleChange = (): void => {
    if (this.titleValue() === '') {
      this.title.setAttribute('error', t.captureTitleRequired);
      return;
    }
    this.saveTitle();
  };

  private readonly onTitleInput = (): void => {
    if (this.titleValue() !== '') this.title.removeAttribute('error');
  };

  private readonly onTitleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    this.onTitleChange();
  };

  /** An empty title is never saved: leaving the field restores the stored one. */
  private readonly onTitleBlur = (): void => {
    if (this.titleValue() !== '' || !this.task) return;
    this.title.value = this.task.title;
    this.title.removeAttribute('error');
  };

  private readonly onDueChange = (): void => {
    const day = this.date.value;
    const time = this.time.value;
    if (!day) {
      this.save({ dueAt: undefined, dueHasTime: 0 });
      return;
    }
    if (!isDay(day)) return;
    const hhmm = /^\d{2}:\d{2}/u.test(time) ? time.slice(0, 5) : '';
    this.save({ dueAt: isoAt(day, hhmm || undefined), dueHasTime: hhmm ? 1 : 0 });
  };

  private readonly onRepeat = (): void => {
    if (!this.task || this.gone) return;
    openRecurrenceSheet(this.task, (patch) => this.save(patch));
  };

  private readonly onFlagChange = (event: Event): void => {
    const detail = detailOf<ChipChange>(event);
    if (!detail) return;
    const value: 0 | 1 = detail.selected ? 1 : 0;
    this.save(detail.value === 'urgent' ? { urgent: value } : { important: value });
  };

  /** A project of another area does not move along: it is cleared. */
  private readonly onAreaChange = (event: Event): void => {
    const detail = detailOf<ChipChange>(event);
    if (!detail?.selected || !detail.value || !this.task || detail.value === this.task.areaId) return;
    const projectId = this.task.projectId;
    const project = projectId ? this.projects.find((p) => p.id === projectId) : undefined;
    this.save(projectId && project?.areaId !== detail.value ? { areaId: detail.value, projectId: null } : { areaId: detail.value });
  };

  private readonly onProject = (): void => {
    if (!this.task || this.gone || this.projectBtn.disabled) return;
    openProjectSheet(this.task, this.projects, (projectId) => this.save({ projectId }));
  };

  private readonly onDescriptionChange = (): void => {
    this.saveDescription();
  };

  private readonly onToggleDetent = (): void => {
    this.sheet.detent = this.sheet.detent === 'full' ? 'half' : 'full';
    this.syncMore();
  };

  private readonly onDetentChange = (event: Event): void => {
    if (event.target === this.sheet) this.syncMore();
  };

  private subtaskTitle(): string {
    return this.subtaskInput.value.replace(/\s+/gu, ' ').trim();
  }

  /** Adds the typed subtask; the input is cleared at once and keeps focus for the next one. */
  private addSubtask(): void {
    const title = this.subtaskTitle();
    if (!title || this.gone) return;
    this.subtaskInput.value = '';
    const parentId = this.taskId;
    this.subtaskQueue = this.subtaskQueue
      .then(() => createSubtask(parentId, title))
      .catch((err: unknown) => {
        // Nothing typed since: the text comes back so it is not lost.
        if (this.subtaskInput.value === '') this.subtaskInput.value = title;
        failed(err);
      });
  }

  private readonly onSubtaskKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    this.addSubtask();
  };

  private readonly onSubtaskAdd = (): void => {
    if (this.subtaskTitle() === '') {
      this.subtaskInput.focusInput();
      return;
    }
    this.addSubtask();
    this.subtaskInput.focusInput();
  };

  private readonly onSubtaskCheck = (event: Event): void => {
    const box = event.target instanceof Element ? event.target.closest<OlCheckbox>('ol-checkbox') : null;
    const id = box?.closest<HTMLElement>('[data-subtask]')?.dataset['subtask'];
    if (!box || !id) return;
    const checked = detailOf<CheckboxChange>(event)?.checked ?? box.checked;
    box.closest('li')?.toggleAttribute('data-done', checked);
    this.subtaskBusy.add(id);
    this.subtaskQueue = this.subtaskQueue
      .then(async () => {
        if (checked) await completeTask(id);
        else await reopenTask(id);
      })
      .catch((err: unknown) => {
        box.checked = !checked;
        box.closest('li')?.toggleAttribute('data-done', !checked);
        failed(err);
      })
      .finally(() => {
        this.subtaskBusy.delete(id);
        this.renderSubtasks(this.subtasks);
      });
  };

  private readonly onSubtaskListClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const row = event.target.closest<HTMLElement>('[data-subtask]');
    const id = row?.dataset['subtask'];
    if (!row || !id) return;
    // The title is part of the row's target: a tap on it toggles the checkbox.
    if (event.target.closest('.ol-task-sheet__subtask-title')) {
      row.querySelector<OlCheckbox>('ol-checkbox')?.click();
      return;
    }
    if (!event.target.closest('ol-icon-button') || this.subtaskBusy.has(id)) return;
    this.subtaskBusy.add(id);
    deleteTask(id).then((deleted) => {
      showToast(t.toastSubtaskRemoved, {
        action: { label: t.actionUndo, onAction: () => void restoreTask(deleted).catch(failed) },
      });
    }, failed).finally(() => this.subtaskBusy.delete(id));
  };

  private readonly onModeChange = (event: Event): void => {
    if (!detailOf<SegmentedChange>(event)) return;
    this.syncReminderForm();
  };

  private readonly onFormKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    this.onAddReminder();
  };

  private readReminder(): Omit<Reminder, 'id'> | null {
    if (this.mode.value !== 'absolute') {
      if (!this.timed()) return null;
      const raw = this.offset.value.trim();
      const minutes = Number(raw);
      if (raw === '' || !Number.isInteger(minutes) || minutes < 0) {
        this.offset.setAttribute('error', t.reminderOffsetInvalid);
        this.offset.focusInput();
        return null;
      }
      return { mode: 'relative', offsetMinutes: minutes };
    }
    const [day = '', time = ''] = this.at.value.split('T');
    if (!isDay(day) || !/^\d{2}:\d{2}/u.test(time)) {
      this.at.setAttribute('error', t.reminderAtRequired);
      this.at.focusInput();
      return null;
    }
    return { mode: 'absolute', at: isoAt(day, time.slice(0, 5)) };
  }

  private readonly onAddReminder = (): void => {
    if (this.addingReminder || this.gone) return;
    const reminder = this.readReminder();
    if (!reminder) return;
    this.addingReminder = true;
    // D.5: before the first reminder ever, the hint dialog and the permission request come first
    // (started here, inside the click handler); the reminder is saved whatever the outcome.
    const permission = ensureReminderPermission().catch((err: unknown) => console.error(err));
    void permission
      .then(() => addReminder(this.taskId, reminder))
      .catch(failed)
      .finally(() => {
        this.addingReminder = false;
      });
  };

  private readonly onReminderListClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('ol-icon-button[data-reminder]') : null;
    const id = target?.dataset['reminder'];
    const reminder = id ? this.task?.reminders.find((r) => r.id === id) : undefined;
    if (!id || !reminder || this.removing.has(id)) return;
    this.removing.add(id);
    const taskId = this.taskId;
    const { id: _removed, ...rest } = reminder;
    void _removed;
    removeReminder(taskId, id).then(() => {
      showToast(t.toastDeleted, {
        action: { label: t.actionUndo, onAction: () => void addReminder(taskId, rest).catch(failed) },
      });
    }, failed).finally(() => this.removing.delete(id));
  };

  private readonly onFocusClick = (): void => {
    if (this.focusBusy) return;
    const day = today();
    const previous = this.focusIds;
    const inFocus = previous.includes(this.taskId);
    const op = inFocus ? removeFromFocus(day, this.taskId) : addToFocus(day, this.taskId);
    this.focusBusy = true;
    this.focusBtn.setAttribute('loading', '');
    // Optimistic: the label is right at once; the next liveQuery emission confirms it.
    const optimistic = inFocus ? previous.filter((id) => id !== this.taskId) : [...previous, this.taskId];
    this.focusIds = optimistic;
    this.syncFocus();
    const settle = (): void => {
      this.focusBusy = false;
      this.focusBtn.removeAttribute('loading');
    };
    op.then(
      () => {
        settle();
        showToast(inFocus ? t.toastFocusRemoved : t.toastFocusAdded);
      },
      (err: unknown) => {
        settle();
        if (this.focusIds === optimistic) {
          this.focusIds = previous;
          this.syncFocus();
        }
        if (err instanceof FocusFullError) showToast(t.toastFocusFull);
        else failed(err);
      },
    );
  };

  private readonly onMore = (): void => {
    openActionMenu(this.task?.title || t.actionMore, [
      { label: t.actionDelete, icon: 'trash-2', danger: true, run: () => void this.confirmDelete() },
    ]);
  };

  private async confirmDelete(): Promise<void> {
    const confirmed = await confirmDialog({
      title: t.actionConfirmDelete,
      body: this.subtasks.length > 0 ? t.confirmDeleteTaskWithSubtasks : t.confirmDeleteTask,
      confirmLabel: t.actionDelete,
      destructive: true,
    });
    if (!confirmed || this.gone) return;
    this.gone = true;
    try {
      const deleted = await deleteTask(this.taskId);
      this.sheet.close('action');
      showToast(t.toastDeleted, { action: { label: t.actionUndo, onAction: () => void restoreTask(deleted).catch(failed) } });
    } catch (err) {
      this.gone = false;
      failed(err);
    }
  }
}

/** routed: opened by the router for /aufgabe/:id (history="none"). */
export function openTaskSheet(taskId: Id, opts: { routed?: boolean } = {}): OlSheet {
  const sheet = createSheet({
    title: t.taskSheetTitle, history: opts.routed ? 'none' : 'push', headerActions: true,
  });
  void new TaskSheet(sheet, taskId).start();
  return sheet;
}
