// History-API router (F §4.8). Routes: /start, /heute, /planung, /planung/inbox, /planung/p/:projectId,
// /wissen, /wissen/n/:noteId, /einstellungen/:section?, overlay routes /aufgabe/:taskId and
// /gewohnheit/:habitId (a sheet over the last active tab). Unknown paths → /heute (replace).
// Query strings are kept (A.1: /wissen?tag=a/b,c&op=and). Popstate entries that only carry sheet
// state ({ olSheet }) with an unchanged path are ignored by the router (ol-sheet handles them).
//
// Details of this implementation (S23, S24):
// - Every entry written by the router carries { olIdx } (in-app depth). ol-sheet copies the state into
//   its own entries, so back() knows whether history.back() stays inside the app; at depth 0 it
//   navigates to the parent/tab root with replace instead of leaving the site.
// - '/', unknown paths and trailing slashes are normalised with replaceState on start and popstate.
// - Direct entry to an overlay route: the current entry becomes the underlay (tab from localStorage
//   'activeTab', default /heute), then the overlay is pushed on top, so back closes the sheet.
// - The guard runs on start, navigate, popstate and refresh; its redirect replaces the entry.
// - Tab state (last path per tab) lives in memory; localStorage 'activeTab' only picks the underlay.
// - No browser globals are touched at module load: parseRoute() runs in node tests.

export type Tab = 'heute' | 'planung' | 'wissen';
export type RouteName =
  | 'start' | 'heute' | 'planung' | 'planung-inbox' | 'planung-project'
  | 'wissen' | 'wissen-note' | 'einstellungen' | 'aufgabe' | 'gewohnheit';

export interface Route {
  name: RouteName;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  /** true for /aufgabe/:id and /gewohnheit/:id */
  overlay: boolean;
  /**
   * Tab the route belongs to (null for /start and /einstellungen; overlays: the underlying tab).
   * parseRoute() cannot know the underlay and yields null for overlays; current() fills it in.
   */
  tab: Tab | null;
  /** Canonical path plus the query string as given ("/wissen?tag=a/b,c"); see routeHref(). */
  href?: string;
}

export const TABS: readonly Tab[] = ['heute', 'planung', 'wissen'];
const HOME = '/heute';

export function isTab(value: unknown): value is Tab {
  return value === 'heute' || value === 'planung' || value === 'wissen';
}

interface Pattern {
  name: RouteName;
  parts: readonly string[];
  tab: Tab | null;
  overlay?: true;
}

const PATTERNS: readonly Pattern[] = [
  { name: 'start', parts: ['start'], tab: null },
  { name: 'heute', parts: ['heute'], tab: 'heute' },
  { name: 'planung', parts: ['planung'], tab: 'planung' },
  { name: 'planung-inbox', parts: ['planung', 'inbox'], tab: 'planung' },
  { name: 'planung-project', parts: ['planung', 'p', ':projectId'], tab: 'planung' },
  { name: 'wissen', parts: ['wissen'], tab: 'wissen' },
  { name: 'wissen-note', parts: ['wissen', 'n', ':noteId'], tab: 'wissen' },
  { name: 'einstellungen', parts: ['einstellungen'], tab: null },
  { name: 'einstellungen', parts: ['einstellungen', ':section'], tab: null },
  { name: 'aufgabe', parts: ['aufgabe', ':taskId'], tab: null, overlay: true },
  { name: 'gewohnheit', parts: ['gewohnheit', ':habitId'], tab: null, overlay: true },
];

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Pure: path (+ optional query) → Route; unknown paths yield null. */
export function parseRoute(pathWithQuery: string): Route | null {
  if (typeof pathWithQuery !== 'string' || !pathWithQuery.startsWith('/')) return null;
  const hashAt = pathWithQuery.indexOf('#');
  const noHash = hashAt >= 0 ? pathWithQuery.slice(0, hashAt) : pathWithQuery;
  const queryAt = noHash.indexOf('?');
  const rawPath = queryAt >= 0 ? noHash.slice(0, queryAt) : noHash;
  const search = queryAt >= 0 ? noHash.slice(queryAt + 1) : '';
  // Empty segments ("//", trailing "/") are dropped: "/heute/" is "/heute".
  const segments = rawPath.split('/').filter((s) => s !== '');
  if (segments.length === 0) return null;

  for (const pattern of PATTERNS) {
    if (pattern.parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < segments.length && ok; i++) {
      const part = pattern.parts[i] ?? '';
      const segment = segments[i] ?? '';
      if (part.startsWith(':')) {
        const value = decode(segment);
        if (value === null || value.trim() === '' || value === '.' || value === '..') ok = false;
        else params[part.slice(1)] = value;
      } else if (part !== segment) {
        ok = false;
      }
    }
    if (!ok) continue;
    const path = `/${segments.join('/')}`;
    return {
      name: pattern.name,
      path,
      params,
      query: new URLSearchParams(search),
      overlay: pattern.overlay === true,
      tab: pattern.tab,
      href: search ? `${path}?${search}` : path,
    };
  }
  return null;
}

/** Path plus query of a route, as written to the address bar. */
export function routeHref(route: Route): string {
  if (route.href) return route.href;
  const search = route.query.toString();
  return search ? `${route.path}?${search}` : route.path;
}

function homeRoute(): Route {
  return {
    name: 'heute', path: HOME, params: {}, query: new URLSearchParams(), overlay: false, tab: 'heute', href: HOME,
  };
}

function tabRoute(tab: Tab): Route {
  return parseRoute(`/${tab}`) ?? homeRoute();
}

// ---------------------------------------------------------------------------
// Router state

export type NavigationKind = 'initial' | 'push' | 'replace' | 'pop' | 'refresh';

/** Second argument of onRoute callbacks: how the route was reached. */
export interface RouteChange {
  kind: NavigationKind;
  /** The route before this change (null on the initial dispatch). */
  previous: Route | null;
}

export type RouteGuard = (route: Route) => string | null | Promise<string | null>;

export interface RouterOptions {
  /**
   * Awaited before a push/replace is written, e.g. ol-sheet's historySettled(): a sheet that just
   * closed may still wait for its history.back(), which would otherwise undo the new entry.
   */
  settle?: () => Promise<void>;
}

type Listener = (route: Route, change: RouteChange) => void;

const listeners = new Set<Listener>();
const lastPaths = new Map<Tab, string>();
let guardFn: RouteGuard | null = null;
let settle: () => Promise<void> = () => Promise.resolve();
let listening = false;
let currentRoute: Route | null = null;
let base: Route | null = null;
let seq = 0;

interface EntryState { idx: number; sheet: boolean; stamped: boolean }

function readState(state: unknown = history.state): EntryState {
  if (typeof state !== 'object' || state === null) return { idx: 0, sheet: false, stamped: false };
  const record = state as Record<string, unknown>;
  const idx = record['olIdx'];
  const valid = typeof idx === 'number' && Number.isInteger(idx) && idx >= 0;
  return { idx: valid ? idx : 0, sheet: record['olSheet'] !== undefined, stamped: valid };
}

function entry(idx: number): { olIdx: number } {
  return { olIdx: idx };
}

function locationHref(): string {
  return location.pathname + location.search;
}

function storedTab(): Tab | null {
  try {
    const value = localStorage.getItem('activeTab');
    return isTab(value) ? value : null;
  } catch {
    return null;
  }
}

function storeTab(tab: Tab): void {
  try {
    if (localStorage.getItem('activeTab') !== tab) localStorage.setItem('activeTab', tab);
  } catch {
    // Storage blocked (private mode, policy): tab state stays in memory.
  }
}

async function resolve(input: string): Promise<{ route: Route; redirected: boolean }> {
  const parsed = parseRoute(input);
  let route = parsed ?? homeRoute();
  let redirected = parsed === null || routeHref(parsed) !== input;
  // A guard may redirect a few times (e.g. /start → /heute); a cycle stops after four hops.
  for (let hop = 0; hop < 4 && guardFn; hop++) {
    let target: string | null = null;
    try {
      target = await guardFn(route);
    } catch {
      target = null;
    }
    if (!target) break;
    const next = parseRoute(target) ?? homeRoute();
    if (routeHref(next) === routeHref(route)) break;
    route = next;
    redirected = true;
  }
  return { route, redirected };
}

function emitRoute(route: Route, change: RouteChange): void {
  for (const cb of [...listeners]) {
    try {
      cb(route, change);
    } catch {
      // A failing subscriber must not stop the others.
    }
  }
}

function commit(route: Route, kind: NavigationKind): void {
  const previous = currentRoute;
  let next = route;
  if (route.overlay) {
    base ??= tabRoute(storedTab() ?? 'heute');
    next = { ...route, tab: base.tab };
  } else {
    base = route;
    if (route.tab) {
      lastPaths.set(route.tab, routeHref(route));
      storeTab(route.tab);
    }
  }
  currentRoute = next;
  emitRoute(next, { kind, previous });
}

async function go(input: string, kind: Exclude<NavigationKind, 'initial'>): Promise<void> {
  const token = ++seq;
  const { route, redirected } = await resolve(input);
  if (token !== seq) return;
  if (kind === 'push' || kind === 'replace') {
    await settle();
    if (token !== seq) return;
  }
  const href = routeHref(route);
  const state = readState();
  const same = currentRoute !== null && routeHref(currentRoute) === href;
  if (kind === 'push') {
    if (same) return;
    history.pushState(entry(state.idx + 1), '', href);
  } else if (kind === 'replace') {
    if (same && href === locationHref()) return;
    history.replaceState(entry(state.idx), '', href);
  } else if (redirected || href !== locationHref()) {
    // pop/refresh: the address bar already shows the entry; only a redirect or normalisation rewrites it.
    history.replaceState(entry(state.idx), '', href);
  } else if (!state.stamped) {
    history.replaceState({ ...(history.state as object | null), olIdx: state.idx }, '');
  }
  commit(route, kind);
}

const onPopState = (event: PopStateEvent): void => {
  const input = locationHref();
  const parsed = parseRoute(input);
  // Entries that only differ by sheet state (same path) belong to ol-sheet.
  if (currentRoute && parsed && routeHref(parsed) === routeHref(currentRoute) && readState(event.state).stamped) return;
  void go(input, 'pop');
};

export interface NavigateOptions { replace?: boolean }

export function navigate(path: string, opts: NavigateOptions = {}): void {
  void go(path, opts.replace ? 'replace' : 'push');
}

/** Parent of a route inside the app: overlay → its underlay, level 1 → tab root, settings → last tab. */
function parentHref(route: Route): string {
  if (route.overlay) return routeHref(base ?? homeRoute());
  switch (route.name) {
    case 'planung-inbox':
    case 'planung-project':
      return '/planung';
    case 'wissen-note':
      return '/wissen';
    case 'einstellungen':
    case 'start':
      return lastPathOf(base?.tab ?? storedTab() ?? 'heute');
    default:
      return routeHref(route);
  }
}

/** history.back() when there is in-app history, otherwise navigate to the current tab root (replace). */
export function back(): void {
  const state = readState();
  if (state.idx > 0 || state.sheet) {
    history.back();
    return;
  }
  const route = current();
  const target = parentHref(route);
  if (target !== routeHref(route)) navigate(target, { replace: true });
}

/** Subscribes to route changes (called with the new route); returns an unsubscribe function. */
export function onRoute(cb: (route: Route, change: RouteChange) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function current(): Route {
  return currentRoute ?? homeRoute();
}

/** For an overlay route: the tab route underneath; otherwise current(). */
export function baseRoute(): Route {
  const route = current();
  return route.overlay ? base ?? homeRoute() : route;
}

/**
 * Starts listening (popstate) and dispatches the initial route.
 * guard(route) may return a path to redirect to (replace), e.g. '/start' while onboardingDone is 0.
 */
export async function startRouter(guard: RouteGuard, opts: RouterOptions = {}): Promise<void> {
  guardFn = guard;
  if (opts.settle) settle = opts.settle;
  if (!listening) {
    listening = true;
    window.addEventListener('popstate', onPopState);
  }
  const token = ++seq;
  const { route } = await resolve(locationHref());
  if (token !== seq) return;
  const state = readState();
  const href = routeHref(route);
  if (route.overlay) {
    const underlay = tabRoute(storedTab() ?? 'heute');
    base = underlay;
    if (underlay.tab) lastPaths.set(underlay.tab, routeHref(underlay));
    if (state.idx === 0) {
      // Fresh direct entry: make the underlay the first entry so back closes the sheet in-app.
      history.replaceState(entry(0), '', routeHref(underlay));
      history.pushState(entry(1), '', href);
    } else {
      history.replaceState(entry(state.idx), '', href);
    }
  } else {
    // Stamps the depth (kept across reloads) and drops a stale sheet marker.
    history.replaceState(entry(state.idx), '', href);
  }
  commit(route, 'initial');
}

/** Re-dispatches the current route (e.g. after a day change or onboarding). */
export function refresh(): void {
  void go(routeHref(current()), 'refresh');
}

/** Last path visited inside a tab (tab state is kept across tab switches). */
export function lastPathOf(tab: Tab): string {
  return lastPaths.get(tab) ?? `/${tab}`;
}
