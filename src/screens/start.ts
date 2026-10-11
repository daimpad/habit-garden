// CONTRACT STUB – implemented in AP7. Onboarding /start (F §4.13): 3 steps, dot indicator, every step skippable.
import type { Route } from '../router.js';

/** Renders the screen into view; returns a cleanup function (unsubscribe, timers). */
export function mount(view: HTMLElement, route: Route): () => void {
  void route;
  view.textContent = '';
  return () => {};
}
