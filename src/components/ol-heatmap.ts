// <ol-heatmap habit-id="…" weeks="12"></ol-heatmap>
// Loads the habit and its logs itself via liveQuery (repo/habits habit$, repo/habitLogs habitLogs$),
// levels from growth.stageAt (l0..l4). 13-column grid (weekday column Mo/Mi/Fr + 12 weeks,
// Monday first, last column contains today). One focusable element (tabindex 0, role="group",
// aria-label t.heatmapAria). Keys: ↑/↓ ±1 day, ←/→ ±7 days, Enter/Space toggle, Home/End.
// Tooltip role="tooltip" clamped to the viewport; cursor changes announced in an aria-live="polite" region.
// Click/tap on a past (or today's) cell moves the cursor there and toggles it. Future cells: aria-hidden, not toggleable.
// The component does NOT write: it emits `ol-toggle-day` (detail: { day }) and the owner calls toggleLog.
// Re-renders must keep focus and cursor (update cell classes in place).
// Approved exception (Rückfrage 2): cells are 12 px, below the 48 px touch target; documented in code.
//
// Details of this implementation:
// - setData(habit, logs, today) renders a snapshot; the liveQuery subscription (started while
//   connected with a habit-id) calls it on every emission, and tests may call it directly.
// - The skeleton (grid, tooltip, live region) is rendered once; cells are patched in place
//   (data-day, l0..l4, --today, --future, aria-hidden), so focus and cursor survive emissions.
// - Cursor: starts on today (and follows today across midnight until moved), clamped to
//   [first cell, today]; Home = first cell, End = today. It is drawn only while the grid has focus.
// - aria-label "Erfüllt an n von m Tagen": m = scheduled days in [max(first cell, startDay), today],
//   n = days among them with a 'done' log (S35).
// - The live region is written only when the cursor moves, not when data changes (the owner's
//   toast announces a toggle).
import type { Day, Habit, HabitLog } from '../model.js';
import { fmt, stageName, t, weekdayShort } from '../i18n/de.js';
import { habit$ } from '../repo/habits.js';
import { habitLogs$ } from '../repo/habitLogs.js';
import { isScheduledOn, stageAt } from '../services/growth.js';
import { addDays, diffDays, formatDayLong, onDayChange, startOfWeek, today as currentDay } from '../util/date.js';
import { emit, h, render } from '../util/dom.js';

export interface ToggleDayDetail { day: string }

const DEFAULT_WEEKS = 12;
const MAX_WEEKS = 53;
/** Weekday labels in the first column: Monday, Wednesday, Friday. */
const LABELED_WEEKDAYS = new Set([1, 3, 5]);
const LEVEL_CLASSES = ['l0', 'l1', 'l2', 'l3', 'l4'] as const;
const KEY_DELTAS: Partial<Record<string, number>> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };
/** Distance of the tooltip from the cell and from the viewport edges (px). */
const TIP_GAP = 8;

let instances = 0;

interface Snapshot { habit: Habit; logs: readonly HabitLog[]; today: Day }

// Note on touch targets (approved decision 4, audit D5): heatmap cells stay 12 px with a 3 px gap
// (F §4.10) and are the only documented exception to the 48 px rule. The grid is a dense data view
// with a complete keyboard alternative (arrows, Enter/Space, Home/End); a tap moves the cursor to the
// cell so the tooltip names date and status, and the owner shows a toast with "Rückgängig" for
// every toggle, so a mis-tap can be undone at once.
export class OlHeatmap extends HTMLElement {
  static observedAttributes = ['habit-id', 'weeks'];

  private grid: HTMLElement | null = null;
  private tip: HTMLElement | null = null;
  private live: HTMLElement | null = null;
  private cells: HTMLElement[] = [];
  private data: Snapshot | null = null;
  private statusByDay = new Map<Day, HabitLog['status']>();
  /** First day of the grid (Monday). */
  private start: Day | null = null;
  /** Cursor day; null follows today. */
  private cursor: Day | null = null;
  private cursorCell: HTMLElement | null = null;
  private hoverDay: Day | null = null;
  /** Day the visible tooltip describes, null when hidden. */
  private tipDay: Day | null = null;
  private subscriptions: Array<{ unsubscribe(): void }> = [];
  private subscribedId: string | null = null;
  private stopDayWatch: (() => void) | null = null;
  private readonly tipId = `ol-heatmap-tip-${++instances}`;

  connectedCallback(): void {
    this.ensureSkeleton();
    this.stopDayWatch ??= onDayChange(() => this.onNewDay());
    document.addEventListener('scroll', this.onViewportChange, { capture: true, passive: true });
    window.addEventListener('resize', this.onViewportChange, { passive: true });
    this.syncSubscription();
    this.update();
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    this.stopDayWatch?.();
    this.stopDayWatch = null;
    document.removeEventListener('scroll', this.onViewportChange, { capture: true });
    window.removeEventListener('resize', this.onViewportChange);
    this.hideTip();
  }

  attributeChangedCallback(name = '', oldValue: string | null = null, newValue: string | null = null): void {
    if (oldValue === newValue) return;
    if (name === 'habit-id') {
      this.cursor = null;
      if (this.isConnected) this.syncSubscription();
    } else if (name === 'weeks') {
      this.update();
    }
  }

  /**
   * Renders a snapshot: the habit, its logs and the day that counts as today. Used by the
   * liveQuery subscription and usable directly (tests, owners that already hold the data).
   */
  setData(habit: Habit, logs: readonly HabitLog[], today: Day): void {
    const status = new Map<Day, HabitLog['status']>();
    for (const log of logs) {
      if (log.habitId !== habit.id) continue;
      if (log.status === 'done' || !status.has(log.day)) status.set(log.day, log.status);
    }
    this.statusByDay = status;
    this.data = { habit, logs, today };
    this.update();
  }

  /** Current cursor day (today unless moved). */
  get cursorDay(): Day | null {
    if (!this.data || !this.start) return null;
    return this.clamp(this.cursor ?? this.data.today);
  }

  // ---------------------------------------------------------------------------
  // Data

  private syncSubscription(): void {
    const id = this.getAttribute('habit-id');
    if (id === this.subscribedId && this.subscriptions.length > 0) return;
    this.unsubscribe();
    if (!id || !this.isConnected) return;
    this.subscribedId = id;
    let habit: Habit | undefined;
    let logs: HabitLog[] | undefined;
    const push = (): void => {
      if (habit && logs && habit.id === this.subscribedId) this.setData(habit, logs, currentDay());
    };
    const fail = (error: unknown): void => console.error(error);
    this.subscriptions.push(
      habit$(id).subscribe({ next: (value) => { habit = value; push(); }, error: fail }),
      habitLogs$(id).subscribe({ next: (value) => { logs = value; push(); }, error: fail }),
    );
  }

  private unsubscribe(): void {
    for (const sub of this.subscriptions) sub.unsubscribe();
    this.subscriptions = [];
    this.subscribedId = null;
  }

  private onNewDay(): void {
    if (!this.data) return;
    this.data = { ...this.data, today: currentDay() };
    this.update();
  }

  private weeks(): number {
    const value = Number(this.getAttribute('weeks') ?? DEFAULT_WEEKS);
    return Number.isInteger(value) && value >= 1 ? Math.min(value, MAX_WEEKS) : DEFAULT_WEEKS;
  }

  // ---------------------------------------------------------------------------
  // Rendering

  private ensureSkeleton(): void {
    if (this.grid) return;
    const labels = [1, 2, 3, 4, 5, 6, 7].map(
      (wd) => h`<span class="ol-heatmap__weekday" aria-hidden="true">${LABELED_WEEKDAYS.has(wd) ? weekdayShort(wd) : ''}</span>`,
    );
    render(
      this,
      h`<div class="ol-heatmap__grid" tabindex="0" role="group" aria-describedby="${this.tipId}">${labels}</div>
        <div class="ol-heatmap__tip" id="${this.tipId}" role="tooltip" hidden></div>
        <p class="ol-visually-hidden" aria-live="polite"></p>`,
    );
    this.grid = this.querySelector<HTMLElement>('.ol-heatmap__grid');
    this.tip = this.querySelector<HTMLElement>('.ol-heatmap__tip');
    this.live = this.querySelector<HTMLElement>('[aria-live]');
    const grid = this.grid;
    if (!grid) return;
    grid.addEventListener('keydown', this.onKeyDown);
    grid.addEventListener('click', this.onClick);
    grid.addEventListener('pointerover', this.onPointerOver);
    grid.addEventListener('pointerout', this.onPointerOut);
    grid.addEventListener('focus', this.onFocus);
    grid.addEventListener('blur', this.onBlur);
  }

  /** Keeps exactly `count` day cells after the seven weekday labels. */
  private ensureCells(count: number): void {
    const grid = this.grid;
    if (!grid) return;
    while (this.cells.length < count) {
      const cell = document.createElement('span');
      cell.className = 'ol-heatmap__cell';
      grid.append(cell);
      this.cells.push(cell);
    }
    while (this.cells.length > count) this.cells.pop()?.remove();
  }

  private update(): void {
    const snap = this.data;
    if (!snap || !this.grid) return;
    const { habit, logs, today } = snap;
    const weeks = this.weeks();
    const start = addDays(startOfWeek(today), -7 * (weeks - 1));
    this.start = start;
    this.ensureCells(weeks * 7);

    const countFrom = habit.startDay > start ? habit.startDay : start;
    let done = 0;
    let total = 0;
    this.cells.forEach((cell, i) => {
      const day = addDays(start, i);
      const future = day > today;
      if (cell.dataset['day'] !== day) cell.dataset['day'] = day;
      const level = future ? -1 : stageAt(habit, logs, day);
      LEVEL_CLASSES.forEach((cls, l) => cell.classList.toggle(cls, l === level));
      cell.classList.toggle('ol-heatmap__cell--today', day === today);
      cell.classList.toggle('ol-heatmap__cell--future', future);
      if (future) cell.setAttribute('aria-hidden', 'true');
      else cell.removeAttribute('aria-hidden');
      if (!future && day >= countFrom && isScheduledOn(habit, day)) {
        total++;
        if (this.statusByDay.get(day) === 'done') done++;
      }
    });

    const template = weeks === DEFAULT_WEEKS ? t.heatmapAria : t.heatmapAriaWeeks;
    const label = fmt(template, { name: habit.name, n: done, m: total, weeks });
    if (this.grid.getAttribute('aria-label') !== label) this.grid.setAttribute('aria-label', label);

    if (this.cursor !== null) {
      const clamped = this.clamp(this.cursor);
      this.cursor = clamped === today ? null : clamped;
    }
    this.markCursor();
    // Keep a visible tooltip current without announcing (data changes are announced by the owner's toast).
    if (this.tipDay !== null) {
      const day = this.hoverDay ?? (this.isFocused() ? this.cursorDay : null);
      if (day) this.showTip(day);
      else this.hideTip();
    }
  }

  private clamp(day: Day): Day {
    const snap = this.data;
    if (!snap || !this.start) return day;
    if (day < this.start) return this.start;
    if (day > snap.today) return snap.today;
    return day;
  }

  private cellFor(day: Day): HTMLElement | null {
    if (!this.start) return null;
    return this.cells[diffDays(day, this.start)] ?? null;
  }

  private markCursor(): void {
    const day = this.cursorDay;
    const cell = day ? this.cellFor(day) : null;
    if (cell === this.cursorCell) return;
    this.cursorCell?.classList.remove('ol-heatmap__cell--cursor');
    cell?.classList.add('ol-heatmap__cell--cursor');
    this.cursorCell = cell;
  }

  private isFocused(): boolean {
    return this.grid !== null && document.activeElement === this.grid;
  }

  // ---------------------------------------------------------------------------
  // Tooltip and live region

  private tipText(day: Day): string {
    const snap = this.data;
    const date = formatDayLong(day);
    if (!snap || day > snap.today) return fmt(t.heatmapTooltip, { date, status: t.heatmapStatusFuture });
    const status = this.statusByDay.get(day);
    if (status === 'done') {
      const stage = stageName(stageAt(snap.habit, snap.logs, day));
      return fmt(t.heatmapTooltipStage, { date, status: t.heatmapStatusDone, stage });
    }
    return fmt(t.heatmapTooltip, { date, status: status === 'skipped' ? t.heatmapStatusSkipped : t.heatmapStatusOpen });
  }

  private showTip(day: Day): void {
    const tip = this.tip;
    const cell = this.cellFor(day);
    if (!tip || !cell) return;
    const text = this.tipText(day);
    if (tip.textContent !== text) tip.textContent = text;
    tip.hidden = false;
    this.tipDay = day;
    this.placeTip(tip, cell);
  }

  /** Positions the fixed tooltip above the cell (below when there is no room), clamped to the viewport. */
  private placeTip(tip: HTMLElement, cell: HTMLElement): void {
    // Measure at the origin first: an ancestor with a transform (an animated sheet) becomes the
    // containing block of a fixed element, so the offset is relative to wherever (0, 0) lands.
    tip.style.transform = 'none';
    const origin = tip.getBoundingClientRect();
    const rect = cell.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const maxX = Math.max(TIP_GAP, viewportWidth - TIP_GAP - origin.width);
    const x = Math.min(maxX, Math.max(TIP_GAP, rect.left + rect.width / 2 - origin.width / 2));
    let y = rect.top - TIP_GAP - origin.height;
    if (y < TIP_GAP) y = rect.bottom + TIP_GAP;
    y = Math.max(TIP_GAP, Math.min(y, viewportHeight - TIP_GAP - origin.height));
    tip.style.transform = `translate(${Math.round(x - origin.left)}px, ${Math.round(y - origin.top)}px)`;
  }

  private hideTip(): void {
    if (this.tip) this.tip.hidden = true;
    this.tipDay = null;
  }

  private announce(day: Day): void {
    if (this.live) this.live.textContent = this.tipText(day);
  }

  // ---------------------------------------------------------------------------
  // Interaction

  private moveCursor(day: Day, announce: boolean): void {
    const snap = this.data;
    if (!snap) return;
    const next = this.clamp(day);
    this.cursor = next === snap.today ? null : next;
    this.markCursor();
    if (!this.hoverDay || this.hoverDay === next) this.showTip(next);
    if (announce) this.announce(next);
  }

  private toggle(day: Day): void {
    const snap = this.data;
    if (!snap || !this.start || day > snap.today || day < this.start) return;
    emit<ToggleDayDetail>(this, 'ol-toggle-day', { day });
  }

  private dayOf(target: EventTarget | null): Day | null {
    if (!(target instanceof Element)) return null;
    const cell = target.closest<HTMLElement>('.ol-heatmap__cell');
    if (!cell || !this.grid?.contains(cell)) return null;
    return cell.dataset['day'] ?? null;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const snap = this.data;
    const current = this.cursorDay;
    if (!snap || !this.start || !current) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const delta = KEY_DELTAS[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      this.hoverDay = null;
      this.moveCursor(addDays(current, delta), true);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      this.hoverDay = null;
      this.moveCursor(event.key === 'Home' ? this.start : snap.today, true);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!event.repeat) this.toggle(current);
    } else if (event.key === 'Escape') {
      // Dismiss the tooltip (WCAG 1.4.13); the event continues so a surrounding sheet still closes.
      this.hideTip();
    }
  };

  private readonly onClick = (event: MouseEvent): void => {
    const day = this.dayOf(event.target);
    const snap = this.data;
    if (!day || !snap || day > snap.today) return;
    if (!this.isFocused()) this.grid?.focus({ preventScroll: true });
    this.hoverDay = null;
    this.moveCursor(day, true);
    this.toggle(day);
  };

  private readonly onPointerOver = (event: PointerEvent): void => {
    const day = this.dayOf(event.target);
    if (!day) return;
    this.hoverDay = day;
    this.showTip(day);
  };

  private readonly onPointerOut = (event: PointerEvent): void => {
    if (!this.dayOf(event.target)) return;
    if (this.dayOf(event.relatedTarget)) return; // moving to another cell: its pointerover follows
    this.hoverDay = null;
    const cursor = this.isFocused() ? this.cursorDay : null;
    if (cursor) this.showTip(cursor);
    else this.hideTip();
  };

  private readonly onFocus = (): void => {
    this.markCursor();
    const day = this.cursorDay;
    if (day && !this.hoverDay) this.showTip(day);
  };

  private readonly onBlur = (): void => {
    if (!this.hoverDay) this.hideTip();
  };

  private readonly onViewportChange = (): void => {
    if (this.tipDay === null) return;
    const cell = this.cellFor(this.tipDay);
    if (!this.tip || !cell) return;
    const rect = cell.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    if (rect.bottom < 0 || rect.top > viewportHeight) this.hideTip();
    else this.placeTip(this.tip, cell);
  };
}

if (!customElements.get('ol-heatmap')) customElements.define('ol-heatmap', OlHeatmap);
