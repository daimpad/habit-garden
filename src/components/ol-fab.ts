// CONTRACT STUB – implemented in AP6.
// <ol-fab side="right|left" label="Neu anlegen" hidden></ol-fab>
// 56 px, filled, icon plus, position fixed 16 px right (or left) and 16 px above the bottom nav
// (from 900 px: bottom right of the content area), shadow var(--shadow-raised), pressed scale(.94).
// Internal <button aria-label=label (default t.actionCreate)>. Consumers listen to `click`.
// main.ts owns the single instance and decides what it opens (G1).

export class OlFab extends HTMLElement {
  static observedAttributes = ['side', 'label'];
  connectedCallback(): void {}
  attributeChangedCallback(): void {}
}

if (!customElements.get('ol-fab')) customElements.define('ol-fab', OlFab);
