// <ol-checkbox checked indeterminate disabled label="Als erledigt markieren"></ol-checkbox>
// 24 px box, radius 6, 48 px target; role="checkbox" on the host, tabindex 0, aria-checked
// (mixed for indeterminate), aria-label from `label`. Space/Enter/click toggle `checked` and emit
// `ol-change` (detail: { checked: boolean }). The tick path is drawn with stroke-dashoffset in 180 ms,
// box scale 1 → 1.12 → 1 (B.4); no animation under reduced motion.
//
// Details of this implementation:
// - Unchecked: 1.5 px text-2 border on surface (S29); checked: primary fill with an on-primary tick;
//   indeterminate: primary fill with a dash. Activating an indeterminate box checks it.
// - The scale pulse plays only on a user check (not when attributes are set by a re-render).
// - Plays HAPTIC.tick when the user checks it; owners do not need to vibrate.
// - preventDefault() on `ol-change` reverts the toggle.
// - `disabled`: aria-disabled, opacity .38, no toggling, removed from the tab order.
import { emit, h, HAPTIC, motionReduced, render, vibrate } from '../util/dom.js';

export interface CheckboxChange { checked: boolean }

export class OlCheckbox extends HTMLElement {
  static observedAttributes = ['checked', 'indeterminate', 'disabled', 'label'];

  private svg: SVGSVGElement | null = null;

  connectedCallback(): void {
    if (!this.hasAttribute('role')) this.setAttribute('role', 'checkbox');
    this.ensureSkeleton();
    this.addEventListener('click', this.onClick);
    this.addEventListener('keydown', this.onKeyDown);
    this.sync();
  }

  disconnectedCallback(): void {
    this.removeEventListener('click', this.onClick);
    this.removeEventListener('keydown', this.onKeyDown);
  }

  attributeChangedCallback(): void {
    if (this.svg) this.sync();
  }

  get checked(): boolean {
    return this.hasAttribute('checked');
  }
  set checked(value: boolean) {
    this.toggleAttribute('checked', value);
  }

  get indeterminate(): boolean {
    return this.hasAttribute('indeterminate');
  }
  set indeterminate(value: boolean) {
    this.toggleAttribute('indeterminate', value);
  }

  private ensureSkeleton(): void {
    if (this.svg) return;
    this.svg = this.querySelector<SVGSVGElement>(':scope > svg.ol-checkbox__svg');
    if (this.svg) return;
    render(
      this,
      h`<svg class="ol-checkbox__svg" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
        <rect class="ol-checkbox__box" x="0.75" y="0.75" width="22.5" height="22.5" rx="5.25"></rect>
        <path class="ol-checkbox__tick" d="M6.5 12.5l3.75 3.75 7.25-8" pathLength="1"></path>
        <path class="ol-checkbox__dash" d="M7 12h10"></path>
      </svg>`,
    );
    this.svg = this.querySelector<SVGSVGElement>(':scope > svg.ol-checkbox__svg');
  }

  private sync(): void {
    const state = this.hasAttribute('indeterminate') ? 'mixed' : this.checked ? 'true' : 'false';
    if (this.getAttribute('aria-checked') !== state) this.setAttribute('aria-checked', state);
    const label = this.getAttribute('label');
    if (label !== null && this.getAttribute('aria-label') !== label) this.setAttribute('aria-label', label);
    const disabled = this.hasAttribute('disabled');
    if (disabled) this.setAttribute('aria-disabled', 'true');
    else this.removeAttribute('aria-disabled');
    const tabindex = disabled ? '-1' : '0';
    if (this.getAttribute('tabindex') !== tabindex) this.setAttribute('tabindex', tabindex);
  }

  private toggle(): void {
    if (this.hasAttribute('disabled')) return;
    const wasIndeterminate = this.hasAttribute('indeterminate');
    const wasChecked = this.checked;
    const checked = wasIndeterminate ? true : !wasChecked;
    this.removeAttribute('indeterminate');
    this.checked = checked;
    if (checked) {
      vibrate(HAPTIC.tick);
      this.pulse();
    }
    if (!emit<CheckboxChange>(this, 'ol-change', { checked })) {
      this.checked = wasChecked;
      this.toggleAttribute('indeterminate', wasIndeterminate);
    }
  }

  private pulse(): void {
    if (!this.svg || motionReduced() || typeof this.svg.animate !== 'function') return;
    this.svg.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
      { duration: 200, easing: 'cubic-bezier(.2,0,0,1)' },
    );
  }

  private readonly onClick = (): void => {
    this.toggle();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    if (!event.repeat) this.toggle();
  };
}

if (!customElements.get('ol-checkbox')) customElements.define('ol-checkbox', OlCheckbox);
