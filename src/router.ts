// CONTRACT STUB – implemented in AP7 (shell).
// History-API router (F §4.8). Routes: /start, /heute, /planung, /planung/inbox, /planung/p/:projectId,
// /wissen, /wissen/n/:noteId, /einstellungen/:section?, overlay routes /aufgabe/:taskId and
// /gewohnheit/:habitId (a sheet over the last active tab). Unknown paths → /heute (replace).
// Query strings are kept (A.1: /wissen?tag=a/b,c&op=and). Popstate entries that only carry sheet
// state ({ olSheet }) with an unchanged path are ignored by the router (ol-sheet handles them).

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
  /** Tab the route belongs to (null for /start and /einstellungen; overlays: the underlying tab). */
  tab: Tab | null;
}

/** Pure: path (+ optional query) → Route; unknown paths yield null. */
export function parseRoute(pathWithQuery: string): Route | null {
  throw new Error(`not implemented: parseRoute ${pathWithQuery}`);
}

export interface NavigateOptions { replace?: boolean }

export function navigate(path: string, opts: NavigateOptions = {}): void {
  throw new Error(`not implemented: navigate ${path} ${String(opts.replace)}`);
}

/** history.back() when there is in-app history, otherwise navigate to the current tab root (replace). */
export function back(): void {
  throw new Error('not implemented: back');
}

/** Subscribes to route changes (called with the new route); returns an unsubscribe function. */
export function onRoute(cb: (route: Route) => void): () => void {
  throw new Error(`not implemented: onRoute ${typeof cb}`);
}

export function current(): Route {
  throw new Error('not implemented: current');
}

/** For an overlay route: the tab route underneath; otherwise current(). */
export function baseRoute(): Route {
  throw new Error('not implemented: baseRoute');
}

/**
 * Starts listening (popstate) and dispatches the initial route.
 * guard(route) may return a path to redirect to (replace), e.g. '/start' while onboardingDone is 0.
 */
export function startRouter(guard: (route: Route) => string | null | Promise<string | null>): Promise<void> {
  throw new Error(`not implemented: startRouter ${typeof guard}`);
}

/** Re-dispatches the current route (e.g. after a day change or onboarding). */
export function refresh(): void {
  throw new Error('not implemented: refresh');
}

/** Last path visited inside a tab (tab state is kept across tab switches). */
export function lastPathOf(tab: Tab): string {
  throw new Error(`not implemented: lastPathOf ${tab}`);
}
