// Archiv (A.2 P10 [Ext], opened from ⋯ in the PLANUNG root app bar): archived projects and archived
// areas, each with "Reaktivieren".
// Layout (full detent, history push):
// - "Archivierte Projekte": grouped by area in area order (sortKey); each row shows the area's
//   flower glyph, the project name and "Reaktivieren" (setProjectArchived(id, false)). The group
//   heading names the area; an archived area is marked, with the hint that its projects reappear in
//   PLANUNG once the area is active again. Projects whose area no longer exists go to "Ohne Bereich".
// - "Archivierte Bereiche": flower, name and "Reaktivieren" (setAreaArchived(id, 0)).
// - Empty state when neither list has entries.
// Every reactivation confirms with a toast ("Projekt „…“ reaktiviert" / "Bereich „…“ reaktiviert").
//
// Details of this implementation:
// - Areas and projects stay live (liveQuery) while the sheet is open and are unsubscribed on close.
// - The body is rebuilt only when its visible content changes. When the focused row disappears
//   (reactivated), focus moves to the "Reaktivieren" button now at the same position (or the last
//   one); with nothing left it goes to the sheet dialog, so it never falls back to <body>.
// - A row whose write is still running ignores further taps (no disabled state: disabling the focused
//   button would drop keyboard focus before the row disappears).
import '../../components/ol-button.js';
import '../../components/ol-empty-state.js';
import '../../components/ol-flower.js';
import type { OlButton } from '../../components/ol-button.js';
import { createSheet, type OlSheet } from '../../components/ol-sheet.js';
import { showToast } from '../../components/ol-toast.js';
import { fmt, t } from '../../i18n/de.js';
import type { Area, FlowerId, Id, Project } from '../../model.js';
import { areas$, setAreaArchived } from '../../repo/areas.js';
import { allProjects$, setProjectArchived } from '../../repo/projects.js';
import { h, render, type SafeHtml } from '../../util/dom.js';
import { failed } from './task.js';

interface Sub { unsubscribe(): void }

const NO_AREA = '';

interface ProjectRow { id: Id; name: string; flower: FlowerId }
interface Group { key: string; name: string; archived: boolean; projects: ProjectRow[] }
interface AreaRow { id: Id; name: string; flower: FlowerId }
interface View { groups: Group[]; areas: AreaRow[] }

let uidSeq = 0;

/** Pure: archived projects grouped by area (area order, "Ohne Bereich" last) and archived areas. */
export function archiveView(areas: readonly Area[], projects: readonly Project[]): View {
  const byArea = new Map<string, Project[]>();
  const known = new Set(areas.map((a) => a.id));
  for (const project of projects) {
    if (project.status !== 'archived') continue;
    const key = known.has(project.areaId) ? project.areaId : NO_AREA;
    const list = byArea.get(key) ?? [];
    list.push(project);
    byArea.set(key, list);
  }
  const groups: Group[] = [];
  for (const area of areas) {
    const list = byArea.get(area.id);
    if (!list) continue;
    groups.push({
      key: area.id,
      name: area.name,
      archived: area.archived === 1,
      projects: list.map((p) => ({ id: p.id, name: p.name, flower: area.flower })),
    });
  }
  const loose = byArea.get(NO_AREA);
  if (loose) {
    groups.push({ key: NO_AREA, name: t.noArea, archived: false, projects: loose.map((p) => ({ id: p.id, name: p.name, flower: 'generic' })) });
  }
  const archivedAreas = areas.filter((a) => a.archived === 1).map((a) => ({ id: a.id, name: a.name, flower: a.flower }));
  return { groups, areas: archivedAreas };
}

class ArchiveSheet {
  private areas: Area[] | null = null;
  private projects: Project[] | null = null;
  private readonly busy = new Set<string>();
  private signature: string | null = null;
  private subs: Sub[] = [];
  private readonly uid = `archive-${++uidSeq}`;

  constructor(private readonly sheet: OlSheet) {}

  start(): void {
    const sheet = this.sheet;
    render(sheet.bodyEl, h`<div class="ol-archive" aria-busy="true"></div>`);
    sheet.bodyEl.addEventListener('click', this.onClick);
    sheet.addEventListener('ol-dismiss', (event) => {
      if (event.target === sheet) this.cleanup();
    });
    void sheet.closed.then(() => this.cleanup());
    sheet.open();
    const fail = (err: unknown): void => console.error(err);
    this.subs.push(
      areas$(true).subscribe({
        next: (list) => {
          this.areas = list;
          this.render();
        },
        error: fail,
      }),
      allProjects$(true).subscribe({
        next: (list) => {
          this.projects = list;
          this.render();
        },
        error: fail,
      }),
    );
  }

  private cleanup(): void {
    for (const sub of this.subs) sub.unsubscribe();
    this.subs = [];
  }

  private get root(): HTMLElement | null {
    return this.sheet.bodyEl.querySelector<HTMLElement>('.ol-archive');
  }

  private render(): void {
    const root = this.root;
    if (!this.areas || !this.projects || !root || !this.sheet.isConnected) return;
    const view = archiveView(this.areas, this.projects);
    const signature = JSON.stringify(view);
    if (signature === this.signature) return;
    this.signature = signature;

    const buttons = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('ol-button[data-key]')];
    const active = document.activeElement;
    const focused = active instanceof Element && root.contains(active) ? active.closest<HTMLElement>('ol-button[data-key]') : null;
    const focusKey = focused?.dataset['key'] ?? null;
    const focusIndex = focused ? buttons().indexOf(focused) : -1;

    const empty = view.groups.length === 0 && view.areas.length === 0;
    const button = (key: string, name: string): SafeHtml =>
      h`<ol-button class="ol-archive__reactivate" variant="tonal" size="sm" label="${t.archiveReactivate}" data-key="${key}" data-name="${name}"></ol-button>`;
    const row = (key: string, name: string, flower: FlowerId): SafeHtml => h`<li class="ol-archive__row">
  <ol-flower class="ol-archive__glyph" flower="${flower}" size="24"></ol-flower>
  <span class="ol-archive__name">${name}</span>
  ${button(key, name)}
</li>`;
    const projectsId = `${this.uid}-projects`;
    const areasId = `${this.uid}-areas`;

    render(root, h`
      ${view.groups.length > 0 ? h`<section class="ol-archive__section" aria-labelledby="${projectsId}">
        <h3 class="ol-label ol-archive__heading" id="${projectsId}">${t.archiveProjects}</h3>
        ${view.groups.map((group, i) => {
          const groupId = `${projectsId}-g${i}`;
          return h`<div class="ol-archive__group" role="group" aria-labelledby="${groupId}">
          <h4 class="ol-archive__group-name" id="${groupId}">${group.archived ? fmt(t.archiveAreaArchived, { name: group.name }) : group.name}</h4>
          ${group.archived ? h`<p class="ol-archive__hint ol-body-s">${t.archiveAreaArchivedHint}</p>` : ''}
          <ul class="ol-archive__list">${group.projects.map((p) => row(`p:${p.id}`, p.name, p.flower))}</ul>
        </div>`;
        })}
      </section>` : ''}
      ${view.areas.length > 0 ? h`<section class="ol-archive__section" aria-labelledby="${areasId}">
        <h3 class="ol-label ol-archive__heading" id="${areasId}">${t.archiveAreas}</h3>
        <ul class="ol-archive__list">${view.areas.map((a) => row(`a:${a.id}`, a.name, a.flower))}</ul>
      </section>` : ''}
      ${empty ? h`<ol-empty-state class="ol-archive__empty" icon="archive" message="${t.archiveEmpty}"></ol-empty-state>` : ''}`);
    root.removeAttribute('aria-busy');
    for (const btn of root.querySelectorAll<OlButton>('ol-button[data-key]')) {
      btn.button?.setAttribute('aria-label', fmt(t.archiveReactivateAria, { name: btn.dataset['name'] ?? '' }));
    }

    if (focusKey === null) return;
    const all = buttons();
    const same = all.find((b) => b.dataset['key'] === focusKey);
    const target = same ?? all[Math.min(focusIndex, all.length - 1)];
    const focusable = target?.querySelector<HTMLElement>('button') ?? target;
    if (focusable) focusable.focus({ preventScroll: !same });
    else this.sheet.querySelector<HTMLElement>('dialog')?.focus({ preventScroll: true });
  }

  private readonly onClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('ol-button[data-key]') : null;
    const key = target?.dataset['key'];
    if (!target || !key) return;
    void this.reactivate(key, target.dataset['name'] ?? '');
  };

  private async reactivate(key: string, name: string): Promise<void> {
    if (this.busy.has(key)) return;
    const id = key.slice(2);
    this.busy.add(key);
    try {
      if (key.startsWith('p:')) {
        await setProjectArchived(id, false);
        showToast(fmt(t.toastProjectReactivated, { name }));
      } else {
        await setAreaArchived(id, 0);
        showToast(fmt(t.toastAreaReactivated, { name }));
      }
    } catch (err) {
      failed(err);
    } finally {
      this.busy.delete(key);
    }
  }
}

/** "Archiv": archived projects (by area) and archived areas, each with "Reaktivieren". */
export function openArchiveSheet(): OlSheet {
  const sheet = createSheet({ title: t.archiveTitle, history: 'push', detent: 'full' });
  new ArchiveSheet(sheet).start();
  return sheet;
}
