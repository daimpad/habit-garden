// <ol-bottom-nav value="heute|planung|wissen"></ol-bottom-nav>
// <nav aria-label=t.navLabel> with three <a href> links (/heute, /planung, /wissen; the href of a tab
// may be set via setTabPath(tab, path) to restore tab state), Lucide icons sun, clipboard-list, brain,
// label 12/500 always visible; active: pill 56×32 primary-soft behind the icon, aria-current="page".
// 64 px + safe-area-inset-bottom; from 900 px a left rail with the same three targets.
// Navigation itself happens through main.ts' delegated link handler. Tap on the active tab:
// preventDefault; if scrolled, scroll to top; otherwise emit `ol-navigate` to the tab root.
// Paths (tab roots, setTabPath) are internal app paths; the rendered hrefs carry the base path
// (util/base.ts), e.g. "/habit-garden/heute" on GitHub Pages.
//
// Details of this implementation:
// - Fixed to the bottom (z-index 20); from 900 px a fixed left rail 96 px wide (base.css pads .ol-shell).
// - Active tab: pill in primary-soft, label in primary at weight 600 (not colour alone, S29).
// - Tap on the active tab: preventDefault + stopPropagation (main.ts' handler does not see it);
//   scrolled → window.scrollTo top (smooth unless motion is reduced); otherwise, if the current path
//   is not the tab root, `ol-navigate` (detail: { path: '/heute' | '/planung' | '/wissen' }).
//   Modified clicks (Ctrl/Meta/Shift/Alt, middle button) are left to the browser.
import { t } from '../i18n/de.js';
import { appPath, appUrl } from '../util/base.js';
import { emit, h, icon, motionReduced, render } from '../util/dom.js';

export type Tab = 'heute' | 'planung' | 'wissen';

export interface NavigateDetail { path: string }

const TABS: readonly { tab: Tab; root: string; icon: string; label: string }[] = [
  { tab: 'heute', root: '/heute', icon: 'sun', label: t.tabHeute },
  { tab: 'planung', root: '/planung', icon: 'clipboard-list', label: t.tabPlanung },
  { tab: 'wissen', root: '/wissen', icon: 'brain', label: t.tabWissen },
];

function isTab(value: string | null): value is Tab {
  return value === 'heute' || value === 'planung' || value === 'wissen';
}

export class OlBottomNav extends HTMLElement {
  static observedAttributes = ['value'];

  private nav: HTMLElement | null = null;
  private readonly paths = new Map<Tab, string>();

  connectedCallback(): void {
    this.ensureSkeleton();
    this.sync();
  }

  attributeChangedCallback(): void {
    if (this.nav) this.sync();
  }

  get value(): Tab | null {
    const value = this.getAttribute('value');
    return isTab(value) ? value : null;
  }
  set value(tab: Tab | null) {
    if (tab) this.setAttribute('value', tab);
    else this.removeAttribute('value');
  }

  setTabPath(tab: Tab, path: string): void {
    // Only same-origin app paths are accepted ("/…", not "//host").
    if (!TABS.some((d) => d.tab === tab) || !path.startsWith('/') || path.startsWith('//')) return;
    this.paths.set(tab, path);
    const link = this.linkOf(tab);
    const href = appUrl(path);
    if (link && link.getAttribute('href') !== href) link.setAttribute('href', href);
  }

  private linkOf(tab: Tab): HTMLAnchorElement | null {
    return this.nav?.querySelector<HTMLAnchorElement>(`a[data-tab="${tab}"]`) ?? null;
  }

  private ensureSkeleton(): void {
    if (this.nav) return;
    let nav = this.querySelector<HTMLElement>(':scope > nav.ol-bottom-nav__nav');
    if (!nav) {
      render(
        this,
        h`<nav class="ol-bottom-nav__nav" aria-label="${t.navLabel}">${TABS.map(
          (d) => h`<a class="ol-bottom-nav__link" href="${appUrl(this.paths.get(d.tab) ?? d.root)}" data-tab="${d.tab}"><span class="ol-bottom-nav__pill">${icon(d.icon, 24)}</span><span class="ol-bottom-nav__label">${d.label}</span></a>`,
        )}</nav>`,
      );
      nav = this.querySelector<HTMLElement>(':scope > nav.ol-bottom-nav__nav');
    }
    this.nav = nav;
    nav?.addEventListener('click', this.onClick);
  }

  private sync(): void {
    const active = this.value;
    for (const d of TABS) {
      const link = this.linkOf(d.tab);
      if (!link) continue;
      if (d.tab === active) {
        if (link.getAttribute('aria-current') !== 'page') link.setAttribute('aria-current', 'page');
      } else if (link.hasAttribute('aria-current')) {
        link.removeAttribute('aria-current');
      }
      const href = appUrl(this.paths.get(d.tab) ?? d.root);
      if (link.getAttribute('href') !== href) link.setAttribute('href', href);
    }
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-tab]') : null;
    if (!link) return;
    const tab = link.dataset['tab'] ?? null;
    if (!isTab(tab) || tab !== this.value) return;
    event.preventDefault();
    event.stopPropagation();
    const def = TABS.find((d) => d.tab === tab);
    if (!def) return;
    if (window.scrollY > 0) {
      window.scrollTo({ top: 0, behavior: motionReduced() ? 'auto' : 'smooth' });
      return;
    }
    if (appPath(location.pathname) !== def.root || location.search !== '') {
      emit<NavigateDetail>(this, 'ol-navigate', { path: def.root });
    }
  };
}

if (!customElements.get('ol-bottom-nav')) customElements.define('ol-bottom-nav', OlBottomNav);
