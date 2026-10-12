// WISSEN placeholder (F §4.13, D8): app bar with ⚙ and an empty state naming the next action.
// The FAB (main.ts) opens capture with "Notiz". Notes saved from capture or the journal are counted, so the
// empty state does not ask for a first note once notes exist; they stay in the JSON export.
// TODO(phase-4): note list, tag sheet (AND/OR), Markdown editor with autosave, search (A.3 Screen 3).
// /wissen/n/:id mounts this placeholder as well until then.
import type { Subscription } from 'dexie';
import '../components/ol-app-bar.js';
import '../components/ol-empty-state.js';
import '../components/ol-icon-button.js';
import { fmt, t } from '../i18n/de.js';
import { noteCount$ } from '../repo/notes.js';
import type { Route } from '../router.js';
import { emit, h, render } from '../util/dom.js';

function message(count: number): string {
  if (count <= 0) return t.emptyWissen;
  return count === 1 ? t.wissenNoteSavedOne : fmt(t.wissenNotesSaved, { n: count });
}

export function mount(view: HTMLElement, route: Route): () => void {
  void route;
  render(view, h`
    <ol-app-bar heading="${t.titleWissen}">
      <ol-icon-button slot="actions" class="ol-wissen__settings" icon="settings" label="${t.actionSettings}"></ol-icon-button>
    </ol-app-bar>
    <div class="ol-wissen">
      <ol-empty-state icon="notebook-pen" message="${t.emptyWissen}"></ol-empty-state>
    </div>`);
  view.querySelector('.ol-wissen__settings')?.addEventListener('click', (event) => {
    if (event.currentTarget instanceof Element) emit(event.currentTarget, 'ol-navigate', { path: '/einstellungen' });
  });

  const empty = view.querySelector<HTMLElement>('ol-empty-state');
  let sub: Subscription | null = null;
  try {
    sub = noteCount$().subscribe({
      next: (count) => {
        const text = message(count);
        if (empty && empty.getAttribute('message') !== text) empty.setAttribute('message', text);
      },
      error: (err: unknown) => console.error(err),
    });
  } catch (err) {
    console.error(err);
  }
  return () => sub?.unsubscribe();
}
