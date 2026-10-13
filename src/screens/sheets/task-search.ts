// Task search (A.3 PLANUNG 🔍: "Vollbild-Suche über Aufgaben des Bereichs mit Filterchips (Status, Flags,
// Datum)"). Full-height sheet with a search field (focus at once), three chip groups and a live result
// list. Matching per C.4: normalised substring (services/search.ts) in title, tags and description,
// ranked title > tag > description, then open before done and by due order. Within a group chips are
// OR, across groups AND; without any chip every top-level task of the scope is a candidate. A result
// opens the task sheet; the list stays live while the sheet is open.
import '../../components/ol-chip.js';
import '../../components/ol-input.js';
import { liveQuery, type Subscription } from 'dexie';
import type { OlInput } from '../../components/ol-input.js';
import { createSheet, type OlSheet } from '../../components/ol-sheet.js';
import { db } from '../../db.js';
import { fmt, t } from '../../i18n/de.js';
import { GENERIC_TINT, type Area, type Id, type Task } from '../../model.js';
import { compareDue } from '../../repo/tasks.js';
import { passesFilters, searchRank, type FilterGroup } from '../../services/planning.js';
import { normalizeForSearch } from '../../services/search.js';
import { formatDayShort, today } from '../../util/date.js';
import { emit, h, render, setVar } from '../../util/dom.js';

interface Filter { group: FilterGroup; value: string; label: string; icon?: string }

const FILTERS: readonly Filter[] = [
  { group: 'status', value: 'open', label: t.taskStatusOpen },
  { group: 'status', value: 'doing', label: t.taskStatusDoing },
  { group: 'status', value: 'done', label: t.taskStatusDone },
  { group: 'flag', value: 'important', label: t.flagImportant, icon: 'flag' },
  { group: 'flag', value: 'urgent', label: t.flagUrgent, icon: 'alarm-clock' },
  { group: 'date', value: 'overdue', label: t.searchFilterOverdue },
  { group: 'date', value: 'today', label: t.searchFilterToday },
  { group: 'date', value: 'week', label: t.searchFilterWeek },
  { group: 'date', value: 'noDate', label: t.searchFilterNoDate },
];

export function openTaskSearch(opts: { areaId?: Id; areas: readonly Area[] }): OlSheet {
  const area = opts.areaId ? opts.areas.find((a) => a.id === opts.areaId) : undefined;
  const sheet = createSheet({ title: t.searchTitle, detent: 'full' });
  render(sheet.bodyEl, h`<div class="ol-search">
    <ol-input class="ol-search__field" type="search" label="${t.searchField}" autocomplete="off" autofocus></ol-input>
    <div class="ol-search__filters" role="group" aria-label="${t.searchFiltersAria}">
      ${FILTERS.map((f) => h`<ol-chip value="${f.group}:${f.value}" label="${f.label}" ${f.icon ? h`icon="${f.icon}"` : ''}></ol-chip>`)}
    </div>
    <p class="ol-search__count ol-caption" aria-live="polite"></p>
    <ul class="ol-search__results"></ul>
    <p class="ol-search__empty ol-body-s" hidden>${t.searchEmpty}</p>
  </div>`);
  const field = sheet.bodyEl.querySelector<OlInput>('.ol-search__field');
  const list = sheet.bodyEl.querySelector<HTMLElement>('.ol-search__results');
  const count = sheet.bodyEl.querySelector<HTMLElement>('.ol-search__count');
  const empty = sheet.bodyEl.querySelector<HTMLElement>('.ol-search__empty');
  const selected = new Set<string>();
  const areaById = new Map(opts.areas.map((a) => [a.id, a]));
  let tasks: Task[] = [];
  let projects = new Map<Id, string>();
  let timer = 0;

  const show = (): void => {
    if (!list || !count || !empty) return;
    const q = normalizeForSearch((field?.value ?? '').trim());
    const day = today();
    const hits = tasks
      .map((task) => ({ task, rank: searchRank(task, q) }))
      .filter((x) => x.rank >= 0 && passesFilters(x.task, selected, day))
      .sort((a, b) => a.rank - b.rank || Number(a.task.status === 'done') - Number(b.task.status === 'done') || compareDue(a.task, b.task))
      .slice(0, 200);
    const scope = area ? fmt(t.searchScopeArea, { area: area.name }) : t.searchScopeAll;
    count.textContent = `${hits.length === 1 ? t.searchCountOne : fmt(t.searchCount, { n: hits.length })} ${scope}`;
    empty.hidden = hits.length > 0;
    render(list, h`${hits.map(({ task }) => {
      const meta = [projects.get(task.projectId ?? '') ?? '', task.dueDay ? formatDayShort(task.dueDay) : ''].filter(Boolean).join(' · ');
      return h`<li class="ol-search__row" data-id="${task.id}" data-status="${task.status}">
        <button type="button" class="ol-search__hit">
          <span class="ol-search__title">${task.title}</span>
          ${meta ? h`<span class="ol-caption ol-search__meta">${meta}</span>` : ''}
        </button></li>`;
    })}`);
    for (const row of list.querySelectorAll<HTMLElement>('.ol-search__row')) {
      const task = tasks.find((x) => x.id === row.dataset['id']);
      setVar(row, '--tint', (task && areaById.get(task.areaId)?.tint) ?? GENERIC_TINT);
    }
  };

  const sub: Subscription = liveQuery(async () => {
    const rows = await db.tasks.filter((x) => (x.parentId === null || x.parentId === undefined) && (!opts.areaId || x.areaId === opts.areaId)).toArray();
    const ps = await db.projects.toArray();
    return { rows, ps };
  }).subscribe({
    next: ({ rows, ps }) => {
      tasks = rows;
      projects = new Map(ps.map((p) => [p.id, p.name]));
      show();
    },
    error: (err: unknown) => console.error(err),
  });

  field?.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(show, 150);
  });
  sheet.bodyEl.addEventListener('ol-change', (event) => {
    const chip = event.target instanceof Element ? event.target.closest('ol-chip') : null;
    const value = chip?.getAttribute('value');
    if (!chip || !value) return;
    if (chip.hasAttribute('selected')) selected.add(value);
    else selected.delete(value);
    show();
  });
  list?.addEventListener('click', (event) => {
    const hit = event.target instanceof Element ? event.target.closest('.ol-search__hit') : null;
    const id = hit?.closest<HTMLElement>('li[data-id]')?.dataset['id'];
    if (hit && id) emit(hit, 'ol-navigate', { path: `/aufgabe/${encodeURIComponent(id)}` });
  });
  const finish = (): void => {
    sub.unsubscribe();
    window.clearTimeout(timer);
  };
  void sheet.closed.then(finish, finish);
  sheet.open();
  return sheet;
}
