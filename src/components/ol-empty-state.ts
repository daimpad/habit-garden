// <ol-empty-state icon="sprout" message="Noch keine Routine" action="Routine anlegen"></ol-empty-state>
// Icon 32 px text-3, message 14 text-2, optional tonal ol-button (`action` label) that emits
// `ol-action`. Vertically centred.
//
// Details of this implementation:
// - Default: centred in a block of at least 40 % of the viewport height (B.3 "ab 40 % Höhe"), for
//   screens whose content is only the empty state. Additional attribute `compact` drops the minimum
//   height (e.g. inside a card on HEUTE).
// - Attribute changes update the parts in place; the action button is kept (and keeps focus).
import { emit, h, icon, render } from '../util/dom.js';
import type { OlButton } from './ol-button.js';
import './ol-button.js';

export class OlEmptyState extends HTMLElement {
  static observedAttributes = ['icon', 'message', 'action'];

  private iconEl: HTMLElement | null = null;
  private messageEl: HTMLElement | null = null;
  private actionEl: OlButton | null = null;
  private renderedIcon: string | null = null;

  connectedCallback(): void {
    this.ensureSkeleton();
    this.sync();
  }

  attributeChangedCallback(): void {
    if (this.messageEl) this.sync();
  }

  private ensureSkeleton(): void {
    if (this.messageEl) return;
    let messageEl = this.querySelector<HTMLElement>(':scope > .ol-empty-state__message');
    if (!messageEl) {
      render(
        this,
        h`<span class="ol-empty-state__icon" aria-hidden="true" hidden></span><p class="ol-empty-state__message"></p><ol-button class="ol-empty-state__action" variant="tonal" hidden></ol-button>`,
      );
      messageEl = this.querySelector<HTMLElement>(':scope > .ol-empty-state__message');
    }
    this.messageEl = messageEl;
    this.iconEl = this.querySelector<HTMLElement>(':scope > .ol-empty-state__icon');
    this.actionEl = this.querySelector<OlButton>(':scope > .ol-empty-state__action');
    this.renderedIcon = this.iconEl?.dataset['icon'] ?? null;
    this.actionEl?.addEventListener('click', this.onAction);
  }

  private sync(): void {
    const name = this.getAttribute('icon')?.trim() || null;
    if (this.iconEl && name !== this.renderedIcon) {
      if (name) {
        render(this.iconEl, icon(name, 32));
        this.iconEl.dataset['icon'] = name;
      } else {
        this.iconEl.textContent = '';
        delete this.iconEl.dataset['icon'];
      }
      this.iconEl.hidden = !name;
      this.renderedIcon = name;
    }

    const message = this.getAttribute('message') ?? '';
    if (this.messageEl) {
      if (this.messageEl.textContent !== message) this.messageEl.textContent = message;
      this.messageEl.hidden = message === '';
    }

    const action = this.getAttribute('action')?.trim() ?? '';
    if (this.actionEl) {
      if (this.actionEl.getAttribute('label') !== action) this.actionEl.setAttribute('label', action);
      this.actionEl.hidden = action === '';
    }
  }

  private readonly onAction = (event: MouseEvent): void => {
    event.stopPropagation();
    emit(this, 'ol-action');
  };
}

if (!customElements.get('ol-empty-state')) customElements.define('ol-empty-state', OlEmptyState);
