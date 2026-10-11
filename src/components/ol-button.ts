// CONTRACT STUB – implemented in AP6.
// <ol-button variant="filled|tonal|ghost|danger" size="md|sm" icon="plus" type="button|submit"
//            disabled loading label="Speichern"></ol-button>
// Renders an internal <button class="ol-button__btn"> (48 px; sm 40 px) with optional icon and the label
// (attribute `label`, or the element's initial text content). Consumers listen to `click` on the host;
// no click is delivered while disabled or loading. hover/pressed overlay, pressed scale(.98),
// disabled opacity .38, loading replaces the label with a spinner at fixed width.

export class OlButton extends HTMLElement {
  static observedAttributes = ['variant', 'size', 'icon', 'disabled', 'loading', 'label', 'type'];
  connectedCallback(): void {}
  attributeChangedCallback(): void {}
  override focus(options?: FocusOptions): void {
    super.focus(options);
  }
}

if (!customElements.get('ol-button')) customElements.define('ol-button', OlButton);
