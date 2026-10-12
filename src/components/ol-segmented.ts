// <ol-segmented value="light" label="Thema">
//   <button data-value="light">Hell</button><button data-value="system">System</button>
// </ol-segmented>
// 2–4 options, height 40, sliding indicator (200 ms). The host gets role="radiogroup"
// and aria-label; child buttons become role="radio" with aria-checked and roving tabindex.
// Arrow keys move and select. Emits `ol-change` (detail: { value: string }); `value` reflects.
//
// Details of this implementation:
// - Options are equal-width columns; the indicator (surface with a 1 px border on a surface-2 track,
//   S29) is positioned through --ol-seg-i / --ol-seg-n, so no measuring is needed.
//   The selected label is primary at weight 600 (selection does not rely on colour alone).
// - Options added or removed later are picked up (MutationObserver on the child list).
// - Arrow keys (with wrap), Home and End move focus and select; options with `disabled` are skipped.
// - Each 40 px option extends its hit area to 48 px with a transparent ::before (S28).
// - preventDefault() on `ol-change` reverts the selection.
import { emit, h, render } from '../util/dom.js';

export interface SegmentedChange { value: string }

export class OlSegmented extends HTMLElement {
  static observedAttributes = ['value', 'label'];

  private indicator: HTMLElement | null = null;
  private observer: MutationObserver | null = null;

  connectedCallback(): void {
    this.setAttribute('role', 'radiogroup');
    this.ensureIndicator();
    this.addEventListener('click', this.onClick);
    this.addEventListener('keydown', this.onKeyDown);
    this.observer ??= new MutationObserver(() => this.sync());
    this.observer.observe(this, { childList: true });
    this.sync();
  }

  disconnectedCallback(): void {
    this.removeEventListener('click', this.onClick);
    this.removeEventListener('keydown', this.onKeyDown);
    this.observer?.disconnect();
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.sync();
  }

  get value(): string {
    return this.getAttribute('value') ?? '';
  }
  set value(v: string) {
    this.setAttribute('value', v);
  }

  /** The option buttons (direct children with data-value). */
  get options(): HTMLButtonElement[] {
    return [...this.children].filter(
      (el): el is HTMLButtonElement => el instanceof HTMLButtonElement && el.dataset['value'] !== undefined,
    );
  }

  private ensureIndicator(): void {
    if (this.indicator?.parentElement === this) return;
    this.indicator = this.querySelector<HTMLElement>(':scope > .ol-segmented__indicator');
    if (this.indicator) return;
    const holder = document.createElement('span');
    render(holder, h`<span class="ol-segmented__indicator" aria-hidden="true"></span>`);
    const el = holder.firstElementChild;
    if (el instanceof HTMLElement) {
      this.prepend(el);
      this.indicator = el;
    }
  }

  private sync(): void {
    this.ensureIndicator();
    const label = this.getAttribute('label');
    if (label !== null && this.getAttribute('aria-label') !== label) this.setAttribute('aria-label', label);

    const options = this.options;
    const value = this.value;
    const selectedIndex = options.findIndex((o) => o.dataset['value'] === value);
    const enabled = options.filter((o) => !o.disabled);
    const tabbable = selectedIndex >= 0 && !options[selectedIndex]?.disabled ? options[selectedIndex] : enabled[0];

    options.forEach((option, index) => {
      if (!option.classList.contains('ol-segmented__option')) option.classList.add('ol-segmented__option');
      if (option.type !== 'button') option.type = 'button';
      if (option.getAttribute('role') !== 'radio') option.setAttribute('role', 'radio');
      const checked = index === selectedIndex ? 'true' : 'false';
      if (option.getAttribute('aria-checked') !== checked) option.setAttribute('aria-checked', checked);
      const tabindex = option === tabbable ? '0' : '-1';
      if (option.getAttribute('tabindex') !== tabindex) option.setAttribute('tabindex', tabindex);
    });

    const n = String(Math.max(1, options.length));
    if (this.style.getPropertyValue('--ol-seg-n') !== n) this.style.setProperty('--ol-seg-n', n);
    if (selectedIndex >= 0) {
      const i = String(selectedIndex);
      if (this.style.getPropertyValue('--ol-seg-i') !== i) this.style.setProperty('--ol-seg-i', i);
    }
    this.toggleAttribute('data-selected', selectedIndex >= 0);
  }

  private select(option: HTMLButtonElement, focus: boolean): void {
    const next = option.dataset['value'];
    if (next === undefined || option.disabled) return;
    if (focus) option.focus();
    const previous = this.getAttribute('value');
    if (next === previous) return;
    this.value = next;
    if (!emit<SegmentedChange>(this, 'ol-change', { value: next })) {
      if (previous === null) this.removeAttribute('value');
      else this.value = previous;
    }
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (!(target instanceof HTMLButtonElement) || target.parentElement !== this) return;
    if (target.dataset['value'] === undefined) return;
    this.select(target, false);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const options = this.options.filter((o) => !o.disabled);
    const current = event.target instanceof HTMLButtonElement ? options.indexOf(event.target) : -1;
    if (current < 0 || options.length === 0) return;
    let next: HTMLButtonElement | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = options[(current + 1) % options.length];
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = options[(current - 1 + options.length) % options.length];
    else if (event.key === 'Home') next = options[0];
    else if (event.key === 'End') next = options[options.length - 1];
    else if (event.key === ' ' || event.key === 'Enter') next = options[current];
    else return;
    event.preventDefault();
    if (next) this.select(next, true);
  };
}

if (!customElements.get('ol-segmented')) customElements.define('ol-segmented', OlSegmented);
