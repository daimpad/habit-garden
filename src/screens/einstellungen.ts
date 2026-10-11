// CONTRACT STUB – implemented in AP7. /einstellungen/:section? (full-screen overlay, F §4.13).
import type { Route } from '../router.js';

export function mount(view: HTMLElement, route: Route): () => void {
  void route;
  view.textContent = '';
  return () => {};
}
