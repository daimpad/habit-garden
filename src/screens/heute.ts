// CONTRACT STUB – implemented in AP7. HEUTE (F §4.13, A.3 Screen 1).
import type { Route } from '../router.js';

export function mount(view: HTMLElement, route: Route): () => void {
  void route;
  view.textContent = '';
  return () => {};
}
