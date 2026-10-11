// CONTRACT STUB – implemented in AP6.
// <ol-bottom-nav value="heute|planung|wissen"></ol-bottom-nav>
// <nav aria-label=t.navLabel> with three <a href> links (/heute, /planung, /wissen; the href of a tab
// may be set via setTabPath(tab, path) to restore tab state), Lucide icons sun, clipboard-list, brain,
// label 12/500 always visible; active: pill 56×32 primary-soft behind the icon, aria-current="page".
// 64 px + safe-area-inset-bottom; from 900 px a left rail with the same three targets.
// Navigation itself happens through main.ts' delegated link handler. Tap on the active tab:
// preventDefault; if scrolled, scroll to top; otherwise emit `ol-navigate` to the tab root.

export type Tab = 'heute' | 'planung' | 'wissen';

export class OlBottomNav extends HTMLElement {
  static observedAttributes = ['value'];
  connectedCallback(): void {}
  attributeChangedCallback(): void {}
  setTabPath(tab: Tab, path: string): void {
    void tab; void path;
  }
}

if (!customElements.get('ol-bottom-nav')) customElements.define('ol-bottom-nav', OlBottomNav);
