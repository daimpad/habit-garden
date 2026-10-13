// PLANUNG Kanban and Matrix (Phase 3 part 2, Feinkonzept A.2 P5/P6, A.3 Screen 2).
// Contract (planung.ts mounts it):
// - new PlanungBoard(container, 'kanban' | 'matrix') renders its skeleton into `container` and owns it;
//   update(ctx) is called on every data emission and patches cards by task id (no full re-render; a card
//   element moves between columns, so focus on it survives); destroy() removes listeners and the drag.
// - Kanban: columns Offen · In Arbeit · Erledigt (Task.status). Narrow screens: 85 % wide columns with a
//   peek of the next (horizontal scroll-snap paging); from 900 px three columns side by side. Head with
//   counter. Erledigt lists ctx.doneTasks completed in the last 14 days, newest first, at most 30.
//   Open columns: dated tasks in due order, then undated ones newest first.
// - Matrix: 2×2 quadrants by Task.important/urgent over ctx.tasks (open and in progress), each with its
//   own scroll area and a count badge. Tapping a quadrant head shows that quadrant alone ("Vollbild",
//   A.3), with a back state on the same head button (and Esc).
// - Card: area strip (--tint), title button (tap emits 'ol-navigate' to /aufgabe/:id), meta line
//   (project name when ctx.showProject · due date, or "erledigt {date}" in Erledigt · subtask ratio),
//   and a "Verschieben" icon button (keyboard path, A.2): a small menu (openActionMenu) with the other
//   columns/quadrants.
// - Long-press drag (util/drag.ts, 350 ms) moves a card to another column/quadrant. Status writes: to
//   'done' via completeTask (recurring tasks get their follow-up), from 'done' via reopenTask (then
//   updateTask for 'doing'), 'open'↔'doing' via updateTask. Matrix: updateTask({ important, urgent }).
//   The card moves at once (optimistic); a failed write restores the last data. A toast names the new
//   column/quadrant (completion: doneMessage) with Rückgängig restoring the previous status or flags.
//   One write per card at a time; updates that arrive during a drag are applied when it ends.
import '../components/ol-icon-button.js';
import { showToast } from '../components/ol-toast.js';
import { fmt, t } from '../i18n/de.js';
import { GENERIC_TINT, type Area, type Id, type Project, type Task } from '../model.js';
import { compareDue, completeTask, reopenTask, updateTask } from '../repo/tasks.js';
import { addDays, compareIso, dayOfIso, formatDayShort, formatTime, today } from '../util/date.js';
import { emit, h, icon, render } from '../util/dom.js';
import { attachLongPressDrag } from '../util/drag.js';
import { doneMessage, failed, openActionMenu } from './sheets/task.js';

export interface BoardContext {
  /** Open top-level tasks in scope (status 'open' or 'doing'). */
  tasks: readonly Task[];
  /** Done top-level tasks in scope (the caller passes the last 14 days; filtered again here). */
  doneTasks: readonly Task[];
  projects: ReadonlyMap<Id, Project>;
  areas: ReadonlyMap<Id, Area>;
  /** Subtask ratios by task id. */
  progress: ReadonlyMap<Id, { done: number; total: number }>;
  showProject: boolean;
}

export type BoardKind = 'kanban' | 'matrix';
type Status = Task['status'];
type Quadrant = 'q1' | 'q2' | 'q3' | 'q4';
type Zone = Status | Quadrant;

interface ZoneDef { key: Zone; label: string; icon: string }

const COLUMNS: readonly ZoneDef[] = [
  { key: 'open', label: t.taskStatusOpen, icon: 'inbox' },
  { key: 'doing', label: t.taskStatusDoing, icon: 'sprout' },
  { key: 'done', label: t.taskStatusDone, icon: 'circle-check' },
];
const QUADRANTS: readonly ZoneDef[] = [
  { key: 'q1', label: t.boardQuadrantQ1, icon: 'flame' },
  { key: 'q2', label: t.boardQuadrantQ2, icon: 'flag' },
  { key: 'q3', label: t.boardQuadrantQ3, icon: 'alarm-clock' },
  { key: 'q4', label: t.boardQuadrantQ4, icon: 'moon' },
];
const FLAGS: Readonly<Record<Quadrant, { important: 0 | 1; urgent: 0 | 1 }>> = {
  q1: { important: 1, urgent: 1 }, q2: { important: 1, urgent: 0 }, q3: { important: 0, urgent: 1 }, q4: { important: 0, urgent: 0 },
};
const DONE_DAYS = 14;
const DONE_MAX = 30;
const OVERRIDE_MAX_MS = 3000;

let boardSeq = 0;

function isStatus(value: string | undefined): value is Status {
  return value === 'open' || value === 'doing' || value === 'done';
}

function isQuadrant(value: string | undefined): value is Quadrant {
  return value === 'q1' || value === 'q2' || value === 'q3' || value === 'q4';
}

export function quadrantOf(task: Pick<Task, 'important' | 'urgent'>): Quadrant {
  if (task.important === 1) return task.urgent === 1 ? 'q1' : 'q2';
  return task.urgent === 1 ? 'q3' : 'q4';
}

/** Open columns and quadrants: dated tasks in due order, then undated ones newest first. */
function compareOpen(a: Task, b: Task): number {
  const da = a.dueDay !== undefined;
  const dbDated = b.dueDay !== undefined;
  if (da !== dbDated) return da ? -1 : 1;
  if (da) return compareDue(a, b);
  return compareIso(b.createdAt, a.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Done tasks of the last 14 days (today included), newest completion first, at most 30. */
function recentDone(tasks: readonly Task[], day: string): Task[] {
  const from = addDays(day, -(DONE_DAYS - 1));
  return tasks
    .filter((task) => task.status === 'done' && task.completedAt !== undefined && dayOfIso(task.completedAt) >= from)
    .sort((a, b) => compareIso(b.completedAt, a.completedAt))
    .slice(0, DONE_MAX);
}

/**
 * Tasks per zone of a board kind. `overrides` pins tasks with a pending move to their new zone (optimistic
 * UI); `known` supplies the last seen record of such a task while it is missing from both lists (a done
 * task can leave ctx.tasks before it arrives in ctx.doneTasks). A task in both lists counts once (newer).
 */
function zonesOf(kind: BoardKind, ctx: BoardContext, overrides: ReadonlyMap<Id, Zone>, known: ReadonlyMap<Id, Task>): Map<Zone, Task[]> {
  const byId = new Map<Id, Task>();
  const add = (task: Task): void => {
    const seen = byId.get(task.id);
    if (!seen || compareIso(task.updatedAt, seen.updatedAt) > 0) byId.set(task.id, task);
  };
  for (const task of ctx.tasks) if (task.status !== 'done') add(task);
  if (kind === 'kanban') for (const task of recentDone(ctx.doneTasks, today())) add(task);
  for (const id of overrides.keys()) {
    const task = known.get(id);
    if (task && !byId.has(id)) byId.set(id, task);
  }
  const out = new Map<Zone, Task[]>();
  for (const def of kind === 'kanban' ? COLUMNS : QUADRANTS) out.set(def.key, []);
  for (const task of byId.values()) {
    const zone = overrides.get(task.id) ?? (kind === 'kanban' ? task.status : quadrantOf(task));
    out.get(zone)?.push(task);
  }
  for (const [zone, list] of out) {
    if (zone === 'done') list.sort((a, b) => (a.completedAt === undefined ? -1 : b.completedAt === undefined ? 1 : compareIso(b.completedAt, a.completedAt)));
    else list.sort(compareOpen);
  }
  return out;
}

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function req<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`planung-board: missing ${selector}`);
  return el;
}

/** "14.10." or "14.10., 09:00". */
function dueText(task: Task): string {
  if (!task.dueDay) return '';
  const day = formatDayShort(task.dueDay);
  return task.dueHasTime === 1 && task.dueAt ? `${day}, ${formatTime(task.dueAt)}` : day;
}

export class PlanungBoard {
  private readonly root: HTMLElement;
  private readonly zones: readonly ZoneDef[];
  private readonly cards = new Map<Id, HTMLElement>();
  private readonly tasks = new Map<Id, Task>();
  private readonly busy = new Set<Id>();
  /** Pending moves: the card stays in its new zone until the data agrees (or the write fails). */
  private readonly overrides = new Map<Id, Zone>();
  private readonly overrideTimers = new Map<Id, number>();
  private readonly detach: Array<() => void> = [];
  private readonly uid = `board-${++boardSeq}`;
  private ctx: BoardContext | null = null;
  private dragging = false;
  private deferred = false;
  private expanded: Quadrant | null = null;
  private pendingFocus: Id | null = null;
  private destroyed = false;

  constructor(private readonly container: HTMLElement, private readonly kind: BoardKind) {
    this.zones = kind === 'kanban' ? COLUMNS : QUADRANTS;
    render(container, kind === 'kanban' ? this.kanbanSkeleton() : this.matrixSkeleton());
    this.root = req<HTMLElement>(container, '.ol-board');
    this.bind();
  }

  update(ctx: BoardContext): void {
    if (this.destroyed) return;
    this.ctx = ctx;
    if (this.dragging) {
      this.deferred = true;
      return;
    }
    this.patch();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const off of this.detach.splice(0)) off();
    for (const timer of this.overrideTimers.values()) window.clearTimeout(timer);
    this.overrideTimers.clear();
    this.overrides.clear();
    this.cards.clear();
    this.tasks.clear();
    this.container.replaceChildren();
  }

  // --- Skeleton ---

  private kanbanSkeleton(): ReturnType<typeof h> {
    return h`<div class="ol-board ol-board--kanban" role="region" aria-label="${t.boardKanbanAria}">
      <div class="ol-board__columns">
        ${COLUMNS.map((c) => h`<section class="ol-board__zone ol-board__col" data-zone="${c.key}" aria-labelledby="${this.uid}-${c.key}">
          <div class="ol-board__head">
            <span class="ol-board__head-icon" aria-hidden="true">${icon(c.icon, 20)}</span>
            <h2 class="ol-board__heading" id="${this.uid}-${c.key}">${c.label}</h2>
            <span class="ol-board__count ol-num"></span>
          </div>
          ${c.key === 'done' ? h`<p class="ol-board__note ol-caption">${t.boardDoneRecent}</p>` : ''}
          <p class="ol-board__empty ol-caption">${t.boardZoneEmpty}</p>
          <ul class="ol-board__list"></ul>
        </section>`)}
      </div>
    </div>`;
  }

  private matrixSkeleton(): ReturnType<typeof h> {
    return h`<div class="ol-board ol-board--matrix" role="region" aria-label="${t.boardMatrixAria}">
      <div class="ol-board__quads">
        ${QUADRANTS.map((q) => h`<section class="ol-board__zone ol-board__quad" data-zone="${q.key}" aria-labelledby="${this.uid}-${q.key}">
          <h2 class="ol-board__qheading">
            <button type="button" class="ol-board__qhead" aria-expanded="false">
              <span class="ol-board__qback" aria-hidden="true">${icon('arrow-left', 20)}</span>
              <span class="ol-board__head-icon" aria-hidden="true">${icon(q.icon, 20)}</span>
              <span class="ol-board__qtitle" id="${this.uid}-${q.key}">${q.label}</span>
              <span class="ol-board__count ol-num"></span>
              <span class="ol-board__qchev" aria-hidden="true">${icon('chevron-right', 20)}</span>
            </button>
          </h2>
          <p class="ol-board__empty ol-caption">${t.boardZoneEmpty}</p>
          <ul class="ol-board__list"></ul>
        </section>`)}
      </div>
    </div>`;
  }

  private bind(): void {
    const root = this.root;
    const onClick = (event: MouseEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const head = target.closest<HTMLElement>('.ol-board__qhead');
      if (head) {
        const zone = head.closest<HTMLElement>('[data-zone]')?.dataset['zone'];
        if (isQuadrant(zone)) this.toggleExpanded(zone);
        return;
      }
      const card = target.closest<HTMLElement>('.ol-board__card');
      const id = card?.dataset['id'];
      if (!card || !id) return;
      if (target.closest('.ol-board__move')) this.openMoveMenu(id);
      else if (target.closest('.ol-board__title')) emit(card, 'ol-navigate', { path: `/aufgabe/${encodeURIComponent(id)}` });
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !this.expanded || this.dragging || event.defaultPrevented) return;
      event.preventDefault();
      this.toggleExpanded(this.expanded);
    };
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    this.detach.push(() => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKey);
    });
    this.detach.push(attachLongPressDrag(root, {
      itemSelector: '.ol-board__card',
      targetSelector: '.ol-board__zone',
      axis: this.kind === 'kanban' ? 'x' : 'both',
      autoScroll: this.kind === 'kanban' ? root.querySelector<HTMLElement>('.ol-board__columns') : null,
      canStart: (item) => !this.expanded && !this.busy.has(item.dataset['id'] ?? ''),
      onStart: () => {
        this.dragging = true;
      },
      onDrop: (item, target) => {
        const id = item.dataset['id'];
        const zone = target.dataset['zone'];
        if (id && zone) this.move(id, zone);
      },
      onEnd: () => {
        this.dragging = false;
        if (this.deferred) {
          this.deferred = false;
          this.patch();
        }
      },
    }));
  }

  // --- Rendering ---

  private zoneEl(key: Zone): HTMLElement {
    return req<HTMLElement>(this.root, `.ol-board__zone[data-zone="${key}"]`);
  }

  private patch(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const active = document.activeElement;
    const grouped = zonesOf(this.kind, ctx, this.overrides, this.tasks);
    const seen = new Set<Id>();
    const known = new Map(this.tasks);
    this.tasks.clear();
    for (const def of this.zones) {
      const items = grouped.get(def.key) ?? [];
      const zone = this.zoneEl(def.key);
      const list = req<HTMLElement>(zone, '.ol-board__list');
      items.forEach((task, i) => {
        seen.add(task.id);
        this.tasks.set(task.id, task);
        let card = this.cards.get(task.id);
        if (!card) {
          card = this.createCard();
          card.dataset['id'] = task.id;
          this.cards.set(task.id, card);
        }
        const at = list.children[i] ?? null;
        if (at !== card) list.insertBefore(card, at);
        this.updateCard(card, task, def.key, ctx);
      });
      const count = req<HTMLElement>(zone, '.ol-board__count');
      setText(count, String(items.length));
      setAttr(count, 'aria-label', fmt(t.boardCountAria, { n: items.length }));
      req<HTMLElement>(zone, '.ol-board__empty').hidden = items.length > 0;
      zone.classList.toggle('is-empty', items.length === 0);
      const head = zone.querySelector<HTMLElement>('.ol-board__qhead');
      if (head) {
        setAttr(head, 'aria-label', this.expanded === def.key ? t.boardQuadrantBack : fmt(t.boardQuadrantOpenAria, { quadrant: def.label, n: items.length }));
      }
    }
    // A pending move is settled once the data shows the task in its new zone (or the task is gone).
    for (const [id, zone] of this.overrides) {
      const fresh = this.dataTask(ctx, id);
      if (!this.busy.has(id) && (!fresh ? !known.has(id) : this.zoneOfTask(fresh) === zone)) this.clearOverride(id);
    }
    for (const [id, card] of this.cards) {
      if (seen.has(id)) continue;
      card.remove();
      this.cards.delete(id);
    }
    if (active instanceof HTMLElement && active.isConnected && document.activeElement !== active && this.root.contains(active)) {
      active.focus({ preventScroll: true });
    }
    this.focusPending();
  }

  private createCard(): HTMLElement {
    const li = document.createElement('li');
    li.className = 'ol-board__card';
    render(li, h`<button type="button" class="ol-board__title"></button>
      <span class="ol-board__foot">
        <span class="ol-board__meta ol-caption">
          <span class="ol-board__project"></span>
          <span class="ol-board__date"></span>
          <span class="ol-board__ratio ol-num"></span>
        </span>
        <ol-icon-button class="ol-board__move" icon="ellipsis" label="${t.boardMove}"></ol-icon-button>
      </span>`);
    return li;
  }

  private updateCard(card: HTMLElement, task: Task, zone: Zone, ctx: BoardContext): void {
    const tint = ctx.areas.get(task.areaId)?.tint ?? GENERIC_TINT;
    if (card.style.getPropertyValue('--tint') !== tint) card.style.setProperty('--tint', tint);
    card.classList.toggle('ol-board__card--done', zone === 'done');
    const title = req<HTMLElement>(card, '.ol-board__title');
    setText(title, task.title);
    setAttr(title, 'aria-label', fmt(t.planOpenAria, { title: task.title }));

    const project = ctx.showProject && task.projectId ? ctx.projects.get(task.projectId) : undefined;
    const projectEl = req<HTMLElement>(card, '.ol-board__project');
    setText(projectEl, project?.name ?? '');
    projectEl.hidden = !project;

    const dateEl = req<HTMLElement>(card, '.ol-board__date');
    let date = '';
    let overdue = false;
    if (zone === 'done') {
      date = task.completedAt ? fmt(t.boardDoneOn, { date: formatDayShort(dayOfIso(task.completedAt)) }) : '';
    } else {
      date = dueText(task);
      overdue = task.dueDay !== undefined && task.dueDay < today();
    }
    setText(dateEl, date);
    dateEl.hidden = !date;
    dateEl.classList.toggle('ol-board__date--overdue', overdue);

    const ratio = ctx.progress.get(task.id);
    const ratioEl = req<HTMLElement>(card, '.ol-board__ratio');
    const hasRatio = ratio !== undefined && ratio.total > 0;
    setText(ratioEl, hasRatio ? fmt(t.subtaskProgress, { done: ratio.done, total: ratio.total }) : '');
    if (hasRatio) setAttr(ratioEl, 'aria-label', fmt(t.subtaskProgressAria, { done: ratio.done, total: ratio.total }));
    ratioEl.hidden = !hasRatio;

    const moveBtn = req<HTMLElement>(card, '.ol-board__move');
    setAttr(moveBtn, 'label', fmt(t.boardMoveAria, { title: task.title }));
    card.classList.toggle('is-busy', this.busy.has(task.id));
  }

  private toggleExpanded(zone: Quadrant): void {
    this.expanded = this.expanded === zone ? null : zone;
    if (this.expanded) this.root.dataset['expanded'] = this.expanded;
    else delete this.root.dataset['expanded'];
    for (const def of this.zones) {
      const el = this.zoneEl(def.key);
      el.hidden = this.expanded !== null && def.key !== this.expanded;
      el.classList.toggle('is-expanded', def.key === this.expanded);
      const head = el.querySelector<HTMLElement>('.ol-board__qhead');
      if (head) setAttr(head, 'aria-expanded', String(def.key === this.expanded));
    }
    this.patch();
    const head = this.zoneEl(zone).querySelector<HTMLElement>('.ol-board__qhead');
    head?.focus({ preventScroll: true });
    if (this.expanded) this.root.scrollIntoView({ block: 'nearest' });
  }

  private focusPending(): void {
    const id = this.pendingFocus;
    if (!id) return;
    const active = document.activeElement;
    if (active && active !== document.body && !this.root.contains(active)) return;
    const card = this.cards.get(id);
    this.pendingFocus = null;
    card?.querySelector<HTMLElement>('.ol-board__move')?.focus({ preventScroll: false });
  }

  // --- Moving ---

  /** The task as the data has it (open list first, then the done list). */
  private dataTask(ctx: BoardContext, id: Id): Task | undefined {
    return ctx.tasks.find((x) => x.id === id) ?? ctx.doneTasks.find((x) => x.id === id);
  }

  private clearOverride(id: Id): void {
    this.overrides.delete(id);
    const timer = this.overrideTimers.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    this.overrideTimers.delete(id);
  }

  private zoneOfTask(task: Task): Zone {
    return this.kind === 'kanban' ? task.status : quadrantOf(task);
  }

  private labelOf(zone: Zone): string {
    return this.zones.find((z) => z.key === zone)?.label ?? '';
  }

  private openMoveMenu(id: Id): void {
    const task = this.tasks.get(id);
    if (!task || this.busy.has(id)) return;
    const from = this.zoneOfTask(task);
    const items = this.zones.filter((z) => z.key !== from).map((z) => ({
      label: z.label,
      icon: z.icon,
      run: () => {
        this.pendingFocus = id;
        this.move(id, z.key);
        void sheet.closed.then(() => window.requestAnimationFrame(() => this.focusPending()));
      },
    }));
    const sheet = openActionMenu(fmt(t.boardMoveTitle, { title: task.title }), items);
  }

  /** Moves a card to a zone: optimistic DOM move, write, toast with Rückgängig. */
  private move(id: Id, zone: string): void {
    const task = this.tasks.get(id);
    if (!task || this.busy.has(id)) return;
    const from = this.zoneOfTask(task);
    if (from === zone || this.overrides.has(id)) return;
    let write: Promise<string>;
    let undo: () => Promise<unknown>;
    if (this.kind === 'kanban' && isStatus(zone) && isStatus(from)) {
      write = this.writeStatus(id, from, zone);
      undo = () => this.writeStatus(id, zone, from);
    } else if (this.kind === 'matrix' && isQuadrant(zone)) {
      const before = { important: task.important, urgent: task.urgent };
      write = updateTask(id, FLAGS[zone]).then(() => fmt(t.boardToastMoved, { target: this.labelOf(zone) }));
      undo = () => updateTask(id, before);
    } else {
      return;
    }
    this.busy.add(id);
    this.overrides.set(id, zone);
    this.patch();
    write.then((message) => {
      this.busy.delete(id);
      showToast(message, { action: { label: t.actionUndo, onAction: () => void undo().catch(failed) } });
      // Normally the data emission settles the move; never keep a card pinned for longer than this.
      this.overrideTimers.set(id, window.setTimeout(() => {
        this.clearOverride(id);
        if (!this.dragging) this.patch();
      }, OVERRIDE_MAX_MS));
      if (!this.dragging) this.patch();
    }, (err: unknown) => {
      this.busy.delete(id);
      this.clearOverride(id);
      failed(err);
      if (!this.dragging) this.patch();
    });
  }

  /** Writes a status change; resolves with the toast text. */
  private async writeStatus(id: Id, from: Status, to: Status): Promise<string> {
    if (to === 'done') {
      const result = await completeTask(id);
      return doneMessage(result);
    }
    if (from === 'done') await reopenTask(id);
    if (to === 'doing' || from !== 'done') await updateTask(id, { status: to });
    return fmt(t.boardToastMoved, { target: this.labelOf(to) });
  }
}
