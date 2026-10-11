// CONTRACT STUB – implemented in AP6.
// <ol-app-bar heading="Planung" display back>
//   <ol-icon-button slot="actions" icon="settings" label="Einstellungen"></ol-icon-button>
// </ol-app-bar>
// <header> 56 px (not sticky): optional back icon button (arrow-left, aria-label t.actionBack) that emits
// `ol-back`; title as <h1> (class ol-title, or ol-display with `display`); up to two children with
// slot="actions" are moved into the right-hand action area on first connect.

export class OlAppBar extends HTMLElement {
  static observedAttributes = ['heading', 'back', 'display'];
  connectedCallback(): void {}
  attributeChangedCallback(): void {}
}

if (!customElements.get('ol-app-bar')) customElements.define('ol-app-bar', OlAppBar);
