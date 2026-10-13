// People sheets ("Personen"): the list of all people and the person editor.
// List (full detent, history push): header action "Person hinzufügen"; one row per active person,
// due people first, then by name: butterfly glyph (pale while due, like on the island), name,
// "last contact · rhythm" and a compact "Kontaktiert" button that logs today (toast with
// "Rückgängig"). The name button opens the editor. Empty state with the same action.
// Editor (fit up to the full detent, history push): name, rhythm (radio chips), note; for an existing
// person also "Kontakt eintragen" (optional kind chips Anruf/Nachricht/Treffen, single select and
// deselectable, "Heute kontaktiert") and "Verlauf" (latest 10 logs, each removable with "Rückgängig").
// Footer: Speichern. ⋯ menu of an existing person: Löschen (destructive dialog, undo toast).
//
// Details of this implementation:
// - Both sheets keep their data live (liveQuery) while open and unsubscribe when they close;
//   "today" is re-evaluated on day changes (util/date onDayChange).
// - The list is rebuilt only when its visible content changes; focus stays on the same control of
//   the same person (or moves to the person's name when their "Kontaktiert" button got disabled).
// - "Kontaktiert" is disabled for people contacted today: logging again would replace today's log
//   (repo/contacts: one log per person and day) and drop a kind chosen in the editor.
// - Editor fields are not overwritten by live updates (they are saved with Speichern); the title,
//   the status line and the history follow the stored data. A rhythm outside CONTACT_RHYTHMS (from an
//   import) gets its own chip so saving keeps it.
// - A new person's sheet opens synchronously (the name field takes focus inside open(), so iOS shows
//   the keyboard); an existing person's sheet opens once the person is loaded (unknown id: not opened).
import '../../components/ol-button.js';
import '../../components/ol-chip.js';
import '../../components/ol-empty-state.js';
import '../../components/ol-icon-button.js';
import '../../components/ol-input.js';
import { butterfly } from '../../components/flora.js';
import type { OlButton } from '../../components/ol-button.js';
import type { ChipChange, OlChip } from '../../components/ol-chip.js';
import { confirmDialog } from '../../components/ol-dialog.js';
import type { OlEmptyState } from '../../components/ol-empty-state.js';
import type { OlInput } from '../../components/ol-input.js';
import { createSheet, type OlSheet } from '../../components/ol-sheet.js';
import { showToast } from '../../components/ol-toast.js';
import { fmt, t } from '../../i18n/de.js';
import {
  CONTACT_RHYTHMS, DEFAULT_CONTACT_RHYTHM, type Contact, type ContactKind, type ContactLog, type Id,
} from '../../model.js';
import {
  contact$, contactLogs$, contactLogsFor$, contacts$, createContact, deleteContact, getContact, logContact,
  removeContactLog, restoreContact, restoreContactLog, undoLogContact, updateContact,
} from '../../repo/contacts.js';
import {
  butterflyColor, CONTACT_KINDS, contactKindLabel, contactStatus, contactStatuses, isContactKind, lastContactText,
  rhythmLabel, type ContactStatus,
} from '../../services/contacts.js';
import { formatDayLong, onDayChange, today } from '../../util/date.js';
import { h, HAPTIC, raw, render, vibrate } from '../../util/dom.js';
import { failed, openActionMenu } from './task.js';

interface Sub { unsubscribe(): void }

let uidSeq = 0;
const uid = (prefix: string): string => `${prefix}-${++uidSeq}`;

const GLYPH_SIZE = 32;
const HISTORY_MAX = 10;

const KIND_ICONS: Readonly<Record<ContactKind, string>> = {
  call: 'phone', message: 'message-circle', meeting: 'coffee',
};

/** "Zuletzt vor 9 Tagen · Wöchentlich" */
function metaLine(status: ContactStatus): string {
  return fmt(t.peopleMetaLine, { last: lastContactText(status), rhythm: rhythmLabel(status.contact.rhythmDays) });
}

/** Due people first, then by name (German collation). */
function byDueThenName(a: ContactStatus, b: ContactStatus): number {
  if (a.due !== b.due) return a.due ? -1 : 1;
  const byName = a.contact.name.localeCompare(b.contact.name, 'de', { sensitivity: 'base' });
  if (byName !== 0) return byName;
  return a.contact.sortKey < b.contact.sortKey ? -1 : a.contact.sortKey > b.contact.sortKey ? 1 : 0;
}

/** Logs today's contact and shows "{name}: Kontakt eingetragen" with "Rückgängig". */
async function logToday(contact: Contact, kind?: ContactKind): Promise<void> {
  const result = await logContact(contact.id, today(), kind);
  vibrate(HAPTIC.tick);
  showToast(fmt(t.toastContactLogged, { name: contact.name }), {
    action: { label: t.actionUndo, onAction: () => void undoLogContact(result).catch(failed) },
  });
}

// ---------------------------------------------------------------------------
// People list

class PeopleSheet {
  private contacts: Contact[] | null = null;
  private logs: ContactLog[] | null = null;
  private busy = new Set<Id>();
  private signature: string | null = null;
  private subs: Sub[] = [];
  private stopDay: (() => void) | null = null;

  private list!: HTMLElement;
  private empty!: OlEmptyState;

  constructor(private readonly sheet: OlSheet) {}

  start(): void {
    const sheet = this.sheet;
    render(sheet.headerActionsEl, h`<ol-icon-button class="ol-people__add" icon="user-plus" label="${t.peopleAdd}"></ol-icon-button>`);
    render(
      sheet.bodyEl,
      h`<div class="ol-people">
  <ul class="ol-people__list" hidden></ul>
  <ol-empty-state class="ol-people__empty" icon="users" message="${t.peopleEmpty}" action="${t.peopleAdd}" hidden></ol-empty-state>
</div>`,
    );
    const list = sheet.bodyEl.querySelector<HTMLElement>('.ol-people__list');
    const empty = sheet.bodyEl.querySelector<OlEmptyState>('.ol-people__empty');
    if (!list || !empty) throw new Error('people sheet: markup missing');
    this.list = list;
    this.empty = empty;

    sheet.headerActionsEl.querySelector('ol-icon-button')?.addEventListener('click', () => void openPersonSheet());
    empty.addEventListener('ol-action', () => void openPersonSheet());
    list.addEventListener('click', this.onListClick);
    sheet.addEventListener('ol-dismiss', (event) => {
      if (event.target === sheet) this.cleanup();
    });
    void sheet.closed.then(() => this.cleanup());

    sheet.open();
    this.subscribe();
  }

  private subscribe(): void {
    const fail = (err: unknown): void => console.error(err);
    this.subs.push(
      contacts$().subscribe({
        next: (contacts) => {
          this.contacts = contacts;
          this.render();
        },
        error: fail,
      }),
      contactLogs$().subscribe({
        next: (logs) => {
          this.logs = logs;
          this.render();
        },
        error: fail,
      }),
    );
    this.stopDay = onDayChange(() => this.render());
  }

  private cleanup(): void {
    for (const sub of this.subs) sub.unsubscribe();
    this.subs = [];
    this.stopDay?.();
    this.stopDay = null;
  }

  private render(): void {
    const contacts = this.contacts;
    const logs = this.logs;
    if (!contacts || !logs || !this.sheet.isConnected) return;
    const statuses = contactStatuses(contacts, logs, today()).sort(byDueThenName);
    const rows = statuses.map((s) => ({
      id: s.contact.id,
      name: s.contact.name,
      meta: metaLine(s),
      color: butterflyColor(s.contact),
      due: s.due,
      today: s.contactedToday,
      busy: this.busy.has(s.contact.id),
    }));
    const signature = JSON.stringify(rows);
    if (signature === this.signature) return;
    this.signature = signature;

    const list = this.list;
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && list.contains(active)
      ? active.closest<HTMLElement>('[data-open], [data-contact]')
      : null;
    const focusKey = focused ? { id: focused.dataset['open'] ?? focused.dataset['contact'] ?? '', open: 'open' in focused.dataset } : null;

    // DOM ids come from the list position; person ids (possibly imported) stay in data attributes only.
    const listId = list.id || (list.id = uid('people-list'));
    render(
      list,
      h`${rows.map((row, index) => {
        const metaId = `${listId}-m${index}`;
        return h`<li class="ol-people__row" ${row.due ? 'data-due' : ''}>
  <button type="button" class="ol-people__open" data-open="${row.id}" aria-label="${fmt(t.peopleOpenAria, { name: row.name })}" aria-describedby="${metaId}">
    <span class="ol-people__glyph" aria-hidden="true">${raw(butterfly(row.color, GLYPH_SIZE))}</span>
    <span class="ol-people__text">
      <span class="ol-people__name">${row.name}</span>
      <span class="ol-people__meta ol-body-s" id="${metaId}">${row.meta}</span>
    </span>
  </button>
  <ol-button class="ol-people__contacted" variant="tonal" size="sm" label="${t.peopleContacted}" data-contact="${row.id}" ${row.today || row.busy ? 'disabled' : ''}></ol-button>
</li>`;
      })}`,
    );
    for (const btn of list.querySelectorAll<OlButton>('ol-button[data-contact]')) {
      const row = rows.find((r) => r.id === btn.dataset['contact']);
      if (row) btn.button?.setAttribute('aria-label', fmt(t.peopleContactedAria, { name: row.name }));
    }
    list.hidden = rows.length === 0;
    this.empty.hidden = rows.length > 0;

    if (!focusKey) return;
    const selector = focusKey.open ? 'data-open' : 'data-contact';
    const same = [...list.querySelectorAll<HTMLElement>(`[${selector}]`)].find((el) => el.getAttribute(selector) === focusKey.id);
    const fallback = [...list.querySelectorAll<HTMLElement>('[data-open]')].find((el) => el.dataset['open'] === focusKey.id);
    const target = same instanceof HTMLElement && !same.hasAttribute('disabled') ? same : fallback;
    if (target) target.focus({ preventScroll: true });
    else if (rows.length === 0) this.empty.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    else list.querySelector<HTMLElement>('[data-open]')?.focus({ preventScroll: true });
  }

  private readonly onListClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    const open = target?.closest<HTMLElement>('[data-open]');
    if (open) {
      const id = open.dataset['open'];
      if (id) openPersonSheet(id);
      return;
    }
    const id = target?.closest<HTMLElement>('ol-button[data-contact]')?.dataset['contact'];
    if (id) void this.contacted(id);
  };

  private async contacted(id: Id): Promise<void> {
    const contact = this.contacts?.find((c) => c.id === id);
    if (!contact || this.busy.has(id)) return;
    this.busy.add(id);
    this.render();
    try {
      await logToday(contact);
    } catch (err) {
      failed(err);
    } finally {
      this.busy.delete(id);
      this.render();
    }
  }
}

/** "Personen": all active people with their contact status and "Person hinzufügen". */
export function openPeopleSheet(): OlSheet {
  const sheet = createSheet({ title: t.peopleTitle, history: 'push', detent: 'full', headerActions: true });
  new PeopleSheet(sheet).start();
  return sheet;
}

// ---------------------------------------------------------------------------
// Person editor

class PersonSheet {
  private contact: Contact | null = null;
  private logs: ContactLog[] = [];
  /** The first log snapshot has arrived (status and history stay empty until then, no false "Noch kein Kontakt"). */
  private logsLoaded = false;
  private saving = false;
  private logging = false;
  private gone = false;
  private historySig: string | null = null;
  private subs: Sub[] = [];
  private stopDay: (() => void) | null = null;

  private name!: OlInput;
  private rhythm!: HTMLElement;
  private note!: OlInput;
  private saveBtn!: OlButton;
  private status: HTMLElement | null = null;
  private kinds: HTMLElement | null = null;
  private logBtn: OlButton | null = null;
  private history: HTMLElement | null = null;
  private historyEmpty: HTMLElement | null = null;

  constructor(private readonly sheet: OlSheet, private readonly contactId: Id | null) {}

  /** New person: builds and opens at once. */
  startNew(): void {
    this.build(null);
    this.sheet.open();
  }

  /** Existing person: opens once loaded; an unknown id closes the sheet unopened. */
  async startExisting(id: Id): Promise<void> {
    let contact: Contact | undefined;
    try {
      contact = await getContact(id);
    } catch (err) {
      console.error(err);
    }
    if (!this.sheet.isConnected) return;
    if (!contact) {
      this.sheet.close('action');
      return;
    }
    this.contact = contact;
    this.build(contact);
    this.sheet.open();
    // Filled after open(): the auto-growing note can only measure its content while the dialog is shown.
    this.note.value = contact.note ?? '';
    this.note.field?.dispatchEvent(new Event('input'));
    this.subscribe(id);
  }

  private build(contact: Contact | null): void {
    const sheet = this.sheet;
    const ids = {
      rhythm: uid('person-rhythm'), log: uid('person-log'), kind: uid('person-kind'), history: uid('person-history'),
    };
    const rhythmDays = contact?.rhythmDays ?? DEFAULT_CONTACT_RHYTHM;
    const rhythms = CONTACT_RHYTHMS.includes(rhythmDays) ? CONTACT_RHYTHMS : [...CONTACT_RHYTHMS, rhythmDays].sort((a, b) => a - b);
    if (contact) {
      // Initial focus on ⋯ rather than on the name field (no keyboard pops up when only logging).
      render(sheet.headerActionsEl, h`<ol-icon-button icon="ellipsis" label="${t.actionMore}" autofocus></ol-icon-button>`);
      sheet.setTitle(contact.name);
    }
    const logSection = contact
      ? h`<section class="ol-person__section" aria-labelledby="${ids.log}">
    <h3 class="ol-label" id="${ids.log}">${t.personLogSection}</h3>
    <p class="ol-person__status ol-body-s"></p>
    <p class="ol-person__label" id="${ids.kind}">${t.personKindLabel}</p>
    <div class="ol-person__chips ol-person__kinds" role="group" aria-labelledby="${ids.kind}">
      ${CONTACT_KINDS.map((kind) => h`<ol-chip value="${kind}" icon="${KIND_ICONS[kind]}" label="${contactKindLabel(kind)}"></ol-chip>`)}
    </div>
    <ol-button class="ol-person__log" variant="tonal" icon="check" label="${t.personLogToday}"></ol-button>
  </section>
  <section class="ol-person__section" aria-labelledby="${ids.history}">
    <h3 class="ol-label" id="${ids.history}">${t.personHistory}</h3>
    <ul class="ol-person__history" hidden></ul>
    <p class="ol-person__history-empty ol-body-s" hidden>${t.personHistoryEmpty}</p>
  </section>`
      : null;
    render(
      sheet.bodyEl,
      h`<div class="ol-person">
  <ol-input class="ol-person__name" label="${t.fieldName}" value="${contact?.name ?? ''}" autocomplete="off" maxlength="200" ${contact ? '' : 'autofocus'}></ol-input>
  <div class="ol-person__field">
    <p class="ol-person__label" id="${ids.rhythm}">${t.fieldRhythm}</p>
    <div class="ol-person__chips ol-person__rhythm" role="radiogroup" aria-labelledby="${ids.rhythm}">
      ${rhythms.map((days) => h`<ol-chip kind="radio" value="${String(days)}" label="${rhythmLabel(days)}" ${days === rhythmDays ? 'selected' : ''}></ol-chip>`)}
    </div>
  </div>
  <ol-input class="ol-person__note" label="${t.personFieldNote}" helper="${t.personNoteHelper}" multiline rows-max="6"></ol-input>
  ${logSection}
</div>`,
    );
    render(sheet.footerEl, h`<ol-button class="ol-person__save" variant="filled" label="${t.actionSave}"></ol-button>`);

    const q = <T extends Element>(root: ParentNode, selector: string): T => {
      const el = root.querySelector<T>(selector);
      if (!el) throw new Error(`person sheet: missing ${selector}`);
      return el;
    };
    const body = sheet.bodyEl;
    this.name = q<OlInput>(body, '.ol-person__name');
    this.rhythm = q<HTMLElement>(body, '.ol-person__rhythm');
    this.note = q<OlInput>(body, '.ol-person__note');
    this.saveBtn = q<OlButton>(sheet.footerEl, '.ol-person__save');
    this.name.field?.setAttribute('enterkeyhint', 'done');

    this.name.addEventListener('input', () => {
      if (this.name.value.trim() !== '') this.name.removeAttribute('error');
    });
    this.name.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      void this.save();
    });
    this.saveBtn.addEventListener('click', () => void this.save());

    if (contact) {
      this.status = q<HTMLElement>(body, '.ol-person__status');
      this.kinds = q<HTMLElement>(body, '.ol-person__kinds');
      this.logBtn = q<OlButton>(body, '.ol-person__log');
      this.history = q<HTMLElement>(body, '.ol-person__history');
      this.historyEmpty = q<HTMLElement>(body, '.ol-person__history-empty');
      sheet.headerActionsEl.querySelector('ol-icon-button')?.addEventListener('click', this.onMore);
      this.kinds.addEventListener('ol-change', this.onKindChange);
      this.logBtn.addEventListener('click', () => void this.logNow());
      this.history.addEventListener('click', this.onHistoryClick);
      sheet.addEventListener('ol-dismiss', (event) => {
        if (event.target === sheet) this.cleanup();
      });
      void sheet.closed.then(() => this.cleanup());
    }
  }

  private subscribe(id: Id): void {
    const fail = (err: unknown): void => console.error(err);
    this.subs.push(
      contact$(id).subscribe({
        next: (contact) => {
          if (contact) {
            this.contact = contact;
            this.sheet.setTitle(contact.name);
            this.renderStatus();
          } else if (!this.gone) {
            this.gone = true;
            this.sheet.close('action');
          }
        },
        error: fail,
      }),
      contactLogsFor$(id).subscribe({
        next: (logs) => {
          this.logs = logs;
          this.logsLoaded = true;
          this.renderStatus();
          this.renderHistory();
        },
        error: fail,
      }),
    );
    this.stopDay = onDayChange(() => this.renderStatus());
  }

  private cleanup(): void {
    for (const sub of this.subs) sub.unsubscribe();
    this.subs = [];
    this.stopDay?.();
    this.stopDay = null;
  }

  private renderStatus(): void {
    const contact = this.contact;
    if (!contact || !this.status || !this.logsLoaded) return;
    const text = metaLine(contactStatus(contact, this.logs, today()));
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  /** Latest HISTORY_MAX logs; rebuilt only when they change, focus kept on the same entry (or the next one). */
  private renderHistory(): void {
    const list = this.history;
    const empty = this.historyEmpty;
    if (!list || !empty || !this.logsLoaded) return;
    const items = this.logs.slice(0, HISTORY_MAX).map((log) => {
      const date = formatDayLong(log.day);
      return { id: log.id, date, text: log.kind ? fmt(t.personHistoryLine, { date, kind: contactKindLabel(log.kind) }) : date };
    });
    const signature = JSON.stringify(items);
    if (signature === this.historySig) return;
    this.historySig = signature;
    const active = document.activeElement;
    const focusedId = active instanceof HTMLElement && list.contains(active)
      ? active.closest<HTMLElement>('[data-log]')?.dataset['log'] ?? null
      : null;
    const before = focusedId ? [...list.querySelectorAll<HTMLElement>('[data-log]')].map((el) => el.dataset['log']) : [];
    render(
      list,
      h`${items.map((item) => h`<li class="ol-person__entry">
  <span class="ol-person__entry-text">${item.text}</span>
  <ol-icon-button icon="x" label="${fmt(t.personHistoryRemoveAria, { date: item.date })}" data-log="${item.id}"></ol-icon-button>
</li>`)}`,
    );
    list.hidden = items.length === 0;
    empty.hidden = items.length > 0;
    if (focusedId === null) return;
    const buttons = [...list.querySelectorAll<HTMLElement>('[data-log]')];
    const index = before.indexOf(focusedId);
    const next = buttons.find((b) => b.dataset['log'] === focusedId) ?? buttons[Math.min(Math.max(index, 0), buttons.length - 1)];
    (next ?? this.logBtn)?.focus();
  }

  private selectedKind(): ContactKind | undefined {
    const value = this.kinds?.querySelector<OlChip>('ol-chip[selected]')?.value;
    return isContactKind(value) ? value : undefined;
  }

  /** Single select: selecting a kind deselects the others; selecting it again deselects it. */
  private readonly onKindChange = (event: Event): void => {
    const detail = event instanceof CustomEvent ? (event.detail as ChipChange | null) : null;
    if (!detail?.selected || !this.kinds) return;
    for (const chip of this.kinds.querySelectorAll<OlChip>('ol-chip')) {
      if (chip.value !== detail.value && chip.selected) chip.selected = false;
    }
  };

  private async logNow(): Promise<void> {
    const contact = this.contact;
    if (!contact || this.logging || this.gone) return;
    this.logging = true;
    this.logBtn?.setAttribute('loading', '');
    try {
      await logToday(contact, this.selectedKind());
      for (const chip of this.kinds?.querySelectorAll<OlChip>('ol-chip[selected]') ?? []) chip.selected = false;
    } catch (err) {
      failed(err);
    } finally {
      this.logging = false;
      this.logBtn?.removeAttribute('loading');
    }
  }

  private readonly onHistoryClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('ol-icon-button[data-log]') : null;
    const id = target?.dataset['log'];
    const log = id ? this.logs.find((l) => l.id === id) : undefined;
    if (log) void this.removeLog(log);
  };

  private async removeLog(log: ContactLog): Promise<void> {
    try {
      const removed = await removeContactLog(log.id);
      if (!removed) return;
      showToast(t.toastContactLogRemoved, {
        action: { label: t.actionUndo, onAction: () => void restoreContactLog(removed).catch(failed) },
      });
    } catch (err) {
      failed(err);
    }
  }

  private selectedRhythm(): number {
    const value = Number(this.rhythm.querySelector<OlChip>('ol-chip[selected]')?.value);
    return Number.isInteger(value) && value >= 1 ? value : this.contact?.rhythmDays ?? DEFAULT_CONTACT_RHYTHM;
  }

  private async save(): Promise<void> {
    if (this.saving || this.gone) return;
    const name = this.name.value.trim();
    if (!name) {
      this.name.setAttribute('error', t.personNameRequired);
      this.name.focusInput();
      return;
    }
    const rhythmDays = this.selectedRhythm();
    const note = this.note.value;
    this.saving = true;
    this.saveBtn.setAttribute('loading', '');
    try {
      if (this.contactId === null) {
        await createContact({ name, rhythmDays, note });
        this.sheet.close('action');
        showToast(t.toastPersonCreated);
      } else {
        await updateContact(this.contactId, { name, rhythmDays, note });
        this.sheet.close('action');
        showToast(t.toastSaved);
      }
    } catch (err) {
      this.saving = false;
      this.saveBtn.removeAttribute('loading');
      failed(err);
    }
  }

  private readonly onMore = (): void => {
    const contact = this.contact;
    if (!contact) return;
    openActionMenu(contact.name, [{ label: t.actionDelete, icon: 'trash-2', danger: true, run: () => void this.confirmDelete() }]);
  };

  private async confirmDelete(): Promise<void> {
    const id = this.contactId;
    if (id === null) return;
    const confirmed = await confirmDialog({
      title: t.actionConfirmDelete, body: t.confirmDeletePerson, confirmLabel: t.actionDelete, destructive: true,
    });
    if (!confirmed || this.gone) return;
    this.gone = true;
    try {
      const deleted = await deleteContact(id);
      this.sheet.close('action');
      showToast(t.toastDeleted, { action: { label: t.actionUndo, onAction: () => void restoreContact(deleted).catch(failed) } });
    } catch (err) {
      this.gone = false;
      failed(err);
    }
  }
}

/** Person editor; without an id a new person is created on save ("Person angelegt"). */
export function openPersonSheet(contactId?: Id): OlSheet {
  const sheet = createSheet({
    title: contactId ? t.personTitle : t.personTitleNew, history: 'push', detent: 'full', fit: true,
    headerActions: contactId !== undefined,
  });
  const editor = new PersonSheet(sheet, contactId ?? null);
  if (contactId === undefined) editor.startNew();
  else void editor.startExisting(contactId);
  return sheet;
}
