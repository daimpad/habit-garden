// Guided tour overlay (decision of 19.10.2026; steps and geometry: services/tour.ts).
// A native <dialog> (showModal: focus trap, the page below is inert) fills the screen without a visible
// backdrop. Inside it a "light" (a rounded box whose huge shadow dims everything else) glides from element to
// element, and Keimi explains the step in a bubble next to it: title, one or two sentences, "1 von 10" with
// dots, Zurück / Weiter (Fertig on the last step) and, on `tryIt` steps, Ausprobieren. The close button and Esc
// end the tour (a toast says where to find it again); ArrowLeft / ArrowRight step back and forth.
//
// Details of this implementation:
// - Each step first navigates to its route (if needed), waits up to TARGET_WAIT_MS for a visible target,
//   scrolls the window so that light and bubble fit (services/tour scrollTarget) and then places both.
//   Optional steps without a target are dropped; others show Keimi in the middle.
// - Window scroll and resize re-place the light in the next frame; background scroll is locked while open.
// - Ausprobieren: the dialog closes (tour paused), the matching sheet opens (capture "Routine" or the focus
//   picker); once no modal is open any more the dialog opens again on the next step.
// - A route change the tour did not start (Back) ends the tour quietly.
// - Under reduced motion the light jumps instead of gliding and nothing pulses or waves (CSS).
// - Klänge: Keimi chirps when a tour starts and when it is finished with Fertig (services/sound).
// - The offer after the onboarding (queueTourOffer in start.ts, maybeOfferTour from main.ts once HEUTE
//   shows) uses the same bubble in the middle: "Später" / "Tour starten", asked once per onboarding.
import '../components/ol-button.js';
import '../components/ol-icon-button.js';
import { keimiGlyph } from '../components/island.js';
import { playSound } from '../services/sound.js';
import { lockScroll, onModalChange, popModal, pushModal, topModal } from '../components/ol-sheet.js';
import { showToast } from '../components/ol-toast.js';
import { fmt, t } from '../i18n/de.js';
import { current, navigate, onRoute } from '../router.js';
import { place, scrollTarget, TOURS, type Rect, type TourId, type TourStep, type Viewport } from '../services/tour.js';
import { today } from '../util/date.js';
import { h, motionReduced, raw, render, setVar } from '../util/dom.js';
import { openCapture } from './sheets/capture.js';
import { openFocusPick } from './sheets/focus-pick.js';

const TARGET_WAIT_MS = 1500;
/** On the same screen a missing target is not coming: a short grace period only. */
const TARGET_WAIT_SAME_MS = 150;
const SCROLL_WAIT_MS = 600;
const OFFER_KEY = 'hg-tour-offer';
const OFFER_DELAY_MS = 900;

let active: Tour | null = null;

/** Starts a tour (an open one ends first). */
export function startTour(id: TourId): void {
  active?.end(false);
  active = new Tour(id);
  void active.begin();
}

/** Called by the onboarding when it finishes: HEUTE offers the main tour once. */
export function queueTourOffer(): void {
  try {
    sessionStorage.setItem(OFFER_KEY, '1');
  } catch {
    // Storage unavailable: no offer; the tour stays reachable from the settings.
  }
}

/** Shows the offer when the onboarding queued one and HEUTE is on screen without another overlay. */
export function maybeOfferTour(): void {
  let queued = false;
  try {
    queued = sessionStorage.getItem(OFFER_KEY) === '1';
    if (queued) sessionStorage.removeItem(OFFER_KEY);
  } catch {
    return;
  }
  if (!queued) return;
  window.setTimeout(() => {
    if (active || topModal() || current().name !== 'heute') return;
    active = new Tour('main');
    active.offer();
  }, OFFER_DELAY_MS);
}

function visibleEl(selector: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    if (el.closest('.ol-tour')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (getComputedStyle(el).visibility === 'hidden') continue;
    return el;
  }
  return null;
}

function findTarget(step: TourStep): HTMLElement | null {
  for (const sel of step.targets) {
    const el = visibleEl(sel);
    if (el) return el;
  }
  return null;
}

function viewport(): Viewport {
  const width = document.documentElement.clientWidth;
  const height = window.visualViewport?.height ?? window.innerHeight;
  const nav = document.querySelector<HTMLElement>('ol-bottom-nav:not([hidden])');
  const r = nav?.getBoundingClientRect();
  // The navigation is a bar at the bottom on phones, a rail on the left from 900 px.
  const bottom = r && r.width > r.height && r.top > height / 2 ? Math.min(height, r.top) : height;
  return { width, height, top: 0, bottom };
}

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

class Tour {
  private readonly steps: TourStep[];
  private index = 0;
  private readonly dialog: HTMLDialogElement;
  private readonly spot: HTMLElement;
  private readonly bubble: HTMLElement;
  private target: HTMLElement | null = null;
  private releaseScroll: (() => void) | null = null;
  private readonly cleanups: Array<() => void> = [];
  private navigating = false;
  private paused = false;
  private ended = false;
  private showing = 0;
  private raf = 0;
  private readonly opener: Element | null;

  constructor(id: TourId) {
    this.steps = [...TOURS[id]];
    this.opener = document.activeElement;
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'ol-tour';
    this.dialog.setAttribute('aria-label', t.tourAria);
    render(this.dialog, h`<div class="ol-tour__spot" data-empty aria-hidden="true"></div>
      <div class="ol-tour__bubble" data-side="center">
        <div class="ol-tour__keimi" aria-hidden="true">${raw(keimiGlyph(60))}</div>
        <div class="ol-tour__content">
          <p class="ol-tour__progress"><span class="ol-tour__count ol-caption ol-num"></span><span class="ol-tour__dots" aria-hidden="true"></span></p>
          <h2 class="ol-tour__title" id="ol-tour-title"></h2>
          <p class="ol-tour__text" id="ol-tour-text"></p>
          <div class="ol-tour__actions">
            <ol-button class="ol-tour__back" variant="ghost" size="sm" label="${t.tourBack}"></ol-button>
            <ol-button class="ol-tour__try" variant="tonal" size="sm" label="${t.tourTry}" hidden></ol-button>
            <ol-button class="ol-tour__next" size="sm" label="${t.tourNext}"></ol-button>
          </div>
        </div>
        <ol-icon-button class="ol-tour__close" icon="x" label="${t.tourClose}"></ol-icon-button>
      </div>`);
    this.dialog.setAttribute('aria-labelledby', 'ol-tour-title');
    this.dialog.setAttribute('aria-describedby', 'ol-tour-text');
    this.spot = this.q('.ol-tour__spot');
    this.bubble = this.q('.ol-tour__bubble');
    this.bind();
  }

  private q(selector: string): HTMLElement {
    const el = this.dialog.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`tour: ${selector}`);
    return el;
  }

  private bind(): void {
    this.q('.ol-tour__next').addEventListener('click', () => {
      if (this.dialog.dataset['mode'] === 'offer') void this.begin();
      else void this.go(1);
    });
    this.q('.ol-tour__back').addEventListener('click', () => {
      if (this.dialog.dataset['mode'] === 'offer') this.end(true);
      else void this.go(-1);
    });
    this.q('.ol-tour__try').addEventListener('click', () => void this.tryIt());
    this.q('.ol-tour__close').addEventListener('click', () => this.end(true));
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.end(true);
    });
    this.dialog.addEventListener('keydown', (event) => {
      if (this.dialog.dataset['mode'] !== 'step' || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        void this.go(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        void this.go(-1);
      }
    });
    const relayout = (): void => {
      if (this.raf || this.paused) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.layout();
      });
    };
    window.addEventListener('scroll', relayout, { passive: true, capture: true });
    window.addEventListener('resize', relayout);
    window.visualViewport?.addEventListener('resize', relayout);
    this.cleanups.push(() => {
      window.removeEventListener('scroll', relayout, { capture: true });
      window.removeEventListener('resize', relayout);
      window.visualViewport?.removeEventListener('resize', relayout);
      if (this.raf) cancelAnimationFrame(this.raf);
    });
    this.cleanups.push(onRoute(() => {
      if (!this.navigating && !this.paused && !this.ended && this.dialog.dataset['mode'] === 'step') this.end(false);
    }));
  }

  private open(): void {
    if (!this.dialog.isConnected) document.body.append(this.dialog);
    if (!this.dialog.open) this.dialog.showModal();
    pushModal(this.dialog);
    this.releaseScroll ??= lockScroll();
  }

  private hide(): void {
    if (this.dialog.open) this.dialog.close();
    popModal(this.dialog);
    this.releaseScroll?.();
    this.releaseScroll = null;
  }

  /** The offer after the onboarding: Keimi in the middle, "Später" / "Tour starten". */
  offer(): void {
    this.dialog.dataset['mode'] = 'offer';
    this.setText(t.tourOfferTitle, t.tourOfferText);
    this.q('.ol-tour__count').textContent = '';
    render(this.q('.ol-tour__dots'), h``);
    this.q('.ol-tour__back').setAttribute('label', t.tourOfferLater);
    this.q('.ol-tour__back').hidden = false;
    this.q('.ol-tour__next').setAttribute('label', t.tourOfferStart);
    this.q('.ol-tour__try').hidden = true;
    this.target = null;
    this.open();
    this.layout();
    this.enter();
    this.q('.ol-tour__next').focus();
  }

  async begin(): Promise<void> {
    this.dialog.dataset['mode'] = 'step';
    this.q('.ol-tour__back').setAttribute('label', t.tourBack);
    this.open();
    this.index = 0;
    playSound('keimi');
    await this.show(1);
  }

  private async go(dir: 1 | -1): Promise<void> {
    if (this.showing) return;
    const next = this.index + dir;
    if (next >= this.steps.length) {
      playSound('keimi');
      this.end(false);
      return;
    }
    if (next < 0) return;
    this.index = next;
    await this.show(dir);
  }

  /** Shows steps[index] (dropping optional steps without a target, moving on in `dir`). */
  private async show(dir: 1 | -1): Promise<void> {
    const ticket = ++this.showing;
    try {
      for (;;) {
        const step = this.steps[this.index];
        if (!step || this.ended) return;
        const moved = await this.reach(step.route);
        const target = await this.waitTarget(step, moved ? TARGET_WAIT_MS : TARGET_WAIT_SAME_MS);
        if (ticket !== this.showing || this.ended) return;
        if (!target && step.optional) {
          this.steps.splice(this.index, 1);
          if (dir < 0) this.index -= 1;
          if (this.index < 0) this.index = 0;
          if (this.index >= this.steps.length) {
            this.end(false);
            return;
          }
          continue;
        }
        this.target = target;
        this.fill(step);
        if (target) await this.scrollFor(target);
        if (ticket !== this.showing || this.ended) return;
        this.layout();
        this.enter();
        (step.tryIt ? this.q('.ol-tour__try') : this.q('.ol-tour__next')).focus();
        return;
      }
    } finally {
      if (ticket === this.showing) this.showing = 0;
    }
  }

  /** Navigates to the step's screen; true when it had to. */
  private async reach(route: TourStep['route']): Promise<boolean> {
    const name = route.slice(1);
    if (current().name === name) return false;
    this.navigating = true;
    try {
      navigate(route);
      const until = performance.now() + TARGET_WAIT_MS;
      while (current().name !== name && performance.now() < until) await frame();
      await frame();
    } finally {
      this.navigating = false;
    }
    return true;
  }

  private async waitTarget(step: TourStep, ms: number): Promise<HTMLElement | null> {
    if (step.targets.length === 0) return null;
    const until = performance.now() + ms;
    for (;;) {
      const el = findTarget(step);
      // A target present but still empty (data loading) gets a few more frames.
      if (el || performance.now() > until) return el;
      await frame();
    }
  }

  private async scrollFor(el: HTMLElement): Promise<void> {
    const vp = viewport();
    const size = { w: this.bubble.offsetWidth, h: this.bubble.offsetHeight };
    const rect = rectOf(el);
    const top = scrollTarget(rect, size, vp);
    if (top === null) return;
    const delta = rect.y - top;
    if (Math.abs(delta) < 2) return;
    const smooth = !motionReduced();
    window.scrollBy({ top: delta, behavior: smooth ? 'smooth' : 'instant' });
    if (!smooth) return;
    await Promise.race([
      new Promise<void>((resolve) => window.addEventListener('scrollend', () => resolve(), { once: true })),
      sleep(SCROLL_WAIT_MS),
    ]);
  }

  private setText(title: string, text: string): void {
    this.q('.ol-tour__title').textContent = title;
    this.q('.ol-tour__text').textContent = text;
  }

  private fill(step: TourStep): void {
    const n = this.index + 1;
    const total = this.steps.length;
    this.setText(step.title, step.text);
    this.q('.ol-tour__count').textContent = fmt(t.tourProgress, { n, total });
    render(this.q('.ol-tour__dots'), h`${this.steps.map((_, i) => h`<span class="ol-tour__dot" ${i === this.index ? 'data-on' : ''}></span>`)}`);
    this.q('.ol-tour__back').hidden = this.index === 0;
    this.q('.ol-tour__next').setAttribute('label', n === total ? t.tourDone : t.tourNext);
    this.q('.ol-tour__try').hidden = !step.tryIt || !this.target;
  }

  /** Places light and bubble for the current target (or Keimi in the middle). */
  private layout(): void {
    if (this.ended || this.paused) return;
    const vp = viewport();
    const target = this.target?.isConnected ? this.target : null;
    const p = place(target ? rectOf(target) : null, { w: this.bubble.offsetWidth, h: this.bubble.offsetHeight }, vp);
    const px = (v: number): string => `${v.toFixed(1)}px`;
    if (p.spot) {
      setVar(this.spot, '--sx', px(p.spot.x));
      setVar(this.spot, '--sy', px(p.spot.y));
      setVar(this.spot, '--sw', px(p.spot.w));
      setVar(this.spot, '--sh', px(p.spot.h));
      this.spot.removeAttribute('data-empty');
    } else {
      setVar(this.spot, '--sx', px(vp.width / 2));
      setVar(this.spot, '--sy', px(vp.height / 2));
      setVar(this.spot, '--sw', '0px');
      setVar(this.spot, '--sh', '0px');
      this.spot.setAttribute('data-empty', '');
    }
    setVar(this.bubble, '--bx', px(p.bubble.x));
    setVar(this.bubble, '--by', px(p.bubble.y));
    setVar(this.bubble, '--px', px(p.pointer));
    this.bubble.dataset['side'] = p.side;
  }

  /** Text fades up, Keimi hops (not under reduced motion). */
  private enter(): void {
    if (motionReduced()) return;
    this.q('.ol-tour__content').animate(
      [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
      { duration: 260, easing: 'cubic-bezier(0,0,0,1)' },
    );
    this.q('.ol-tour__keimi').animate(
      [{ transform: 'translateY(0)' }, { transform: 'translateY(-6px)' }, { transform: 'translateY(0)' }],
      { duration: 420, easing: 'cubic-bezier(.2,.9,.3,1.2)' },
    );
  }

  /** Ausprobieren: step aside, open the sheet, come back on the next step once it is closed. */
  private async tryIt(): Promise<void> {
    const step = this.steps[this.index];
    if (!step?.tryIt || this.paused) return;
    this.paused = true;
    this.hide();
    let opened = false;
    try {
      if (step.tryIt === 'habit') openCapture({ type: 'habit' });
      else openFocusPick(today());
      await frame();
      opened = topModal() !== null;
    } catch (err) {
      console.error(err);
    }
    if (opened) {
      await new Promise<void>((resolve) => {
        const stop = onModalChange(() => {
          if (topModal() === null) {
            stop();
            resolve();
          }
        });
        this.cleanups.push(stop);
      });
      // Let the closing sheet finish and HEUTE re-render (a new routine card).
      await sleep(350);
    }
    if (this.ended) return;
    this.paused = false;
    this.open();
    if (opened && this.index < this.steps.length - 1) this.index += 1;
    await this.show(1);
  }

  end(announce: boolean): void {
    if (this.ended) return;
    this.ended = true;
    for (const fn of this.cleanups.splice(0)) fn();
    this.hide();
    this.dialog.remove();
    if (active === this) active = null;
    if (this.opener instanceof HTMLElement && this.opener.isConnected) this.opener.focus({ preventScroll: true });
    if (announce) showToast(t.tourEndedToast);
  }
}
