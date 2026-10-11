// CONTRACT STUB – implemented in AP6.
// <ol-input label="Titel" value="" type="text|date|time|number|search" name="title" placeholder=""
//           error="…" helper="…" inputmode="…" required multiline rows-max="6" autofocus
//           min="" max="" step=""></ol-input>
// Label 13/500 above (<label for>), field 48 px (min 16 px font), surface, 1 px border, focus border
// primary; error → aria-invalid + aria-describedby + danger text; helper text 12 px.
// `multiline` renders an auto-growing <textarea> (up to rows-max lines).
// The inner control's native `input` event bubbles; `change` is re-emitted as
// `ol-change` (detail: { value: string }).

export interface InputChange { value: string }

export class OlInput extends HTMLElement {
  static observedAttributes = ['label', 'value', 'type', 'name', 'placeholder', 'error', 'helper', 'inputmode', 'required', 'multiline', 'rows-max', 'disabled', 'min', 'max', 'step'];
  connectedCallback(): void {}
  attributeChangedCallback(): void {}
  get value(): string {
    return this.getAttribute('value') ?? '';
  }
  set value(v: string) {
    this.setAttribute('value', v);
  }
  /** Focuses the inner control. */
  focusInput(): void {}
}

if (!customElements.get('ol-input')) customElements.define('ol-input', OlInput);
