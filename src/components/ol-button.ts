// <ol-button variant="filled|tonal|ghost|danger" size="md|sm" icon="plus" type="button|submit"
//            disabled loading label="Speichern"></ol-button>
// Renders an internal <button class="ol-button__btn"> (48 px; sm 40 px) with optional icon and the label
// (attribute `label`, or the element's initial text content). Consumers listen to `click` on the host;
// no click is delivered while disabled or loading. hover/pressed overlay, pressed scale(.98),
// disabled opacity .38.
//
// Details of this implementation:
// - Default variant is `filled`, default size `md`. sm keeps 40 px visually; a transparent ::before
//   extends the hit area to 48 px.
// - The initial text content is copied into the `label` attribute on first connect; the attribute is
//   the source of truth afterwards. Re-connecting or moving the element reuses the rendered button.
// - `loading` (S36, B.0: no loading animations for local operations): static label swap to
//   t.buttonBusy (or the non-empty `loading` attribute value), aria-busy, aria-disabled; the button
//   keeps focus and its current width as a minimum. No spinner.
// - `focus()` focuses the internal button.
import { t } from '../i18n/de.js';
import { h, icon, render, setVar } from '../util/dom.js';

export class OlButton extends HTMLElement {
  static observedAttributes = ['variant', 'size', 'icon', 'disabled', 'loading', 'label', 'type'];

  private btn: HTMLButtonElement | null = null;
  private iconEl: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private renderedIcon: string | null = null;
  private wasLoading = false;

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

  /** The internal native button (null before the first connect). */
  get button(): HTMLButtonElement | null {
    return this.btn;
  }

  private ensureSkeleton(): void {
    if (this.btn) return;
    let btn = this.querySelector<HTMLButtonElement>(':scope > button.ol-button__btn');
    if (!btn) {
      const text = (this.textContent ?? '').replace(/\s+/gu, ' ').trim();
      if (text && !this.hasAttribute('label')) this.setAttribute('label', text);
      render(
        this,
        h`<button class="ol-button__btn" type="button"><span class="ol-button__icon" hidden></span><span class="ol-button__label"></span></button>`,
      );
      btn = this.querySelector<HTMLButtonElement>(':scope > button.ol-button__btn');
    }
    this.btn = btn;
    this.iconEl = btn?.querySelector<HTMLElement>('.ol-button__icon') ?? null;
    this.labelEl = btn?.querySelector<HTMLElement>('.ol-button__label') ?? null;
    this.renderedIcon = this.iconEl?.firstElementChild ? (this.iconEl.dataset['icon'] ?? null) : null;
  }

  private sync(): void {
    const btn = this.btn;
    if (!btn) return;
    const type = this.getAttribute('type');
    const nextType = type === 'submit' || type === 'reset' ? type : 'button';
    if (btn.type !== nextType) btn.type = nextType;

    const disabled = this.hasAttribute('disabled');
    const loading = this.hasAttribute('loading');
    btn.disabled = disabled;
    if (loading && !disabled) btn.setAttribute('aria-disabled', 'true');
    else btn.removeAttribute('aria-disabled');
    if (loading) btn.setAttribute('aria-busy', 'true');
    else btn.removeAttribute('aria-busy');

    // Keep the width while the label is swapped so the layout does not jump.
    if (loading && !this.wasLoading && btn.offsetWidth > 0) setVar(this, '--ol-button-min-w', `${btn.offsetWidth}px`);
    if (!loading && this.wasLoading) this.style.removeProperty('--ol-button-min-w');
    this.wasLoading = loading;

    const label = this.getAttribute('label') ?? '';
    const busy = this.getAttribute('loading')?.trim() || t.buttonBusy;
    const text = loading ? busy : label;
    if (this.labelEl) {
      if (this.labelEl.textContent !== text) this.labelEl.textContent = text;
      this.labelEl.hidden = text === '';
    }

    const name = loading ? null : this.getAttribute('icon')?.trim() || null;
    if (this.iconEl && name !== this.renderedIcon) {
      if (name) {
        render(this.iconEl, icon(name, 20));
        this.iconEl.dataset['icon'] = name;
      } else {
        this.iconEl.textContent = '';
        delete this.iconEl.dataset['icon'];
      }
      this.iconEl.hidden = !name;
      this.renderedIcon = name;
    }
  }

  private readonly onClickCapture = (event: MouseEvent): void => {
    if (this.hasAttribute('disabled') || this.hasAttribute('loading')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
}

if (!customElements.get('ol-button')) customElements.define('ol-button', OlButton);
