// <ol-flower flower="bellis" size="24" label="Gesundheit & Fitness"></ol-flower>
// Renders flora.flower(); aria-hidden="true" without label, else role="img" + aria-label.
import { raw, render } from '../util/dom.js';
import { flower, isFlowerId } from './flora.js';

export class OlFlower extends HTMLElement {
  static observedAttributes = ['flower', 'size', 'label'];

  #rendered = '';

  connectedCallback(): void {
    this.#render();
    this.#syncA11y();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue || !this.isConnected) return;
    if (name === 'label') this.#syncA11y();
    else this.#render();
  }

  #render(): void {
    const attr = this.getAttribute('flower');
    const id = isFlowerId(attr) ? attr : 'generic';
    const size = Number(this.getAttribute('size'));
    const markup = flower(id, Number.isFinite(size) && size > 0 ? size : 24);
    if (markup === this.#rendered && this.firstElementChild) return;
    render(this, raw(markup));
    this.#rendered = markup;
  }

  #syncA11y(): void {
    const label = this.getAttribute('label')?.trim();
    if (label) {
      this.removeAttribute('aria-hidden');
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', label);
    } else {
      this.removeAttribute('role');
      this.removeAttribute('aria-label');
      this.setAttribute('aria-hidden', 'true');
    }
  }
}

if (!customElements.get('ol-flower')) customElements.define('ol-flower', OlFlower);
