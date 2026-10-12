// PLANUNG placeholder (F §4.13, D8): app bar with ⚙ and an empty state naming the next action.
// The FAB (main.ts) opens capture with "Aufgabe"; tasks with a date appear in HEUTE under "Fällig heute".
// TODO(phase-3): area chips, projects, list / Kanban / matrix views, inbox and project screen (A.3 Screen 2).
// /planung/inbox and /planung/p/:id mount this placeholder as well until then.
import '../components/ol-app-bar.js';
import '../components/ol-empty-state.js';
import '../components/ol-icon-button.js';
import { t } from '../i18n/de.js';
import type { Route } from '../router.js';
import { emit, h, render } from '../util/dom.js';

export function mount(view: HTMLElement, route: Route): () => void {
  void route;
  render(view, h`
    <ol-app-bar heading="${t.titlePlanung}">
      <ol-icon-button slot="actions" class="ol-planung__settings" icon="settings" label="${t.actionSettings}"></ol-icon-button>
    </ol-app-bar>
    <div class="ol-planung">
      <ol-empty-state icon="clipboard-list" message="${t.emptyPlanung}"></ol-empty-state>
    </div>`);
  view.querySelector('.ol-planung__settings')?.addEventListener('click', (event) => {
    if (event.currentTarget instanceof Element) emit(event.currentTarget, 'ol-navigate', { path: '/einstellungen' });
  });
  return () => {};
}
