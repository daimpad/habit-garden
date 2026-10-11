// CONTRACT STUB – implemented in AP6.
// <ol-flower flower="bellis" size="24" label="Gesundheit & Fitness"></ol-flower>
// Renders flora.flower(); aria-hidden="true" without label, else role="img" + aria-label.

export class OlFlower extends HTMLElement {
  static observedAttributes = ['flower', 'size', 'label'];
  connectedCallback(): void {}
  attributeChangedCallback(): void {}
}

if (!customElements.get('ol-flower')) customElements.define('ol-flower', OlFlower);
