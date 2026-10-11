// CONTRACT STUB – implemented in AP6.
// Exactly one <ol-toast> (main.ts appends it to body). Queue; one toast visible at a time.
// 48 px, surface with border, radius md, text 14, up to two actions (primary text buttons).
// Placed 16 px above the bottom nav and clear of the FAB. role="status", aria-live="polite".
// Duration 5000 ms; the timer pauses on hover, focus and touch. Entering/leaving animation;
// crossfade under reduced motion. Approved API extension: up to two actions (D.5 "Erledigt", "+1 h").

export interface ToastAction { label: string; onAction: () => void }
export interface ToastOptions { action?: ToastAction; actions?: ToastAction[]; duration?: number }

export class OlToast extends HTMLElement {
  connectedCallback(): void {}
  show(message: string, opts: ToastOptions = {}): void {
    void message; void opts;
  }
}

if (!customElements.get('ol-toast')) customElements.define('ol-toast', OlToast);

/** Shows a toast on the single instance (created on first use if missing). */
export function showToast(message: string, opts: ToastOptions = {}): void {
  let el = document.querySelector<OlToast>('ol-toast');
  if (!el) {
    el = document.createElement('ol-toast') as OlToast;
    document.body.append(el);
  }
  el.show(message, opts);
}
