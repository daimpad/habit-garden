// CONTRACT STUB – implemented in AP7. Placeholder screen, TODO(phase-3).
import type { Route } from '../router.js';

export function mount(view: HTMLElement, route: Route): () => void {
  void route;
  view.textContent = '';
  return () => {};
}
