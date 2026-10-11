// CONTRACT STUB – implemented in AP6.
// <ol-icon-button icon="settings" label="Einstellungen" badge="3" disabled></ol-icon-button>
// 48 px target, 24 px icon from the sprite (util/dom icon()), internal <button aria-label=label>.
// `label` is mandatory. Circular pressed state. Consumers listen to `click`.

export class OlIconButton extends HTMLElement {
  static observedAttributes = ['icon', 'label', 'badge', 'disabled'];
  connectedCallback(): void {}
  attributeChangedCallback(): void {}
}

if (!customElements.get('ol-icon-button')) customElements.define('ol-icon-button', OlIconButton);
