// WISSEN list (Phase 4, A.2 W1–W2, A.3 Screen 3). Same calm language as PLANUNG, no meadow.
// - App bar: "Wissen" with # (tag sheet) and ⚙. Below it the search field: live filter over title, tags
//   and text (services/notes filterNotes, 150 ms debounce), the match is highlighted in title or preview.
// - Tag filter (W2) as URL state `/wissen?tag=a/b,c&op=and` (A.1): chips with × over the list and an
//   UND/ODER switch; the tag sheet shows the tag tree with counts and multiple selection. Changing the
//   filter replaces the history entry, so the screen remounts; the search text survives in module state.
// - Sections "Angeheftet" and "Zuletzt bearbeitet"; a note card shows a small leaf in the colour of its
//   first tag, the title, up to two tags, one preview line and the relative time; tap opens the editor.
// - Empty state names the first step; the FAB (main.ts) creates a note and opens the editor (G1).
// /wissen/n/:id is the editor (screens/note-editor.ts).
import type { Subscription } from 'dexie';
import '../components/ol-app-bar.js';
import '../components/ol-chip.js';
import '../components/ol-empty-state.js';
import '../components/ol-icon-button.js';
import '../components/ol-input.js';
import '../components/ol-segmented.js';
import type { OlInput } from '../components/ol-input.js';
import { createSheet, type OlSheet } from '../components/ol-sheet.js';
import { fmt, t } from '../i18n/de.js';
import type { Note, Tag } from '../model.js';
import { notes$, tags$ } from '../repo/notes.js';
import type { Route } from '../router.js';
import {
  buildTagTree, filterNotes, matchRange, parseTagQuery, previewLine, relativeTime, tagQueryString, tagTint,
  type TagNode, type TagOp,
} from '../services/notes.js';
import { now } from '../util/date.js';
import { emit, h, raw, render, setVar, type SafeHtml } from '../util/dom.js';

/** Search text of the list; kept across remounts caused by filter changes. */
let lastQuery = '';
/** Tags of the current filter, read by main.ts so a note created from a filtered list carries them. */
let currentTags: string[] = [];

export function wissenContext(): { tags: string[] } {
  return { tags: [...currentTags] };
}

const LEAF = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path class="ol-wissen__leaf-blade" d="M5 19C5 10 11 4 20 4c0 9-6 15-15 15z"/><path class="ol-wissen__leaf-vein" d="M5 19 15 9"/></svg>';

function highlight(text: string, query: string): SafeHtml {
  const range = matchRange(text, query);
  if (!range) return h`${text}`;
  const [a, b] = range;
  return h`${text.slice(0, a)}<mark class="ol-wissen__mark">${text.slice(a, b)}</mark>${text.slice(b)}`;
}

function cardContent(note: Note, query: string): SafeHtml {
  const title = note.title || t.wissenUntitled;
  const preview = previewLine(note.body);
  // A parent tag next to its own child adds nothing on the card (#lesen beside #lesen/liste).
  const leaves = note.tagPaths.filter((p) => !note.tagPaths.some((q) => q.startsWith(`${p}/`)));
  const shown = leaves.slice(0, 2);
  const more = leaves.length - shown.length;
  const time = relativeTime(note.updatedAt, now(), { justNow: t.wissenJustNow, minutesAgo: (n) => fmt(t.wissenMinutesAgo, { n }) });
  return h`<button type="button" class="ol-wissen__card" data-id="${note.id}">
    <span class="ol-wissen__leaf">${raw(LEAF)}</span>
    <span class="ol-wissen__body">
      <span class="ol-wissen__head">
        <span class="ol-wissen__title">${highlight(title, query)}</span>
        <span class="ol-wissen__tags">${shown.map((p) => h`<span class="ol-wissen__tag">#${p}</span>`)}${more > 0 ? h`<span class="ol-wissen__tag ol-wissen__tag--more">+${more}</span>` : ''}</span>
      </span>
      <span class="ol-wissen__foot">
        <span class="ol-wissen__preview ol-body-s">${preview ? highlight(preview, query) : ''}</span>
        <time class="ol-wissen__time ol-caption ol-num" datetime="${note.updatedAt}">${time}</time>
      </span>
    </span>
  </button>`;
}

class WissenScreen {
  private readonly subs: Subscription[] = [];
  private notes: Note[] | null = null;
  private tags: Tag[] = [];
  private readonly selected: string[];
  private readonly op: TagOp;
  private timer = 0;
  private clock = 0;
  private sheet: OlSheet | null = null;

  constructor(private readonly view: HTMLElement, route: Route) {
    const parsed = parseTagQuery(route.query.toString());
    this.selected = parsed.tags;
    this.op = parsed.op;
    currentTags = [...parsed.tags];
    this.render();
    this.bind();
    this.subs.push(notes$().subscribe({ next: (rows) => { this.notes = rows; this.update(); }, error: (err: unknown) => console.error(err) }));
    this.subs.push(tags$().subscribe({ next: (rows) => { this.tags = rows; }, error: (err: unknown) => console.error(err) }));
    this.clock = window.setInterval(() => this.update(), 60_000);
  }

  destroy(): void {
    for (const sub of this.subs) sub.unsubscribe();
    window.clearTimeout(this.timer);
    window.clearInterval(this.clock);
    this.sheet?.close();
  }

  private render(): void {
    render(this.view, h`
      <ol-app-bar display heading="${t.titleWissen}">
        <ol-icon-button slot="actions" class="ol-wissen__tag-open" icon="hash" label="${t.wissenTagsOpen}"></ol-icon-button>
        <ol-icon-button slot="actions" class="ol-wissen__settings" icon="settings" label="${t.actionSettings}"></ol-icon-button>
      </ol-app-bar>
      <div class="ol-wissen" data-loading>
        <ol-input class="ol-wissen__search" type="search" label="${t.wissenSearch}" autocomplete="off"></ol-input>
        <div class="ol-wissen__filters" role="group" aria-label="${t.wissenFilterAria}" ${this.selected.length ? '' : 'hidden'}>
          ${this.selected.map((p) => h`<ol-chip variant="input" value="${p}" label="#${p}"></ol-chip>`)}
          ${this.selected.length > 1 ? h`<button type="button" class="ol-wissen__op" aria-label="${t.wissenOpAria}" data-op="${this.op}">${this.op === 'and' ? t.wissenOpAnd : t.wissenOpOr}</button>` : ''}
        </div>
        <p class="ol-wissen__count ol-caption" aria-live="polite"></p>
        <section class="ol-wissen__section ol-wissen__section--pinned" hidden>
          <div class="ol-section__head"><h2 class="ol-label">${t.wissenPinned}</h2></div>
          <ul class="ol-wissen__list ol-wissen__list--pinned"></ul>
        </section>
        <section class="ol-wissen__section ol-wissen__section--recent" hidden>
          <div class="ol-section__head"><h2 class="ol-label">${t.wissenRecent}</h2></div>
          <ul class="ol-wissen__list ol-wissen__list--recent"></ul>
        </section>
        <p class="ol-wissen__nohits ol-body-s" hidden>${t.wissenNoHits}</p>
        <ol-empty-state class="ol-wissen__empty" icon="notebook-pen" message="${t.emptyWissen}" hidden></ol-empty-state>
      </div>`);
    const field = this.view.querySelector<OlInput>('.ol-wissen__search');
    if (field && lastQuery) field.value = lastQuery;
  }

  private bind(): void {
    const view = this.view;
    view.querySelector('.ol-wissen__settings')?.addEventListener('click', (event) => {
      if (event.currentTarget instanceof Element) emit(event.currentTarget, 'ol-navigate', { path: '/einstellungen' });
    });
    view.querySelector('.ol-wissen__tag-open')?.addEventListener('click', () => this.openTagSheet());
    const field = view.querySelector<OlInput>('.ol-wissen__search');
    field?.addEventListener('input', () => {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        lastQuery = field.value;
        this.update();
      }, 150);
    });
    const filters = view.querySelector<HTMLElement>('.ol-wissen__filters');
    filters?.addEventListener('ol-remove', (event) => {
      const value = event.target instanceof Element ? event.target.getAttribute('value') : null;
      if (value) this.applyFilter(this.selected.filter((p) => p !== value), this.op);
    });
    filters?.querySelector('.ol-wissen__op')?.addEventListener('click', () => this.applyFilter(this.selected, this.op === 'and' ? 'or' : 'and'));
    view.addEventListener('click', (event) => {
      const card = event.target instanceof Element ? event.target.closest<HTMLElement>('.ol-wissen__card') : null;
      if (!card) return;
      const id = card.dataset['id'];
      if (id) emit(card, 'ol-navigate', { path: `/wissen/n/${encodeURIComponent(id)}` });
    });
  }

  private applyFilter(tags: readonly string[], op: TagOp): void {
    emit(this.view, 'ol-navigate', { path: `/wissen${tagQueryString(tags, op)}`, replace: true });
  }

  private update(): void {
    const notes = this.notes;
    if (!notes) return;
    const root = this.view.querySelector<HTMLElement>('.ol-wissen');
    root?.removeAttribute('data-loading');
    const query = lastQuery;
    const hits = filterNotes(notes, query, this.selected, this.op);
    const colors = new Map(this.tags.filter((tag) => tag.color).map((tag) => [tag.path, tag.color ?? '']));
    const pinned = hits.filter((n) => n.pinned === 1);
    const recent = hits.filter((n) => n.pinned !== 1);
    this.fill('.ol-wissen__list--pinned', '.ol-wissen__section--pinned', query.trim() ? [] : pinned, query, colors);
    this.fill('.ol-wissen__list--recent', '.ol-wissen__section--recent', query.trim() ? hits : recent, query, colors);
    const filtering = query.trim() !== '' || this.selected.length > 0;
    const count = this.view.querySelector<HTMLElement>('.ol-wissen__count');
    if (count) count.textContent = filtering ? (hits.length === 1 ? t.wissenCountOne : fmt(t.wissenCount, { n: hits.length })) : '';
    const empty = this.view.querySelector<HTMLElement>('.ol-wissen__empty');
    if (empty) empty.hidden = notes.length > 0;
    const nohits = this.view.querySelector<HTMLElement>('.ol-wissen__nohits');
    if (nohits) nohits.hidden = notes.length === 0 || hits.length > 0;
    const search = this.view.querySelector<HTMLElement>('.ol-wissen__search');
    if (search) search.hidden = notes.length === 0 && !filtering;
  }

  private fill(listSel: string, sectionSel: string, notes: readonly Note[], query: string, colors: ReadonlyMap<string, string>): void {
    const list = this.view.querySelector<HTMLElement>(listSel);
    const section = this.view.querySelector<HTMLElement>(sectionSel);
    if (!list || !section) return;
    section.hidden = notes.length === 0;
    const active = document.activeElement;
    const focusedId = active instanceof HTMLElement && list.contains(active) ? active.closest<HTMLElement>('[data-id]')?.dataset['id'] : undefined;
    render(list, h`${notes.map((note) => h`<li class="ol-wissen__item" data-note="${note.id}" data-pinned="${String(note.pinned === 1)}">${cardContent(note, query)}</li>`)}`);
    for (const item of list.querySelectorAll<HTMLElement>('.ol-wissen__item')) {
      const note = notes.find((n) => n.id === item.dataset['note']);
      const tint = tagTint(note?.tagPaths[0], colors);
      if (tint) setVar(item, '--tint', tint);
    }
    if (focusedId) list.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusedId)}"]`)?.focus({ preventScroll: true });
  }

  // --- Tag sheet (W2) ---

  private openTagSheet(): void {
    const notes = this.notes ?? [];
    const tree = buildTagTree(this.tags, notes);
    const chosen = new Set(this.selected);
    let op: TagOp = this.op;
    const sheet = createSheet({ title: t.wissenTagsTitle, detent: 'full' });
    this.sheet = sheet;
    const rows: SafeHtml[] = [];
    const walk = (nodes: readonly TagNode[]): void => {
      for (const node of nodes) {
        rows.push(h`<li class="ol-tagtree__row" data-depth="${String(Math.min(node.depth, 5))}">
          <ol-chip value="${node.path}" label="#${node.name}" ${chosen.has(node.path) ? 'selected' : ''}></ol-chip>
          <span class="ol-tagtree__count ol-caption ol-num" aria-label="${fmt(t.wissenTagCountAria, { n: node.count })}">${node.count}</span>
        </li>`);
        walk(node.children);
      }
    };
    walk(tree);
    render(sheet.bodyEl, h`<div class="ol-tagtree">
      <ol-segmented class="ol-tagtree__op" label="${t.wissenOpAria}" value="${op}">
        <button type="button" data-value="or">${t.wissenOpOr}</button>
        <button type="button" data-value="and">${t.wissenOpAnd}</button>
      </ol-segmented>
      <p class="ol-tagtree__hint ol-caption">${t.wissenTagsHint}</p>
      ${rows.length ? h`<ul class="ol-tagtree__list" role="group" aria-label="${t.wissenTagsTitle}">${rows}</ul>` : h`<p class="ol-tagtree__empty ol-body-s">${t.wissenTagsEmpty}</p>`}
    </div>`);
    render(sheet.footerEl, h`<div class="ol-tagtree__actions">
      <ol-button class="ol-tagtree__clear" variant="ghost" label="${t.wissenTagsClear}"></ol-button>
      <ol-button class="ol-tagtree__apply" variant="filled" label="${t.wissenTagsApply}"></ol-button>
    </div>`);
    sheet.bodyEl.addEventListener('ol-change', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.matches('ol-segmented') && event instanceof CustomEvent) {
        const value = (event.detail as { value?: string }).value;
        op = value === 'and' ? 'and' : 'or';
        return;
      }
      const chip = target?.closest('ol-chip');
      const value = chip?.getAttribute('value');
      if (!chip || !value) return;
      if (chip.hasAttribute('selected')) chosen.add(value);
      else chosen.delete(value);
    });
    const finish = (tags: readonly string[]): void => {
      sheet.close('action');
      void sheet.closed.then(() => this.applyFilter(tags, op), () => undefined);
    };
    sheet.footerEl.querySelector('.ol-tagtree__clear')?.addEventListener('click', () => finish([]));
    sheet.footerEl.querySelector('.ol-tagtree__apply')?.addEventListener('click', () => finish([...chosen]));
    void sheet.closed.then(() => { if (this.sheet === sheet) this.sheet = null; }, () => undefined);
    sheet.open();
  }
}

export function mount(view: HTMLElement, route: Route): () => void {
  const screen = new WissenScreen(view, route);
  return () => screen.destroy();
}
