// Einstellungen /einstellungen/:section? (F §4.13, A.3 Einstellungen, D.4, S13, S25, S38, S39): a full-screen
// overlay with the sections Daten, Benachrichtigungen, Darstellung, Bereiche and Info.
//
// Details of this implementation:
// - The skeleton is rendered once; liveQuery emissions (profile, areas) patch values and keyed area rows in
//   place, so focus, an open rename field and component state survive (S7).
// - /einstellungen/:section scrolls to that section (and focuses its heading) once profile and areas have
//   arrived, so later content does not push the target away.
// - Daten: export with the plaintext hint next to the button and, before the download, the same notice in a
//   non-destructive dialog (S25, D.4.1; export-flow exportWithNotice);
//   import → validation (ImportError → "kein gültiger Habit-Garden-Export") → mode dialog (Zusammenführen /
//   Wiederherstellen) → restore needs a destructive confirmation with Abbrechen focused, then the route
//   is re-dispatched. "Alle Daten löschen" needs two destructive confirmations, deletes the database and
//   the UI preferences in localStorage, then location.replace('/start') under the base path (S40).
// - Benachrichtigungen (S13): permission state (re-read on focus/visibility), default lead time, hint.
// - Darstellung (S38): Profile.settings is the source of truth; 'theme' also goes to localStorage as the
//   pre-paint cache (app/theme-boot.js). Thema Hell / Dunkel / System (System follows prefers-color-scheme
//   live); Landschaft switches the sky of the HEUTE garden (H11). main.ts applies data-theme, data-motion,
//   data-landscape and the FAB side from the profile.
// - Bereiche: rename inline, archive/reactivate (the last active area stays active), create with a flower
//   choice; the tint comes from DEFAULT_AREAS for that flower, GENERIC_TINT for 'generic'.
//   Reorder (A.3): "Reihenfolge ändern" switches the rows from rename/archive to up/down buttons (48 px,
//   keyboard operable, disabled at the ends; "Fertig" switches back). Each move is one moveAreaBy write
//   (computed in the transaction, so quick repeated taps are not lost); focus stays on the moved row's
//   button (the other direction when it reached an end) and a polite live region announces the new
//   position. The order covers archived areas too, as listed here.
// - Info (S39): version, build hash, licences, privacy sentence, provenance of the plant geometry.
// - Daten also offers the Markdown export of all notes and an ICS file of all open dated tasks (W6).
import type { Observable, Subscription } from 'dexie';
import '../components/ol-app-bar.js';
import '../components/ol-button.js';
import '../components/ol-card.js';
import '../components/ol-checkbox.js';
import '../components/ol-chip.js';
import '../components/ol-flower.js';
import '../components/ol-icon-button.js';
import '../components/ol-input.js';
import '../components/ol-segmented.js';
import { FLOWER_IDS, isFlowerId } from '../components/flora.js';
import type { OlButton } from '../components/ol-button.js';
import type { CheckboxChange, OlCheckbox } from '../components/ol-checkbox.js';
import type { ChipChange } from '../components/ol-chip.js';
import { choiceDialog, confirmDialog } from '../components/ol-dialog.js';
import type { OlInput } from '../components/ol-input.js';
import type { OlSegmented, SegmentedChange } from '../components/ol-segmented.js';
import { historySettled } from '../components/ol-sheet.js';
import { showToast } from '../components/ol-toast.js';
import { flowerName, fmt, t } from '../i18n/de.js';
import { DEFAULT_AREAS, GENERIC_TINT, type Area, type FlowerId, type Id, type Profile } from '../model.js';
import { areas$, createArea, LastAreaError, moveAreaBy, setAreaArchived, updateArea } from '../repo/areas.js';
import { profile$, updateSettings } from '../repo/profile.js';
import { refresh, type Route } from '../router.js';
import { notificationPermission, requestNotificationPermission } from '../services/reminders.js';
import { loadExampleData } from '../services/seed.js';
import { estimate, formatBytes, isPersisted, isSafari, requestPersist, type PersistResult } from '../services/storage-hints.js';
import {
  deleteAllData, ImportError, importMerge, importRestore, parseImport, type ExportFile,
} from '../services/transfer.js';
import { appUrl } from '../util/base.js';
import { dayOfIso, formatDayFull, formatTime } from '../util/date.js';
import { buildHash, h, icon, render, setVar, type SafeHtml } from '../util/dom.js';
import { importNotes, listNotes } from '../repo/notes.js';
import { exportAllIcs } from '../services/ics.js';
import { exportNotesMarkdown, parseNotesMarkdown } from '../services/notes-export.js';
import { currentInstallState, offlineReady, onInstallChange, promptInstall } from '../services/pwa.js';
import { isTourId } from '../services/tour.js';
import { exportWithNotice } from './export-flow.js';
import { startTour } from './tour.js';

export const APP_VERSION = '0.1.0';

const SECTIONS = ['daten', 'benachrichtigungen', 'darstellung', 'app', 'bereiche', 'hilfe', 'info'] as const;
type SectionId = typeof SECTIONS[number];

const LEAD_MINUTES: readonly number[] = [0, 5, 10, 15, 30, 60];
/** S18: 0 ≤ dayStartHour < 12 ≤ eveningHour ≤ 23 (12 is the fixed noon of the routine order). */
const MORNING_HOURS: readonly number[] = Array.from({ length: 12 }, (_, i) => i);
const EVENING_HOURS: readonly number[] = Array.from({ length: 12 }, (_, i) => i + 12);
const NAME_MAX = 40;
const SCROLL_FALLBACK_MS = 600;

const SECTION_TITLES: Readonly<Record<SectionId, string>> = {
  daten: t.settingsData,
  benachrichtigungen: t.settingsNotifications,
  darstellung: t.settingsAppearance,
  app: t.settingsApp,
  bereiche: t.settingsAreas,
  hilfe: t.settingsHelp,
  info: t.settingsInfo,
};

const PERSIST_TEXT: Readonly<Record<PersistResult, string>> = {
  granted: t.persistGranted,
  denied: t.persistDenied,
  unsupported: t.persistUnsupported,
};

const NOTIF_TEXT: Readonly<Record<NotificationPermission | 'unsupported', string>> = {
  granted: t.notifGranted,
  denied: t.notifDenied,
  default: t.notifDefault,
  unsupported: t.notifUnsupported,
};

const LICENSES: readonly string[] = [
  t.licenseOlife, t.licenseDexie, t.licenseMarkdownIt, t.licenseDompurify, t.licenseInter, t.licenseLucide,
];

function isSection(value: unknown): value is SectionId {
  return typeof value === 'string' && (SECTIONS as readonly string[]).includes(value);
}

function tintFor(flower: FlowerId): string {
  if (flower === 'generic') return GENERIC_TINT;
  return DEFAULT_AREAS.find((a) => a.flower === flower)?.tint ?? GENERIC_TINT;
}

function req<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`einstellungen: missing ${selector}`);
  return el;
}

function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function options(values: readonly number[], label: (n: number) => string): SafeHtml {
  return h`${values.map((v) => h`<option value="${v}">${label(v)}</option>`)}`;
}

function selectField(cls: string, id: string, label: string, opts: SafeHtml): SafeHtml {
  return h`<div class="ol-settings__field">
    <label class="ol-settings__label" for="${id}">${label}</label>
    <span class="ol-settings__select">
      <select class="${cls}" id="${id}">${opts}</select>
      <span class="ol-settings__chevron" aria-hidden="true">${icon('chevron-down', 20)}</span>
    </span>
  </div>`;
}

/** Sets a select's value; an unknown numeric value gets its own option first (e.g. from an import). */
function setSelect(select: HTMLSelectElement, value: number, label: (n: number) => string): void {
  const v = String(value);
  if (![...select.options].some((o) => o.value === v)) {
    const option = document.createElement('option');
    option.value = v;
    option.textContent = label(value);
    const after = [...select.options].find((o) => Number(o.value) > value) ?? null;
    select.insertBefore(option, after);
  }
  if (select.value !== v) select.value = v;
}

export function mount(view: HTMLElement, route: Route): () => void {
  const screen = new SettingsScreen(view, route);
  screen.start();
  return () => screen.destroy();
}

interface Els {
  exportBtn: OlButton;
  lastExport: HTMLElement;
  importBtn: OlButton;
  file: HTMLInputElement;
  storage: HTMLElement;
  persist: HTMLElement;
  persistBtn: OlButton;
  persistResult: HTMLElement;
  deleteBtn: OlButton;
  notif: HTMLElement;
  notifBtn: OlButton;
  seedBtn: OlButton;
  lead: HTMLSelectElement;
  theme: OlSegmented;
  landscape: OlCheckbox;
  landscapeText: HTMLElement;
  left: OlCheckbox;
  leftText: HTMLElement;
  animations: OlSegmented;
  dayStart: HTMLSelectElement;
  evening: HTMLSelectElement;
  areaList: HTMLElement;
  reorderBtn: OlButton;
  reorderStatus: HTMLElement;
  flowers: HTMLElement;
  newName: OlInput;
  createBtn: OlButton;
}

class SettingsScreen {
  private readonly view: HTMLElement;
  private readonly route: Route;
  private readonly els: Els;
  private readonly subs: Subscription[] = [];
  private stopInstall: (() => void) | null = null;
  private readonly timers = new Set<number>();
  private destroyed = false;

  private profileLoaded = false;
  private areasLoaded = false;
  private scrolled = false;
  private areas: Area[] = [];
  private editing: Id | null = null;
  private reordering = false;
  /** Row and direction whose button keeps focus once a move has been rendered. */
  private moveFocus: { id: Id; dir: 'up' | 'down' } | null = null;
  private newFlower: FlowerId = 'generic';
  private importing = false;

  constructor(view: HTMLElement, route: Route) {
    this.view = view;
    this.route = route;
    render(view, this.markup());
    this.els = this.collect();
    this.bind();
  }

  start(): void {
    this.watch(profile$(), (profile) => {
      this.renderProfile(profile);
      this.profileLoaded = true;
      this.maybeScroll();
    });
    this.watch(areas$(true), (list) => {
      this.areas = list;
      this.renderAreas();
      this.areasLoaded = true;
      this.maybeScroll();
    });
    void this.renderStorage();
    this.renderNotif();
    window.addEventListener('focus', this.onWake);
    document.addEventListener('visibilitychange', this.onWake);
    if (isSection(this.route.params['section'])) this.later(() => this.maybeScroll(true), SCROLL_FALLBACK_MS);
  }

  destroy(): void {
    this.destroyed = true;
    for (const sub of this.subs) sub.unsubscribe();
    this.subs.length = 0;
    this.stopInstall?.();
    this.stopInstall = null;
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    window.removeEventListener('focus', this.onWake);
    document.removeEventListener('visibilitychange', this.onWake);
  }

  private watch<T>(source: Observable<T>, next: (value: T) => void): void {
    try {
      this.subs.push(source.subscribe({
        next: (value: T) => {
          if (this.destroyed) return;
          try {
            next(value);
          } catch (err) {
            console.error(err);
          }
        },
        error: (err: unknown) => console.error(err),
      }));
    } catch (err) {
      console.error(err);
    }
  }

  /** Section "App": installed or how to install, and whether this build is ready offline. */
  private renderApp(): void {
    if (this.destroyed) return;
    const state = currentInstallState();
    const stateEl = this.view.querySelector('.ol-settings__app-state');
    const hint = this.view.querySelector('.ol-settings__app-hint');
    const button = this.view.querySelector<HTMLElement>('.ol-settings__install');
    if (stateEl) setText(stateEl, state === 'installed' ? t.appInstalledShort : t.appNotInstalled);
    if (button) button.hidden = state !== 'prompt';
    if (hint) {
      setText(hint, state === 'installed' ? t.appInstalled : state === 'prompt' ? t.appInstallHint : state === 'ios' ? t.appInstallIos : t.appInstallManual);
    }
    void offlineReady().then((ready) => {
      const el = this.view.querySelector('.ol-settings__offline');
      if (!el || this.destroyed) return;
      setText(el, ready === null ? t.appOfflineNo : ready ? t.appOfflineYes : t.appOfflinePending);
    });
  }

  private later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (!this.destroyed) fn();
    }, ms);
    this.timers.add(id);
  }

  // -------------------------------------------------------------------------
  // Markup

  private section(id: SectionId, body: SafeHtml): SafeHtml {
    return h`<section class="ol-section ol-settings__section" id="settings-${id}" data-section="${id}" aria-labelledby="settings-${id}-h">
      <div class="ol-section__head"><h2 class="ol-label" id="settings-${id}-h" tabindex="-1">${SECTION_TITLES[id]}</h2></div>
      <ol-card class="ol-settings__card">${body}</ol-card>
    </section>`;
  }

  private markup(): SafeHtml {
    const minutes = (n: number): string => fmt(t.minutesValue, { n });
    const hour = (n: number): string => fmt(t.hourValue, { h: n });
    const daten = h`
      <div class="ol-settings__item">
        <ol-button class="ol-settings__export" variant="tonal" icon="download" label="${t.exportJson}"></ol-button>
        <p class="ol-settings__hint">${t.exportPlaintextHint}</p>
        <p class="ol-settings__hint ol-settings__last-export"></p>
      </div>
      <div class="ol-settings__item">
        <ol-button class="ol-settings__export-md" variant="tonal" icon="notebook-pen" label="${t.exportMarkdown}"></ol-button>
        <p class="ol-settings__hint">${t.exportMarkdownHint}</p>
      </div>
      <div class="ol-settings__item">
        <ol-button class="ol-settings__import-md" variant="tonal" icon="upload" label="${t.importMarkdown}"></ol-button>
        <input class="ol-settings__file-md ol-visually-hidden" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" tabindex="-1" aria-hidden="true">
        <p class="ol-settings__hint">${t.importMarkdownHint}</p>
      </div>
      <div class="ol-settings__item">
        <ol-button class="ol-settings__export-ics" variant="tonal" icon="calendar" label="${t.exportIcsAll}"></ol-button>
        <p class="ol-settings__hint">${t.exportIcsAllHint}</p>
      </div>
      <div class="ol-settings__item">
        <ol-button class="ol-settings__import" variant="tonal" icon="upload" label="${t.importJson}"></ol-button>
        <input class="ol-settings__file ol-visually-hidden" type="file" accept="application/json,.json" tabindex="-1" aria-hidden="true">
        <p class="ol-settings__hint">${t.importNewDeviceHint}</p>
      </div>
      <div class="ol-settings__item">
        <dl class="ol-settings__facts">
          <div class="ol-settings__fact"><dt>${t.storageLabel}</dt><dd class="ol-settings__storage"></dd></div>
          <div class="ol-settings__fact"><dt>${t.persistStatus}</dt><dd class="ol-settings__persist"></dd></div>
        </dl>
        <ol-button class="ol-settings__persist-btn" variant="tonal" size="sm" icon="shield" label="${t.persistAction}" hidden></ol-button>
        <p class="ol-settings__hint ol-settings__persist-result" role="status" aria-live="polite"></p>
      </div>
      <div class="ol-settings__item">
        <ul class="ol-settings__notes">
          ${isSafari() ? h`<li class="ol-settings__line">${icon('info', 20)}<span>${t.safariHint}</span></li>` : ''}
          <li class="ol-settings__line">${icon('shield', 20)}<span>${t.hintDeviceProtection}</span></li>
          <li class="ol-settings__line">${icon('info', 20)}<span>${t.incognitoHint}</span></li>
        </ul>
      </div>
      <div class="ol-settings__item">
        <ol-button class="ol-settings__delete" variant="danger" icon="trash-2" label="${t.deleteAll}"></ol-button>
      </div>`;
    const benachrichtigungen = h`
      <dl class="ol-settings__facts ol-settings__item">
        <div class="ol-settings__fact"><dt>${t.notifPermission}</dt><dd class="ol-settings__notif"></dd></div>
      </dl>
      <div class="ol-settings__item">
        <ol-button class="ol-settings__notif-btn" variant="tonal" size="sm" icon="bell" label="${t.notifRequest}" hidden></ol-button>
      </div>
      <div class="ol-settings__item">
        ${selectField('ol-settings__lead', 'settings-lead', t.reminderLead, options(LEAD_MINUTES, minutes))}
      </div>
      <div class="ol-settings__item">
        <p class="ol-settings__line">${icon('bell', 20)}<span><span class="ol-settings__strong">${t.reminderHint}</span>
          <span class="ol-settings__hint">${t.reminderHintClosed}</span></span></p>
      </div>`;
    const darstellung = h`
      <div class="ol-settings__item">
        <span class="ol-settings__label" id="settings-theme-label">${t.theme}</span>
        <ol-segmented class="ol-settings__theme" aria-labelledby="settings-theme-label">
          <button type="button" data-value="light">${t.themeLight}</button>
          <button type="button" data-value="dark">${t.themeDark}</button>
          <button type="button" data-value="system">${t.themeSystem}</button>
        </ol-segmented>
      </div>
      <div class="ol-settings__item ol-settings__switch">
        <div class="ol-settings__switch-text">
          <span class="ol-settings__strong">${t.leftHanded}</span>
          <span class="ol-settings__hint" id="settings-left-hint">${t.leftHandedHint}</span>
        </div>
        <ol-checkbox class="ol-settings__left" label="${t.leftHanded}" aria-describedby="settings-left-hint"></ol-checkbox>
      </div>
      <div class="ol-settings__item ol-settings__switch">
        <div class="ol-settings__switch-text ol-settings__landscape-text">
          <span class="ol-settings__strong">${t.landscape}</span>
          <span class="ol-settings__hint" id="settings-landscape-hint">${t.landscapeHint}</span>
        </div>
        <ol-checkbox class="ol-settings__landscape" label="${t.landscape}" aria-describedby="settings-landscape-hint"></ol-checkbox>
      </div>
      <div class="ol-settings__item">
        <span class="ol-settings__label" id="settings-motion-label">${t.animations}</span>
        <ol-segmented class="ol-settings__motion" aria-labelledby="settings-motion-label">
          <button type="button" data-value="system">${t.animationsSystem}</button>
          <button type="button" data-value="reduced">${t.animationsReduced}</button>
        </ol-segmented>
      </div>
      <div class="ol-settings__item ol-settings__pair">
        ${selectField('ol-settings__day-start', 'settings-day-start', t.dayStartHour, options(MORNING_HOURS, hour))}
        ${selectField('ol-settings__evening', 'settings-evening', t.eveningHour, options(EVENING_HOURS, hour))}
      </div>`;
    const bereiche = h`
      <ul class="ol-settings__areas"></ul>
      <div class="ol-settings__item ol-settings__reorder">
        <ol-button class="ol-settings__reorder-btn" variant="tonal" size="sm" label="${t.areaReorder}" aria-describedby="settings-reorder-hint"></ol-button>
        <p class="ol-settings__hint" id="settings-reorder-hint">${t.areaReorderHint}</p>
        <p class="ol-visually-hidden ol-settings__reorder-status" role="status" aria-live="polite"></p>
      </div>
      <div class="ol-settings__item ol-settings__create" role="group" aria-label="${t.areaAdd}">
        <span class="ol-settings__label" id="settings-flower-label">${t.areaFlower}</span>
        <div class="ol-settings__flowers" role="radiogroup" aria-labelledby="settings-flower-label">
          ${FLOWER_IDS.map((f) => h`<ol-chip kind="radio" value="${f}" flower="${f}" tint="${tintFor(f)}" label="${flowerName(f)}" ${f === this.newFlower ? 'selected' : ''}></ol-chip>`)}
        </div>
        <ol-input class="ol-settings__new-name" label="${t.fieldName}" maxlength="${NAME_MAX}" autocomplete="off"></ol-input>
        <ol-button class="ol-settings__create-btn" variant="tonal" icon="plus" label="${t.areaAdd}"></ol-button>
      </div>`;
    // App (decision of 19.10.2026): install state and offline readiness (services/pwa.ts).
    const app = h`
      <div class="ol-settings__item">
        <dl class="ol-settings__facts">
          <div class="ol-settings__fact"><dt>${t.appInstallLabel}</dt><dd class="ol-settings__app-state"></dd></div>
        </dl>
        <ol-button class="ol-settings__install" variant="tonal" icon="download" label="${t.appInstallAction}" hidden></ol-button>
        <p class="ol-settings__hint ol-settings__app-hint"></p>
      </div>
      <div class="ol-settings__item">
        <dl class="ol-settings__facts">
          <div class="ol-settings__fact"><dt>${t.appOfflineLabel}</dt><dd class="ol-settings__offline"></dd></div>
        </dl>
        <p class="ol-settings__hint">${t.appOfflineHint}</p>
      </div>`;
    // Tour (decision of 19.10.2026): the main tour and one chapter per area.
    const hilfe = h`
      <div class="ol-settings__item">
        <ol-button class="ol-settings__tour" variant="tonal" icon="circle-help" label="${t.helpTourMain}" data-tour="main"></ol-button>
        <p class="ol-settings__hint">${t.helpTourMainHint}</p>
      </div>
      <div class="ol-settings__item">
        <h3 class="ol-settings__subhead">${t.helpChapters}</h3>
        <div class="ol-settings__chapters">
          <ol-button variant="ghost" size="sm" icon="sun" label="${t.helpChapterHeute}" data-tour="heute"></ol-button>
          <ol-button variant="ghost" size="sm" icon="clipboard-list" label="${t.helpChapterPlanung}" data-tour="planung"></ol-button>
          <ol-button variant="ghost" size="sm" icon="brain" label="${t.helpChapterWissen}" data-tour="wissen"></ol-button>
        </div>
      </div>`;
    const info = h`
      <dl class="ol-settings__facts ol-settings__item">
        <div class="ol-settings__fact"><dt>${t.infoVersion}</dt><dd class="ol-num">${APP_VERSION}</dd></div>
        <div class="ol-settings__fact"><dt>${t.infoBuild}</dt><dd class="ol-mono">${buildHash()}</dd></div>
      </dl>
      <div class="ol-settings__item">
        <h3 class="ol-settings__subhead">${t.infoLicenses}</h3>
        <ul class="ol-settings__licenses">${LICENSES.map((line) => h`<li>${line}</li>`)}</ul>
        <a class="ol-settings__link" href="${appUrl('/licenses.txt')}">${t.infoLicensesLink}</a>
        <p class="ol-settings__hint">${t.infoProvenance}</p>
      </div>
      <div class="ol-settings__item">
        <ol-button class="ol-settings__seed" variant="tonal" icon="sprout" label="${t.seedAction}"></ol-button>
        <p class="ol-settings__hint">${t.seedHint}</p>
      </div>
      <div class="ol-settings__item">
        <h3 class="ol-settings__subhead">${t.infoPrivacy}</h3>
        <p class="ol-body-s">${t.infoPrivacyText}</p>
      </div>`;
    return h`
      <ol-app-bar back heading="${t.settingsTitle}"></ol-app-bar>
      <div class="ol-settings">
        ${this.section('daten', daten)}
        ${this.section('benachrichtigungen', benachrichtigungen)}
        ${this.section('darstellung', darstellung)}
        ${this.section('app', app)}
        ${this.section('bereiche', bereiche)}
        ${this.section('hilfe', hilfe)}
        ${this.section('info', info)}
      </div>`;
  }

  private collect(): Els {
    const v = this.view;
    return {
      exportBtn: req<OlButton>(v, '.ol-settings__export'),
      lastExport: req<HTMLElement>(v, '.ol-settings__last-export'),
      importBtn: req<OlButton>(v, '.ol-settings__import'),
      file: req<HTMLInputElement>(v, '.ol-settings__file'),
      storage: req<HTMLElement>(v, '.ol-settings__storage'),
      persist: req<HTMLElement>(v, '.ol-settings__persist'),
      persistBtn: req<OlButton>(v, '.ol-settings__persist-btn'),
      persistResult: req<HTMLElement>(v, '.ol-settings__persist-result'),
      deleteBtn: req<OlButton>(v, '.ol-settings__delete'),
      notif: req<HTMLElement>(v, '.ol-settings__notif'),
      notifBtn: req<OlButton>(v, '.ol-settings__notif-btn'),
      seedBtn: req<OlButton>(v, '.ol-settings__seed'),
      lead: req<HTMLSelectElement>(v, '.ol-settings__lead'),
      theme: req<OlSegmented>(v, '.ol-settings__theme'),
      landscape: req<OlCheckbox>(v, '.ol-settings__landscape'),
      landscapeText: req<HTMLElement>(v, '.ol-settings__landscape-text'),
      left: req<OlCheckbox>(v, '.ol-settings__left'),
      leftText: req<HTMLElement>(v, '.ol-settings__switch-text:not(.ol-settings__landscape-text)'),
      animations: req<OlSegmented>(v, '.ol-settings__motion'),
      dayStart: req<HTMLSelectElement>(v, '.ol-settings__day-start'),
      evening: req<HTMLSelectElement>(v, '.ol-settings__evening'),
      areaList: req<HTMLElement>(v, '.ol-settings__areas'),
      reorderBtn: req<OlButton>(v, '.ol-settings__reorder-btn'),
      reorderStatus: req<HTMLElement>(v, '.ol-settings__reorder-status'),
      flowers: req<HTMLElement>(v, '.ol-settings__flowers'),
      newName: req<OlInput>(v, '.ol-settings__new-name'),
      createBtn: req<OlButton>(v, '.ol-settings__create-btn'),
    };
  }

  private bind(): void {
    const els = this.els;
    els.exportBtn.addEventListener('click', () => void this.onExport());
    this.view.querySelector('.ol-settings__export-md')?.addEventListener('click', () => {
      void listNotes().then((notes) => exportNotesMarkdown(notes), () => showToast(t.notesExportFailed));
    });
    const mdFile = this.view.querySelector<HTMLInputElement>('.ol-settings__file-md');
    this.view.querySelector('.ol-settings__import-md')?.addEventListener('click', () => mdFile?.click());
    mdFile?.addEventListener('change', () => {
      const file = mdFile.files?.[0];
      mdFile.value = '';
      if (file) void this.onImportMarkdown(file);
    });
    this.view.querySelector('.ol-settings__export-ics')?.addEventListener('click', () => void exportAllIcs());
    // The file picker opens from the click itself (user activation).
    els.importBtn.addEventListener('click', () => {
      if (!this.importing) els.file.click();
    });
    els.file.addEventListener('change', () => {
      const file = els.file.files?.[0];
      els.file.value = '';
      if (file) void this.onImport(file);
    });
    els.persistBtn.addEventListener('click', () => void this.onPersist());
    els.seedBtn.addEventListener('click', () => void this.onSeed());
    this.view.querySelector('.ol-settings__install')?.addEventListener('click', () => void promptInstall().then(() => this.renderApp()));
    this.stopInstall = onInstallChange(() => this.renderApp());
    this.renderApp();
    this.view.querySelector('#settings-hilfe')?.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tour]') : null;
      const id = button?.dataset['tour'];
      if (isTourId(id)) startTour(id);
    });
    els.notifBtn.addEventListener('click', () => {
      void requestNotificationPermission().then(() => {
        if (!this.destroyed) this.renderNotif();
      });
    });
    els.deleteBtn.addEventListener('click', () => void this.onDeleteAll());

    els.lead.addEventListener('change', () => this.save({ reminderLeadMinutes: Number(els.lead.value) }));
    els.dayStart.addEventListener('change', () => this.save({ dayStartHour: Number(els.dayStart.value) }));
    els.evening.addEventListener('change', () => this.save({ eveningHour: Number(els.evening.value) }));
    els.theme.addEventListener('ol-change', (event) => {
      const value = (event as CustomEvent<SegmentedChange>).detail.value;
      if (value !== 'light' && value !== 'dark' && value !== 'system') return;
      this.save({ theme: value });
      try {
        localStorage.setItem('theme', value);
      } catch {
        // Storage blocked: Profile.settings stays the source of truth.
      }
    });
    els.animations.addEventListener('ol-change', (event) => {
      const value = (event as CustomEvent<SegmentedChange>).detail.value;
      if (value === 'system' || value === 'reduced') this.save({ animations: value });
    });
    els.left.addEventListener('ol-change', (event) => {
      this.save({ leftHanded: (event as CustomEvent<CheckboxChange>).detail.checked });
    });
    // The text next to the switch toggles it as well (larger target, like a <label>).
    els.leftText.addEventListener('click', () => els.left.click());
    els.landscape.addEventListener('ol-change', (event) => {
      this.save({ landscape: (event as CustomEvent<CheckboxChange>).detail.checked ? 1 : 0 });
    });
    els.landscapeText.addEventListener('click', () => els.landscape.click());

    els.areaList.addEventListener('click', this.onAreaClick);
    els.reorderBtn.addEventListener('click', () => this.toggleReorder());
    els.areaList.addEventListener('keydown', this.onAreaKeyDown);
    els.areaList.addEventListener('input', (event) => {
      const input = event.target instanceof Element ? event.target.closest('.ol-settings__area-input') : null;
      input?.removeAttribute('error');
    });
    els.flowers.addEventListener('ol-change', (event) => {
      const value = (event as CustomEvent<ChipChange>).detail.value;
      if (isFlowerId(value)) this.newFlower = value;
    });
    els.newName.addEventListener('input', () => els.newName.removeAttribute('error'));
    els.newName.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      void this.onCreate();
    });
    els.createBtn.addEventListener('click', () => void this.onCreate());
  }

  // -------------------------------------------------------------------------
  // Section from the route

  private maybeScroll(force = false): void {
    if (this.scrolled || this.destroyed) return;
    const id = this.route.params['section'];
    if (!isSection(id)) return;
    if (!force && !(this.profileLoaded && this.areasLoaded)) return;
    this.scrolled = true;
    const section = this.view.querySelector<HTMLElement>(`#settings-${id}`);
    const heading = section?.querySelector<HTMLElement>('h2');
    if (!section) return;
    requestAnimationFrame(() => {
      if (this.destroyed) return;
      heading?.focus({ preventScroll: true });
      section.scrollIntoView({ block: 'start' });
    });
  }

  // -------------------------------------------------------------------------
  // Profile-driven values

  private save(patch: Partial<Profile['settings']>): void {
    updateSettings(patch).catch((err: unknown) => {
      console.error(err);
      showToast(t.toastError);
    });
  }

  private renderProfile(profile: Profile): void {
    const s = profile.settings;
    const els = this.els;
    setAttr(els.theme, 'value', s.theme);
    if (els.landscape.checked !== (s.landscape === 1)) els.landscape.checked = s.landscape === 1;
    setAttr(els.animations, 'value', s.animations);
    if (els.left.checked !== s.leftHanded) els.left.checked = s.leftHanded;
    setSelect(els.lead, s.reminderLeadMinutes, (n) => fmt(t.minutesValue, { n }));
    setSelect(els.dayStart, s.dayStartHour, (n) => fmt(t.hourValue, { h: n }));
    setSelect(els.evening, s.eveningHour, (n) => fmt(t.hourValue, { h: n }));
    const last = profile.lastExportAt;
    setText(
      els.lastExport,
      last && !Number.isNaN(Date.parse(last))
        ? fmt(t.exportLast, { date: formatDayFull(dayOfIso(last)), time: formatTime(last) })
        : t.backupCardBodyNever,
    );
  }

  // -------------------------------------------------------------------------
  // Daten

  private async renderStorage(): Promise<void> {
    const [usage, persisted] = await Promise.all([estimate(), isPersisted()]);
    if (this.destroyed) return;
    setText(
      this.els.storage,
      usage && usage.quota > 0
        ? fmt(t.storageUsage, { used: formatBytes(usage.usage), quota: formatBytes(usage.quota) })
        : t.storageUnknown,
    );
    setText(this.els.persist, persisted === null ? t.persistUnsupported : persisted ? t.persistOn : t.persistOff);
    this.els.persistBtn.hidden = persisted !== false;
  }

  private async onSeed(): Promise<void> {
    const btn = this.els.seedBtn;
    if (btn.hasAttribute('loading')) return;
    const confirmed = await confirmDialog({ title: t.seedConfirmTitle, body: t.seedConfirmBody, confirmLabel: t.seedAction });
    if (!confirmed || this.destroyed) return;
    btn.setAttribute('loading', '');
    try {
      const result = await loadExampleData();
      showToast(result === 'created' ? t.seedDone : t.seedExists);
    } catch (err) {
      console.error(err);
      showToast(t.toastError);
    } finally {
      btn.removeAttribute('loading');
    }
  }

  private async onPersist(): Promise<void> {
    const btn = this.els.persistBtn;
    if (btn.hasAttribute('loading')) return;
    btn.setAttribute('loading', '');
    const result = await requestPersist();
    if (this.destroyed) return;
    btn.removeAttribute('loading');
    setText(this.els.persistResult, PERSIST_TEXT[result]);
    await this.renderStorage();
  }

  /** W6: notes from a Markdown file (the export format, or any single .md as one note). */
  private async onImportMarkdown(file: File): Promise<void> {
    try {
      const parsed = parseNotesMarkdown(await file.text());
      if (parsed.length === 0) {
        showToast(t.importMarkdownEmpty);
        return;
      }
      const r = await importNotes(parsed);
      showToast(fmt(t.importMarkdownDone, { created: r.created, updated: r.updated, unchanged: r.unchanged }));
    } catch (err) {
      console.error(err);
      showToast(t.importMarkdownFailed);
    }
  }

  private async onExport(): Promise<void> {
    const btn = this.els.exportBtn;
    if (btn.hasAttribute('loading')) return;
    const exported = await exportWithNotice(btn);
    if (exported && !this.destroyed) void this.renderStorage();
  }

  private async onImport(file: File): Promise<void> {
    if (this.importing) return;
    let data: ExportFile;
    try {
      data = parseImport(await file.text());
    } catch (err) {
      if (!(err instanceof ImportError)) console.error(err);
      showToast(err instanceof ImportError ? t.toastImportInvalid : t.toastImportFailed);
      return;
    }
    const mode = await choiceDialog({
      title: t.importModeTitle,
      body: t.importModeBody,
      choices: [
        { value: 'merge', label: t.importMerge, hint: t.importMergeHint, variant: 'tonal' },
        { value: 'restore', label: t.importRestore, hint: t.importRestoreHint, variant: 'danger' },
      ],
    });
    if (mode === 'merge') {
      await this.runImport(async () => {
        const result = await importMerge(data);
        showToast(fmt(t.toastImportMerged, { created: result.created, updated: result.updated }));
      });
    } else if (mode === 'restore') {
      const confirmed = await confirmDialog({
        title: t.confirmRestoreTitle,
        body: t.confirmRestoreBody,
        confirmLabel: t.importRestore,
        destructive: true,
      });
      if (!confirmed) return;
      await this.runImport(async () => {
        const n = await importRestore(data);
        showToast(fmt(t.toastImportRestored, { n }));
        // Re-dispatch the route: the screen mounts fresh (the guard sends an empty restore to /start).
        // The confirm dialog's history entry is popped first.
        await historySettled();
        refresh();
      });
    }
  }

  private async runImport(run: () => Promise<void>): Promise<void> {
    const btn = this.els.importBtn;
    this.importing = true;
    btn.setAttribute('loading', '');
    try {
      await run();
    } catch (err) {
      if (!(err instanceof ImportError)) console.error(err);
      // Merge and restore run in one transaction each: a failure leaves the data unchanged.
      showToast(err instanceof ImportError ? t.toastImportInvalid : t.toastImportFailed);
    } finally {
      this.importing = false;
      btn.removeAttribute('loading');
    }
    if (!this.destroyed) void this.renderStorage();
  }

  private async onDeleteAll(): Promise<void> {
    const first = await confirmDialog({
      title: t.deleteAllTitle1, body: t.deleteAllBody1, confirmLabel: t.deleteAll, destructive: true,
    });
    if (!first) return;
    const second = await confirmDialog({
      title: t.deleteAllTitle2, body: t.deleteAllBody2, confirmLabel: t.actionDelete, destructive: true,
    });
    if (!second) return;
    this.els.deleteBtn.setAttribute('loading', '');
    try {
      await deleteAllData();
    } catch (err) {
      console.error(err);
      this.els.deleteBtn.removeAttribute('loading');
      showToast(t.toastError);
      return;
    }
    try {
      localStorage.removeItem('theme');
      localStorage.removeItem('activeTab');
    } catch {
      // Storage blocked: nothing stored there.
    }
    // The dialogs' history entries are popped before the page is replaced.
    await historySettled();
    location.replace(appUrl('/start'));
  }

  // -------------------------------------------------------------------------
  // Benachrichtigungen

  private renderNotif(): void {
    const permission = notificationPermission();
    setText(this.els.notif, NOTIF_TEXT[permission]);
    // Shown only while the browser has not decided yet (decision 2026-10-12).
    this.els.notifBtn.hidden = permission !== 'default';
  }

  private readonly onWake = (): void => {
    if (document.visibilityState === 'hidden' || this.destroyed) return;
    this.renderNotif();
    void this.renderStorage();
  };

  // -------------------------------------------------------------------------
  // Bereiche

  private renderAreas(): void {
    const list = this.els.areaList;
    const active = document.activeElement;
    const rows = new Map<string, HTMLElement>();
    for (const row of [...list.children]) {
      if (row instanceof HTMLElement && row.dataset['id']) rows.set(row.dataset['id'], row);
    }
    const ids = new Set(this.areas.map((a) => a.id));
    for (const [id, row] of rows) {
      if (ids.has(id)) continue;
      if (this.editing === id) this.editing = null;
      row.remove();
      rows.delete(id);
    }
    this.areas.forEach((area, i) => {
      let row = rows.get(area.id);
      if (!row) {
        row = this.createAreaRow(area);
        row.dataset['id'] = area.id;
      }
      const at = list.children[i] ?? null;
      if (at !== row) list.insertBefore(row, at);
      this.updateAreaRow(row, area, i, this.areas.length);
    });
    const current = document.activeElement;
    const focusInList = current === null || current === document.body || list.contains(current);
    const focus = this.reordering && focusInList ? this.moveFocus : null;
    const moved = focus ? list.querySelector<HTMLElement>(`.ol-settings__area[data-id="${CSS.escape(focus.id)}"]`) : null;
    if (focus && moved) {
      // The used button, or the other direction once the row reached an end (disabled buttons drop focus).
      const own = moved.querySelector<HTMLElement>(`.ol-settings__area-${focus.dir}`);
      const other = moved.querySelector<HTMLElement>(`.ol-settings__area-${focus.dir === 'up' ? 'down' : 'up'}`);
      const target = own && !own.hasAttribute('disabled') ? own : other;
      if (target && !target.contains(document.activeElement)) {
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'nearest' });
      }
    } else if (active instanceof HTMLElement && active.isConnected && document.activeElement !== active && list.contains(active)) {
      active.focus({ preventScroll: true });
    }
  }

  private toggleReorder(): void {
    if (this.editing) {
      const row = [...this.els.areaList.children].find((r) => r instanceof HTMLElement && r.dataset['id'] === this.editing);
      if (row instanceof HTMLElement) this.endRename(row, false);
    }
    this.reordering = !this.reordering;
    this.moveFocus = null;
    this.els.areaList.toggleAttribute('data-reorder', this.reordering);
    setAttr(this.els.reorderBtn, 'label', this.reordering ? t.areaReorderDone : t.areaReorder);
    setText(this.els.reorderStatus, '');
    this.renderAreas();
  }

  private async moveArea(area: Area, dir: 'up' | 'down'): Promise<void> {
    this.moveFocus = { id: area.id, dir };
    try {
      const { index, total } = await moveAreaBy(area.id, dir === 'up' ? -1 : 1);
      if (!this.destroyed) setText(this.els.reorderStatus, fmt(t.areaMovedAnnounce, { name: area.name, pos: index + 1, total }));
    } catch (err) {
      console.error(err);
      showToast(t.toastError);
    }
  }

  private createAreaRow(area: Area): HTMLElement {
    const li = document.createElement('li');
    li.className = 'ol-settings__area';
    render(li, h`
      <span class="ol-settings__area-bar" aria-hidden="true"></span>
      <ol-flower class="ol-settings__area-flower" flower="${area.flower}" size="24"></ol-flower>
      <div class="ol-settings__area-main">
        <div class="ol-settings__area-view">
          <span class="ol-settings__area-name"></span>
          <span class="ol-settings__area-state">${t.areaArchived}</span>
        </div>
        <div class="ol-settings__area-edit" hidden>
          <ol-input class="ol-settings__area-input" label="${t.fieldName}" maxlength="${NAME_MAX}" autocomplete="off"></ol-input>
          <div class="ol-settings__area-edit-actions">
            <ol-button class="ol-settings__area-cancel" variant="ghost" size="sm" label="${t.actionCancel}"></ol-button>
            <ol-button class="ol-settings__area-save" variant="filled" size="sm" label="${t.actionSave}"></ol-button>
          </div>
        </div>
      </div>
      <div class="ol-settings__area-actions">
        <ol-icon-button class="ol-settings__area-up" icon="chevron-up" label="" hidden></ol-icon-button>
        <ol-icon-button class="ol-settings__area-down" icon="chevron-down" label="" hidden></ol-icon-button>
        <ol-icon-button class="ol-settings__area-rename" icon="pencil" label=""></ol-icon-button>
        <ol-icon-button class="ol-settings__area-archive" icon="archive" label=""></ol-icon-button>
      </div>`);
    return li;
  }

  private updateAreaRow(row: HTMLElement, area: Area, index: number, total: number): void {
    setVar(row, '--tint', area.tint);
    const up = row.querySelector<HTMLElement>('.ol-settings__area-up');
    const down = row.querySelector<HTMLElement>('.ol-settings__area-down');
    const rename = row.querySelector<HTMLElement>('.ol-settings__area-rename');
    const archive = row.querySelector<HTMLElement>('.ol-settings__area-archive');
    for (const el of [up, down]) if (el) el.hidden = !this.reordering;
    for (const el of [rename, archive]) if (el) el.hidden = this.reordering;
    if (up) {
      setAttr(up, 'label', fmt(t.areaMoveUpAria, { name: area.name }));
      up.toggleAttribute('disabled', index === 0);
    }
    if (down) {
      setAttr(down, 'label', fmt(t.areaMoveDownAria, { name: area.name }));
      down.toggleAttribute('disabled', index === total - 1);
    }
    row.toggleAttribute('data-archived', area.archived === 1);
    const flower = row.querySelector('.ol-settings__area-flower');
    if (flower) setAttr(flower, 'flower', area.flower);
    const name = row.querySelector('.ol-settings__area-name');
    if (name) setText(name, area.name);
    const state = row.querySelector<HTMLElement>('.ol-settings__area-state');
    if (state) state.hidden = area.archived === 0;
    if (rename) setAttr(rename, 'label', fmt(t.areaRenameAria, { name: area.name }));
    if (archive) {
      setAttr(archive, 'icon', area.archived === 1 ? 'undo-2' : 'archive');
      setAttr(archive, 'label', fmt(area.archived === 1 ? t.areaUnarchiveAria : t.areaArchiveAria, { name: area.name }));
    }
  }

  private rowOf(target: EventTarget | null): { row: HTMLElement; area: Area } | null {
    const row = target instanceof Element ? target.closest<HTMLElement>('.ol-settings__area') : null;
    const area = this.areas.find((a) => a.id === row?.dataset['id']);
    return row && area ? { row, area } : null;
  }

  private readonly onAreaClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const hit = this.rowOf(target);
    if (!target || !hit) return;
    if (target.closest('.ol-settings__area-up')) void this.moveArea(hit.area, 'up');
    else if (target.closest('.ol-settings__area-down')) void this.moveArea(hit.area, 'down');
    else if (target.closest('.ol-settings__area-rename')) this.startRename(hit.row, hit.area);
    else if (target.closest('.ol-settings__area-archive')) void this.toggleArchived(hit.area);
    else if (target.closest('.ol-settings__area-save')) void this.saveRename(hit.row, hit.area);
    else if (target.closest('.ol-settings__area-cancel')) this.endRename(hit.row, true);
  };

  private readonly onAreaKeyDown = (event: KeyboardEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.ol-settings__area-input') || event.isComposing) return;
    const hit = this.rowOf(target);
    if (!hit) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.saveRename(hit.row, hit.area);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.endRename(hit.row, true);
    }
  };

  private startRename(row: HTMLElement, area: Area): void {
    if (this.editing && this.editing !== area.id) {
      const other = [...this.els.areaList.children].find((r) => r instanceof HTMLElement && r.dataset['id'] === this.editing);
      if (other instanceof HTMLElement) this.endRename(other, false);
    }
    this.editing = area.id;
    row.setAttribute('data-editing', '');
    const view = row.querySelector<HTMLElement>('.ol-settings__area-view');
    const edit = row.querySelector<HTMLElement>('.ol-settings__area-edit');
    const actions = row.querySelector<HTMLElement>('.ol-settings__area-actions');
    const input = row.querySelector<OlInput>('.ol-settings__area-input');
    if (view) view.hidden = true;
    if (actions) actions.hidden = true;
    if (edit) edit.hidden = false;
    if (input) {
      input.removeAttribute('error');
      input.value = area.name;
      input.focusInput();
      input.field?.select();
    }
  }

  private endRename(row: HTMLElement, focusButton: boolean): void {
    if (this.editing === row.dataset['id']) this.editing = null;
    row.removeAttribute('data-editing');
    const view = row.querySelector<HTMLElement>('.ol-settings__area-view');
    const edit = row.querySelector<HTMLElement>('.ol-settings__area-edit');
    const actions = row.querySelector<HTMLElement>('.ol-settings__area-actions');
    if (view) view.hidden = false;
    if (actions) actions.hidden = false;
    if (edit) edit.hidden = true;
    if (focusButton) row.querySelector<HTMLElement>('.ol-settings__area-rename')?.focus();
  }

  private async saveRename(row: HTMLElement, area: Area): Promise<void> {
    const input = row.querySelector<OlInput>('.ol-settings__area-input');
    if (!input) return;
    const name = input.value.trim().slice(0, NAME_MAX);
    if (name === '') {
      input.setAttribute('error', t.areaNameRequired);
      input.focusInput();
      return;
    }
    if (name !== area.name) {
      try {
        await updateArea(area.id, { name });
      } catch (err) {
        console.error(err);
        showToast(t.toastError);
        return;
      }
      showToast(t.toastSaved);
    }
    if (!this.destroyed && row.isConnected) this.endRename(row, true);
  }

  private async toggleArchived(area: Area): Promise<void> {
    const archived = area.archived === 1 ? 0 : 1;
    try {
      await setAreaArchived(area.id, archived);
    } catch (err) {
      if (err instanceof LastAreaError) {
        showToast(t.areaLastActive);
      } else {
        console.error(err);
        showToast(t.toastError);
      }
      return;
    }
    showToast(archived === 1 ? t.toastAreaArchived : t.toastAreaUnarchived);
  }

  private async onCreate(): Promise<void> {
    const { newName, createBtn } = this.els;
    if (createBtn.hasAttribute('loading')) return;
    const name = newName.value.trim().slice(0, NAME_MAX);
    if (name === '') {
      newName.setAttribute('error', t.areaNameRequired);
      newName.focusInput();
      return;
    }
    const flower = this.newFlower;
    createBtn.setAttribute('loading', '');
    try {
      await createArea({ name, flower, tint: tintFor(flower) });
      newName.value = '';
      showToast(t.toastAreaCreated);
    } catch (err) {
      console.error(err);
      showToast(t.toastError);
    } finally {
      createBtn.removeAttribute('loading');
    }
  }
}
