// Bootstrap: open the DB, apply settings (data-motion, theme, FAB side), render the shell (view,
// bottom nav, FAB, toast, particles), wire global events (ol-navigate, ol-back, delegated
// <a href="/…"> clicks), start the router with the onboarding guard, start reminders and the
// day watcher.
//
// Details of this implementation:
// - Screens export mount(view, route) → cleanup. The previous cleanup runs before the next mount; every
//   mount gets a fresh <main id="view"> so listeners a screen left on the element cannot leak.
// - Overlay routes (/aufgabe/:id, /gewohnheit/:id) open their sheet with { routed: true } over the base
//   screen; a user dismiss goes back(), leaving the route closes the sheet with reason 'route'.
// - Transitions (B.4): tab switch 120 ms crossfade (none under reduced motion); a level deeper or back
//   translateX(±20px) + fade 200 ms (120 ms fade under reduced motion).
// - Tab state: the scroll position of each base path is kept in memory and restored on tab switch,
//   history pop and refresh; other navigations start at the top. Focus moves to the screen's <h1>.
// - Calls into screen and sheet modules are guarded, so a failing screen leaves the shell usable.
// - Navigation order (B.4): from 900 px the nav is the left rail and comes first in the DOM (and so in
//   the tab order); below it follows #view and the FAB as the bottom bar.
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
import type { OlBottomNav } from './components/ol-bottom-nav.js';
import type { OlFab } from './components/ol-fab.js';
import { historySettled, topModal, type DismissReason, type OlSheet } from './components/ol-sheet.js';
import { db } from './db.js';
import { t } from './i18n/de.js';
import type { Profile } from './model.js';
import { getProfile, profile$ } from './repo/profile.js';
import {
  TABS, back, baseRoute, current, lastPathOf, navigate, onRoute, parseRoute, refresh, routeHref, startRouter,
  type Route, type RouteChange, type RouteName,
} from './router.js';
import * as einstellungenScreen from './screens/einstellungen.js';
import * as heuteScreen from './screens/heute.js';
import * as planungScreen from './screens/planung.js';
import { openCapture } from './screens/sheets/capture.js';
import { openHabitSheet } from './screens/sheets/habit.js';
import { openTaskSheet } from './screens/sheets/task.js';
import * as startScreen from './screens/start.js';
import * as wissenScreen from './screens/wissen.js';
import { startReminders } from './services/reminders.js';
import { onDayChange } from './util/date.js';
import { h, motionReduced, render } from './util/dom.js';

type ScreenMount = (view: HTMLElement, route: Route) => () => void;

function screenFor(name: RouteName): ScreenMount | null {
  switch (name) {
    case 'start':
      return startScreen.mount;
    case 'heute':
      return heuteScreen.mount;
    case 'planung':
    case 'planung-inbox':
    case 'planung-project':
      return planungScreen.mount;
    case 'wissen':
    case 'wissen-note':
      return wissenScreen.mount;
    case 'einstellungen':
      return einstellungenScreen.mount;
    default:
      return null;
  }
}

const noop = (): void => undefined;

// ---------------------------------------------------------------------------
// Shell

interface Shell { root: HTMLElement; view: HTMLElement; fab: OlFab; nav: OlBottomNav }

let shell: Shell | null = null;

function renderShell(app: HTMLElement): Shell | null {
  render(
    app,
    h`<div class="ol-shell"><main id="view" class="ol-view" tabindex="-1"></main><ol-fab></ol-fab><ol-bottom-nav></ol-bottom-nav></div>`,
  );
  const root = app.querySelector<HTMLElement>('.ol-shell');
  const view = app.querySelector<HTMLElement>('#view');
  const fab = app.querySelector<OlFab>('ol-fab');
  const nav = app.querySelector<OlBottomNav>('ol-bottom-nav');
  if (!root || !view || !fab || !nav) return null;
  return { root, view, fab, nav };
}

function renderError(app: HTMLElement, message: string): void {
  render(
    app,
    h`<div class="ol-shell" data-overlay-screen><main id="view" class="ol-view" tabindex="-1"><div class="ol-shell__error" role="alert"><h1 class="ol-title">${t.appName}</h1><p class="ol-body">${message}</p></div></main></div>`,
  );
}

const RAIL_QUERY = '(min-width: 900px)';

/** Puts the nav where it is seen: before #view as the rail (≥ 900 px), after the FAB as the bottom bar. */
function placeNav(rail: boolean): void {
  if (!shell) return;
  const { root, view, nav } = shell;
  const active = document.activeElement;
  const focused = active instanceof HTMLElement && nav.contains(active) ? active : null;
  if (rail) {
    if (nav.nextElementSibling !== view) root.insertBefore(nav, view);
  } else if (root.lastElementChild !== nav) {
    root.append(nav);
  }
  if (focused && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
}

function watchNavPlacement(): void {
  const mql = window.matchMedia(RAIL_QUERY);
  placeNav(mql.matches);
  mql.addEventListener('change', (event) => placeNav(event.matches));
}

/** Exactly one instance at <body> (ol-toast may move itself into an open dialog). */
function ensureSingleton(tag: 'ol-toast' | 'ol-particles'): void {
  if (!document.querySelector(tag)) document.body.append(document.createElement(tag));
}

// ---------------------------------------------------------------------------
// Settings

function applySettings(settings: Profile['settings']): void {
  const root = document.documentElement;
  if (settings.animations === 'reduced') {
    if (root.dataset['motion'] !== 'reduced') root.dataset['motion'] = 'reduced';
  } else if (root.dataset['motion'] !== undefined) {
    delete root.dataset['motion'];
  }
  // TODO(phase-5): dark mode. Until then 'system' (and 'dark') render the light theme.
  if (root.dataset['theme'] !== 'light') root.dataset['theme'] = 'light';
  try {
    // Pre-paint cache only; Profile.settings stays the source of truth (S38).
    if (localStorage.getItem('theme') !== settings.theme) localStorage.setItem('theme', settings.theme);
  } catch {
    // Storage blocked: nothing to cache.
  }
  const side = settings.leftHanded ? 'left' : 'right';
  if (shell && shell.fab.getAttribute('side') !== side) shell.fab.setAttribute('side', side);
}

let remindersStarted = false;

function startRemindersOnce(): void {
  if (remindersStarted) return;
  remindersStarted = true;
  try {
    startReminders();
  } catch {
    remindersStarted = false;
  }
}

function watchProfile(initial: Profile): void {
  let onboarded = initial.onboardingDone === 1;
  try {
    profile$().subscribe({
      next: (profile) => {
        applySettings(profile.settings);
        const done = profile.onboardingDone === 1;
        if (done) startRemindersOnce();
        if (done === onboarded) return;
        onboarded = done;
        // Onboarding finished (or all data deleted) elsewhere: apply the guard to the open route.
        const name = current().name;
        if (!done && name !== 'start') navigate('/start', { replace: true });
        else if (done && name === 'start') navigate('/heute', { replace: true });
      },
      error: noop,
    });
  } catch {
    // liveQuery unavailable: settings stay as applied at boot.
  }
}

/** Onboarding guard (F §4.8): reads the profile fresh on every navigation. */
async function guard(route: Route): Promise<string | null> {
  let done: 0 | 1;
  try {
    done = (await getProfile()).onboardingDone;
  } catch {
    return null;
  }
  if (done !== 1) return route.name === 'start' ? null : '/start';
  return route.name === 'start' ? '/heute' : null;
}

// ---------------------------------------------------------------------------
// Chrome: bottom nav, FAB, full-screen overlay screens

let overlayScreen = false;
let fabSuppressed = false;

function syncFab(): void {
  if (!shell) return;
  const hidden = overlayScreen || fabSuppressed;
  if (shell.fab.hidden !== hidden) shell.fab.hidden = hidden;
}

function syncChrome(base: Route): void {
  if (!shell) return;
  overlayScreen = base.name === 'start' || base.name === 'einstellungen';
  shell.root.toggleAttribute('data-overlay-screen', overlayScreen);
  if (shell.nav.hidden !== overlayScreen) shell.nav.hidden = overlayScreen;
  shell.nav.value = base.tab;
  for (const tab of TABS) shell.nav.setTabPath(tab, lastPathOf(tab));
  syncFab();
}

/** G1: HEUTE and PLANUNG capture a task, WISSEN a note. */
function onFabClick(): void {
  const tab = baseRoute().tab;
  if (!tab || overlayScreen) return;
  let sheet: OlSheet;
  try {
    // TODO(phase-3): PLANUNG pre-fills the selected area and project (G1).
    sheet = openCapture({ type: tab === 'wissen' ? 'note' : 'task' });
  } catch {
    return;
  }
  // B.4: the FAB fades out while the capture sheet is open.
  fabSuppressed = true;
  syncFab();
  const restore = (): void => {
    fabSuppressed = false;
    syncFab();
  };
  // Back as soon as closing starts: the sheet returns focus to the FAB button, which must be
  // focusable (not hidden) by then. `closed` is the fallback.
  sheet.addEventListener('ol-dismiss', (event) => {
    if (event.target === sheet) restore();
  });
  if (sheet.closed instanceof Promise) sheet.closed.then(restore, restore);
  else restore();
}

// ---------------------------------------------------------------------------
// Screens

interface Mounted { key: string; route: Route; cleanup: () => void }

let mounted: Mounted | null = null;
const scrollMemory = new Map<string, number>();
let stopScrollJob: () => void = noop;
let stopFocusJob: () => void = noop;

function depthOf(route: Route): number {
  switch (route.name) {
    case 'planung-inbox':
    case 'planung-project':
    case 'wissen-note':
    case 'einstellungen':
      return 1;
    default:
      return 0;
  }
}

function animateView(view: HTMLElement, prev: Route | null, next: Route, change: RouteChange): void {
  if (!prev || change.kind === 'initial' || change.kind === 'refresh' || typeof view.animate !== 'function') return;
  const reduced = motionReduced();
  const tabSwitch = prev.tab !== null && next.tab !== null && prev.tab !== next.tab;
  if (tabSwitch) {
    // B.4 "Tab-Wechsel": crossfade without direction; nothing under reduced motion.
    if (!reduced) view.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear' });
    return;
  }
  const delta = depthOf(next) - depthOf(prev);
  if (delta === 0 || reduced) {
    view.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear' });
    return;
  }
  // B.4 "Ebene öffnen": translateX(20px → 0) + fade; back is the inverse direction.
  view.animate(
    [{ opacity: 0, transform: `translateX(${delta > 0 ? 20 : -20}px)` }, { opacity: 1, transform: 'translateX(0)' }],
    { duration: 200, easing: 'cubic-bezier(0,0,0,1)' },
  );
}

const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

/** Scrolls to y; content rendered asynchronously (liveQuery) is waited for up to 1 s. */
function scrollToY(view: HTMLElement, y: number): void {
  stopScrollJob();
  window.scrollTo(0, y);
  if (y <= 0 || Math.abs(window.scrollY - y) < 1 || typeof ResizeObserver !== 'function') return;
  const observer = new ResizeObserver(() => {
    window.scrollTo(0, y);
    if (Math.abs(window.scrollY - y) < 1) stop();
  });
  const timer = window.setTimeout(() => stop(), 1000);
  const stop = (): void => {
    observer.disconnect();
    window.clearTimeout(timer);
    for (const type of USER_SCROLL_EVENTS) window.removeEventListener(type, stop, true);
    stopScrollJob = noop;
  };
  for (const type of USER_SCROLL_EVENTS) window.addEventListener(type, stop, { capture: true, passive: true });
  observer.observe(view);
  stopScrollJob = stop;
}

function focusHeading(view: HTMLElement): boolean {
  const heading = view.querySelector<HTMLElement>('h1');
  if (!heading) return false;
  if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  return true;
}

/** Moves focus to the new screen's <h1> (it may render a moment later), else to #view. */
function focusScreen(view: HTMLElement): void {
  stopFocusJob();
  if (topModal()) return;
  if (focusHeading(view)) return;
  const before = document.activeElement;
  const moved = (): boolean => {
    const active = document.activeElement;
    return active !== null && active !== document.body && active !== before;
  };
  const observer = new MutationObserver(() => {
    if (!view.isConnected || moved() || topModal()) stop();
    else if (focusHeading(view)) stop();
  });
  const timer = window.setTimeout(() => {
    const fallback = view.isConnected && !moved() && !topModal();
    stop();
    if (fallback) view.focus({ preventScroll: true });
  }, 400);
  const stop = (): void => {
    observer.disconnect();
    window.clearTimeout(timer);
    stopFocusJob = noop;
  };
  observer.observe(view, { childList: true, subtree: true });
  stopFocusJob = stop;
}

function mountBase(route: Route, change: RouteChange, overlayOpen: boolean): void {
  if (!shell) return;
  const key = routeHref(route);
  const prev = mounted;
  const focusWasInView = shell.view.contains(document.activeElement);
  stopFocusJob();
  if (prev) {
    scrollMemory.set(prev.key, window.scrollY);
    mounted = null;
    try {
      prev.cleanup();
    } catch {
      // A failing cleanup must not block the next screen.
    }
  }
  const view = document.createElement('main');
  view.id = 'view';
  view.className = 'ol-view';
  view.tabIndex = -1;
  view.dataset['screen'] = route.name;
  shell.view.replaceWith(view);
  shell.view = view;

  let cleanup = noop;
  const mount = screenFor(route.name);
  if (mount) {
    try {
      const result: unknown = mount(view, route);
      if (typeof result === 'function') cleanup = result as () => void;
    } catch {
      // Screen not available: the shell stays usable.
    }
  }
  mounted = { key, route, cleanup };
  animateView(view, prev?.route ?? null, route, change);

  const tabSwitch = prev !== null && route.tab !== null && prev.route.tab !== route.tab;
  const restore = change.kind === 'pop' || change.kind === 'refresh' || tabSwitch;
  if (change.kind !== 'initial') scrollToY(view, restore ? scrollMemory.get(key) ?? 0 : 0);

  const moveFocus = change.kind === 'refresh' ? focusWasInView : change.kind !== 'initial';
  if (moveFocus && !overlayOpen) focusScreen(view);
}

// ---------------------------------------------------------------------------
// Overlay routes

interface OverlayEntry { key: string; sheet: OlSheet | null; done: boolean }

let overlay: OverlayEntry | null = null;

function overlayKey(route: Route): string | null {
  if (!route.overlay) return null;
  const id = route.name === 'aufgabe' ? route.params['taskId'] : route.params['habitId'];
  return id ? `${route.name}:${id}` : null;
}

function syncOverlay(route: Route): void {
  const key = overlayKey(route);
  if (overlay && overlay.key !== key) {
    const old = overlay;
    overlay = null;
    old.done = true;
    try {
      old.sheet?.close('route');
    } catch {
      // Already gone.
    }
  }
  if (!key || overlay) return;
  const entry: OverlayEntry = { key, sheet: null, done: false };
  overlay = entry;
  const dismissed = (reason: DismissReason | undefined): void => {
    if (entry.done) return;
    entry.done = true;
    if (overlay === entry) overlay = null;
    // 'route': the router closed it; 'history': the entry is already gone.
    if (reason !== 'route' && reason !== 'history') back();
  };
  try {
    const sheet = route.name === 'aufgabe'
      ? openTaskSheet(route.params['taskId'] ?? '', { routed: true })
      : openHabitSheet(route.params['habitId'] ?? '', { routed: true });
    entry.sheet = sheet;
    sheet.addEventListener('ol-dismiss', (event) => {
      if (event.target !== sheet) return;
      const detail: unknown = event instanceof CustomEvent ? event.detail : undefined;
      const reason = typeof detail === 'object' && detail !== null ? (detail as { reason?: DismissReason }).reason : undefined;
      dismissed(reason);
    });
    // Fallback for a sheet that closed before the listener was attached (e.g. unknown id).
    if (sheet.closed instanceof Promise) sheet.closed.then(dismissed, () => dismissed(undefined));
  } catch {
    // Sheet module not available: the route stays without a sheet.
  }
}

function onRouteChange(route: Route, change: RouteChange): void {
  const base = baseRoute();
  syncChrome(base);
  if (!mounted || mounted.key !== routeHref(base) || change.kind === 'refresh') {
    mountBase(base, change, route.overlay);
  }
  syncOverlay(route);
}

// ---------------------------------------------------------------------------
// Global events

function onNavigateEvent(event: Event): void {
  if (event.defaultPrevented || !(event instanceof CustomEvent)) return;
  const detail: unknown = event.detail;
  if (typeof detail !== 'object' || detail === null) return;
  const { path, replace } = detail as { path?: unknown; replace?: unknown };
  if (typeof path !== 'string') return;
  navigate(path, { replace: replace === true });
}

function onBackEvent(event: Event): void {
  if (event.defaultPrevented) return;
  back();
}

/** Delegated in-app links: <a href="/…"> without target/download/modifier keys/middle click. */
function onLinkClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest('a[href^="/"]');
  if (!link || link.hasAttribute('download')) return;
  const linkTarget = link.getAttribute('target');
  if (linkTarget && linkTarget !== '_self') return;
  const href = link.getAttribute('href') ?? '';
  if (href.startsWith('//')) return;
  // Only app routes; files such as /assets/… stay with the browser.
  if (href !== '/' && !href.startsWith('/?') && !parseRoute(href)) return;
  event.preventDefault();
  navigate(href);
}

// ---------------------------------------------------------------------------
// Boot

function isVersionError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; inner?: { name?: unknown } | null };
  return e.name === 'VersionError' || e.inner?.name === 'VersionError';
}

async function boot(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;
  let profile: Profile;
  // Another tab with an older connection blocks the upgrade: say so until the open succeeds
  // (renderShell then replaces the message).
  const onBlocked = (): void => renderError(app, t.errorBlocked);
  db.on.blocked.subscribe(onBlocked);
  try {
    await db.open();
    profile = await getProfile();
  } catch (err) {
    renderError(app, isVersionError(err) ? t.errorBlocked : t.errorStorage);
    return;
  } finally {
    db.on.blocked.unsubscribe(onBlocked);
  }
  try {
    history.scrollRestoration = 'manual';
  } catch {
    // Not supported: the browser restores scroll itself.
  }
  shell = renderShell(app);
  if (!shell) return;
  watchNavPlacement();
  ensureSingleton('ol-toast');
  ensureSingleton('ol-particles');
  applySettings(profile.settings);

  document.addEventListener('ol-navigate', onNavigateEvent);
  document.addEventListener('ol-back', onBackEvent);
  document.addEventListener('click', onLinkClick);
  shell.fab.addEventListener('click', onFabClick);

  watchProfile(profile);
  onRoute(onRouteChange);
  await startRouter(guard, { settle: historySettled });
  if (profile.onboardingDone === 1) startRemindersOnce();
  onDayChange(() => refresh());
}

void boot();
