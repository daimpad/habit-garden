// CONTRACT STUB – implemented in AP7 (shell). Bootstrap: open the DB, apply settings
// (data-motion, FAB side), render the shell (view, bottom nav, FAB, toast, particles),
// wire global events (ol-navigate, ol-back, delegated <a href="/…"> clicks), start the router
// with the onboarding guard, start reminders and the day watcher.
import './components/ol-app-bar.js';
import './components/ol-bottom-nav.js';
import './components/ol-button.js';
import './components/ol-icon-button.js';
import './components/ol-fab.js';
import './components/ol-card.js';
import './components/ol-checkbox.js';
import './components/ol-habit-toggle.js';
import './components/ol-plant.js';
import './components/ol-flower.js';
import './components/ol-particles.js';
import './components/ol-heatmap.js';
import './components/ol-toast.js';
import './components/ol-sheet.js';
import './components/ol-dialog.js';
import './components/ol-chip.js';
import './components/ol-segmented.js';
import './components/ol-empty-state.js';
import './components/ol-input.js';
import { db } from './db.js';
import { t } from './i18n/de.js';
import { h, render } from './util/dom.js';

async function boot(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;
  await db.open();
  render(app, h`<main class="ol-view"><p class="ol-body">${t.appName}</p></main>`);
}

void boot();
