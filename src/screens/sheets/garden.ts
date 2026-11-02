// "Dein Garten" (Gamification Teil 2, decision of 02.11.2026): a sheet opened from the button beside "Rückblick" in
// HEUTE, with the tabs Besucher and Herbarium (Gestalten follows in Teil 3).
// - Besucher: "6 von 12 entdeckt" with a progress bar, then one card per visitor in album order: found ones in
//   colour with name and why they came, open ones as a soft silhouette with the hint (and "4 von 10" for counted
//   reasons). A visitor found within the last three days carries "Neu".
// - Herbarium: one pressed flower per routine that reached full bloom (routine, area colour and name, date), then
//   the routines still growing as pale cards ("noch 3 Tage").
// - Data is live (repo/visitors gardenData$, areas$) while the sheet is open; each emission re-renders the open tab
//   (the sheet holds no inputs, so nothing is lost). The tab choice is kept for the session.
import '../../components/ol-segmented.js';
import { visitorGlyph } from '../../components/island-visitors.js';
import { pressedFlower } from '../../components/flora.js';
import { createSheet, type OlSheet } from '../../components/ol-sheet.js';
import type { SegmentedChange } from '../../components/ol-segmented.js';
import { fmt, t } from '../../i18n/de.js';
import type { Area, HabitLog, Id } from '../../model.js';
import { areas$ } from '../../repo/areas.js';
import { gardenData$, type GardenData } from '../../repo/visitors.js';
import { herbariumCards } from '../../services/herbarium.js';
import { NEW_DAYS, VISITOR_NAME, visitorInfos } from '../../services/visitors.js';
import { addDays, onDayChange, today } from '../../util/date.js';
import { h, raw, render, setVar } from '../../util/dom.js';

export type GardenTab = 'visitors' | 'herbarium';

interface Sub { unsubscribe(): void }

let lastTab: GardenTab = 'visitors';

export function openGardenSheet(tab: GardenTab = lastTab): OlSheet {
  const sheet = createSheet({ title: t.gardenTitle, history: 'push', detent: 'full', id: 'garden' });
  new GardenSheet(sheet, tab).start();
  return sheet;
}

class GardenSheet {
  private data: GardenData | null = null;
  private areas = new Map<Id, Area>();
  private subs: Sub[] = [];
  private stopDay: (() => void) | null = null;
  private panel!: HTMLElement;

  constructor(private readonly sheet: OlSheet, private tab: GardenTab) {}

  start(): void {
    render(this.sheet.bodyEl, h`<div class="ol-garden-sheet">
      <ol-segmented class="ol-garden-sheet__tabs" label="${t.gardenTabsAria}" value="${this.tab}">
        <button type="button" data-value="visitors">${t.gardenTabVisitors}</button>
        <button type="button" data-value="herbarium">${t.gardenTabHerbarium}</button>
      </ol-segmented>
      <div class="ol-garden-sheet__panel" aria-live="off"></div>
    </div>`);
    this.panel = this.sheet.bodyEl.querySelector<HTMLElement>('.ol-garden-sheet__panel') ?? this.sheet.bodyEl;
    this.sheet.bodyEl.querySelector('.ol-garden-sheet__tabs')?.addEventListener('ol-change', (event) => {
      const value = (event as CustomEvent<SegmentedChange>).detail.value;
      if (value !== 'visitors' && value !== 'herbarium') return;
      this.tab = value;
      lastTab = value;
      this.renderPanel();
    });
    this.subs.push(
      gardenData$().subscribe({ next: (data) => { this.data = data; this.renderPanel(); }, error: (err: unknown) => console.error(err) }),
      areas$(true).subscribe({ next: (list) => { this.areas = new Map(list.map((a) => [a.id, a])); this.renderPanel(); }, error: (err: unknown) => console.error(err) }),
    );
    this.stopDay = onDayChange(() => this.renderPanel());
    this.sheet.addEventListener('ol-dismiss', () => this.stop(), { once: true });
    this.sheet.open();
  }

  private stop(): void {
    for (const sub of this.subs.splice(0)) sub.unsubscribe();
    this.stopDay?.();
    this.stopDay = null;
  }

  private renderPanel(): void {
    if (!this.data) return;
    if (this.tab === 'visitors') this.renderVisitors(this.data);
    else this.renderHerbarium(this.data);
  }

  private renderVisitors(data: GardenData): void {
    const now = today();
    const infos = visitorInfos(data.history, now);
    const found = infos.filter((v) => v.day !== null).length;
    const since = addDays(now, -(NEW_DAYS - 1));
    render(this.panel, h`<div class="ol-garden-sheet__head">
        <p class="ol-garden-sheet__count">${fmt(t.gardenFound, { n: found, of: infos.length })}</p>
        <div class="ol-garden-sheet__bar" aria-hidden="true"><span class="ol-garden-sheet__fill"></span></div>
      </div>
      <ul class="ol-visitor-grid">${infos.map((v) => {
        const open = v.day === null;
        const isNew = !open && v.day !== null && v.day >= since;
        return h`<li class="ol-visitor-card${open ? ' ol-visitor-card--open' : ''}">
          <span class="ol-visitor-card__art">${raw(visitorGlyph(v.id, open))}</span>
          ${isNew ? h`<span class="ol-visitor-card__new">${t.gardenNew}</span>` : ''}
          <span class="ol-visitor-card__name">${open ? t.visitorOpen : VISITOR_NAME[v.id]}</span>
          <span class="ol-visitor-card__text">${v.text}</span>
          ${open && v.progress ? h`<span class="ol-visitor-card__progress">${fmt(t.visitorProgress, { n: v.progress.n, of: v.progress.of })}</span>` : ''}
        </li>`;
      })}</ul>
      <p class="ol-garden-sheet__hint">${t.gardenVisitorsHint}</p>`);
    const fill = this.panel.querySelector<HTMLElement>('.ol-garden-sheet__fill');
    if (fill) setVar(fill, '--p', (found / Math.max(1, infos.length)).toFixed(3));
  }

  private renderHerbarium(data: GardenData): void {
    const logs = new Map<Id, HabitLog[]>();
    for (const log of data.logs) {
      const list = logs.get(log.habitId);
      if (list) list.push(log);
      else logs.set(log.habitId, [log]);
    }
    const cards = herbariumCards(data.habits, logs, data.milestones, this.areas, today());
    const pressed = cards.filter((c) => c.bloomedOn !== null).length;
    const count = pressed === 0 ? t.herbariumCountNone : pressed === 1 ? t.herbariumCountOne : fmt(t.herbariumCount, { n: pressed });
    render(this.panel, h`<div class="ol-garden-sheet__head">
        <p class="ol-garden-sheet__count">${count}</p>
        <p class="ol-garden-sheet__hint">${cards.length === 0 ? t.herbariumEmpty : t.herbariumHint}</p>
      </div>
      <ul class="ol-herb-grid">${cards.map((c) => h`<li class="ol-herb-card${c.bloomedOn ? '' : ' ol-herb-card--open'}">
          <span class="ol-herb-card__paper">${raw(pressedFlower(c.flower, c.tint, 64))}</span>
          <span class="ol-herb-card__name">${c.name}</span>
          ${c.area ? h`<span class="ol-herb-card__area"><span class="ol-herb-card__dot" data-tint="${c.tint}"></span>${c.area}</span>` : ''}
          <span class="ol-herb-card__line">${c.line}${c.archived ? h` · ${t.herbariumArchived}` : ''}</span>
        </li>`)}</ul>`);
    for (const dot of this.panel.querySelectorAll<HTMLElement>('.ol-herb-card__dot')) setVar(dot, '--tint', dot.dataset['tint'] ?? '');
  }
}
