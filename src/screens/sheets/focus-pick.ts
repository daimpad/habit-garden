// Focus picker (F §4.13, A.2 H1, D.1, S15). Full-height sheet with history entry (A.1: back closes it):
// search field (live, case- and diacritic-insensitive via focusCandidates), suggestions grouped
// Heute fällig · Überfällig · Ohne Datum (D.1: due today before undated), "Neu anlegen" in the footer.
// Tapping a suggestion puts it into the focus of `day` (addToFocus) and closes the sheet.
//
// Details of this implementation:
// - The groups re-render in place (keyed rows) on every emission of a liveQuery that is re-created per
//   search text, so focus on a suggestion survives data changes.
// - When three existing tasks are in focus, t.focusLimitHint is shown and every action is disabled.
// - "Neu anlegen" creates a task titled with the search text in the first active area (Phase-1 default,
//   decision 8) and adds it to the focus; an empty search field gets t.captureTitleRequired and focus.
import { liveQuery, type Subscription } from 'dexie';
import type { OlButton } from '../../components/ol-button.js';
import type { OlInput } from '../../components/ol-input.js';
import { createSheet, type OlSheet } from '../../components/ol-sheet.js';
import { showToast } from '../../components/ol-toast.js';
import { t } from '../../i18n/de.js';
import { MAX_FOCUS, type Area, type Day, type Id, type Task } from '../../model.js';
import { firstActiveArea, listAreas } from '../../repo/areas.js';
import { addToFocus, FocusFullError, getFocus } from '../../repo/dayPlans.js';
import { createTask, focusCandidates, getTask, type FocusCandidates } from '../../repo/tasks.js';
import { formatDayShort, formatTime } from '../../util/date.js';
import { h, render, type SafeHtml } from '../../util/dom.js';

type GroupKey = keyof FocusCandidates;

/** Group order (F §4.13, D.1). */
const GROUPS: ReadonlyArray<{ key: GroupKey; label: string }> = [
  { key: 'dueToday', label: t.focusGroupDueToday },
  { key: 'overdue', label: t.focusGroupOverdue },
  { key: 'noDate', label: t.focusGroupNoDate },
];

interface PickData { candidates: FocusCandidates; full: boolean; areas: Map<Id, Area> }

async function load(day: Day, query: string): Promise<PickData> {
  const ids = await getFocus(day);
  const focused = (await Promise.all(ids.map((id) => getTask(id)))).filter((task) => task !== undefined);
  const candidates = await focusCandidates(day, query, ids);
  const areas = await listAreas(true);
  return { candidates, full: focused.length >= MAX_FOCUS, areas: new Map(areas.map((a) => [a.id, a])) };
}

function req<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`focus-pick: missing ${selector}`);
  return el;
}

export function openFocusPick(day: Day): OlSheet {
  const sheet = createSheet({ title: t.focusPickTitle, detent: 'full' });
  const key = sheet.sheetKey;
  render(sheet.bodyEl, h`<div class="ol-focus-pick">
    <ol-input class="ol-focus-pick__search" type="search" label="${t.focusSearchLabel}" autocomplete="off"></ol-input>
    <p class="ol-focus-pick__hint ol-body-s" hidden>${t.focusLimitHint}</p>
    ${GROUPS.map((g) => h`<section class="ol-focus-pick__group" data-group="${g.key}" aria-labelledby="${key}-${g.key}" hidden>
      <h3 class="ol-label" id="${key}-${g.key}">${g.label}</h3>
      <ul class="ol-focus-pick__list"></ul>
    </section>`)}
    <p class="ol-focus-pick__empty ol-body-s" hidden>${t.emptyFocusPick}</p>
  </div>`);
  render(sheet.footerEl, h`<ol-button class="ol-focus-pick__create" variant="filled" icon="plus" label="${t.actionCreate}"></ol-button>`);

  const root = req<HTMLElement>(sheet.bodyEl, '.ol-focus-pick');
  const search = req<OlInput>(root, '.ol-focus-pick__search');
  const hint = req<HTMLElement>(root, '.ol-focus-pick__hint');
  const empty = req<HTMLElement>(root, '.ol-focus-pick__empty');
  const create = req<OlButton>(sheet.footerEl, '.ol-focus-pick__create');
  const groups = new Map<GroupKey, { section: HTMLElement; list: HTMLElement }>();
  for (const g of GROUPS) {
    const section = req<HTMLElement>(root, `[data-group="${g.key}"]`);
    groups.set(g.key, { section, list: req<HTMLElement>(section, '.ol-focus-pick__list') });
  }

  let sub: Subscription | null = null;
  let query = '';
  let busy = false;
  let full = false;
  let tasks = new Map<Id, Task>();

  const setBusy = (value: boolean): void => {
    busy = value;
    sync();
  };

  const sync = (): void => {
    const disabled = busy || full;
    for (const button of root.querySelectorAll<HTMLButtonElement>('.ol-focus-pick__item')) button.disabled = disabled;
    create.toggleAttribute('disabled', full);
    create.toggleAttribute('loading', busy && !full);
    hint.hidden = !full;
  };

  const meta = (task: Task, data: PickData, group: GroupKey): SafeHtml => {
    const area = data.areas.get(task.areaId)?.name ?? t.noArea;
    if (group === 'overdue' && task.dueDay) {
      return h`<span class="ol-focus-pick__overdue">${t.overdueLabel} <span class="ol-num">${formatDayShort(task.dueDay)}</span></span><span>${area}</span>`;
    }
    if (group === 'dueToday' && task.dueHasTime === 1 && task.dueAt) {
      return h`<span class="ol-num">${formatTime(task.dueAt)}</span><span>${area}</span>`;
    }
    return h`<span>${area}</span>`;
  };

  const renderGroup = (list: HTMLElement, items: readonly Task[], data: PickData, group: GroupKey): void => {
    const active = document.activeElement;
    const rows = new Map<string, HTMLElement>();
    for (const child of list.children) if (child instanceof HTMLElement) rows.set(child.dataset['id'] ?? '', child);
    const wanted = new Set(items.map((task) => task.id));
    for (const [id, row] of rows) {
      if (wanted.has(id)) continue;
      if (row.contains(document.activeElement)) search.focusInput();
      row.remove();
      rows.delete(id);
    }
    items.forEach((task, i) => {
      let row = rows.get(task.id);
      if (!row) {
        row = document.createElement('li');
        row.dataset['id'] = task.id;
        render(row, h`<button type="button" class="ol-focus-pick__item"><span class="ol-focus-pick__title"></span><span class="ol-focus-pick__meta ol-caption"></span></button>`);
      }
      const at = list.children[i] ?? null;
      if (at !== row) list.insertBefore(row, at);
      const title = row.querySelector('.ol-focus-pick__title');
      if (title && title.textContent !== task.title) title.textContent = task.title;
      const metaEl = row.querySelector('.ol-focus-pick__meta');
      if (metaEl) render(metaEl, meta(task, data, group));
    });
    if (active instanceof HTMLElement && active.isConnected && active !== document.activeElement && list.contains(active)) active.focus();
  };

  const show = (data: PickData): void => {
    full = data.full;
    tasks = new Map();
    let total = 0;
    for (const g of GROUPS) {
      const items = data.candidates[g.key];
      const parts = groups.get(g.key);
      if (!parts) continue;
      for (const task of items) tasks.set(task.id, task);
      renderGroup(parts.list, items, data, g.key);
      parts.section.hidden = items.length === 0;
      total += items.length;
    }
    empty.hidden = total > 0;
    sync();
  };

  const run = (): void => {
    sub?.unsubscribe();
    const q = query;
    sub = liveQuery(() => load(day, q)).subscribe({
      next: (data: PickData) => show(data),
      error: (err: unknown) => console.error(err),
    });
  };

  const finish = (): void => {
    sub?.unsubscribe();
    sub = null;
  };

  const pick = async (id: Id): Promise<void> => {
    if (busy || full || !tasks.has(id)) return;
    setBusy(true);
    try {
      await addToFocus(day, id);
      sheet.close('action');
    } catch (err) {
      setBusy(false);
      showToast(err instanceof FocusFullError ? t.toastFocusFull : t.toastError);
    }
  };

  const createFromSearch = async (): Promise<void> => {
    if (busy || full) return;
    const title = search.value.trim();
    if (!title) {
      search.setAttribute('error', t.captureTitleRequired);
      search.focusInput();
      return;
    }
    setBusy(true);
    try {
      const area = await firstActiveArea();
      if (!area) throw new Error('no active area');
      const task = await createTask({ title, areaId: area.id });
      await addToFocus(day, task.id);
      sheet.close('action');
    } catch (err) {
      setBusy(false);
      showToast(err instanceof FocusFullError ? t.toastFocusFull : t.toastError);
    }
  };

  search.addEventListener('input', () => {
    if (search.hasAttribute('error')) search.removeAttribute('error');
    const next = search.value;
    if (next === query) return;
    query = next;
    run();
  });
  root.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>('.ol-focus-pick__item') : null;
    const id = button?.closest<HTMLElement>('li[data-id]')?.dataset['id'];
    if (id) void pick(id);
  });
  create.addEventListener('click', () => void createFromSearch());
  sheet.addEventListener('ol-dismiss', (event) => {
    if (event.target === sheet) finish();
  });
  void sheet.closed.then(finish, finish);

  run();
  sheet.open();
  return sheet;
}
