// <ol-card tint="#7FA36F" interactive elevated>…content…</ol-card>
// Surface, radius md, padding 16, 1 px border. `tint` sets --tint (style.setProperty) and a 4 px left bar.
// `interactive` → role="button", tabindex="0", overlay states, Enter/Space dispatch a click.
// Content stays as light-DOM children (no re-rendering of children).
//
// Details of this implementation:
// - Enter activates on keydown, Space on keyup (native button behaviour); keys pressed inside
//   descendants (inputs, nested buttons) are ignored.
// - Removing `interactive` removes only the role/tabindex the card set itself.
// - `elevated` adds var(--shadow-raised) without the border; B.0 reserves shadows for lifted states
//   (e.g. a dragged card, TODO(phase-3) Kanban).
// - Children with slot="header" / slot="footer" get spacing from the stylesheet (B.3 slots).

export class OlCard extends HTMLElement {
  static observedAttributes = ['tint', 'interactive', 'elevated'];

  private ownsRole = false;
  private ownsTabindex = false;
  private spaceDown = false;

  connectedCallback(): void {
    this.addEventListener('keydown', this.onKeyDown);
    this.addEventListener('keyup', this.onKeyUp);
    this.sync();
  }

  disconnectedCallback(): void {
    this.removeEventListener('keydown', this.onKeyDown);
    this.removeEventListener('keyup', this.onKeyUp);
    this.spaceDown = false;
  }

  attributeChangedCallback(): void {
    this.sync();
  }

  private sync(): void {
    const tint = this.getAttribute('tint')?.trim();
    if (tint) {
      if (this.style.getPropertyValue('--tint') !== tint) this.style.setProperty('--tint', tint);
    } else if (this.style.getPropertyValue('--tint')) {
      this.style.removeProperty('--tint');
    }

    const interactive = this.hasAttribute('interactive');
    if (interactive) {
      if (!this.hasAttribute('role')) {
        this.setAttribute('role', 'button');
        this.ownsRole = true;
      }
      if (!this.hasAttribute('tabindex')) {
        this.setAttribute('tabindex', '0');
        this.ownsTabindex = true;
      }
    } else {
      if (this.ownsRole) this.removeAttribute('role');
      if (this.ownsTabindex) this.removeAttribute('tabindex');
      this.ownsRole = false;
      this.ownsTabindex = false;
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.hasAttribute('interactive') || event.target !== this) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!event.repeat) this.click();
    } else if (event.key === ' ') {
      event.preventDefault();
      this.spaceDown = true;
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.key !== ' ' || !this.spaceDown) return;
    this.spaceDown = false;
    if (!this.hasAttribute('interactive') || event.target !== this) return;
    event.preventDefault();
    this.click();
  };
}

if (!customElements.get('ol-card')) customElements.define('ol-card', OlCard);
