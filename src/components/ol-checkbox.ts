// CONTRACT STUB – implemented in AP6.
// <ol-checkbox checked indeterminate disabled label="Als erledigt markieren"></ol-checkbox>
// 24 px box, radius 6, 48 px target; role="checkbox" on the host, tabindex 0, aria-checked
// (mixed for indeterminate), aria-label from `label`. Space/Enter/click toggle `checked` and emit
// `ol-change` (detail: { checked: boolean }). The tick path is drawn with stroke-dashoffset in 180 ms,
// box scale 1 → 1.12 → 1 (B.4); no animation under reduced motion.

export interface CheckboxChange { checked: boolean }

export class OlCheckbox extends HTMLElement {
  static observedAttributes = ['checked', 'indeterminate', 'disabled', 'label'];
  connectedCallback(): void {}
  attributeChangedCallback(): void {}
  get checked(): boolean {
    return this.hasAttribute('checked');
  }
  set checked(value: boolean) {
    this.toggleAttribute('checked', value);
  }
}

if (!customElements.get('ol-checkbox')) customElements.define('ol-checkbox', OlCheckbox);
