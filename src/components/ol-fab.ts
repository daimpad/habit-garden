// <ol-fab side="right|left" label="Neu anlegen" hidden></ol-fab>
// 56 px, filled, icon plus, position fixed 16 px right (or left) and 16 px above the bottom nav
// (from 900 px: 24 px from the bottom right of the viewport, S26), shadow var(--shadow-raised),
// pressed scale(.94). Internal <button aria-label=label (default t.actionCreate)>. Consumers listen to
// `click`. main.ts owns the single instance and decides what it opens (G1).
//
// Details of this implementation:
// - `hidden` fades the FAB out (120 ms, B.4 "FAB fadet aus") and removes it from hit testing.
// - `focus()` focuses the internal button. Re-connecting reuses the rendered button.
import { t } from '../i18n/de.js';
import { h, icon, render } from '../util/dom.js';

export class OlFab extends HTMLElement {
  static observedAttributes = ['side', 'label'];

  private btn: HTMLButtonElement | null = null;

  connectedCallback(): void {
    if (!this.btn) {
      this.btn = this.querySelector<HTMLButtonElement>(':scope > button.ol-fab__btn');
      if (!this.btn) {
        render(this, h`<button class="ol-fab__btn" type="button">${icon('plus', 24)}</button>`);
        this.btn = this.querySelector<HTMLButtonElement>(':scope > button.ol-fab__btn');
      }
    }
    this.sync();
  }

  attributeChangedCallback(): void {
    if (this.btn) this.sync();
  }

  override focus(options?: FocusOptions): void {
    if (this.btn) this.btn.focus(options);
    else super.focus(options);
  }

  private sync(): void {
    if (!this.btn) return;
    const label = this.getAttribute('label')?.trim() || t.actionCreate;
    if (this.btn.getAttribute('aria-label') !== label) this.btn.setAttribute('aria-label', label);
  }
}

if (!customElements.get('ol-fab')) customElements.define('ol-fab', OlFab);
