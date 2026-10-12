// Exactly one <ol-toast> (main.ts appends it to body). Queue; one toast visible at a time.
// 48 px, surface with border, radius md, text 14, up to two actions (primary text buttons).
// Placed 16 px above the bottom nav and clear of the FAB. role="status", aria-live="polite".
// Duration 5000 ms; the timer pauses on hover, focus and touch. Entering/leaving animation;
// crossfade under reduced motion. Approved API extension: up to two actions (D.5 "Erledigt", "+1 h").
//
// Details of this implementation (S12, S26):
// - 48 px is the minimum height: the text wraps to two lines and the actions wrap below it.
// - A duration of 60 s or more (or Infinity) makes the toast sticky (reminders): it stays until the user
//   acts or closes it (close button). `dismissible` adds the close button to any toast.
// - Queue rules: a toast with actions (undo) never waits – it replaces the visible transient toast at
//   once (a replaced undo action stays committed; a replaced plain message is shown again afterwards).
//   A transient toast never waits behind a sticky one: the sticky toast steps back into the queue.
//   Plain messages queue FIFO ahead of queued sticky toasts.
// - Clicking an action dismisses the toast first, emits ol-action (detail { label, index }), then calls
//   onAction (so a toast shown by the action is not dismissed with this one).
// - While a sheet or dialog is open the element moves into the topmost modal <dialog>, so it stays
//   visible, announced and operable (content outside a modal dialog is inert).
// - In a sheet it sits 8 px above the panel's top edge when there is room for it, so it covers none of
//   the sheet's controls; otherwise (full-height sheet) 8 px above the footer, and the sheet body gets
//   bottom padding / scroll padding of the toast's height while it is visible (the focused field is
//   scrolled clear of it). Re-placed on detent changes and size changes of the sheet.
// - A sheet or dialog that opens over a visible (non-sticky) toast ends that toast instead of taking
//   it along, and the queue continues (S12: sticky reminder toasts move along and stay).
// - The hover pause starts on a real mouse movement over the toast, not when the toast appears under
//   a resting pointer.
// - Reflected attributes: state="visible|leaving" (absent when idle), sticky.
import { t } from '../i18n/de.js';
import { emit, h, icon, motionReduced, render } from '../util/dom.js';
import { onModalChange, topModal } from './ol-sheet.js';

export interface ToastAction { label: string; onAction: () => void }
export interface ToastOptions { action?: ToastAction; actions?: ToastAction[]; duration?: number; dismissible?: boolean }

const DEFAULT_DURATION = 5000;
const STICKY_FROM = 60_000;
const MAX_TIMEOUT = 2 ** 31 - 1;
const MIN_RESUME = 1500;
const REQUEUE_MIN = 1500;
const ENTER_MS = 200;
const LEAVE_MS = 150;
const CROSSFADE_MS = 120;

interface Entry {
  message: string;
  actions: ToastAction[];
  duration: number;
  sticky: boolean;
  dismissible: boolean;
}

type Hold = 'hover' | 'focus' | 'touch';

export class OlToast extends HTMLElement {
  private boxEl: HTMLElement | null = null;
  private msgEl: HTMLElement | null = null;
  private actionsEl: HTMLElement | null = null;
  private current: Entry | null = null;
  private queue: Entry[] = [];
  private timer = 0;
  private deadline = 0;
  private remaining = 0;
  private holds = new Set<Hold>();
  private anim: Animation | null = null;
  private focusOrigin: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  /** Modal dialogs that were open when the visible entry was displayed. */
  private modalsAtDisplay = new Set<HTMLDialogElement>();
  /** Sheet dialog that currently reserves space for the toast (data-toast-space). */
  private spaceHost: HTMLDialogElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private observed: HTMLDialogElement | null = null;
  /** Mouse position when it entered the toast; the hover pause starts once it moves from there. */
  private pointerAt: { x: number; y: number } | null = null;

  connectedCallback(): void {
    this.build();
    this.unsubscribe ??= onModalChange(this.onModalChange);
    document.addEventListener('ol-detent-change', this.onLayoutChange);
    window.addEventListener('resize', this.onLayoutChange);
  }

  disconnectedCallback(): void {
    // ol-toast moves between <body> and dialogs; only a real removal stops the observers.
    if (this.isConnected) return;
    this.unsubscribe?.();
    this.unsubscribe = null;
    document.removeEventListener('ol-detent-change', this.onLayoutChange);
    window.removeEventListener('resize', this.onLayoutChange);
    this.resizeObserver?.disconnect();
    this.observed = null;
    this.releaseSpace();
  }

  show(message: string, opts: ToastOptions = {}): void {
    this.build();
    const actions = [...(opts.actions ?? []), ...(opts.action ? [opts.action] : [])].slice(0, 2);
    const duration = opts.duration ?? DEFAULT_DURATION;
    const sticky = !Number.isFinite(duration) || duration >= STICKY_FROM;
    const entry: Entry = { message, actions, duration, sticky, dismissible: opts.dismissible ?? sticky };
    const cur = this.current;
    if (!cur) {
      this.display(entry, false);
    } else if (entry.sticky) {
      this.enqueue(entry, false);
    } else if (cur.sticky) {
      this.enqueue(cur, true);
      this.display(entry, true);
    } else if (entry.actions.length > 0) {
      const left = this.timeLeft();
      if (cur.actions.length === 0 && left >= REQUEUE_MIN) this.enqueue({ ...cur, duration: left }, true);
      this.display(entry, true);
    } else {
      this.enqueue(entry, false);
    }
  }

  /** Hides the visible toast and shows the next queued one. */
  dismiss(): void {
    const entry = this.current;
    if (!entry) return;
    // Focus inside the toast goes back to where it came from before the toast goes away.
    if (this.contains(document.activeElement)) this.returnFocus();
    this.clearTimer();
    this.current = null;
    const next = this.queue.shift();
    if (next) {
      this.display(next, true);
    } else {
      this.hide();
    }
  }

  private build(): void {
    if (this.boxEl) return;
    this.setAttribute('role', 'status');
    this.setAttribute('aria-live', 'polite');
    this.setAttribute('aria-atomic', 'true');
    render(this, h`<div class="ol-toast__box" hidden><p class="ol-toast__msg"></p><div class="ol-toast__actions"></div></div>`);
    this.boxEl = this.querySelector<HTMLElement>('.ol-toast__box');
    this.msgEl = this.querySelector<HTMLElement>('.ol-toast__msg');
    this.actionsEl = this.querySelector<HTMLElement>('.ol-toast__actions');
    this.actionsEl?.addEventListener('click', this.onActionClick);
    this.addEventListener('pointerenter', this.onPointerEnter);
    this.addEventListener('pointermove', this.onPointerMove);
    this.addEventListener('pointerleave', this.onPointerLeave);
    this.addEventListener('pointerdown', this.onPointerDown);
    this.addEventListener('pointerup', this.onPointerUp);
    this.addEventListener('pointercancel', this.onPointerUp);
    this.addEventListener('focusin', this.onFocusIn);
    this.addEventListener('focusout', this.onFocusOut);
  }

  /** Transient entries go before queued sticky ones; `front` puts an entry first within its group. */
  private enqueue(entry: Entry, front: boolean): void {
    const firstSticky = this.queue.findIndex((e) => e.sticky);
    const end = firstSticky < 0 ? this.queue.length : firstSticky;
    if (entry.sticky) this.queue.splice(front ? end : this.queue.length, 0, entry);
    else this.queue.splice(front ? 0 : end, 0, entry);
  }

  private display(entry: Entry, replacing: boolean): void {
    const box = this.boxEl;
    const msg = this.msgEl;
    const actions = this.actionsEl;
    if (!box || !msg || !actions) return;
    this.clearTimer();
    const wasVisible = !box.hidden && this.getAttribute('state') === 'visible';
    const hadFocus = this.contains(document.activeElement);
    this.current = entry;
    this.modalsAtDisplay = new Set([...document.querySelectorAll<HTMLDialogElement>('dialog[open]')]);
    this.rehome();
    msg.textContent = entry.message;
    render(
      actions,
      h`${entry.actions.map((a, i) => h`<button type="button" class="ol-toast__action" data-index="${i}">${a.label}</button>`)}${
        entry.dismissible ? h`<button type="button" class="ol-toast__close" aria-label="${t.actionClose}">${icon('x', 20)}</button>` : ''}`,
    );
    // The focused button of the replaced toast is gone: focus goes back to where it came from.
    if (hadFocus && !this.contains(document.activeElement)) this.returnFocus();
    box.hidden = false;
    this.setAttribute('state', 'visible');
    this.toggleAttribute('sticky', entry.sticky);
    // Holds that no longer apply (focused button replaced, pointer gone) are dropped.
    if (!this.contains(document.activeElement)) this.holds.delete('focus');
    if (!box.matches(':hover')) this.holds.delete('hover');
    this.place();
    this.anim?.cancel();
    const reduced = motionReduced();
    if ((replacing && wasVisible) || reduced) {
      this.anim = box.animate([{ opacity: wasVisible ? 0.4 : 0 }, { opacity: 1 }], { duration: CROSSFADE_MS, easing: 'linear' });
    } else {
      this.anim = box.animate(
        [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: ENTER_MS, easing: 'cubic-bezier(0,0,0,1)' },
      );
    }
    this.remaining = entry.duration;
    this.startTimer();
  }

  private hide(): void {
    const box = this.boxEl;
    if (!box || box.hidden) return;
    this.setAttribute('state', 'leaving');
    this.anim?.cancel();
    const anim = motionReduced()
      ? box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CROSSFADE_MS, easing: 'linear', fill: 'forwards' })
      : box.animate(
        [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(8px)' }],
        { duration: LEAVE_MS, easing: 'cubic-bezier(.3,0,1,1)', fill: 'forwards' },
      );
    this.anim = anim;
    anim.finished.then(() => {
      if (this.current || this.anim !== anim) return;
      anim.cancel();
      this.anim = null;
      box.hidden = true;
      if (this.msgEl) this.msgEl.textContent = '';
      if (this.actionsEl) this.actionsEl.textContent = '';
      this.removeAttribute('state');
      this.removeAttribute('sticky');
      this.releaseSpace();
      this.rehome();
    }, () => undefined);
  }

  /** Keeps the element inside the topmost modal dialog (or body), where it is not inert. */
  private rehome(): void {
    if (!this.isConnected) return;
    const target = topModal() ?? document.body;
    // In a sheet the toast sits above the footer (primary button stays reachable).
    const footer = target.querySelector<HTMLElement>(':scope > .ol-sheet__footer');
    this.style.setProperty('--ol-toast-above', `${footer ? footer.offsetHeight : 0}px`);
    if (this.parentElement !== target) {
      const hadFocus = this.contains(document.activeElement);
      target.append(this);
      if (!hadFocus) this.holds.delete('focus');
    }
    this.place();
  }

  /** The sheet dialog the toast lives in, if any. */
  private sheetDialog(): HTMLDialogElement | null {
    const parent = this.parentElement;
    return parent instanceof HTMLDialogElement && parent.classList.contains('ol-sheet__dialog') ? parent : null;
  }

  /**
   * Positions a visible toast inside a sheet: above the panel when there is room, else above the
   * footer with space reserved at the end of the sheet body.
   */
  private place(): void {
    const box = this.boxEl;
    const dialog = this.sheetDialog();
    this.observe(dialog);
    if (!box || box.hidden || !this.current || !dialog) {
      this.style.removeProperty('--ol-toast-bottom');
      this.releaseSpace();
      this.reservePageSpace(!dialog && !!box && !box.hidden && this.current !== null);
      return;
    }
    this.reservePageSpace(false);
    // Layout values (no transforms): the sheet is anchored to the bottom, above the keyboard inset.
    const kb = parseFloat(dialog.style.getPropertyValue('--ol-kb')) || 0;
    const panelTop = window.innerHeight - kb - dialog.offsetHeight;
    const height = box.offsetHeight;
    if (panelTop >= height + 16) {
      this.style.setProperty('--ol-toast-bottom', `${Math.round(kb + dialog.offsetHeight + 8)}px`);
      this.releaseSpace();
      return;
    }
    this.style.removeProperty('--ol-toast-bottom');
    const body = dialog.querySelector<HTMLElement>(':scope > .ol-sheet__body');
    if (!body) return;
    const space = Math.max(0, Math.round(body.getBoundingClientRect().bottom - box.getBoundingClientRect().top + 8));
    if (this.spaceHost && this.spaceHost !== dialog) this.releaseSpace();
    this.spaceHost = dialog;
    dialog.style.setProperty('--ol-toast-space', `${space}px`);
    if (!dialog.hasAttribute('data-toast-space')) {
      dialog.setAttribute('data-toast-space', '');
      const active = document.activeElement;
      if (active instanceof HTMLElement && body.contains(active)) active.scrollIntoView({ block: 'nearest' });
    }
  }

  /**
   * Outside sheets: reserves the toast's height as scroll padding of the page (--ol-toast-page, base.css),
   * so a focused control never ends up behind a visible toast (WCAG 2.4.11, e.g. sticky reminders).
   */
  private reservePageSpace(on: boolean): void {
    const root = document.documentElement;
    const box = this.boxEl;
    if (!on || !box) {
      root.style.removeProperty('--ol-toast-page');
      return;
    }
    // +24: margin plus the 16 px the entering animation may still be offset by.
    const space = Math.max(0, Math.round(window.innerHeight - box.getBoundingClientRect().top + 24));
    const had = root.style.getPropertyValue('--ol-toast-page') !== '';
    root.style.setProperty('--ol-toast-page', `${space}px`);
    if (!had) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && !this.contains(active)) active.scrollIntoView({ block: 'nearest' });
    }
  }

  private releaseSpace(): void {
    const host = this.spaceHost;
    this.spaceHost = null;
    if (!host) return;
    host.removeAttribute('data-toast-space');
    host.style.removeProperty('--ol-toast-space');
  }

  /** Watches the size of the sheet the toast is in (fit sheets grow, detents animate). */
  private observe(dialog: HTMLDialogElement | null): void {
    if (dialog === this.observed) return;
    this.resizeObserver?.disconnect();
    this.observed = dialog;
    if (!dialog || typeof ResizeObserver !== 'function') return;
    this.resizeObserver ??= new ResizeObserver(() => this.place());
    this.resizeObserver.observe(dialog);
  }

  private readonly onLayoutChange = (): void => {
    this.place();
  };

  private readonly onModalChange = (): void => {
    const top = topModal();
    const entry = this.current;
    // A sheet or dialog opened over a visible toast: the toast ends instead of covering the new content.
    if (entry && !entry.sticky && top && !this.modalsAtDisplay.has(top) && this.getAttribute('state') === 'visible') {
      this.dismiss();
      return;
    }
    // A leaving toast fades out where it is (hide() re-homes it afterwards), unless its dialog closes.
    const parent = this.parentElement;
    const parentClosing = parent instanceof HTMLDialogElement && parent.dataset['closing'] !== undefined;
    if (!entry && this.getAttribute('state') === 'leaving' && !parentClosing) return;
    this.rehome();
  };

  private timeLeft(): number {
    if (!this.current) return 0;
    if (this.timer) return Math.max(0, this.deadline - performance.now());
    return this.remaining;
  }

  private startTimer(): void {
    const entry = this.current;
    if (!entry || this.timer || this.holds.size > 0 || !Number.isFinite(this.remaining)) return;
    const ms = Math.min(Math.max(0, this.remaining), MAX_TIMEOUT);
    this.deadline = performance.now() + ms;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      if (this.current === entry) this.dismiss();
    }, ms);
  }

  private pauseTimer(): void {
    if (!this.timer) return;
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.remaining = Math.max(0, this.deadline - performance.now());
  }

  private clearTimer(): void {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = 0;
  }

  private hold(kind: Hold): void {
    if (!this.current) return;
    this.holds.add(kind);
    this.pauseTimer();
  }

  private release(kind: Hold): void {
    if (!this.holds.delete(kind) || this.holds.size > 0 || !this.current) return;
    this.remaining = Math.max(this.remaining, MIN_RESUME);
    this.startTimer();
  }

  private returnFocus(): void {
    const origin = this.focusOrigin;
    this.focusOrigin = null;
    if (origin?.isConnected && !origin.closest('[inert]')) origin.focus({ preventScroll: true });
    else if (this.contains(document.activeElement) && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.holds.delete('focus');
  }

  private readonly onActionClick = (event: MouseEvent): void => {
    const btn = event.target instanceof Element ? event.target.closest('button') : null;
    const entry = this.current;
    if (!btn || !entry) return;
    if (btn.classList.contains('ol-toast__close')) {
      this.dismiss();
      return;
    }
    const index = Number(btn.dataset['index']);
    const action = entry.actions[index];
    if (!action) return;
    this.dismiss();
    emit(this, 'ol-action', { label: action.label, index });
    try {
      action.onAction();
    } catch (err) {
      console.error(err);
    }
  };

  private readonly onPointerEnter = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') this.pointerAt = { x: event.clientX, y: event.clientY };
  };

  /** A toast that appears under a resting mouse does not pause; moving the mouse over it does. */
  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || this.holds.has('hover')) return;
    const at = this.pointerAt;
    if (at && at.x === event.clientX && at.y === event.clientY) return;
    this.hold('hover');
  };

  private readonly onPointerLeave = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    this.pointerAt = null;
    this.release('hover');
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') this.hold('touch');
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') this.release('touch');
  };

  private readonly onFocusIn = (event: FocusEvent): void => {
    const from = event.relatedTarget;
    if (from instanceof HTMLElement && !this.contains(from)) this.focusOrigin = from;
    this.hold('focus');
  };

  private readonly onFocusOut = (event: FocusEvent): void => {
    const to = event.relatedTarget;
    if (to instanceof Node && this.contains(to)) return;
    this.release('focus');
  };
}

if (!customElements.get('ol-toast')) customElements.define('ol-toast', OlToast);

/** Shows a toast on the single instance (created on first use if missing). */
export function showToast(message: string, opts: ToastOptions = {}): void {
  let el = document.querySelector<OlToast>('ol-toast');
  if (!el) {
    el = document.createElement('ol-toast') as OlToast;
    document.body.append(el);
  }
  el.show(message, opts);
}
