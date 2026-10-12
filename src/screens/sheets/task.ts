// Task sheet /aufgabe/:id (F §4.13, A.3 Task-Sheet, D.1, D.5).
// Half detent: checkbox + title, due date and time (native inputs), Wichtig/Dringend chips (icon and
// text, not colour alone), Bereich (radio chips with flowers), Projekt (disabled), "Mehr anzeigen";
// footer: "In den Fokus" / "Aus dem Fokus nehmen" for today, disabled with the limit hint when three
// other tasks are in focus (D.1). Full detent: description, subtasks placeholder, reminders (D.5).
// Header: ⋯ opens a small menu sheet (A.3 "⋯ ⇡") with "Löschen" (destructive dialog, undo toast).
//
// Details of this implementation:
// - The sheet opens once the task is loaded; an unknown id closes it unopened (the router then goes back).
//   A task that disappears while the sheet is open (deleted elsewhere) closes it.
// - Live updates (task$, areas$, today's focus) patch the fields in place; a field that has focus is
//   never overwritten, so typing is not disturbed.
// - Text fields save on change (blur/Enter); pending edits are flushed again when the sheet closes.
// - "Mehr anzeigen" is the keyboard/tap path to the full detent (D7); dragging up works as well.
// - Status chip and Verlauf (A.3): TODO(phase-3). Wiederholung: TODO(phase-2). Linked notes: [Ext].
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
import { fmt, t } from '../../i18n/de.js';
import { GENERIC_TINT, MAX_FOCUS, type Area, type Id, type Reminder, type Task } from '../../model.js';
import { areas$ } from '../../repo/areas.js';
import { addToFocus, FocusFullError, getFocus, removeFromFocus } from '../../repo/dayPlans.js';
import { getProfile } from '../../repo/profile.js';
import {
  addReminder, completeTask, deleteTask, getTask, removeReminder, reopenTask, restoreTask, task$, updateTask,
} from '../../repo/tasks.js';
import { ensureReminderPermission, fireTime } from '../../services/reminders.js';
import { dayOfIso, formatDayShort, formatTime, isDay, isoAt, onDayChange, timeOfIso, today } from '../../util/date.js';
import { h, icon, render } from '../../util/dom.js';

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
  private subs: Sub[] = [];
  private focusSub: Sub | null = null;
  private stopDay: (() => void) | null = null;

  private root!: HTMLElement;
  private check!: OlCheckbox;
  private title!: OlInput;
  private date!: OlInput;
  private time!: OlInput;
  private important!: OlChip;
  private urgent!: OlChip;
  private areaGroup!: HTMLElement;
  private moreBtn!: OlButton;
  private more!: HTMLElement;
  private description!: OlInput;
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
    const remindersLabel = uid('task-reminders');
    const subtasksLabel = uid('task-subtasks');
    const moreId = uid('task-more');
    const hintId = uid('task-focus-hint');
    render(sheet.headerActionsEl, h`<ol-icon-button icon="ellipsis" label="${t.actionMore}"></ol-icon-button>`);
    // TODO(phase-3): project picker; projects cannot be created yet, so the field is disabled ("Kein
    // Projekt") and projectId stays null.
    // TODO(phase-2): subtasks; only the section placeholder is rendered (no child tasks via parentId).
    // TODO(phase-3): status chip and Verlauf. TODO(phase-2): Wiederholung.
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
  <div class="ol-task-sheet__chips">
    <ol-chip class="ol-task-sheet__important" icon="flag" label="${t.flagImportant}" value="important"></ol-chip>
    <ol-chip class="ol-task-sheet__urgent" icon="alarm-clock" label="${t.flagUrgent}" value="urgent"></ol-chip>
  </div>
  <div class="ol-task-sheet__field">
    <p class="ol-task-sheet__label" id="${areaLabel}">${t.fieldArea}</p>
    <div class="ol-task-sheet__areas" role="radiogroup" aria-labelledby="${areaLabel}"></div>
  </div>
  <ol-input class="ol-task-sheet__project" label="${t.fieldProject}" value="${t.noProject}" disabled></ol-input>
  <ol-button class="ol-task-sheet__more-btn" variant="ghost" icon="chevron-down" label="${t.actionShowMore}"></ol-button>
  <div class="ol-task-sheet__more" id="${moreId}" hidden>
    <ol-input class="ol-task-sheet__description" label="${t.fieldDescription}" multiline rows-max="8"></ol-input>
    <section class="ol-task-sheet__section" aria-labelledby="${subtasksLabel}">
      <h3 class="ol-label" id="${subtasksLabel}">${t.sectionSubtasks}</h3>
      <p class="ol-task-sheet__placeholder ol-body-s">${t.subtasksPlaceholder}</p>
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
    this.important = q<OlChip>(body, '.ol-task-sheet__important');
    this.urgent = q<OlChip>(body, '.ol-task-sheet__urgent');
    this.areaGroup = q<HTMLElement>(body, '.ol-task-sheet__areas');
    this.moreBtn = q<OlButton>(body, '.ol-task-sheet__more-btn');
    this.more = q<HTMLElement>(body, '.ol-task-sheet__more');
    this.description = q<OlInput>(body, '.ol-task-sheet__description');
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
    this.offset.value = String(this.leadMinutes);

    sheet.headerActionsEl.querySelector('ol-icon-button')?.addEventListener('click', this.onMore);
    this.check.addEventListener('ol-change', this.onCheck);
    this.title.addEventListener('ol-change', this.onTitleChange);
    this.title.addEventListener('input', this.onTitleInput);
    this.title.addEventListener('keydown', this.onTitleKeyDown);
    this.title.addEventListener('focusout', this.onTitleBlur);
    this.date.addEventListener('ol-change', this.onDueChange);
    this.time.addEventListener('ol-change', this.onDueChange);
    this.important.addEventListener('ol-change', this.onFlagChange);
    this.urgent.addEventListener('ol-change', this.onFlagChange);
    this.areaGroup.addEventListener('ol-change', this.onAreaChange);
    this.moreBtn.addEventListener('click', this.onToggleDetent);
    this.description.addEventListener('ol-change', this.onDescriptionChange);
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
      areas$(true).subscribe({
        next: (areas) => {
          this.areas = areas;
          if (this.task) syncAreaChips(this.areaGroup, areas, this.task.areaId, false);
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
    const done = task.status === 'done';
    if (this.check.checked !== done) this.check.checked = done;
    this.root.toggleAttribute('data-done', done);
    setIfIdle(this.title, task.title);

    const day = task.dueDay ?? '';
    const timed = task.dueHasTime === 1 && task.dueAt !== undefined;
    setIfIdle(this.date, day);
    setIfIdle(this.time, timed && task.dueAt ? timeOfIso(task.dueAt) : '');
    this.time.toggleAttribute('disabled', day === '');

    if (this.important.selected !== (task.important === 1)) this.important.selected = task.important === 1;
    if (this.urgent.selected !== (task.urgent === 1)) this.urgent.selected = task.urgent === 1;
    syncAreaChips(this.areaGroup, this.areas, task.areaId, false);
    setIfIdle(this.description, task.description ?? '');

    if (!this.filled) {
      // First fill: relative reminders need a due time, so the form starts with the mode that works.
      this.filled = true;
      this.mode.value = timed ? 'relative' : 'absolute';
      if (timed && task.dueAt) this.at.value = `${day}T${timeOfIso(task.dueAt)}`;
    }
    this.syncReminderForm();
    this.renderReminders(task);
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
    const id = this.taskId;
    if (!checked) {
      reopenTask(id).catch(failed);
      return;
    }
    completeTask(id).then(
      () => {
        // Unchecked again while the write ran: no "Erledigt" toast for an open task.
        if (!this.check.checked) return;
        showToast(t.toastDone, { action: { label: t.actionUndo, onAction: () => void reopenTask(id).catch(failed) } });
      },
      failed,
    );
  };

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

  private readonly onFlagChange = (event: Event): void => {
    const detail = detailOf<ChipChange>(event);
    if (!detail) return;
    const value: 0 | 1 = detail.selected ? 1 : 0;
    this.save(detail.value === 'urgent' ? { urgent: value } : { important: value });
  };

  private readonly onAreaChange = (event: Event): void => {
    const detail = detailOf<ChipChange>(event);
    if (!detail?.selected || !detail.value || detail.value === this.task?.areaId) return;
    this.save({ areaId: detail.value });
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
      title: t.actionConfirmDelete, body: t.confirmDeleteTask, confirmLabel: t.actionDelete, destructive: true,
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
