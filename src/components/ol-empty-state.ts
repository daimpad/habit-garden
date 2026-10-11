// CONTRACT STUB – implemented in AP6.
// <ol-empty-state icon="sprout" message="Noch keine Routine" action="Routine anlegen"></ol-empty-state>
// Icon 32 px text-3, message 14 text-2, optional tonal ol-button (`action` label) that emits
// `ol-action`. Vertically centred.

export class OlEmptyState extends HTMLElement {
  static observedAttributes = ['icon', 'message', 'action'];
  connectedCallback(): void {}
  attributeChangedCallback(): void {}
}

if (!customElements.get('ol-empty-state')) customElements.define('ol-empty-state', OlEmptyState);
