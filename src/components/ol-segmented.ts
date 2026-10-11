// CONTRACT STUB – implemented in AP6.
// <ol-segmented value="light" label="Thema">
//   <button data-value="light">Hell</button><button data-value="system">System</button>
// </ol-segmented>
// 2–4 options, height 40, sliding indicator (surface-2, 200 ms). The host gets role="radiogroup"
// and aria-label; child buttons become role="radio" with aria-checked and roving tabindex.
// Arrow keys move and select. Emits `ol-change` (detail: { value: string }); `value` reflects.

export interface SegmentedChange { value: string }

export class OlSegmented extends HTMLElement {
  static observedAttributes = ['value', 'label'];
  connectedCallback(): void {}
  attributeChangedCallback(): void {}
  get value(): string {
    return this.getAttribute('value') ?? '';
  }
  set value(v: string) {
    this.setAttribute('value', v);
  }
}

if (!customElements.get('ol-segmented')) customElements.define('ol-segmented', OlSegmented);
