// Journal sheet (F §4.13, A.2 H4, S20). Auto-height sheet with history entry: a short multiline field,
// "Speichern" in the footer → appendJournal(day, text) (one note per day, kind 'journal', tag
// journal/JJJJ/MM; later saves append; it links the day's mood entry in the same transaction), toast, close.
// The sheet keeps the day it was opened for: an entry belongs to the day on which it was started.
// Today's earlier entries are listed read-only below the field (S20), as plain text.
import type { Subscription } from 'dexie';
import type { OlButton } from '../../components/ol-button.js';
import type { OlInput } from '../../components/ol-input.js';
import { createSheet, type OlSheet } from '../../components/ol-sheet.js';
import { showToast } from '../../components/ol-toast.js';
import { t } from '../../i18n/de.js';
import type { Day, Note } from '../../model.js';
import { appendJournal, journalFor$ } from '../../repo/notes.js';
import { h, render } from '../../util/dom.js';

interface Entry { time: string; text: string }

const ENTRY_RE = /^\*\*(\d{2}:\d{2})\*\*\s+([\s\S]*)$/u;

/** Splits a journal body ("**HH:MM** text" blocks separated by blank lines) into entries. */
function entriesOf(note: Note | undefined): Entry[] {
  if (!note || note.body.trim() === '') return [];
  return note.body
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .map((block) => {
      const match = ENTRY_RE.exec(block);
      return match ? { time: match[1] ?? '', text: match[2] ?? '' } : { time: '', text: block };
    });
}

function req<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`journal: missing ${selector}`);
  return el;
}

export function openJournal(day: Day): OlSheet {
  const sheet = createSheet({ title: t.journalSheetTitle, fit: true });
  const headingId = `${sheet.sheetKey}-earlier`;
  render(sheet.bodyEl, h`<div class="ol-journal">
    <ol-input class="ol-journal__field" multiline rows-max="6" label="${t.journalFieldLabel}" autofocus></ol-input>
    <section class="ol-journal__earlier" aria-labelledby="${headingId}" hidden>
      <h3 class="ol-label" id="${headingId}">${t.journalEarlier}</h3>
      <ol class="ol-journal__entries"></ol>
    </section>
  </div>`);
  render(sheet.footerEl, h`<ol-button class="ol-journal__save" variant="filled" label="${t.actionSave}"></ol-button>`);

  const field = req<OlInput>(sheet.bodyEl, '.ol-journal__field');
  const earlier = req<HTMLElement>(sheet.bodyEl, '.ol-journal__earlier');
  const list = req<HTMLElement>(sheet.bodyEl, '.ol-journal__entries');
  const save = req<OlButton>(sheet.footerEl, '.ol-journal__save');

  let sub: Subscription | null = journalFor$(day).subscribe({
    next: (note: Note | undefined) => {
      const entries = entriesOf(note);
      earlier.hidden = entries.length === 0;
      render(list, h`${entries.map((e) => h`<li class="ol-journal__entry">${e.time ? h`<span class="ol-journal__time ol-caption ol-num">${e.time}</span>` : ''}<p class="ol-journal__text ol-body-s">${e.text}</p></li>`)}`);
    },
    error: (err: unknown) => console.error(err),
  });
  const finish = (): void => {
    sub?.unsubscribe();
    sub = null;
  };

  const submit = async (): Promise<void> => {
    if (save.hasAttribute('loading')) return;
    const text = field.value.trim();
    if (!text) {
      field.setAttribute('error', t.journalRequired);
      field.focusInput();
      return;
    }
    save.setAttribute('loading', '');
    try {
      await appendJournal(day, text);
      showToast(t.toastJournalSaved);
      sheet.close('action');
    } catch {
      save.removeAttribute('loading');
      showToast(t.toastError);
    }
  };

  field.addEventListener('input', () => {
    if (field.hasAttribute('error')) field.removeAttribute('error');
  });
  save.addEventListener('click', () => void submit());
  sheet.addEventListener('ol-dismiss', (event) => {
    if (event.target === sheet) finish();
  });
  void sheet.closed.then(finish, finish);

  sheet.open();
  return sheet;
}
