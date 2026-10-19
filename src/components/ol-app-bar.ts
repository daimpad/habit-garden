// <ol-app-bar heading="Planung" display back>
//   <ol-icon-button slot="actions" icon="settings" label="Einstellungen"></ol-icon-button>
// </ol-app-bar>
// <header> 56 px (not sticky): optional back icon button (arrow-left, aria-label t.actionBack) that emits
// `ol-back`; title as <h1> (class ol-title, or ol-display with `display`); up to three children with
// slot="actions" are moved into the right-hand action area on first connect.
//
// Details of this implementation:
// - min-height 56 px so the bar grows with 200 % text; the display title uses
//   clamp(1.375rem, 6vw, 1.75rem) and wraps to a second line when needed (S30).
// - Children with slot="actions" that are appended to the host later are moved on the next connect or
//   attribute change. Re-connecting reuses the rendered header (idempotent).
// - The back and action icons are optically aligned with the 16 px content edge (negative margins);
//   their 48 px hit areas stay intact.
import { t } from '../i18n/de.js';
import { emit, h, render } from '../util/dom.js';
import './ol-icon-button.js';

/** Three icons (e.g. help, search, more) still leave room for the title at 320 px. */
const MAX_ACTIONS = 3;

export class OlAppBar extends HTMLElement {
  static observedAttributes = ['heading', 'back', 'display'];

  private header: HTMLElement | null = null;
  private backEl: HTMLElement | null = null;
  private titleEl: HTMLHeadingElement | null = null;
  private actionsEl: HTMLElement | null = null;

  connectedCallback(): void {
    this.ensureSkeleton();
    this.sync();
  }

  attributeChangedCallback(): void {
    if (this.header) this.sync();
  }

  /** The <h1> title element. */
  get titleElement(): HTMLHeadingElement | null {
    return this.titleEl;
  }

  private ensureSkeleton(): void {
    if (this.header) return;
    let header = this.querySelector<HTMLElement>(':scope > header.ol-app-bar__bar');
    if (!header) {
      const actions = [...this.children].filter((el) => el.getAttribute('slot') === 'actions');
      render(
        this,
        h`<header class="ol-app-bar__bar"><ol-icon-button class="ol-app-bar__back" icon="arrow-left" label="${t.actionBack}" hidden></ol-icon-button><h1 class="ol-app-bar__title ol-title"></h1><div class="ol-app-bar__actions"></div></header>`,
      );
      header = this.querySelector<HTMLElement>(':scope > header.ol-app-bar__bar');
      header?.querySelector('.ol-app-bar__actions')?.append(...actions.slice(0, MAX_ACTIONS));
    }
    this.header = header;
    this.backEl = header?.querySelector<HTMLElement>(':scope > .ol-app-bar__back') ?? null;
    this.titleEl = header?.querySelector<HTMLHeadingElement>(':scope > .ol-app-bar__title') ?? null;
    this.actionsEl = header?.querySelector<HTMLElement>(':scope > .ol-app-bar__actions') ?? null;
    this.backEl?.addEventListener('click', this.onBack);
  }

  private sync(): void {
    const heading = this.getAttribute('heading') ?? '';
    if (this.titleEl) {
      if (this.titleEl.textContent !== heading) this.titleEl.textContent = heading;
      const display = this.hasAttribute('display');
      this.titleEl.classList.toggle('ol-display', display);
      this.titleEl.classList.toggle('ol-title', !display);
    }
    if (this.backEl) this.backEl.hidden = !this.hasAttribute('back');

    // Late slot="actions" children (appended directly to the host).
    if (this.actionsEl) {
      const late = [...this.children].filter((el) => el.getAttribute('slot') === 'actions');
      const room = Math.max(0, MAX_ACTIONS - this.actionsEl.children.length);
      if (late.length && room) this.actionsEl.append(...late.slice(0, room));
      this.actionsEl.hidden = this.actionsEl.children.length === 0;
    }
  }

  private readonly onBack = (event: MouseEvent): void => {
    event.stopPropagation();
    emit(this, 'ol-back');
  };
}

if (!customElements.get('ol-app-bar')) customElements.define('ol-app-bar', OlAppBar);
