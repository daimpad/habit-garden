// Bottom sheet on a native <dialog> (showModal → focus trap, Esc). Structure rendered by the element:
//   dialog.ol-sheet__dialog > [handle 36×4] [header: h2#id title + optional actions] [body (scrolls)] [footer (sticky, safe area)]
// Detents: half (50 %) and full (92 %); height capped to visualViewport.height (keyboard).
// Drag on the handle/header: down closes from 30 % of the height or velocity > 0.5 px/ms; up → full.
// Esc and scrim tap close. Background scroll locked (body.ol-scroll-locked).
// Opening: translateY(100% → 0) 300 ms, scrim 0 → .35; closing ≤ 200 ms; fade 120 ms under reduced motion.
// Events: ol-open, ol-dismiss (detail: { reason }), ol-detent-change (detail: { detent }).
// History (A.1: Back closes sheets first):
//   history="push" (default): open() pushes a history entry {olSheet: id} with the same URL; a popstate
//   that removes it closes the sheet (reason 'history'); closing by UI pops the entry (history.back()).
//   history="none": the router owns the entry (overlay routes /aufgabe/:id, /gewohnheit/:id).
// After the closing animation the element removes itself from the DOM.
//
// Details of this implementation:
// - Reflected host attributes: detent, open, visible (scrim shown), dragging, dismissing, fit, history.
// - `fit` (SheetOptions.fit): height follows the content, at most the detent height (S27: capture and
//   journal); otherwise the detent sets a fixed height.
// - Initial focus (synchronously inside open(), so iOS opens the keyboard from the tap handler): the
//   first focusable [autofocus] element (or the first focusable inside an [autofocus] host such as
//   ol-input), else the first focusable element in bodyEl, else the first in the sheet, else the dialog.
// - Focus returns to the element focused before open() (or, if that element has gone, to where its
//   own overlay returned focus), unless focus has already moved elsewhere.
// - ol-dismiss is emitted when closing starts (still connected); `closed` resolves after removal.
// - The handle is a pointer-only button (tabindex -1) that toggles half/full: tap equivalent of the drag.
// - Shared overlay helpers (modal stack, scroll lock, focus return) are exported for ol-dialog/ol-toast;
//   the toast moves into the topmost modal so it stays visible and operable above a sheet.
import { t } from '../i18n/de.js';
import { emit, h, motionReduced, render } from '../util/dom.js';

export type Detent = 'half' | 'full';
export type DismissReason = 'action' | 'escape' | 'scrim' | 'drag' | 'history' | 'route';
export interface SheetOptions {
  title: string;
  detent?: Detent;
  history?: 'push' | 'none';
  id?: string;
  headerActions?: boolean;
  /** Height follows the content (max. the detent height), capped by visualViewport. */
  fit?: boolean;
}

// --- Shared overlay helpers -------------------------------------------------------------------------

const modalStack: HTMLDialogElement[] = [];
const modalListeners = new Set<() => void>();

/** Topmost open modal dialog of a sheet or ol-dialog (null when none is open or all are closing). */
export function topModal(): HTMLDialogElement | null {
  for (let i = modalStack.length - 1; i >= 0; i--) {
    const dialog = modalStack[i];
    if (dialog?.isConnected && dialog.open) return dialog;
  }
  return null;
}

/** Called after every change of the modal stack; returns an unsubscribe function. */
export function onModalChange(cb: () => void): () => void {
  modalListeners.add(cb);
  return () => {
    modalListeners.delete(cb);
  };
}

function notifyModalChange(): void {
  for (const cb of [...modalListeners]) {
    try {
      cb();
    } catch (err) {
      console.error(err);
    }
  }
}

export function pushModal(dialog: HTMLDialogElement): void {
  if (!modalStack.includes(dialog)) modalStack.push(dialog);
  notifyModalChange();
}

export function popModal(dialog: HTMLDialogElement): void {
  const i = modalStack.indexOf(dialog);
  if (i < 0) return;
  modalStack.splice(i, 1);
  notifyModalChange();
}

let scrollLocks = 0;

/** Locks background scrolling (counted, so stacked overlays work); returns an idempotent release. */
export function lockScroll(): () => void {
  scrollLocks += 1;
  document.body.classList.add('ol-scroll-locked');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (scrollLocks === 0) document.body.classList.remove('ol-scroll-locked');
  };
}

export interface FocusReturn { el: HTMLElement; owner: HTMLDialogElement | null }

const returnTargets = new WeakMap<HTMLDialogElement, FocusReturn | null>();

/** Records where focus goes back to when an overlay opened now closes. */
export function captureFocusReturn(): FocusReturn | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return null;
  return { el: active, owner: active.closest('dialog') };
}

/** Registers the return target of an overlay dialog (used to resolve chains of stacked overlays). */
export function setFocusReturn(dialog: HTMLDialogElement, target: FocusReturn | null): void {
  returnTargets.set(dialog, target);
}

function resolveFocusReturn(target: FocusReturn | null, depth = 0): HTMLElement | null {
  if (!target || depth > 8) return null;
  if (target.el.isConnected && !target.el.closest('[inert]')) return target.el;
  return target.owner ? resolveFocusReturn(returnTargets.get(target.owner) ?? null, depth + 1) : null;
}

/** True when focus is inside el or nowhere in particular (body). */
export function focusWithinOrLost(el: Element): boolean {
  const active = document.activeElement;
  return !active || active === document.body || el.contains(active);
}

export function restoreFocus(target: FocusReturn | null): void {
  const el = resolveFocusReturn(target);
  if (!el) return;
  try {
    el.focus({ preventScroll: true });
  } catch {
    // Element not focusable any more.
  }
}

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', '[contenteditable=""]', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])',
].join(',');

function isFocusable(el: Element): el is HTMLElement {
  return el instanceof HTMLElement && el.matches(FOCUSABLE) && !el.closest('[hidden],[inert]') && el.getClientRects().length > 0;
}

export function firstFocusable(root: ParentNode): HTMLElement | null {
  for (const el of root.querySelectorAll(FOCUSABLE)) if (isFocusable(el)) return el;
  return null;
}

/** First focusable [autofocus] element; an [autofocus] host (e.g. ol-input) yields its first focusable child. */
export function autofocusTarget(root: ParentNode): HTMLElement | null {
  for (const el of root.querySelectorAll('[autofocus]')) {
    if (isFocusable(el)) return el;
    const inner = firstFocusable(el);
    if (inner) return inner;
  }
  return null;
}

/** Current translateY of an element in px (reads running animations). */
function currentTranslateY(el: Element): number {
  const value = getComputedStyle(el).transform;
  if (!value || value === 'none') return 0;
  try {
    return new DOMMatrixReadOnly(value).m42;
  } catch {
    return 0;
  }
}

// --- History ------------------------------------------------------------------------------------------

let backPending: { done: Promise<void> } | null = null;

/** True when a history state is the entry {olSheet: id} of a sheet or dialog. */
export function isOwnEntry(state: unknown, id: string): boolean {
  return typeof state === 'object' && state !== null && (state as Record<string, unknown>)['olSheet'] === id;
}

/**
 * Resolves once a history.back() started by a closing sheet has landed. Code that pushes history right
 * after closing a sheet (e.g. navigate() to an overlay route) should await it; otherwise the pending
 * back() would undo the new entry.
 */
export function historySettled(): Promise<void> {
  return backPending ? backPending.done : Promise.resolve();
}

/** history.back() and a promise for the resulting popstate (a later push must wait for it). */
export function goBack(): void {
  let resolveDone: () => void = () => undefined;
  const token = { done: new Promise<void>((resolve) => { resolveDone = resolve; }) };
  const finish = (): void => {
    window.removeEventListener('popstate', finish);
    window.clearTimeout(timer);
    if (backPending === token) backPending = null;
    resolveDone();
  };
  const timer = window.setTimeout(finish, 600);
  window.addEventListener('popstate', finish);
  backPending = token;
  history.back();
}

// --- Element ------------------------------------------------------------------------------------------

const EASE_ENTER = 'cubic-bezier(0,0,0,1)';
const EASE_EXIT = 'cubic-bezier(.3,0,1,1)';
const EASE_STANDARD = 'cubic-bezier(.2,0,0,1)';
const OPEN_MS = 300;
const CLOSE_MS = 200;
const CROSSFADE_MS = 120;
const DRAG_SLOP = 6;
const CLOSE_RATIO = 0.3;
const FLICK_VELOCITY = 0.5;
const DETENT_RATIO = 0.1;

interface DragState {
  pointerId: number;
  startY: number;
  height: number;
  active: boolean;
  samples: Array<{ t: number; y: number }>;
  source: HTMLElement;
}

let sheetSeq = 0;

export class OlSheet extends HTMLElement {
  static observedAttributes = ['detent'];

  /** Containers filled by the caller after createSheet(). */
  headerActionsEl!: HTMLElement;
  bodyEl!: HTMLElement;
  footerEl!: HTMLElement;

  /** Resolves with the dismiss reason after the sheet has closed and removed itself. */
  readonly closed: Promise<DismissReason>;

  private resolveClosed: (reason: DismissReason) => void = () => undefined;
  private dialogEl: HTMLDialogElement | null = null;
  private titleEl: HTMLElement | null = null;
  private gripEl: HTMLButtonElement | null = null;
  private headerEl: HTMLElement | null = null;
  private sheetId = '';
  private pendingTitle = '';
  private phase: 'idle' | 'open' | 'closing' | 'closed' = 'idle';
  private reason: DismissReason = 'action';
  private hasEntry = false;
  private unlock: (() => void) | null = null;
  private focusReturn: FocusReturn | null = null;
  private cleanups: Array<() => void> = [];
  private anim: Animation | null = null;
  private drag: DragState | null = null;
  private suppressClick = false;
  private downOnScrim = false;

  constructor() {
    super();
    this.closed = new Promise<DismissReason>((resolve) => {
      this.resolveClosed = resolve;
    });
  }

  connectedCallback(): void {
    this.build();
  }

  /** Removed from outside while open: release scroll lock, modal stack and listeners. */
  disconnectedCallback(): void {
    if (this.phase !== 'open' && this.phase !== 'closing') return;
    if (this.phase === 'open') this.beginClose('action');
    this.phase = 'closed';
    this.runCleanups();
    if (this.dialogEl) popModal(this.dialogEl);
    this.unlock?.();
    this.unlock = null;
    this.anim?.cancel();
    this.anim = null;
    this.resolveClosed(this.reason);
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (name !== 'detent' || oldValue === newValue) return;
    this.syncGrip();
    if (this.phase === 'open' && (oldValue === 'full') !== (newValue === 'full')) {
      emit(this, 'ol-detent-change', { detent: this.detent });
    }
  }

  get detent(): Detent {
    return this.getAttribute('detent') === 'full' ? 'full' : 'half';
  }

  set detent(value: Detent) {
    this.setAttribute('detent', value);
  }

  /** Stable id of this sheet (history entry {olSheet: id}, title id). */
  get sheetKey(): string {
    this.ensureId();
    return this.sheetId;
  }

  setTitle(title: string): void {
    this.pendingTitle = title;
    if (this.titleEl) this.titleEl.textContent = title;
  }

  open(): void {
    this.build();
    const dialog = this.dialogEl;
    if (!dialog || this.phase !== 'idle' || !this.isConnected) return;
    this.phase = 'open';
    this.focusReturn = captureFocusReturn();
    setFocusReturn(dialog, this.focusReturn);
    this.watchViewport();
    dialog.showModal();
    pushModal(dialog);
    this.unlock = lockScroll();
    this.setAttribute('open', '');
    this.focusInitial();
    this.animateIn();
    if (this.getAttribute('history') !== 'none') this.pushEntry();
    emit(this, 'ol-open');
  }

  close(reason: DismissReason = 'action'): void {
    if (this.phase === 'idle') {
      this.phase = 'closed';
      this.reason = reason;
      this.remove();
      this.resolveClosed(reason);
      return;
    }
    if (this.phase !== 'open') return;
    this.beginClose(reason);
    this.animateOut().then(() => this.finish(), () => this.finish());
  }

  // --- Building ---

  private ensureId(): void {
    if (!this.sheetId) {
      sheetSeq += 1;
      this.sheetId = this.dataset['sheetId'] || `sheet-${sheetSeq}`;
    }
  }

  private build(): void {
    if (this.dialogEl) return;
    this.ensureId();
    const titleId = `ol-sheet-${this.sheetId}-title`;
    render(
      this,
      h`<dialog class="ol-sheet__dialog" tabindex="-1" aria-labelledby="${titleId}">
  <button type="button" class="ol-sheet__grip" tabindex="-1"><span class="ol-sheet__handle"></span></button>
  <header class="ol-sheet__header">
    <h2 class="ol-sheet__title ol-title" id="${titleId}"></h2>
    <div class="ol-sheet__actions"></div>
  </header>
  <div class="ol-sheet__body"></div>
  <div class="ol-sheet__footer"></div>
</dialog>`,
    );
    const dialog = this.querySelector<HTMLDialogElement>(':scope > dialog.ol-sheet__dialog');
    if (!dialog) return;
    this.dialogEl = dialog;
    this.gripEl = dialog.querySelector<HTMLButtonElement>('.ol-sheet__grip');
    this.headerEl = dialog.querySelector<HTMLElement>('.ol-sheet__header');
    this.titleEl = dialog.querySelector<HTMLElement>('.ol-sheet__title');
    this.headerActionsEl = dialog.querySelector<HTMLElement>('.ol-sheet__actions') ?? dialog;
    this.bodyEl = dialog.querySelector<HTMLElement>('.ol-sheet__body') ?? dialog;
    this.footerEl = dialog.querySelector<HTMLElement>('.ol-sheet__footer') ?? dialog;
    if (this.titleEl) this.titleEl.textContent = this.pendingTitle;
    this.syncGrip();

    dialog.addEventListener('cancel', this.onCancel);
    dialog.addEventListener('close', this.onNativeClose);
    dialog.addEventListener('pointerdown', this.onDialogPointerDown);
    dialog.addEventListener('click', this.onDialogClick);
    dialog.addEventListener('click', this.onClickCapture, true);
    // A drag starts on the handle or header; its moves and the release are followed on window, so a
    // fast mouse that leaves the zone before the slop is passed (no implicit capture) still drags.
    for (const zone of [this.gripEl, this.headerEl]) {
      if (!zone) continue;
      zone.addEventListener('pointerdown', this.onDragStart);
      zone.addEventListener('lostpointercapture', this.onLostCapture);
    }
    this.gripEl?.addEventListener('click', this.onGripClick);
  }

  private syncGrip(): void {
    this.gripEl?.setAttribute('aria-label', this.detent === 'full' ? t.sheetCollapse : t.sheetExpand);
  }

  // --- Opening ---

  private focusInitial(): void {
    const dialog = this.dialogEl;
    if (!dialog) return;
    const target = autofocusTarget(dialog) ?? firstFocusable(this.bodyEl) ?? firstFocusable(this.headerEl ?? dialog)
      ?? firstFocusable(this.footerEl) ?? dialog;
    target.focus({ preventScroll: true });
  }

  private animateIn(): void {
    const dialog = this.dialogEl;
    if (!dialog) return;
    // Resolve the hidden scrim first so the transition to [visible] runs.
    void getComputedStyle(dialog, '::backdrop').opacity;
    this.setAttribute('visible', '');
    this.anim = motionReduced()
      ? dialog.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CROSSFADE_MS, easing: 'linear' })
      : dialog.animate([{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: OPEN_MS, easing: EASE_ENTER });
  }

  private watchViewport(): void {
    const vv = window.visualViewport;
    const dialog = this.dialogEl;
    if (!vv || !dialog) return;
    const sync = (): void => {
      // Ignore pinch zoom; follow the on-screen keyboard (iOS/Android resize the visual viewport only).
      if (Math.abs(vv.scale - 1) > 0.01) {
        dialog.style.removeProperty('--ol-vvh');
        dialog.style.removeProperty('--ol-kb');
        return;
      }
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      dialog.style.setProperty('--ol-vvh', `${Math.round(vv.height)}px`);
      dialog.style.setProperty('--ol-kb', `${Math.round(kb)}px`);
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    this.cleanups.push(() => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    });
  }

  private pushEntry(): void {
    const push = (): void => {
      if (this.phase !== 'open') return;
      const prev: unknown = history.state;
      const base = typeof prev === 'object' && prev !== null ? prev : {};
      history.pushState({ ...base, olSheet: this.sheetId }, '');
      this.hasEntry = true;
      const onPop = (event: PopStateEvent): void => {
        if (isOwnEntry(event.state, this.sheetId)) return;
        this.hasEntry = false;
        this.close('history');
      };
      window.addEventListener('popstate', onPop);
      this.cleanups.push(() => window.removeEventListener('popstate', onPop));
    };
    // A sheet closed just before still waits for its history.back(); push after that popstate.
    if (backPending) void backPending.done.then(push);
    else push();
  }

  // --- Closing ---

  private beginClose(reason: DismissReason): void {
    const dialog = this.dialogEl;
    this.phase = 'closing';
    this.reason = reason;
    this.endDrag();
    this.removeAttribute('dragging');
    this.setAttribute('dismissing', '');
    this.removeAttribute('visible');
    if (dialog) {
      dialog.dataset['closing'] = '';
      // Leave the modal stack right away so a toast shown now is not placed in a fading sheet.
      popModal(dialog);
    }
    this.runCleanups();
    if (this.hasEntry) {
      this.hasEntry = false;
      if (reason !== 'history') {
        // A dialog closed just before may still be going back from its own entry to this one.
        const id = this.sheetId;
        const pop = (): void => {
          if (isOwnEntry(history.state, id)) goBack();
        };
        if (backPending) void backPending.done.then(pop);
        else pop();
      }
    }
    emit(this, 'ol-dismiss', { reason });
  }

  private animateOut(dragOffset?: number, velocity?: number): Promise<void> {
    const dialog = this.dialogEl;
    if (!dialog) return Promise.resolve();
    const reduced = motionReduced();
    const fromY = dragOffset ?? currentTranslateY(dialog);
    const fromOpacity = Number(getComputedStyle(dialog).opacity) || 1;
    this.anim?.cancel();
    dialog.style.removeProperty('transform');
    let anim: Animation;
    if (reduced) {
      anim = dialog.animate([{ opacity: fromOpacity }, { opacity: 0 }], { duration: CROSSFADE_MS, easing: 'linear', fill: 'forwards' });
    } else {
      const height = dialog.getBoundingClientRect().height || window.innerHeight;
      const remaining = Math.max(0, height - fromY);
      // The exit follows the drag velocity (B.4), never longer than 200 ms.
      const duration = velocity && velocity > 0 ? Math.min(CLOSE_MS, Math.max(80, remaining / velocity)) : CLOSE_MS;
      anim = dialog.animate(
        [{ transform: `translateY(${fromY}px)` }, { transform: 'translateY(100%)' }],
        { duration, easing: velocity ? 'linear' : EASE_EXIT, fill: 'forwards' },
      );
    }
    this.anim = anim;
    return anim.finished.then(() => undefined);
  }

  private finish(): void {
    if (this.phase === 'closed') return;
    const dialog = this.dialogEl;
    this.phase = 'closed';
    this.runCleanups();
    let hadFocus = false;
    if (dialog) {
      popModal(dialog);
      hadFocus = focusWithinOrLost(dialog);
      if (dialog.open) dialog.close();
    }
    this.unlock?.();
    this.unlock = null;
    if (hadFocus) restoreFocus(this.focusReturn);
    this.anim?.cancel();
    this.anim = null;
    this.removeAttribute('open');
    this.removeAttribute('dismissing');
    this.remove();
    this.resolveClosed(this.reason);
  }

  private runCleanups(): void {
    const list = this.cleanups;
    this.cleanups = [];
    for (const fn of list) fn();
  }

  // --- Dialog events ---

  private readonly onCancel = (event: Event): void => {
    event.preventDefault();
    if (this.phase === 'open') this.close('escape');
  };

  /** The browser closed the dialog itself (e.g. a repeated close request): clean up without animation. */
  private readonly onNativeClose = (): void => {
    if (this.phase === 'open') this.beginClose('escape');
    if (this.phase === 'closing') this.finish();
  };

  private isOutside(event: MouseEvent): boolean {
    const dialog = this.dialogEl;
    if (!dialog || event.target !== dialog) return false;
    const r = dialog.getBoundingClientRect();
    return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
  }

  private readonly onDialogPointerDown = (event: PointerEvent): void => {
    this.downOnScrim = this.isOutside(event);
  };

  private readonly onDialogClick = (event: MouseEvent): void => {
    const onScrim = this.downOnScrim && this.isOutside(event);
    this.downOnScrim = false;
    if (onScrim && this.phase === 'open') this.close('scrim');
  };

  /** Swallows the click that follows a drag (e.g. on a header action under the finger). */
  private readonly onClickCapture = (event: MouseEvent): void => {
    if (!this.suppressClick) return;
    this.suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  private readonly onGripClick = (): void => {
    if (this.phase !== 'open') return;
    this.detent = this.detent === 'full' ? 'half' : 'full';
  };

  // --- Drag ---

  private readonly onDragStart = (event: PointerEvent): void => {
    if (this.phase !== 'open' || !event.isPrimary || this.drag) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const dialog = this.dialogEl;
    if (!dialog || !(event.currentTarget instanceof HTMLElement)) return;
    if (this.anim && this.anim.playState === 'running') return;
    this.suppressClick = false;
    this.drag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      height: dialog.getBoundingClientRect().height,
      active: false,
      samples: [{ t: event.timeStamp, y: event.clientY }],
      source: event.currentTarget,
    };
    window.addEventListener('pointermove', this.onDragMove);
    window.addEventListener('pointerup', this.onDragEnd);
    window.addEventListener('pointercancel', this.onDragCancel);
  };

  /** Ends tracking of the current pointer (drag finished, cancelled or sheet closing). */
  private endDrag(): void {
    this.drag = null;
    window.removeEventListener('pointermove', this.onDragMove);
    window.removeEventListener('pointerup', this.onDragEnd);
    window.removeEventListener('pointercancel', this.onDragCancel);
  }

  private readonly onDragMove = (event: PointerEvent): void => {
    const drag = this.drag;
    const dialog = this.dialogEl;
    if (!drag || !dialog || event.pointerId !== drag.pointerId) return;
    const dy = event.clientY - drag.startY;
    if (!drag.active) {
      if (Math.abs(dy) < DRAG_SLOP) return;
      drag.active = true;
      // Explicit capture overrides the implicit touch capture of a header button: no click lands on it.
      try {
        drag.source.setPointerCapture(event.pointerId);
      } catch {
        // Pointer already released.
      }
      this.anim?.cancel();
      this.anim = null;
      this.setAttribute('dragging', '');
    }
    event.preventDefault();
    drag.samples.push({ t: event.timeStamp, y: event.clientY });
    if (drag.samples.length > 12) drag.samples.shift();
    if (dy >= 0) {
      dialog.style.removeProperty('height');
      dialog.style.transform = `translateY(${dy}px)`;
    } else {
      dialog.style.removeProperty('transform');
      if (this.detent === 'half') {
        const vvh = window.visualViewport?.height ?? window.innerHeight;
        const max = Math.min(window.innerHeight * 0.92, vvh);
        dialog.style.height = `${Math.min(max, drag.height - dy)}px`;
      }
    }
  };

  private velocity(drag: DragState): number {
    const last = drag.samples[drag.samples.length - 1];
    if (!last) return 0;
    const first = drag.samples.find((s) => last.t - s.t <= 100) ?? last;
    const dt = last.t - first.t;
    return dt > 0 ? (last.y - first.y) / dt : 0;
  }

  private readonly onDragEnd = (event: PointerEvent): void => {
    const drag = this.drag;
    const dialog = this.dialogEl;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.endDrag();
    if (!drag.active || !dialog) return;
    this.suppressClick = true;
    window.setTimeout(() => {
      this.suppressClick = false;
    }, 0);
    const dy = event.clientY - drag.startY;
    const v = this.velocity(drag);
    this.removeAttribute('dragging');
    if (dy > 0 && (dy >= drag.height * CLOSE_RATIO || v > FLICK_VELOCITY)) {
      this.beginClose('drag');
      this.animateOut(dy, Math.max(v, 0)).then(() => this.finish(), () => this.finish());
      return;
    }
    if (dy > 0 && this.detent === 'full' && dy >= drag.height * DETENT_RATIO) this.detent = 'half';
    if (dy < 0 && this.detent === 'half' && (-dy >= drag.height * DETENT_RATIO || v < -FLICK_VELOCITY)) this.detent = 'full';
    // Height transitions from the dragged value to the detent (CSS); the offset snaps back.
    dialog.style.removeProperty('height');
    this.snapBack(Math.max(0, dy));
  };

  private snapBack(fromY: number): void {
    const dialog = this.dialogEl;
    if (!dialog) return;
    dialog.style.removeProperty('transform');
    if (fromY <= 0) return;
    this.anim = dialog.animate(
      [{ transform: `translateY(${fromY}px)` }, { transform: 'translateY(0)' }],
      { duration: motionReduced() ? CROSSFADE_MS : CLOSE_MS, easing: EASE_STANDARD },
    );
  }

  private readonly onDragCancel = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.endDrag();
    if (!drag.active || !this.dialogEl) return;
    this.removeAttribute('dragging');
    this.dialogEl.style.removeProperty('height');
    this.snapBack(Math.max(0, currentTranslateY(this.dialogEl)));
  };

  private readonly onLostCapture = (event: PointerEvent): void => {
    // pointerup already handled it; otherwise treat a lost capture like a cancel. A child losing its
    // implicit touch capture (bubbling here when the zone takes over) is not a cancel.
    const drag = this.drag;
    if (drag && drag.active && event.pointerId === drag.pointerId && event.target === drag.source) this.onDragCancel(event);
  };
}

if (!customElements.get('ol-sheet')) customElements.define('ol-sheet', OlSheet);

/** Topmost open (not closing) sheet, if any. */
export function topSheet(): OlSheet | null {
  const open = [...document.querySelectorAll<OlSheet>('ol-sheet[open]:not([dismissing])')];
  return open[open.length - 1] ?? null;
}

/** Creates a sheet appended to <body> (not yet open). Fill bodyEl/footerEl, then call open(). */
export function createSheet(opts: SheetOptions): OlSheet {
  const el = document.createElement('ol-sheet') as OlSheet;
  if (opts.id) el.dataset['sheetId'] = opts.id;
  el.setAttribute('detent', opts.detent ?? 'half');
  el.setAttribute('history', opts.history ?? 'push');
  if (opts.fit) el.setAttribute('fit', '');
  if (opts.headerActions) el.setAttribute('header-actions', '');
  el.setTitle(opts.title);
  document.body.append(el);
  return el;
}
