// <ol-icon-button icon="settings" label="Einstellungen" badge="3" disabled></ol-icon-button>
// 48 px target, 24 px icon from the sprite (util/dom icon()), internal <button aria-label=label>.
// `label` is mandatory. Circular pressed state. Consumers listen to `click`.
//
// Details of this implementation:
// - The badge is drawn on the icon (aria-hidden); its value is added to the accessible name
//   (t.iconButtonBadgeAria). An empty or "0" badge is hidden.
// - No click reaches consumers while `disabled`. `focus()` focuses the internal button.
// - Re-connecting or moving the element reuses the rendered button.
import { fmt, t } from '../i18n/de.js';
import { h, icon, render } from '../util/dom.js';

export class OlIconButton extends HTMLElement {
  static observedAttributes = ['icon', 'label', 'badge', 'disabled'];

  private btn: HTMLButtonElement | null = null;
  private iconEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private renderedIcon: string | null = null;

  connectedCallback(): void {
    this.ensureSkeleton();
    this.addEventListener('click', this.onClickCapture, true);
    this.sync();
  }

  disconnectedCallback(): void {
    this.removeEventListener('click', this.onClickCapture, true);
  }

  attributeChangedCallback(): void {
    if (this.btn) this.sync();
  }

  override focus(options?: FocusOptions): void {
    if (this.btn) this.btn.focus(options);
    else super.focus(options);
  }

  private ensureSkeleton(): void {
    if (this.btn) return;
    let btn = this.querySelector<HTMLButtonElement>(':scope > button.ol-icon-button__btn');
    if (!btn) {
      render(
        this,
        h`<button class="ol-icon-button__btn" type="button"><span class="ol-icon-button__icon"></span><span class="ol-icon-button__badge" aria-hidden="true" hidden></span></button>`,
      );
      btn = this.querySelector<HTMLButtonElement>(':scope > button.ol-icon-button__btn');
    }
    this.btn = btn;
    this.iconEl = btn?.querySelector<HTMLElement>('.ol-icon-button__icon') ?? null;
    this.badgeEl = btn?.querySelector<HTMLElement>('.ol-icon-button__badge') ?? null;
    this.renderedIcon = this.iconEl?.dataset['icon'] ?? null;
  }

  private sync(): void {
    const btn = this.btn;
    if (!btn) return;
    btn.disabled = this.hasAttribute('disabled');

    const name = this.getAttribute('icon')?.trim() || null;
    if (this.iconEl && name !== this.renderedIcon) {
      if (name) {
        render(this.iconEl, icon(name, 24));
        this.iconEl.dataset['icon'] = name;
      } else {
        this.iconEl.textContent = '';
        delete this.iconEl.dataset['icon'];
      }
      this.renderedIcon = name;
    }

    const badge = this.getAttribute('badge')?.trim() ?? '';
    const showBadge = badge !== '' && badge !== '0';
    if (this.badgeEl) {
      if (this.badgeEl.textContent !== badge) this.badgeEl.textContent = badge;
      this.badgeEl.hidden = !showBadge;
    }

    const label = this.getAttribute('label') ?? '';
    const accessibleName = showBadge ? fmt(t.iconButtonBadgeAria, { label, n: badge }) : label;
    if (btn.getAttribute('aria-label') !== accessibleName) btn.setAttribute('aria-label', accessibleName);
  }

  private readonly onClickCapture = (event: MouseEvent): void => {
    if (this.hasAttribute('disabled')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
}

if (!customElements.get('ol-icon-button')) customElements.define('ol-icon-button', OlIconButton);
