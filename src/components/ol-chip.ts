// <ol-chip variant="filter|input|assist" selected kind="radio|checkbox" flower="bellis" icon="flag"
//          tint="#7FA36F" disabled label="Wichtig" value="important"></ol-chip>
// Height 32 (48 px touch target via padding/hit area), radius full, 14/500, optional 20 px flower or icon.
// filter: role radio (kind="radio") or checkbox (default), aria-checked; selected → --color-primary-soft,
// with tint → color-mix(in srgb, var(--tint) 8%, var(--color-surface)). Selection must not rely on colour
// alone (check icon or weight change). Click/Space/Enter toggle `selected` (radio: only select) and
// emit `ol-change` (detail: { selected: boolean; value: string }).
// input: × button emits `ol-remove` (detail: { value }). assist: plain action button, emits click.
//
// Details of this implementation:
// - Default variant is `filter`. The label comes from `label` or the initial text content.
// - Selected filter chips show a check icon (it replaces a flower/icon while selected), a 1 px primary
//   border and weight 600 (S29).
// - Radio chips that share a parent element form a group: selecting one deselects its siblings,
//   roving tabindex (selected or first enabled chip is tabbable), arrow keys move and select,
//   Home/End jump. The owner should wrap the group in an element with role="radiogroup" + aria-label.
// - Plays HAPTIC.tick when the user selects a filter chip. preventDefault() on `ol-change` reverts.
// - assist: role="button"; Enter/Space dispatch a click. input: the host has no role, the × is a
//   <button aria-label="{label} entfernen">; Delete/Backspace on it also emit `ol-remove`.
// - `disabled`: aria-disabled, opacity .38, no events, not tabbable.
// - The 32 px chip extends its hit area to 48 px with a transparent ::before (S28); rows of chips
//   need a 16 px row gap (8 px above + 8 px below each chip) so neighbouring hit areas do not overlap.
import { fmt, t } from '../i18n/de.js';
import { emit, h, HAPTIC, icon, render, vibrate } from '../util/dom.js';
import './ol-flower.js';

export interface ChipChange { selected: boolean; value: string }
export interface ChipRemove { value: string }

type Variant = 'filter' | 'input' | 'assist';

export class OlChip extends HTMLElement {
  static observedAttributes = ['variant', 'selected', 'kind', 'flower', 'icon', 'tint', 'disabled', 'label', 'value'];

  private leadEl: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private removeEl: HTMLButtonElement | null = null;
  private renderedLead = '';
  private syncing = false;

  connectedCallback(): void {
    this.ensureSkeleton();
    this.addEventListener('click', this.onClickCapture, true);
    this.addEventListener('click', this.onClick);
    this.addEventListener('keydown', this.onKeyDown);
    this.sync();
  }

  disconnectedCallback(): void {
    this.removeEventListener('click', this.onClickCapture, true);
    this.removeEventListener('click', this.onClick);
    this.removeEventListener('keydown', this.onKeyDown);
  }

  attributeChangedCallback(): void {
    if (this.labelEl) this.sync();
  }

  get variant(): Variant {
    const value = this.getAttribute('variant');
    return value === 'input' || value === 'assist' ? value : 'filter';
  }

  get selected(): boolean {
    return this.hasAttribute('selected');
  }
  set selected(value: boolean) {
    this.toggleAttribute('selected', value);
  }

  get value(): string {
    return this.getAttribute('value') ?? '';
  }

  /** True for a filter chip with kind="radio". */
  get isRadio(): boolean {
    return this.variant === 'filter' && this.getAttribute('kind') === 'radio';
  }

  private ensureSkeleton(): void {
    if (this.labelEl) return;
    let labelEl = this.querySelector<HTMLElement>(':scope > .ol-chip__label');
    if (!labelEl) {
      const text = (this.textContent ?? '').replace(/\s+/gu, ' ').trim();
      if (text && !this.hasAttribute('label')) this.setAttribute('label', text);
      render(
        this,
        h`<span class="ol-chip__lead" aria-hidden="true" hidden></span><span class="ol-chip__label"></span><button class="ol-chip__remove" type="button" hidden>${icon('x', 20)}</button>`,
      );
      labelEl = this.querySelector<HTMLElement>(':scope > .ol-chip__label');
    }
    this.labelEl = labelEl;
    this.leadEl = this.querySelector<HTMLElement>(':scope > .ol-chip__lead');
    this.removeEl = this.querySelector<HTMLButtonElement>(':scope > .ol-chip__remove');
    this.renderedLead = this.leadEl?.dataset['lead'] ?? '';
    this.removeEl?.addEventListener('click', this.onRemoveClick);
    this.removeEl?.addEventListener('keydown', this.onRemoveKeyDown);
  }

  private sync(): void {
    if (this.syncing) return;
    this.syncing = true;
    try {
      this.syncContent();
      this.syncA11y();
      if (this.isRadio) this.syncRadioGroup();
    } finally {
      this.syncing = false;
    }
  }

  private syncContent(): void {
    const variant = this.variant;
    const label = this.getAttribute('label') ?? '';
    if (this.labelEl && this.labelEl.textContent !== label) this.labelEl.textContent = label;

    const tint = this.getAttribute('tint')?.trim();
    if (tint) {
      if (this.style.getPropertyValue('--tint') !== tint) this.style.setProperty('--tint', tint);
    } else if (this.style.getPropertyValue('--tint')) {
      this.style.removeProperty('--tint');
    }

    const flowerId = this.getAttribute('flower')?.trim();
    const iconName = this.getAttribute('icon')?.trim();
    const lead = variant === 'filter' && this.selected
      ? 'check'
      : flowerId ? `flower:${flowerId}` : iconName ? `icon:${iconName}` : '';
    if (this.leadEl && lead !== this.renderedLead) {
      if (lead === 'check') render(this.leadEl, icon('check', 20));
      else if (flowerId && lead.startsWith('flower:')) render(this.leadEl, h`<ol-flower flower="${flowerId}" size="20"></ol-flower>`);
      else if (iconName && lead.startsWith('icon:')) render(this.leadEl, icon(iconName, 20));
      else this.leadEl.textContent = '';
      this.leadEl.dataset['lead'] = lead;
      this.leadEl.hidden = lead === '';
      this.renderedLead = lead;
    }
    this.toggleAttribute('data-lead', lead !== '');

    if (this.removeEl) {
      this.removeEl.hidden = variant !== 'input';
      this.removeEl.disabled = this.hasAttribute('disabled');
      const aria = fmt(t.chipRemoveAria, { label });
      if (this.removeEl.getAttribute('aria-label') !== aria) this.removeEl.setAttribute('aria-label', aria);
    }
  }

  private syncA11y(): void {
    const variant = this.variant;
    const disabled = this.hasAttribute('disabled');
    if (disabled) this.setAttribute('aria-disabled', 'true');
    else this.removeAttribute('aria-disabled');

    if (variant === 'input') {
      this.removeAttribute('role');
      this.removeAttribute('aria-checked');
      this.removeAttribute('tabindex');
      return;
    }
    const role = variant === 'assist' ? 'button' : this.isRadio ? 'radio' : 'checkbox';
    if (this.getAttribute('role') !== role) this.setAttribute('role', role);
    if (variant === 'filter') {
      const checked = this.selected ? 'true' : 'false';
      if (this.getAttribute('aria-checked') !== checked) this.setAttribute('aria-checked', checked);
    } else {
      this.removeAttribute('aria-checked');
    }
    if (!this.isRadio) this.setTabIndex(disabled ? -1 : 0);
  }

  /** Radio chips in the same parent element. */
  private radioGroup(): OlChip[] {
    const parent = this.parentElement;
    if (!parent) return [this];
    return [...parent.children].filter((el): el is OlChip => el instanceof OlChip && el.isRadio);
  }

  private syncRadioGroup(): void {
    const group = this.radioGroup();
    const enabled = group.filter((chip) => !chip.hasAttribute('disabled'));
    const current = enabled.find((chip) => chip.selected) ?? enabled[0];
    for (const chip of group) chip.setTabIndex(chip === current ? 0 : -1);
  }

  private setTabIndex(value: number): void {
    const next = String(value);
    if (this.getAttribute('tabindex') !== next) this.setAttribute('tabindex', next);
  }

  /** User selection of a filter chip (radio chips only select). */
  private activate(): void {
    if (this.variant !== 'filter' || this.hasAttribute('disabled')) return;
    const radio = this.isRadio;
    if (radio && this.selected) return;
    const selected = !this.selected;
    const deselected = radio ? this.radioGroup().filter((chip) => chip !== this && chip.selected) : [];
    for (const chip of deselected) chip.selected = false;
    this.selected = selected;
    if (selected) vibrate(HAPTIC.tick);
    if (!emit<ChipChange>(this, 'ol-change', { selected, value: this.value })) {
      this.selected = !selected;
      for (const chip of deselected) chip.selected = true;
    }
  }

  private readonly onClickCapture = (event: MouseEvent): void => {
    if (this.hasAttribute('disabled')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  private readonly onClick = (event: MouseEvent): void => {
    if (this.removeEl && event.target instanceof Node && this.removeEl.contains(event.target)) return;
    if (this.variant === 'filter') this.activate();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.target !== this || event.altKey || event.ctrlKey || event.metaKey) return;
    const variant = this.variant;
    if (variant === 'input' || this.hasAttribute('disabled')) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (event.repeat) return;
      if (variant === 'assist') this.click();
      else this.activate();
      return;
    }
    if (!this.isRadio) return;
    const group = this.radioGroup().filter((chip) => !chip.hasAttribute('disabled'));
    const index = group.indexOf(this);
    if (index < 0 || group.length === 0) return;
    let next: OlChip | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = group[(index + 1) % group.length];
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = group[(index - 1 + group.length) % group.length];
    else if (event.key === 'Home') next = group[0];
    else if (event.key === 'End') next = group[group.length - 1];
    else return;
    event.preventDefault();
    if (!next || next === this) return;
    next.focus();
    next.activate();
  };

  private readonly onRemoveClick = (event: MouseEvent): void => {
    event.stopPropagation();
    if (this.hasAttribute('disabled') || this.variant !== 'input') return;
    emit<ChipRemove>(this, 'ol-remove', { value: this.value });
  };

  private readonly onRemoveKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    event.preventDefault();
    if (this.hasAttribute('disabled') || this.variant !== 'input') return;
    emit<ChipRemove>(this, 'ol-remove', { value: this.value });
  };
}

if (!customElements.get('ol-chip')) customElements.define('ol-chip', OlChip);
