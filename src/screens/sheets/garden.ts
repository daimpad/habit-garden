// "Dein Garten" (Gamification Teil 2 and 3, decision of 02.11.2026): a sheet opened from the button beside "Rückblick"
// in HEUTE, with the tabs Besucher, Herbarium and Gestalten.
// - Besucher: "6 von 12 entdeckt" with a progress bar, then one card per visitor in album order: found ones in
//   colour with name and why they came, open ones as a soft silhouette with the hint (and "4 von 10" for counted
//   reasons). A visitor found within the last three days carries "Neu".
// - Herbarium: one pressed flower per routine that reached full bloom (routine, area colour and name, date), then
//   the routines still growing as pale cards ("noch 3 Tage").
// - Gestalten: the seeds ("34 Samen", where they come from), then one card per thing with its price: Setzen (closes
//   the sheet; HEUTE lets the person choose a place, onPlace), or for a placed thing Umsetzen and Zurückgeben (seeds
//   back, toast with Rückgängig); a thing without enough seeds says how many are missing. Last the side island
//   ("Insel erweitern", progress towards 60).
// - Keimi (Teil 4): the five stages with Keimi as it looks then (reached ones in colour, "seit …"; open ones pale
//   with the hint and how far), and "Keimi trägt" (Nichts · Strohhut · Gießkanne · Blütenkranz; things not yet
//   reached are disabled), saved at once.
// - Data is live (repo/visitors gardenData$, areas$) while the sheet is open; each emission re-renders the open tab
//   (the sheet holds no inputs, so nothing is lost). The tab choice is kept for the session.
import '../../components/ol-segmented.js';
import '../../components/ol-button.js';
import { isletGlyph, itemGlyph } from '../../components/island-garden.js';
import { showToast } from '../../components/ol-toast.js';
import {
  freeSlots, ISLET_PRICE, ITEMS, seedsText, type ItemId,
} from '../../services/garden.js';
import { buyIslet, returnItem, restoreGarden, setKeimiWear } from '../../repo/visitors.js';
import { keimiFigure } from '../../components/island.js';
import { KEIMI_STAGES, keimiLook, keimiStage, STAGE_NAME, STAGE_NOW, type KeimiLook } from '../../services/keimi.js';
import type { KeimiWear } from '../../model.js';
import { playSound } from '../../services/sound.js';
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
import { h, raw, render, setVar, type SafeHtml } from '../../util/dom.js';

/** A small seed (Samen) for counters and prices. */
export const SEED_GLYPH = '<svg class="ol-seed" viewBox="-6 -5 12 10" width="14" height="12" aria-hidden="true" focusable="false">'
  + '<g transform="rotate(-28)"><ellipse rx="4.6" ry="3" fill="#A57B52"/><ellipse cx="1.2" cy=".9" rx="3.2" ry="1.6" fill="#8A6440" opacity=".7"/>'
  + '<ellipse cx="-1.6" cy="-1" rx="1.6" ry=".8" fill="#D9B98E"/></g></svg>';

export type GardenTab = 'visitors' | 'herbarium' | 'shape' | 'keimi';

export interface GardenSheetOptions {
  /** Gestalten: the person wants to place (or move) a thing; the sheet closes first. */
  onPlace?: (item: ItemId) => void;
}

interface Sub { unsubscribe(): void }

let lastTab: GardenTab = 'visitors';

export function openGardenSheet(tab: GardenTab = lastTab, opts: GardenSheetOptions = {}): OlSheet {
  const sheet = createSheet({ title: t.gardenTitle, history: 'push', detent: 'full', id: 'garden' });
  new GardenSheet(sheet, tab, opts).start();
  return sheet;
}

class GardenSheet {
  private data: GardenData | null = null;
  private areas = new Map<Id, Area>();
  private subs: Sub[] = [];
  private stopDay: (() => void) | null = null;
  private panel!: HTMLElement;
  private keimiKey: string | null = null;

  constructor(private readonly sheet: OlSheet, private tab: GardenTab, private readonly opts: GardenSheetOptions) {}

  start(): void {
    render(this.sheet.bodyEl, h`<div class="ol-garden-sheet">
      <ol-segmented class="ol-garden-sheet__tabs" label="${t.gardenTabsAria}" value="${this.tab}">
        <button type="button" data-value="visitors">${t.gardenTabVisitors}</button>
        <button type="button" data-value="herbarium">${t.gardenTabHerbarium}</button>
        <button type="button" data-value="shape">${t.gardenTabShape}</button>
        <button type="button" data-value="keimi">${t.gardenTabKeimi}</button>
      </ol-segmented>
      <div class="ol-garden-sheet__panel" aria-live="off"></div>
    </div>`);
    this.panel = this.sheet.bodyEl.querySelector<HTMLElement>('.ol-garden-sheet__panel') ?? this.sheet.bodyEl;
    this.panel.addEventListener('click', (event) => this.onShapeClick(event));
    this.sheet.bodyEl.querySelector('.ol-garden-sheet__tabs')?.addEventListener('ol-change', (event) => {
      const value = (event as CustomEvent<SegmentedChange>).detail.value;
      if (value !== 'visitors' && value !== 'herbarium' && value !== 'shape' && value !== 'keimi') return;
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
    if (this.tab !== 'keimi') this.keimiKey = null;
    if (this.tab === 'visitors') this.renderVisitors(this.data);
    else if (this.tab === 'herbarium') this.renderHerbarium(this.data);
    else if (this.tab === 'shape') this.renderShape(this.data);
    else this.renderKeimi(this.data);
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

  private renderShape(data: GardenData): void {
    const { balance } = data.seeds;
    const garden = data.garden;
    const islet = garden.islet === 1;
    render(this.panel, h`<div class="ol-seeds">
        <span class="ol-seeds__icon" aria-hidden="true">${raw(SEED_GLYPH)}</span>
        <div><p class="ol-seeds__count">${seedsText(balance)}</p><p class="ol-garden-sheet__hint">${t.seedsHint}</p></div>
      </div>
      <ul class="ol-item-grid">${ITEMS.map((item) => {
        const placed = garden.placed?.[item.id];
        const slots = freeSlots(item.id, garden);
        const missing = item.price - balance;
        const action = placed
          ? h`<span class="ol-item-card__state">${t.itemPlaced}</span>
             <div class="ol-item-card__actions">
               ${slots.length > 0 ? h`<ol-button size="sm" variant="tonal" data-act="move" data-item="${item.id}" label="${t.itemMove}"></ol-button>` : ''}
               <ol-button size="sm" variant="ghost" data-act="return" data-item="${item.id}" label="${t.itemReturn}"></ol-button>
             </div>`
          : slots.length === 0 ? h`<span class="ol-item-card__state">${t.itemNoSlot}</span>`
            : missing > 0 ? h`<span class="ol-item-card__state">${fmt(t.seedsMissing, { n: missing })}</span>`
              : h`<div class="ol-item-card__actions"><ol-button size="sm" variant="filled" data-act="place" data-item="${item.id}" label="${t.itemPlace}"></ol-button></div>`;
        return h`<li class="ol-item-card${placed ? ' ol-item-card--placed' : ''}">
          <span class="ol-item-card__art">${raw(itemGlyph(item.id))}</span>
          <span class="ol-item-card__name">${item.name}</span>
          <span class="ol-item-card__price"><span aria-hidden="true">${raw(SEED_GLYPH)}</span>${seedsText(item.price)}</span>
          ${action}
        </li>`;
      })}</ul>
      <div class="ol-islet-card${islet ? ' ol-islet-card--done' : ''}">
        <span class="ol-islet-card__art">${raw(isletGlyph(52))}</span>
        <div class="ol-islet-card__text">
          <p class="ol-item-card__name">${t.itemIslet}</p>
          <p class="ol-garden-sheet__hint">${islet ? t.itemIsletDone : t.itemIsletHint}</p>
          ${islet ? '' : h`<div class="ol-garden-sheet__bar" aria-hidden="true"><span class="ol-garden-sheet__fill ol-islet-card__fill"></span></div>
            <p class="ol-item-card__price">${fmt(t.visitorProgress, { n: Math.min(balance, ISLET_PRICE), of: ISLET_PRICE })}</p>`}
        </div>
        ${!islet && balance >= ISLET_PRICE ? h`<ol-button size="sm" variant="filled" data-act="islet" label="${t.itemBuyIslet}"></ol-button>` : ''}
      </div>`);
    const fill = this.panel.querySelector<HTMLElement>('.ol-islet-card__fill');
    if (fill) setVar(fill, '--p', Math.min(1, balance / ISLET_PRICE).toFixed(3));
  }

  private onShapeClick(event: Event): void {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-act]') : null;
    if (!button || !this.data) return;
    const act = button.dataset['act'];
    const item = button.dataset['item'] as ItemId | undefined;
    if ((act === 'place' || act === 'move') && item) {
      const onPlace = this.opts.onPlace;
      this.sheet.close('action');
      if (onPlace) void this.sheet.closed.then(() => onPlace(item));
      return;
    }
    if (act === 'return' && item) {
      const before = structuredClone(this.data.garden);
      const name = ITEMS.find((i) => i.id === item)?.name ?? '';
      const price = ITEMS.find((i) => i.id === item)?.price ?? 0;
      returnItem(item).then(() => {
        showToast(fmt(t.placeReturnToast, { name, seeds: seedsText(price) }), {
          action: { label: t.actionUndo, onAction: () => void restoreGarden(before).catch((err: unknown) => console.error(err)) },
        });
      }, (err: unknown) => {
        console.error(err);
        showToast(t.toastError);
      });
      return;
    }
    if (act === 'islet') {
      buyIslet().then(() => {
        playSound('milestone');
        showToast(t.isletToast);
      }, (err: unknown) => {
        console.error(err);
        showToast(t.toastError);
      });
    }
  }

  private renderKeimi(data: GardenData): void {
    const { stages, wear } = data.keimi;
    const look = keimiLook(stages, wear);
    const now = keimiStage(stages);
    const reached = (stage: string): boolean => stages.some((x) => x.stage === stage && x.day !== null);
    const lookOf = (stage: (typeof KEIMI_STAGES)[number]): KeimiLook => ({
      leaves: stage === 'seedling' ? 'two' : 'four',
      wear: stage === 'hat' || stage === 'can' || stage === 'crown' ? stage : null,
    });
    const current = look.wear ?? 'none';
    // Only the outfit changed (a choice here): keep the panel, so focus stays on the switch.
    const key = JSON.stringify(stages);
    const choice = this.panel.querySelector<HTMLElement>('.ol-keimi-wear__choice');
    if (choice && this.keimiKey === key) {
      if (choice.getAttribute('value') !== current) choice.setAttribute('value', current);
      const fig = this.panel.querySelector('.ol-keimi-now__fig');
      if (fig) render(fig, raw(keimiFigure(look, 96, 'kfn-')));
      return;
    }
    this.keimiKey = key;
    const option = (value: KeimiWear, label: string): SafeHtml => h`<button type="button" data-value="${value}" ${value !== 'none' && !reached(value) ? 'disabled' : ''}>${label}</button>`;
    render(this.panel, h`<div class="ol-keimi-now">
        <span class="ol-keimi-now__fig">${raw(keimiFigure(look, 96, 'kfn-'))}</span>
        <div><p class="ol-garden-sheet__count">${STAGE_NOW[now]}</p>
          <p class="ol-garden-sheet__hint">${t.keimiKeeps}</p></div>
      </div>
      <ul class="ol-keimi-stages">${stages.map((x, i) => h`<li class="ol-keimi-stage${x.day ? '' : ' ol-keimi-stage--open'}">
          <span class="ol-keimi-stage__fig">${raw(keimiFigure(lookOf(x.stage), 64, `kfs${i}-`))}</span>
          <span class="ol-keimi-stage__name">${STAGE_NAME[x.stage]}</span>
          <span class="ol-keimi-stage__text">${x.text}</span>
          ${!x.day && x.progress ? h`<span class="ol-visitor-card__progress">${fmt(t.visitorProgress, { n: x.progress.n, of: x.progress.of })}</span>` : ''}
        </li>`)}</ul>
      <div class="ol-keimi-wear">
        <span class="ol-settings__label" id="garden-keimi-wear">${t.keimiWearLabel}</span>
        <ol-segmented class="ol-keimi-wear__choice" aria-labelledby="garden-keimi-wear" value="${current}">
          ${option('none', t.keimiWearNone)}${option('hat', t.keimiWearHat)}${option('can', t.keimiWearCan)}${option('crown', t.keimiWearCrown)}
        </ol-segmented>
      </div>`);
    this.panel.querySelector('.ol-keimi-wear__choice')?.addEventListener('ol-change', (event) => {
      const value = (event as CustomEvent<SegmentedChange>).detail.value;
      if (value !== 'none' && value !== 'hat' && value !== 'can' && value !== 'crown') return;
      setKeimiWear(value).catch((err: unknown) => {
        console.error(err);
        showToast(t.toastError);
      });
    });
  }
}
