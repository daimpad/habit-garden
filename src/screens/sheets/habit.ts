// Habit sheet /gewohnheit/:id and habit editor (F §4.13, A.3 Habit-Sheet, D.2, S17).
// Sheet: arch window (--radius-arch, tint 10 % on surface) with ol-plant 120 px; rhythm, streak as a
// display number, best streak; 12-week ol-heatmap (it loads its own data and emits ol-toggle-day).
// Each heatmap toggle writes toggleLog and shows a toast with the date and "Rückgängig" (decision 4).
// ⋯ opens a menu sheet: Bearbeiten (editor), Archivieren (undo toast), Löschen (dialog, undo toast).
// Editor: name, area (incl. "Ohne Bereich"), rhythm (daily interval / weekdays / times per week) and
// time of day; schedule changes apply retroactively without animation (S17).
//
// Details of this implementation:
// - The sheet opens once habit, logs and areas are loaded; an unknown id closes it unopened.
// - Plant feedback after a toggle (B.4): stage up → grow; for today also wobble, drops on the soil,
//   burst from the head and haptic confirm (a backfilled past day only grows, S35); stage down →
//   crossfade; today done without a stage change → wobble + drops. The toggle result is applied to
//   the local logs at once, and live renders leave the plant's stage alone while a toggle is in
//   flight, so the animation is not pre-empted by a stale snapshot.
// - One toast per toggle (date + status + "Rückgängig"); when today's toggle raises the stage it
//   also names the new stage (F §4.13), so no separate "Stufe … erreicht" toast outlives an undo.
// - A done log before startDay moves startDay (S35, repo/habitLogs); undo restores it.
// - timesPerWeek: streak and best streak are ISO weeks and carry the unit (S19).
// - Sheet and editor use fit + full detent: the height follows the content up to 92 %.
// - Archived habits (S17): the menu offers "Reaktivieren" instead of "Archivieren"; the Archiv sheet
//   (PLANUNG ⋯ › Archiv, "Archivierte Routinen") lists them as well.
import '../../components/ol-button.js';
import '../../components/ol-chip.js';
import '../../components/ol-heatmap.js';
import '../../components/ol-icon-button.js';
import '../../components/ol-input.js';
import '../../components/ol-plant.js';
import '../../components/ol-segmented.js';
import { petalColor } from '../../components/flora.js';
import type { OlButton } from '../../components/ol-button.js';
import type { OlChip } from '../../components/ol-chip.js';
import { confirmDialog } from '../../components/ol-dialog.js';
import type { ToggleDayDetail } from '../../components/ol-heatmap.js';
import type { OlInput } from '../../components/ol-input.js';
import { particles } from '../../components/ol-particles.js';
import type { OlPlant } from '../../components/ol-plant.js';
import type { OlSegmented } from '../../components/ol-segmented.js';
import { createSheet, type OlSheet } from '../../components/ol-sheet.js';
import { showToast } from '../../components/ol-toast.js';
import { fmt, stageName, t, weekdayShort } from '../../i18n/de.js';
import {
  GENERIC_TINT, type Area, type Day, type FlowerId, type Habit, type HabitLog, type HabitSchedule, type Id,
} from '../../model.js';
import { areas$, listAreas } from '../../repo/areas.js';
import { deleteHabit, getHabit, habit$, restoreHabit, setHabitArchived, updateHabit } from '../../repo/habits.js';
import { habitLogId, habitLogs$, logsFor, toggleLog, type ToggleResult } from '../../repo/habitLogs.js';
import { bestStreak, stageFor, streak } from '../../services/growth.js';
import { formatDayLong, isoWeekday, nowIso, onDayChange, today } from '../../util/date.js';
import { h, HAPTIC, render, setVar, vibrate } from '../../util/dom.js';
import { failed, openActionMenu, syncAreaChips, type MenuItem } from './task.js';

interface Sub { unsubscribe(): void }

let uidSeq = 0;
const uid = (prefix: string): string => `${prefix}-${++uidSeq}`;

const FIRST_DAY: Day = '0001-01-01';
const LAST_DAY: Day = '9999-12-31';

const PERIOD_LABELS: Readonly<Record<Habit['period'], string>> = {
  morning: t.periodMorning, evening: t.periodEvening, any: t.periodAny,
};

function isPeriod(value: string): value is Habit['period'] {
  return value === 'morning' || value === 'evening' || value === 'any';
}

/** "Täglich", "Alle 2 Tage", "Wöchentlich: Mo, Mi", "3× pro Woche". */
export function rhythmText(schedule: HabitSchedule): string {
  switch (schedule.kind) {
    case 'daily':
      return schedule.interval > 1 ? fmt(t.rhythmEveryNDays, { n: schedule.interval }) : t.rhythmDaily;
    case 'weekly': {
      const days = [...schedule.weekdays].sort((a, b) => a - b).map(weekdayShort).join(', ');
      return schedule.interval > 1 ? fmt(t.rhythmEveryNWeeks, { n: schedule.interval, days }) : fmt(t.rhythmWeekly, { days });
    }
    case 'timesPerWeek':
      return fmt(t.rhythmTimesPerWeek, { n: schedule.times });
  }
}

function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function setText(el: Element, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

/** Streak value with its unit for timesPerWeek habits ("1 Woche", "3 Wochen"), else the bare number. */
export function streakText(habit: Habit, n: number): string {
  if (habit.schedule.kind !== 'timesPerWeek') return String(n);
  return n === 1 ? t.streakWeeksOne : fmt(t.streakWeeks, { n });
}

const byDay = (a: HabitLog, b: HabitLog): number => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0);

// ---------------------------------------------------------------------------
// Habit sheet

class HabitSheet {
  private habit: Habit | null = null;
  private logs: readonly HabitLog[] = [];
  private areas: readonly Area[] = [];
  private pending = 0;
  private gone = false;
  private queue: Promise<void> = Promise.resolve();
  private subs: Sub[] = [];
  private stopDay: (() => void) | null = null;

  private arch!: HTMLElement;
  private plant!: OlPlant;
  private rhythm!: HTMLElement;
  private streakEl!: HTMLElement;
  private bestEl!: HTMLElement;

  constructor(private readonly sheet: OlSheet, private readonly habitId: Id) {}

  async start(): Promise<void> {
    let habit: Habit | undefined;
    try {
      const [h0, logs, areas] = await Promise.all([
        getHabit(this.habitId), logsFor(this.habitId, FIRST_DAY, LAST_DAY), listAreas(true),
      ]);
      habit = h0;
      this.logs = logs;
      this.areas = areas;
    } catch (err) {
      console.error(err);
    }
    if (!this.sheet.isConnected) return;
    if (!habit) {
      this.sheet.close('action');
      return;
    }
    this.habit = habit;
    this.build();
    this.render();
    this.sheet.open();
    this.subscribe();
  }

  private build(): void {
    const sheet = this.sheet;
    const id = this.habitId;
    // Initial focus on ⋯ rather than on the heatmap (focusing the grid would pop its tooltip at once).
    render(sheet.headerActionsEl, h`<ol-icon-button icon="ellipsis" label="${t.actionMore}" autofocus></ol-icon-button>`);
    render(
      sheet.bodyEl,
      h`<div class="ol-habit-sheet">
  <div class="ol-habit-sheet__top">
    <div class="ol-habit-sheet__arch"><ol-plant class="ol-habit-sheet__plant" size="120" stage="0"></ol-plant></div>
    <dl class="ol-habit-sheet__stats">
      <div class="ol-habit-sheet__stat">
        <dt class="ol-caption">${t.habitRhythm}</dt>
        <dd class="ol-habit-sheet__rhythm ol-body-s"></dd>
      </div>
      <div class="ol-habit-sheet__stat">
        <dt class="ol-caption">${t.habitStreak}</dt>
        <dd class="ol-habit-sheet__streak ol-display ol-num">0</dd>
      </div>
      <div class="ol-habit-sheet__stat">
        <dt class="ol-caption">${t.habitBestStreak}</dt>
        <dd class="ol-habit-sheet__best ol-heading ol-num">0</dd>
      </div>
    </dl>
  </div>
  <ol-heatmap class="ol-habit-sheet__heatmap" habit-id="${id}"></ol-heatmap>
</div>`,
    );
    const q = <T extends Element>(selector: string): T => {
      const el = sheet.bodyEl.querySelector<T>(selector);
      if (!el) throw new Error(`habit sheet: missing ${selector}`);
      return el;
    };
    this.arch = q<HTMLElement>('.ol-habit-sheet__arch');
    this.plant = q<OlPlant>('.ol-habit-sheet__plant');
    this.rhythm = q<HTMLElement>('.ol-habit-sheet__rhythm');
    this.streakEl = q<HTMLElement>('.ol-habit-sheet__streak');
    this.bestEl = q<HTMLElement>('.ol-habit-sheet__best');

    sheet.headerActionsEl.querySelector('ol-icon-button')?.addEventListener('click', this.onMore);
    sheet.bodyEl.addEventListener('ol-toggle-day', this.onToggleDay);
    sheet.addEventListener('ol-dismiss', (event) => {
      if (event.target === sheet) this.cleanup();
    });
    void sheet.closed.then(() => this.cleanup());
  }

  private subscribe(): void {
    const fail = (err: unknown): void => console.error(err);
    this.subs.push(
      habit$(this.habitId).subscribe({
        next: (habit) => {
          if (habit) {
            this.habit = habit;
            this.render();
          } else if (!this.gone) {
            this.gone = true;
            this.sheet.close('action');
          }
        },
        error: fail,
      }),
      habitLogs$(this.habitId).subscribe({
        next: (logs) => {
          this.logs = logs;
          this.render();
        },
        error: fail,
      }),
      areas$(true).subscribe({
        next: (areas) => {
          this.areas = areas;
          this.render();
        },
        error: fail,
      }),
    );
    this.stopDay = onDayChange(() => this.render());
  }

  private cleanup(): void {
    for (const sub of this.subs) sub.unsubscribe();
    this.subs = [];
    this.stopDay?.();
    this.stopDay = null;
  }

  private look(): { flower: FlowerId; tint: string } {
    const habit = this.habit;
    const area = habit?.areaId ? this.areas.find((a) => a.id === habit.areaId) : undefined;
    return { flower: area?.flower ?? 'generic', tint: area?.tint ?? GENERIC_TINT };
  }

  private render(): void {
    const habit = this.habit;
    if (!habit || !this.plant) return;
    const day = today();
    const { flower, tint } = this.look();
    this.sheet.setTitle(habit.name);
    setVar(this.arch, '--tint', tint);
    const current = streak(habit, this.logs, day);
    setAttr(this.plant, 'flower', flower);
    setAttr(this.plant, 'tint', tint);
    setAttr(this.plant, 'streak', String(current));
    if (habit.schedule.kind === 'timesPerWeek') setAttr(this.plant, 'streak-unit', 'weeks');
    else this.plant.removeAttribute('streak-unit');
    // Stage changes caused by a toggle are animated in feedback(); everything else applies directly.
    if (this.pending === 0) setAttr(this.plant, 'stage', String(stageFor(habit, this.logs, day)));
    const rhythm = rhythmText(habit.schedule);
    setText(this.rhythm, habit.period === 'any' ? rhythm : fmt(t.habitRhythmLine, { rhythm, period: PERIOD_LABELS[habit.period] }));
    setText(this.streakEl, streakText(habit, current));
    setText(this.bestEl, streakText(habit, bestStreak(habit, this.logs, day)));
  }

  // --- Toggling ---

  private readonly onToggleDay = (event: Event): void => {
    const day = event instanceof CustomEvent ? (event.detail as ToggleDayDetail | null)?.day : undefined;
    if (day) this.toggle(day, true);
  };

  /**
   * Serialised toggles: each result drives the plant feedback and its toast in order.
   * restoreStartDay: the start day to restore when an undo removes a backfilled log (S35).
   */
  private toggle(day: Day, offerUndo: boolean, restoreStartDay?: Day): void {
    this.pending += 1;
    this.queue = this.queue.then(async () => {
      try {
        const result = await toggleLog(this.habitId, day, restoreStartDay === undefined ? {} : { restoreStartDay });
        this.applyResult(day, result, restoreStartDay);
        this.feedback(day, result);
        const date = formatDayLong(day);
        const raised = result.done && result.after > result.before && day === today();
        const message = raised
          ? fmt(t.toastDayDoneStage, { date, stage: stageName(result.after) })
          : fmt(result.done ? t.toastDayDone : t.toastDayReset, { date });
        const undo = (): void => this.toggle(day, false, result.startDayBefore);
        showToast(message, offerUndo ? { action: { label: t.actionUndo, onAction: undo } } : {});
      } catch (err) {
        failed(err);
      } finally {
        this.pending -= 1;
        if (this.pending === 0) this.render();
      }
    });
  }

  /**
   * Applies a toggle result to the local snapshot at once (like HEUTE's withDay), so a render
   * before the next liveQuery emission does not reset the plant to the old stage. Later
   * emissions carry the same data.
   */
  private applyResult(day: Day, result: ToggleResult, restoreStartDay: Day | undefined): void {
    const next = this.logs.filter((log) => log.day !== day);
    if (result.done) next.push({ id: habitLogId(this.habitId, day), habitId: this.habitId, day, status: 'done', loggedAt: nowIso() });
    next.sort(byDay);
    this.logs = next;
    const habit = this.habit;
    if (!habit) return;
    if (result.startDayBefore !== undefined && day < habit.startDay) {
      this.habit = { ...habit, startDay: day };
    } else if (!result.done && restoreStartDay !== undefined && habit.startDay === day && restoreStartDay > day) {
      this.habit = { ...habit, startDay: restoreStartDay };
    }
  }

  private feedback(day: Day, result: ToggleResult): void {
    const plant = this.plant;
    if (!plant.isConnected) return;
    const { before, after, done } = result;
    const isToday = day === today();
    if (after > before) {
      plant.setAttribute('stage', String(after));
      void plant.grow();
      // A backfilled past day only grows (S35): no wobble, particles or haptics.
      if (!isToday) return;
      const { flower, tint } = this.look();
      void plant.wobble();
      const { soil, head } = plant.anchorPoints();
      const layer = particles();
      layer.drops(soil.x, soil.y);
      layer.burst(head.x, head.y, petalColor(flower, tint), after === 4);
      vibrate(HAPTIC.confirm);
    } else if (after < before) {
      void plant.crossfadeTo(after);
    } else if (done && isToday) {
      void plant.wobble();
      const { soil } = plant.anchorPoints();
      particles().drops(soil.x, soil.y);
    }
  }

  // --- Menu ---

  private readonly onMore = (): void => {
    const habit = this.habit;
    if (!habit) return;
    const items: MenuItem[] = [{ label: t.actionEdit, icon: 'pencil', run: () => void openHabitEditor(habit.id) }];
    if (habit.archived === 0) items.push({ label: t.actionArchive, icon: 'archive', run: () => void this.archive() });
    else items.push({ label: t.habitReactivate, icon: 'undo-2', run: () => void this.reactivate() });
    items.push({ label: t.actionDelete, icon: 'trash-2', danger: true, run: () => void this.confirmDelete() });
    openActionMenu(habit.name, items);
  };

  private async archive(): Promise<void> {
    const id = this.habitId;
    try {
      await setHabitArchived(id, 1);
      this.sheet.close('action');
      showToast(t.toastHabitArchived, { action: { label: t.actionUndo, onAction: () => void setHabitArchived(id, 0).catch(failed) } });
    } catch (err) {
      failed(err);
    }
  }

  private async reactivate(): Promise<void> {
    const habit = this.habit;
    if (!habit) return;
    try {
      await setHabitArchived(habit.id, 0);
      showToast(fmt(t.toastHabitReactivated, { name: habit.name }));
    } catch (err) {
      failed(err);
    }
  }

  private async confirmDelete(): Promise<void> {
    const confirmed = await confirmDialog({
      title: t.actionConfirmDelete, body: t.confirmDeleteHabit, confirmLabel: t.actionDelete, destructive: true,
    });
    if (!confirmed || this.gone) return;
    this.gone = true;
    try {
      const deleted = await deleteHabit(this.habitId);
      this.sheet.close('action');
      showToast(t.toastDeleted, { action: { label: t.actionUndo, onAction: () => void restoreHabit(deleted).catch(failed) } });
    } catch (err) {
      this.gone = false;
      failed(err);
    }
  }
}

/** routed: opened by the router for /gewohnheit/:id (history="none"). */
export function openHabitSheet(habitId: Id, opts: { routed?: boolean } = {}): OlSheet {
  const sheet = createSheet({
    title: t.habitSheetTitle, history: opts.routed ? 'none' : 'push', headerActions: true, detent: 'full', fit: true,
  });
  void new HabitSheet(sheet, habitId).start();
  return sheet;
}

// ---------------------------------------------------------------------------
// Habit editor

class HabitEditor {
  private habit: Habit | null = null;
  private saving = false;

  private name!: OlInput;
  private areaGroup!: HTMLElement;
  private kind!: OlSegmented;
  private interval!: OlInput;
  private weekly!: HTMLElement;
  private weekdays!: HTMLElement;
  private weekdayError!: HTMLElement;
  private times!: OlInput;
  private period!: OlSegmented;
  private saveBtn!: OlButton;

  constructor(private readonly sheet: OlSheet, private readonly habitId: Id) {}

  async start(): Promise<void> {
    let habit: Habit | undefined;
    let areas: Area[] = [];
    try {
      [habit, areas] = await Promise.all([getHabit(this.habitId), listAreas(true)]);
    } catch (err) {
      console.error(err);
    }
    if (!this.sheet.isConnected) return;
    if (!habit) {
      this.sheet.close('action');
      return;
    }
    this.habit = habit;
    this.build(habit, areas);
    this.sheet.open();
  }

  private build(habit: Habit, areas: readonly Area[]): void {
    const sheet = this.sheet;
    const s = habit.schedule;
    const interval = s.kind === 'daily' ? s.interval : 1;
    const weekdays = new Set(s.kind === 'weekly' ? s.weekdays : [isoWeekday(today())]);
    const times = s.kind === 'timesPerWeek' ? s.times : 3;
    const ids = { area: uid('hab-area'), kind: uid('hab-kind'), week: uid('hab-week'), weekErr: uid('hab-week-err'), period: uid('hab-period') };
    render(
      sheet.bodyEl,
      h`<div class="ol-habit-editor">
  <ol-input class="ol-habit-editor__name" label="${t.fieldName}" value="${habit.name}" autocomplete="off"></ol-input>
  <div class="ol-habit-editor__field">
    <p class="ol-habit-editor__label" id="${ids.area}">${t.fieldArea}</p>
    <div class="ol-habit-editor__chips ol-habit-editor__areas" role="radiogroup" aria-labelledby="${ids.area}"></div>
  </div>
  <div class="ol-habit-editor__field">
    <p class="ol-habit-editor__label" id="${ids.kind}">${t.fieldRhythm}</p>
    <ol-segmented class="ol-habit-editor__kind" aria-labelledby="${ids.kind}" value="${s.kind}">
      <button type="button" data-value="daily">${t.rhythmKindDaily}</button>
      <button type="button" data-value="weekly">${t.rhythmKindWeekly}</button>
      <button type="button" data-value="timesPerWeek">${t.rhythmKindTimesPerWeek}</button>
    </ol-segmented>
  </div>
  <ol-input class="ol-habit-editor__interval" type="number" inputmode="numeric" min="1" step="1" label="${t.fieldInterval}" value="${String(interval)}"></ol-input>
  <div class="ol-habit-editor__field ol-habit-editor__weekly">
    <p class="ol-habit-editor__label" id="${ids.week}">${t.fieldWeekdays}</p>
    <div class="ol-habit-editor__chips ol-habit-editor__weekdays" role="group" aria-labelledby="${ids.week}" aria-describedby="${ids.weekErr}">
      ${[1, 2, 3, 4, 5, 6, 7].map((d) => h`<ol-chip value="${String(d)}" label="${weekdayShort(d)}" ${weekdays.has(d) ? 'selected' : ''}></ol-chip>`)}
    </div>
    <p class="ol-habit-editor__error ol-body-s" id="${ids.weekErr}" hidden>${t.habitWeekdaysRequired}</p>
  </div>
  <ol-input class="ol-habit-editor__times" type="number" inputmode="numeric" min="1" max="7" step="1" label="${t.fieldTimesPerWeek}" value="${String(times)}"></ol-input>
  <div class="ol-habit-editor__field">
    <p class="ol-habit-editor__label" id="${ids.period}">${t.fieldPeriod}</p>
    <ol-segmented class="ol-habit-editor__period" aria-labelledby="${ids.period}" value="${habit.period}">
      <button type="button" data-value="morning">${t.periodMorning}</button>
      <button type="button" data-value="evening">${t.periodEvening}</button>
      <button type="button" data-value="any">${t.periodAny}</button>
    </ol-segmented>
  </div>
</div>`,
    );
    render(sheet.footerEl, h`<ol-button class="ol-habit-editor__save" variant="filled" label="${t.actionSave}"></ol-button>`);
    const q = <T extends Element>(root: ParentNode, selector: string): T => {
      const el = root.querySelector<T>(selector);
      if (!el) throw new Error(`habit editor: missing ${selector}`);
      return el;
    };
    const body = sheet.bodyEl;
    this.name = q<OlInput>(body, '.ol-habit-editor__name');
    this.areaGroup = q<HTMLElement>(body, '.ol-habit-editor__areas');
    this.kind = q<OlSegmented>(body, '.ol-habit-editor__kind');
    this.interval = q<OlInput>(body, '.ol-habit-editor__interval');
    this.weekly = q<HTMLElement>(body, '.ol-habit-editor__weekly');
    this.weekdays = q<HTMLElement>(body, '.ol-habit-editor__weekdays');
    this.weekdayError = q<HTMLElement>(body, '.ol-habit-editor__error');
    this.times = q<OlInput>(body, '.ol-habit-editor__times');
    this.period = q<OlSegmented>(body, '.ol-habit-editor__period');
    this.saveBtn = q<OlButton>(sheet.footerEl, '.ol-habit-editor__save');

    syncAreaChips(this.areaGroup, areas, habit.areaId ?? '', true);
    this.syncKind();

    this.kind.addEventListener('ol-change', () => this.syncKind());
    this.weekdays.addEventListener('ol-change', () => {
      if (this.selectedWeekdays().length > 0) this.weekdayError.hidden = true;
    });
    for (const input of [this.name, this.interval, this.times]) {
      input.addEventListener('input', () => input.removeAttribute('error'));
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        void this.save();
      });
    }
    this.saveBtn.addEventListener('click', () => void this.save());
  }

  private syncKind(): void {
    const kind = this.kind.value;
    this.interval.hidden = kind !== 'daily';
    this.weekly.hidden = kind !== 'weekly';
    this.times.hidden = kind !== 'timesPerWeek';
  }

  private selectedWeekdays(): number[] {
    return [...this.weekdays.querySelectorAll<OlChip>('ol-chip')]
      .filter((chip) => chip.selected)
      .map((chip) => Number(chip.value))
      .sort((a, b) => a - b);
  }

  private invalid(input: OlInput, message: string): null {
    input.setAttribute('error', message);
    input.focusInput();
    return null;
  }

  private readSchedule(): HabitSchedule | null {
    const kind = this.kind.value;
    if (kind === 'weekly') {
      const weekdays = this.selectedWeekdays();
      if (weekdays.length === 0) {
        this.weekdayError.hidden = false;
        this.weekdays.querySelector<OlChip>('ol-chip')?.focus();
        return null;
      }
      const previous = this.habit?.schedule;
      return { kind: 'weekly', interval: previous?.kind === 'weekly' ? previous.interval : 1, weekdays };
    }
    if (kind === 'timesPerWeek') {
      const n = Number(this.times.value.trim() || 'x');
      if (!Number.isInteger(n) || n < 1 || n > 7) return this.invalid(this.times, t.habitTimesInvalid);
      return { kind: 'timesPerWeek', times: n };
    }
    const n = Number(this.interval.value.trim() || 'x');
    if (!Number.isInteger(n) || n < 1) return this.invalid(this.interval, t.habitIntervalInvalid);
    return { kind: 'daily', interval: n };
  }

  private async save(): Promise<void> {
    if (this.saving) return;
    const name = this.name.value.trim();
    if (!name) {
      this.invalid(this.name, t.areaNameRequired);
      return;
    }
    const schedule = this.readSchedule();
    if (!schedule) return;
    const period = isPeriod(this.period.value) ? this.period.value : 'any';
    const areaId = this.areaGroup.querySelector<OlChip>('ol-chip[selected]')?.value || undefined;
    this.saving = true;
    this.saveBtn.setAttribute('loading', '');
    try {
      await updateHabit(this.habitId, { name, areaId, schedule, period });
      this.sheet.close('action');
      showToast(t.toastSaved);
    } catch (err) {
      this.saving = false;
      this.saveBtn.removeAttribute('loading');
      failed(err);
    }
  }
}

/** Editor for name, area, rhythm and time of day (A.3 "⋯ Bearbeiten"). */
export function openHabitEditor(habitId: Id): OlSheet {
  const sheet = createSheet({ title: t.habitEditTitle, detent: 'full', fit: true });
  void new HabitEditor(sheet, habitId).start();
  return sheet;
}
