// Placeholder, filled in Phase 5.
import type { Route } from '../router.js';

export function mount(view: HTMLElement, route: Route): () => void {
  void route;
  view.replaceChildren();
  return () => undefined;
}
