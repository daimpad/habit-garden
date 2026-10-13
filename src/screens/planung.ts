// PLANUNG (Phase 3 part 1, A.2 P1–P4/P7, A.3 Screen 2; decisions of 13.10.2026: same visual language as
// HEUTE — soft cards, area colour strip, flower glyphs, a project's progress as a small growing plant).
// One module mounts three routes:
// - /planung: area chips (Alle · areas · +), view segment Projekte · Liste, the Inbox row (only with
//   content), project cards (plant, progress, next due date) and "Neues Projekt"; or the grouped list.
//   Selected area and the view per area are persisted in Profile.planning.
// - /planung/p/:projectId: back, project name, ⋯ (Umbenennen, Bereich wechseln, Archivieren, Löschen),
//   progress row with plant, the project's open tasks grouped like the list view.
// - /planung/inbox: open top-level tasks without project and date; "Zuweisen" opens the project picker.
// Rows: checkbox (completeTask, toast with the next date of a recurring task and Rückgängig), title
// (opens /aufgabe/:id), meta (project · date). Kanban, Matrix, swipe gestures, search and ICS export
// follow in part 2. The FAB pre-fills area and project from planningContext() (G1).
// TODO(phase-3b): Kanban and Matrix with drag, swipe gestures (Liste, Inbox), search, ICS export, archive (P10).
import '../components/ol-app-bar.js';
import '../components/ol-button.js';
import '../components/ol-chip.js';
import '../components/ol-empty-state.js';
import '../components/ol-icon-button.js';
import '../components/ol-plant.js';
import '../components/ol-segmented.js';
import type { Subscription } from 'dexie';
import { flower } from '../components/flora.js';
import type { CheckboxChange } from '../components/ol-checkbox.js';
import { confirmDialog } from '../components/ol-dialog.js';
import type { OlInput } from '../components/ol-input.js';
import { createSheet, type OlSheet } from '../components/ol-sheet.js';
import { showToast } from '../components/ol-toast.js';
import { fmt, t } from '../i18n/de.js';
import { GENERIC_TINT, type Area, type Id, type PlanningView, type Profile, type Project, type Task } from '../model.js';
import { areas$ } from '../repo/areas.js';
import { openTasks$, setPlanningArea, setPlanningView, viewKey } from '../repo/planning.js';
import { profile$ } from '../repo/profile.js';
import {
  allProjects$, createProject, deleteProject, moveProject, projectStats$, restoreProject, setProjectArchived, updateProject,
  type ProjectStats,
} from '../repo/projects.js';
import { completeTask, reopenTask, updateTask } from '../repo/tasks.js';
import { back, type Route } from '../router.js';
import { groupForList, inScope, isInbox, LIST_GROUPS, projectStage, type ListGroupKey } from '../services/planning.js';
import { formatDayShort, formatTime, today } from '../util/date.js';
import { emit, h, icon, raw, render, setVar, type SafeHtml } from '../util/dom.js';
import { doneMessage, failed, openActionMenu } from './sheets/task.js';

const GROUP_LABELS: Readonly<Record<ListGroupKey, string>> = {
  overdue: t.focusGroupOverdue, today: t.planGroupToday, week: t.planGroupWeek, later: t.planGroupLater, noDate: t.focusGroupNoDate,
};
const VIEWS: readonly PlanningView[] = ['projects', 'list'];
const NAME_MAX = 120;

/** Area and project the FAB pre-fills while a PLANUNG route is mounted (G1). */
let context: { areaId?: Id; projectId?: Id } | null = null;
export function planningContext(): { areaId?: Id; projectId?: Id } | null {
  return context;
}

export function mount(view: HTMLElement, route: Route): () => void {
  const screen = new PlanungScreen(view, route);
  screen.start();
  return () => screen.destroy();
}

function req<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`planung: missing ${selector}`);
  return el;
}

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function children(el: Element): HTMLElement[] {
  return [...el.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
}

/** Keyed patch of a list by data-id (reuse, create, remove, reorder); focus survives moves. */
function syncList<T>(list: HTMLElement, items: readonly T[], keyOf: (item: T) => string,
  create: (item: T) => HTMLElement, update: (el: HTMLElement, item: T) => void): void {
  const active = document.activeElement;
  const existing = new Map<string, HTMLElement>();
  for (const el of children(list)) existing.set(el.dataset['id'] ?? '', el);
  const keys = new Set(items.map(keyOf));
  for (const [key, el] of existing) {
    if (keys.has(key)) continue;
    el.remove();
    existing.delete(key);
  }
  items.forEach((item, i) => {
    const key = keyOf(item);
    let el = existing.get(key);
    if (!el) {
      el = create(item);
      el.dataset['id'] = key;
    }
    const at = list.children[i] ?? null;
    if (at !== el) list.insertBefore(el, at);
    update(el, item);
  });
  if (active instanceof HTMLElement && active.isConnected && document.activeElement !== active) active.focus({ preventScroll: true });
}

/** "14.10." or "14.10., 09:00". */
function dueText(task: Task): string {
  if (!task.dueDay) return '';
  const day = formatDayShort(task.dueDay);
  return task.dueHasTime === 1 && task.dueAt ? `${day}, ${formatTime(task.dueAt)}` : day;
}

class PlanungScreen {
  private readonly subs: Subscription[] = [];
  private destroyed = false;
  private readonly kind: 'root' | 'project' | 'inbox';
  private readonly projectId: Id | undefined;

  private profile: Profile | null = null;
  private areas: Area[] | null = null;
  private projects: Project[] | null = null;
  private stats = new Map<Id, ProjectStats>();
  private tasks: Task[] | null = null;
  private gone = false;

  constructor(private readonly view: HTMLElement, route: Route) {
    this.kind = route.name === 'planung-project' ? 'project' : route.name === 'planung-inbox' ? 'inbox' : 'root';
    this.projectId = route.params['projectId'];
    this.renderSkeleton();
    this.bind();
  }

  start(): void {
    const watch = <T>(source: { subscribe(o: { next: (v: T) => void; error: (e: unknown) => void }): Subscription }, next: (v: T) => void): void => {
      this.subs.push(source.subscribe({
        next: (value: T) => {
          if (this.destroyed) return;
          try {
            next(value);
            this.render();
          } catch (err) {
            console.error(err);
          }
        },
        error: (err: unknown) => console.error(err),
      }));
    };
    watch(profile$(), (p: Profile) => { this.profile = p; });
    watch(areas$(true), (list: Area[]) => { this.areas = list; });
    watch(allProjects$(true), (list: Project[]) => { this.projects = list; });
    watch(projectStats$(), (map: Map<Id, ProjectStats>) => { this.stats = map; });
    watch(openTasks$(), (list: Task[]) => { this.tasks = list; });
  }

  destroy(): void {
    this.destroyed = true;
    for (const sub of this.subs) sub.unsubscribe();
    this.subs.length = 0;
    context = null;
  }

  // --- State ---

  private ready(): boolean {
    return this.profile !== null && this.areas !== null && this.projects !== null && this.tasks !== null;
  }

  private activeAreas(): Area[] {
    return (this.areas ?? []).filter((a) => a.archived === 0);
  }

  /** Selected area of the root screen (undefined = "Alle"); an archived or unknown area falls back to "Alle". */
  private selectedArea(): Id | undefined {
    const id = this.profile?.planning?.areaId;
    return id && this.activeAreas().some((a) => a.id === id) ? id : undefined;
  }

  private selectedView(): PlanningView {
    const stored = this.profile?.planning?.views?.[viewKey(this.selectedArea())];
    return stored && VIEWS.includes(stored) ? stored : 'projects';
  }

  private project(): Project | undefined {
    return this.projects?.find((p) => p.id === this.projectId);
  }

  private areaOf(id: Id | undefined): Area | undefined {
    return id ? this.areas?.find((a) => a.id === id) : undefined;
  }

  // --- Skeleton ---

  private renderSkeleton(): void {
    const view = this.view;
    if (this.kind === 'root') {
      render(view, h`
        <ol-app-bar display heading="${t.titlePlanung}">
          <ol-icon-button slot="actions" class="ol-plan__settings" icon="settings" label="${t.actionSettings}"></ol-icon-button>
        </ol-app-bar>
        <div class="ol-plan" data-loading>
          <div class="ol-plan__chips" role="radiogroup" aria-label="${t.planAreasAria}"></div>
          <ol-segmented class="ol-plan__views" label="${t.planViewAria}">
            <button type="button" data-value="projects">${t.planViewProjects}</button>
            <button type="button" data-value="list">${t.planViewList}</button>
          </ol-segmented>
          <section class="ol-plan__projects-view">
            <button type="button" class="ol-plan__inbox-row" hidden>
              <span class="ol-plan__inbox-icon" aria-hidden="true">${icon('inbox')}</span>
              <span class="ol-plan__inbox-label">${t.planInbox}</span>
              <span class="ol-plan__inbox-count ol-num"></span>
              <span aria-hidden="true">${icon('chevron-right', 20)}</span>
            </button>
            <div class="ol-section__head"><h2 class="ol-label">${t.planSectionProjects}</h2></div>
            <p class="ol-plan__empty ol-body-s" hidden>${t.planNoProjects}</p>
            <ul class="ol-plan__projects"></ul>
            <button type="button" class="ol-plan__add-project">${icon('folder-plus')}<span>${t.planProjectAdd}</span></button>
          </section>
          <section class="ol-plan__list-view" hidden>
            <p class="ol-plan__empty ol-body-s" hidden>${t.planListEmpty}</p>
            <div class="ol-plan__groups"></div>
          </section>
        </div>`);
    } else if (this.kind === 'project') {
      render(view, h`
        <ol-app-bar back heading="">
          <ol-icon-button slot="actions" class="ol-plan__more" icon="ellipsis" label="${t.actionMore}"></ol-icon-button>
        </ol-app-bar>
        <div class="ol-plan ol-plan--project" data-loading>
          <div class="ol-plan__progress">
            <ol-plant class="ol-plan__progress-plant" size="64" stage="0"></ol-plant>
            <div class="ol-plan__progress-text">
              <p class="ol-plan__progress-line ol-body"></p>
              <span class="ol-plan__bar" aria-hidden="true"><span class="ol-plan__bar-fill"></span></span>
              <p class="ol-plan__progress-next ol-caption"></p>
            </div>
          </div>
          <p class="ol-plan__empty ol-body-s" hidden>${t.planProjectEmpty}</p>
          <div class="ol-plan__groups"></div>
          <p class="ol-plan__gone ol-body" hidden>${t.projectMissing}</p>
        </div>`);
    } else {
      render(view, h`
        <ol-app-bar back heading="${t.planInbox}"></ol-app-bar>
        <div class="ol-plan ol-plan--inbox" data-loading>
          <p class="ol-plan__hint ol-body-s ol-text-2">${t.planInboxHint}</p>
          <p class="ol-plan__empty ol-body-s" hidden>${t.planInboxEmpty}</p>
          <ul class="ol-plan__list ol-plan__inbox-list"></ul>
        </div>`);
    }
  }

  private bind(): void {
    const view = this.view;
    view.querySelector('.ol-plan__settings')?.addEventListener('click', (event) => {
      if (event.currentTarget instanceof Element) emit(event.currentTarget, 'ol-navigate', { path: '/einstellungen' });
    });
    view.querySelector('.ol-plan__more')?.addEventListener('click', () => this.openProjectMenu());

    const chips = view.querySelector<HTMLElement>('.ol-plan__chips');
    chips?.addEventListener('ol-change', (event) => {
      const chip = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('ol-chip') : null;
      const value = chip?.getAttribute('value');
      if (!chip || value === null || value === undefined) return;
      if (value === '+') {
        event.preventDefault();
        emit(chip, 'ol-navigate', { path: '/einstellungen/bereiche' });
        return;
      }
      void setPlanningArea(value === 'all' ? undefined : value).catch(failed);
    });
    chips?.addEventListener('click', (event) => {
      const chip = event.target instanceof Element ? event.target.closest<HTMLElement>('ol-chip[value="+"]') : null;
      if (chip) emit(chip, 'ol-navigate', { path: '/einstellungen/bereiche' });
    });
    view.querySelector('.ol-plan__views')?.addEventListener('ol-change', (event) => {
      const value = event instanceof CustomEvent ? (event.detail as { value?: string } | null)?.value : undefined;
      if (value === 'projects' || value === 'list') void setPlanningView(viewKey(this.selectedArea()), value).catch(failed);
    });
    view.querySelector('.ol-plan__inbox-row')?.addEventListener('click', (event) => {
      event.preventDefault();
      if (event.currentTarget instanceof Element) emit(event.currentTarget, 'ol-navigate', { path: '/planung/inbox' });
    });
    view.querySelector('.ol-plan__add-project')?.addEventListener('click', () => this.openCreateProject());
    view.querySelector('.ol-plan__projects')?.addEventListener('click', (event) => {
      const card = event.target instanceof Element ? event.target.closest<HTMLElement>('.ol-plan__project') : null;
      const id = card?.closest<HTMLElement>('li[data-id]')?.dataset['id'];
      if (card && id) emit(card, 'ol-navigate', { path: `/planung/p/${encodeURIComponent(id)}` });
    });

    // Task rows (list view, project screen, inbox)
    view.addEventListener('ol-change', (event) => {
      const box = event.target instanceof Element ? event.target.closest('ol-checkbox') : null;
      const id = box?.closest<HTMLElement>('li[data-task]')?.dataset['task'];
      if (box && id && event instanceof CustomEvent) void this.onCheck(id, (event.detail as CheckboxChange).checked);
    });
    view.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest<HTMLElement>('li[data-task]');
      const id = row?.dataset['task'];
      if (!target || !row || !id) return;
      if (target.closest('.ol-plan__title')) emit(row, 'ol-navigate', { path: `/aufgabe/${encodeURIComponent(id)}` });
      else if (target.closest('.ol-plan__assign')) this.openAssign(id);
    });
  }

  // --- Rendering ---

  private render(): void {
    if (!this.ready()) return;
    this.view.querySelector('.ol-plan')?.removeAttribute('data-loading');
    if (this.kind === 'root') this.renderRoot();
    else if (this.kind === 'project') this.renderProject();
    else this.renderInbox();
  }

  private renderRoot(): void {
    const view = this.view;
    const areaId = this.selectedArea();
    context = areaId ? { areaId } : {};
    this.renderChips(areaId);
    const current = this.selectedView();
    const seg = req<HTMLElement>(view, '.ol-plan__views');
    setAttr(seg, 'value', current);
    req<HTMLElement>(view, '.ol-plan__projects-view').hidden = current !== 'projects';
    req<HTMLElement>(view, '.ol-plan__list-view').hidden = current !== 'list';
    const tasks = inScope(this.tasks ?? [], areaId ? { areaId } : {});

    // Inbox row (only with content)
    const inboxCount = tasks.filter(isInbox).length;
    const inboxRow = req<HTMLElement>(view, '.ol-plan__inbox-row');
    inboxRow.hidden = inboxCount === 0;
    setAttr(inboxRow, 'aria-label', fmt(t.planInboxCountAria, { n: inboxCount }));
    setText(req(view, '.ol-plan__inbox-count'), String(inboxCount));

    // Projects
    const projects = (this.projects ?? []).filter((p) => p.status === 'active' && (!areaId || p.areaId === areaId)
      && this.activeAreas().some((a) => a.id === p.areaId));
    const projectsView = req<HTMLElement>(view, '.ol-plan__projects-view');
    req<HTMLElement>(projectsView, '.ol-plan__empty').hidden = projects.length > 0;
    syncList(req<HTMLElement>(view, '.ol-plan__projects'), projects, (p) => p.id, () => this.createProjectCard(),
      (el, p) => this.updateProjectCard(el, p, !areaId));

    // List
    const listView = req<HTMLElement>(view, '.ol-plan__list-view');
    req<HTMLElement>(listView, '.ol-plan__empty').hidden = tasks.length > 0;
    this.renderGroups(req<HTMLElement>(listView, '.ol-plan__groups'), tasks, true);
  }

  private renderChips(selected: Id | undefined): void {
    const chips = req<HTMLElement>(this.view, '.ol-plan__chips');
    type Chip = { key: string; label: string; flower?: Area['flower']; tint?: string };
    const items: Chip[] = [
      { key: 'all', label: t.planAll },
      ...this.activeAreas().map((a) => ({ key: a.id, label: a.name, flower: a.flower, tint: a.tint })),
      { key: '+', label: t.areaAdd },
    ];
    syncList(chips, items, (c) => c.key, (c) => {
      const chip = document.createElement('ol-chip');
      if (c.key === '+') {
        chip.setAttribute('variant', 'assist');
        chip.setAttribute('icon', 'plus');
      } else {
        chip.setAttribute('kind', 'radio');
      }
      chip.setAttribute('value', c.key);
      return chip;
    }, (el, c) => {
      setAttr(el, 'label', c.label);
      if (c.flower) setAttr(el, 'flower', c.flower);
      if (c.tint) setAttr(el, 'tint', c.tint);
      if (c.key !== '+') el.toggleAttribute('selected', c.key === (selected ?? 'all'));
    });
  }

  private createProjectCard(): HTMLElement {
    const li = document.createElement('li');
    render(li, h`<button type="button" class="ol-plan__project">
      <ol-plant class="ol-plan__project-plant" size="48" stage="0"></ol-plant>
      <span class="ol-plan__project-body">
        <span class="ol-plan__project-name"></span>
        <span class="ol-plan__project-area ol-caption"></span>
        <span class="ol-plan__project-meta">
          <span class="ol-plan__bar" aria-hidden="true"><span class="ol-plan__bar-fill"></span></span>
          <span class="ol-plan__project-count ol-caption ol-num"></span>
          <span class="ol-plan__project-next ol-caption"></span>
        </span>
      </span>
    </button>`);
    return li;
  }

  private updateProjectCard(li: HTMLElement, project: Project, showArea: boolean): void {
    const area = this.areaOf(project.areaId);
    const tint = area?.tint ?? GENERIC_TINT;
    setVar(li, '--tint', tint);
    const stats = this.stats.get(project.id) ?? { done: 0, total: 0 };
    const plant = li.querySelector('ol-plant');
    if (plant) {
      setAttr(plant, 'flower', area?.flower ?? 'generic');
      setAttr(plant, 'tint', tint);
      setAttr(plant, 'stage', String(projectStage(stats.done, stats.total)));
    }
    setText(req(li, '.ol-plan__project-name'), project.name);
    const areaEl = req<HTMLElement>(li, '.ol-plan__project-area');
    areaEl.hidden = !showArea;
    setText(areaEl, area?.name ?? '');
    const fill = req<HTMLElement>(li, '.ol-plan__bar-fill');
    setVar(fill, '--progress', stats.total ? (stats.done / stats.total).toFixed(3) : '0');
    const count = req<HTMLElement>(li, '.ol-plan__project-count');
    setText(count, stats.total ? fmt(t.planProjectProgress, { done: stats.done, total: stats.total }) : t.planProjectNoTasks);
    setAttr(count, 'aria-label', stats.total ? fmt(t.planProjectProgressAria, { done: stats.done, total: stats.total }) : t.planProjectNoTasks);
    const next = req<HTMLElement>(li, '.ol-plan__project-next');
    next.hidden = !stats.nextDue;
    setText(next, stats.nextDue ? fmt(t.planProjectNext, { date: stats.nextDue === today() ? t.planNextToday : formatDayShort(stats.nextDue) }) : '');
  }

  /** Grouped task list (Überfällig · Heute · Diese Woche · Später · Ohne Datum). */
  private renderGroups(container: HTMLElement, tasks: readonly Task[], showProject: boolean): void {
    const groups = groupForList(tasks, today());
    const visible = LIST_GROUPS.filter((key) => groups[key].length > 0);
    syncList(container, visible, (k) => k, (key) => {
      const section = document.createElement('section');
      section.className = 'ol-plan__group';
      const headId = `plan-group-${key}`;
      section.setAttribute('aria-labelledby', headId);
      render(section, h`<div class="ol-section__head"><h2 class="ol-label" id="${headId}">${GROUP_LABELS[key]}</h2><span class="ol-caption ol-num ol-plan__group-count"></span></div>
        <ul class="ol-plan__list"></ul>`);
      section.dataset['group'] = key;
      return section;
    }, (section, key) => {
      const items = groups[key];
      setText(req(section, '.ol-plan__group-count'), String(items.length));
      this.renderRows(req<HTMLElement>(section, '.ol-plan__list'), items, showProject, false, key === 'overdue');
    });
  }

  private renderRows(list: HTMLElement, tasks: readonly Task[], showProject: boolean, assign: boolean, overdue = false): void {
    syncList(list, tasks, (task) => task.id, () => {
      const li = document.createElement('li');
      li.className = 'ol-plan__row';
      render(li, h`<ol-checkbox></ol-checkbox>
        <span class="ol-plan__row-text">
          <button type="button" class="ol-plan__title"></button>
          <span class="ol-plan__meta ol-caption"></span>
        </span>
        ${assign ? h`<ol-button class="ol-plan__assign" variant="tonal" size="sm" icon="folder-input" label="${t.taskAssign}"></ol-button>` : ''}`);
      return li;
    }, (li, task) => {
      li.dataset['task'] = task.id;
      setVar(li, '--tint', this.areaOf(task.areaId)?.tint ?? GENERIC_TINT);
      const box = li.querySelector('ol-checkbox');
      if (box) {
        setAttr(box, 'label', task.title);
        box.toggleAttribute('checked', false);
      }
      const title = req(li, '.ol-plan__title');
      setText(title, task.title);
      setAttr(title, 'aria-label', fmt(t.planOpenAria, { title: task.title }));
      const parts: string[] = [];
      const project = showProject && task.projectId ? this.projects?.find((p) => p.id === task.projectId) : undefined;
      if (project) parts.push(project.name);
      const due = dueText(task);
      if (due) parts.push(due);
      const meta = req<HTMLElement>(li, '.ol-plan__meta');
      setText(meta, parts.join(' · '));
      meta.hidden = parts.length === 0;
      meta.classList.toggle('ol-plan__meta--overdue', overdue);
      const assignBtn = li.querySelector('.ol-plan__assign');
      if (assignBtn) setAttr(assignBtn, 'aria-label', fmt(t.taskAssignAria, { title: task.title }));
    });
  }

  private renderProject(): void {
    const view = this.view;
    const project = this.project();
    const gone = req<HTMLElement>(view, '.ol-plan__gone');
    if (!project) {
      context = null;
      gone.hidden = false;
      for (const sel of ['.ol-plan__progress', '.ol-plan__groups', '.ol-plan__empty']) req<HTMLElement>(view, sel).hidden = true;
      this.view.querySelector<HTMLElement>('.ol-plan__more')?.setAttribute('hidden', '');
      return;
    }
    gone.hidden = true;
    context = { areaId: project.areaId, projectId: project.id };
    const bar = view.querySelector('ol-app-bar');
    if (bar) setAttr(bar, 'heading', project.name);
    const area = this.areaOf(project.areaId);
    const tint = area?.tint ?? GENERIC_TINT;
    const progress = req<HTMLElement>(view, '.ol-plan__progress');
    setVar(progress, '--tint', tint);
    const stats = this.stats.get(project.id) ?? { done: 0, total: 0 };
    const plant = req(view, '.ol-plan__progress-plant');
    setAttr(plant, 'flower', area?.flower ?? 'generic');
    setAttr(plant, 'tint', tint);
    setAttr(plant, 'stage', String(projectStage(stats.done, stats.total)));
    setText(req(view, '.ol-plan__progress-line'), stats.total ? fmt(t.planProgressLine, { done: stats.done, total: stats.total }) : t.planProjectNoTasks);
    setVar(req<HTMLElement>(view, '.ol-plan__bar-fill'), '--progress', stats.total ? (stats.done / stats.total).toFixed(3) : '0');
    const next = req<HTMLElement>(view, '.ol-plan__progress-next');
    next.hidden = !stats.nextDue;
    setText(next, stats.nextDue ? fmt(t.planProjectNext, { date: formatDayShort(stats.nextDue) }) : '');
    const tasks = inScope(this.tasks ?? [], { projectId: project.id });
    req<HTMLElement>(view, '.ol-plan__empty').hidden = tasks.length > 0;
    this.renderGroups(req<HTMLElement>(view, '.ol-plan__groups'), tasks, false);
  }

  private renderInbox(): void {
    context = {};
    const tasks = (this.tasks ?? []).filter(isInbox)
      .filter((task) => this.activeAreas().some((a) => a.id === task.areaId))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    req<HTMLElement>(this.view, '.ol-plan__empty').hidden = tasks.length > 0;
    this.renderRows(req<HTMLElement>(this.view, '.ol-plan__inbox-list'), tasks, false, true);
  }

  // --- Actions ---

  private async onCheck(id: Id, checked: boolean): Promise<void> {
    if (!checked) return;
    try {
      const result = await completeTask(id);
      showToast(doneMessage(result), { action: { label: t.actionUndo, onAction: () => void reopenTask(id).catch(failed) } });
    } catch (err) {
      failed(err);
    }
  }

  private openCreateProject(): void {
    const areas = this.activeAreas();
    let areaId = this.selectedArea() ?? areas[0]?.id;
    const sheet = createSheet({ title: t.projectCreateTitle, fit: true });
    render(sheet.bodyEl, h`<div class="ol-plan-sheet">
      <ol-input class="ol-plan-sheet__name" label="${t.projectNameLabel}" maxlength="${NAME_MAX}" autocomplete="off" autofocus></ol-input>
      <div class="ol-plan-sheet__areas" role="radiogroup" aria-label="${t.fieldArea}">
        ${areas.map((a) => h`<ol-chip kind="radio" value="${a.id}" flower="${a.flower}" tint="${a.tint}" label="${a.name}" ${a.id === areaId ? 'selected' : ''}></ol-chip>`)}
      </div>
    </div>`);
    render(sheet.footerEl, h`<ol-button class="ol-plan-sheet__save" variant="filled" label="${t.projectCreate}"></ol-button>`);
    const input = req<OlInput>(sheet.bodyEl, '.ol-plan-sheet__name');
    sheet.bodyEl.addEventListener('ol-change', (event) => {
      const chip = event.target instanceof Element ? event.target.closest('ol-chip') : null;
      const value = chip?.getAttribute('value');
      if (value) areaId = value;
    });
    let saving = false;
    const save = async (): Promise<void> => {
      if (saving) return;
      const name = input.value.trim().slice(0, NAME_MAX);
      if (!name) {
        input.setAttribute('error', t.projectNameRequired);
        input.focusInput();
        return;
      }
      if (!areaId) return;
      saving = true;
      try {
        const project = await createProject({ areaId, name });
        sheet.close('action');
        showToast(t.toastProjectCreated);
        void sheet.closed.then(() => emit(this.view, 'ol-navigate', { path: `/planung/p/${encodeURIComponent(project.id)}` }));
      } catch (err) {
        saving = false;
        failed(err);
      }
    };
    input.addEventListener('input', () => input.removeAttribute('error'));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void save();
      }
    });
    req(sheet.footerEl, '.ol-plan-sheet__save').addEventListener('click', () => void save());
    sheet.open();
  }

  private openProjectMenu(): void {
    const project = this.project();
    if (!project) return;
    openActionMenu(project.name, [
      { label: t.projectRename, icon: 'pencil', run: () => this.openRename(project) },
      { label: t.projectMove, icon: 'folder-input', run: () => this.openMove(project) },
      { label: t.actionArchive, icon: 'archive', run: () => void this.archive(project) },
      { label: t.actionDelete, icon: 'trash-2', danger: true, run: () => void this.remove(project) },
    ]);
  }

  private openRename(project: Project): OlSheet {
    const sheet = createSheet({ title: t.projectRenameTitle, fit: true });
    render(sheet.bodyEl, h`<div class="ol-plan-sheet"><ol-input class="ol-plan-sheet__name" label="${t.projectNameLabel}" maxlength="${NAME_MAX}" autocomplete="off" autofocus></ol-input></div>`);
    render(sheet.footerEl, h`<ol-button class="ol-plan-sheet__save" variant="filled" label="${t.actionSave}"></ol-button>`);
    const input = req<OlInput>(sheet.bodyEl, '.ol-plan-sheet__name');
    input.value = project.name;
    const save = async (): Promise<void> => {
      const name = input.value.trim().slice(0, NAME_MAX);
      if (!name) {
        input.setAttribute('error', t.projectNameRequired);
        input.focusInput();
        return;
      }
      try {
        await updateProject(project.id, { name });
        sheet.close('action');
        showToast(t.toastSaved);
      } catch (err) {
        failed(err);
      }
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void save();
      }
    });
    req(sheet.footerEl, '.ol-plan-sheet__save').addEventListener('click', () => void save());
    sheet.open();
    return sheet;
  }

  private openMove(project: Project): void {
    const sheet = createSheet({ title: t.projectMove, fit: true });
    const areas = this.activeAreas();
    render(sheet.bodyEl, h`<div class="ol-plan-sheet"><div class="ol-plan-sheet__areas" role="radiogroup" aria-label="${t.fieldArea}">
      ${areas.map((a) => h`<ol-chip kind="radio" value="${a.id}" flower="${a.flower}" tint="${a.tint}" label="${a.name}" ${a.id === project.areaId ? 'selected' : ''}></ol-chip>`)}
    </div></div>`);
    sheet.bodyEl.addEventListener('ol-change', (event) => {
      const value = event.target instanceof Element ? event.target.closest('ol-chip')?.getAttribute('value') : null;
      if (!value || value === project.areaId) return;
      const area = areas.find((a) => a.id === value);
      moveProject(project.id, value).then(() => {
        sheet.close('action');
        showToast(fmt(t.toastProjectMoved, { area: area?.name ?? '' }));
      }, failed);
    });
    sheet.open();
  }

  private async archive(project: Project): Promise<void> {
    try {
      await setProjectArchived(project.id, true);
      showToast(t.toastProjectArchived, { action: { label: t.actionUndo, onAction: () => void setProjectArchived(project.id, false).catch(failed) } });
      back();
    } catch (err) {
      failed(err);
    }
  }

  private async remove(project: Project): Promise<void> {
    const ok = await confirmDialog({ title: t.actionConfirmDelete, body: t.confirmDeleteProject, confirmLabel: t.actionDelete, destructive: true });
    if (!ok || this.gone) return;
    this.gone = true;
    try {
      const deleted = await deleteProject(project.id);
      showToast(t.toastProjectDeleted, { action: { label: t.actionUndo, onAction: () => void restoreProject(deleted).catch(failed) } });
      back();
    } catch (err) {
      this.gone = false;
      failed(err);
    }
  }

  private openAssign(taskId: Id): void {
    const task = this.tasks?.find((x) => x.id === taskId);
    if (!task) return;
    const sheet = createSheet({ title: t.assignTitle, fit: true });
    const areas = this.activeAreas();
    const groups = areas.map((a) => ({ area: a, projects: (this.projects ?? []).filter((p) => p.status === 'active' && p.areaId === a.id) }))
      .filter((g) => g.projects.length > 0);
    const glyph = (a: Area): SafeHtml => raw(flower(a.flower, 20));
    render(sheet.bodyEl, h`<div class="ol-plan-sheet">
      ${groups.length === 0 ? h`<p class="ol-body-s ol-text-2">${t.planNoProjects}</p>` : ''}
      ${groups.map((g) => h`<section class="ol-plan-sheet__group">
        <h3 class="ol-label ol-plan-sheet__group-head">${glyph(g.area)}<span>${g.area.name}</span></h3>
        <ul class="ol-plan-sheet__projects">${g.projects.map((p) => h`<li><button type="button" class="ol-plan-sheet__project" data-project="${p.id}">${icon('folder', 20)}<span>${p.name}</span></button></li>`)}</ul>
      </section>`)}
      <ol-button class="ol-plan-sheet__new" variant="ghost" icon="folder-plus" label="${t.planProjectAdd}"></ol-button>
    </div>`);
    sheet.bodyEl.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.ol-plan-sheet__new')) {
        sheet.close('action');
        void sheet.closed.then(() => this.openCreateProject());
        return;
      }
      const id = target?.closest<HTMLElement>('.ol-plan-sheet__project')?.dataset['project'];
      const project = id ? this.projects?.find((p) => p.id === id) : undefined;
      if (!project) return;
      updateTask(task.id, { projectId: project.id, areaId: project.areaId }).then(() => {
        sheet.close('action');
        showToast(fmt(t.toastAssigned, { project: project.name }), {
          action: { label: t.actionUndo, onAction: () => void updateTask(task.id, { projectId: null, areaId: task.areaId }).catch(failed) },
        });
      }, failed);
    });
    sheet.open();
  }
}
