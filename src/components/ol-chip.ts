// CONTRACT STUB – implemented in AP6.
// <ol-chip variant="filter|input|assist" selected kind="radio|checkbox" flower="bellis" icon="flag"
//          tint="#7FA36F" disabled label="Wichtig" value="important"></ol-chip>
// Height 32 (48 px touch target via padding/hit area), radius full, 14/500, optional 20 px flower or icon.
// filter: role radio (kind="radio") or checkbox (default), aria-checked; selected → --color-primary-soft,
// with tint → color-mix(in srgb, var(--tint) 8%, var(--color-surface)). Selection must not rely on colour
// alone (check icon or weight change). Click/Space/Enter toggle `selected` (radio: only select) and
// emit `ol-change` (detail: { selected: boolean; value: string }).
// input: × button emits `ol-remove` (detail: { value }). assist: plain action button, emits click.

export interface ChipChange { selected: boolean; value: string }

export class OlChip extends HTMLElement {
  static observedAttributes = ['variant', 'selected', 'kind', 'flower', 'icon', 'tint', 'disabled', 'label', 'value'];
  connectedCallback(): void {}
  attributeChangedCallback(): void {}
}

if (!customElements.get('ol-chip')) customElements.define('ol-chip', OlChip);
