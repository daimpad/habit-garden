// Abendfeuer (Garten-Insel Teil 3): compact auto-height sheet with one short field ("Was hat dich heute
// gefreut?", up to three lines) and "Ans Feuer". Saving appends "Gefreut: <text>" to the day's journal note
// (repo/notes appendJournal, services/island joyEntry) and hands the note to the caller, which lets the spark
// rise, shows the toast with "Öffnen" and Keimi's thank-you. The sheet keeps the day it was opened for.
import type { OlButton } from '../../components/ol-button.js';
import type { OlInput } from '../../components/ol-input.js';
import { createSheet, type OlSheet } from '../../components/ol-sheet.js';
import { showToast } from '../../components/ol-toast.js';
import { t } from '../../i18n/de.js';
import type { Day, Note } from '../../model.js';
import { appendJournal } from '../../repo/notes.js';
import { joyEntry } from '../../services/island.js';
import { h, render } from '../../util/dom.js';

function req<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`joy: missing ${selector}`);
  return el;
}

export function openJoySheet(day: Day, onSaved: (note: Note) => void): OlSheet {
  const sheet = createSheet({ title: t.joySheetTitle, fit: true });
  render(sheet.bodyEl, h`<div class="ol-joy">
    <ol-input class="ol-joy__field" multiline rows-max="3" label="${t.joyFieldLabel}" autofocus></ol-input>
  </div>`);
  render(sheet.footerEl, h`<ol-button class="ol-joy__save" variant="filled" icon="flame" label="${t.joySave}"></ol-button>`);
  const field = req<OlInput>(sheet.bodyEl, '.ol-joy__field');
  const save = req<OlButton>(sheet.footerEl, '.ol-joy__save');

  const submit = async (): Promise<void> => {
    if (save.hasAttribute('loading')) return;
    const text = field.value.trim();
    if (!text) {
      field.setAttribute('error', t.joyRequired);
      field.focusInput();
      return;
    }
    save.setAttribute('loading', '');
    try {
      const note = await appendJournal(day, joyEntry(text));
      sheet.close('action');
      onSaved(note);
    } catch {
      save.removeAttribute('loading');
      showToast(t.toastError);
    }
  };

  field.addEventListener('input', () => {
    if (field.hasAttribute('error')) field.removeAttribute('error');
  });
  save.addEventListener('click', () => void submit());
  sheet.open();
  return sheet;
}
