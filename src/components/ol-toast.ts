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
//   visible, announced and operable (content outside a modal dialog is inert); in a sheet it sits
//   8 px above the sheet footer, otherwise 16 px above the bottom edge.
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

  connectedCallback(): void {
    this.build();
    this.unsubscribe ??= onModalChange(() => this.rehome());
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
    if (this.parentElement === target) return;
    const hadFocus = this.contains(document.activeElement);
    target.append(this);
    if (!hadFocus) this.holds.delete('focus');
  }

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
    if (event.pointerType === 'mouse') this.hold('hover');
  };

  private readonly onPointerLeave = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') this.release('hover');
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
