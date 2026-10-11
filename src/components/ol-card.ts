// CONTRACT STUB – implemented in AP6.
// <ol-card tint="#7FA36F" interactive elevated>…content…</ol-card>
// Surface, radius md, padding 16, 1 px border. `tint` sets --tint (style.setProperty) and a 4 px left bar.
// `interactive` → role="button", tabindex="0", overlay states, Enter/Space dispatch a click.
// Content stays as light-DOM children (no re-rendering of children).

export class OlCard extends HTMLElement {
  static observedAttributes = ['tint', 'interactive', 'elevated'];
  connectedCallback(): void {}
  attributeChangedCallback(): void {}
}

if (!customElements.get('ol-card')) customElements.define('ol-card', OlCard);
