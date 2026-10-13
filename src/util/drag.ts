// Long-press drag between drop zones (A.2 P5/P6: Kanban columns, Matrix quadrants), pointer events only.
// Contract:
// - attachLongPressDrag(root, opts) listens on `root` for presses on `opts.itemSelector` elements and
//   returns a detach function (removes every listener, cancels a running press or drag, drops the ghost).
// - The press fires after `pressMs` (350 ms, like HEUTE's attachLongPress) unless the pointer moved more
//   than `slop` (10 px) before; presses that start on `ignoreSelector` (buttons other than the card
//   surface, checkboxes, inputs) never start. Touch scrolling keeps working until the press fires:
//   items use `touch-action: manipulation` (CSS); once the drag runs, a non-passive touchmove listener
//   stops the browser from panning.
// - On pick-up: haptic tick, the item gets `is-drag-source`, `root` gets `is-dragging`, and a clone
//   (class `ol-drag-ghost` plus `opts.ghostClass`, aria-hidden) is appended to <body> with position fixed;
//   it follows the pointer through the CSS custom properties --ol-drag-x/--ol-drag-y (CSSOM only, no
//   style attribute in markup). Its start box is --ol-drag-left/--ol-drag-top/--ol-drag-w.
// - The drop zone under the pointer (`targetSelector`, hit-tested on clipped rects with pickTarget) gets
//   `is-drop-target` unless it is the zone the item came from. `axis: 'x'` hit-tests by the horizontal
//   position only (Kanban columns). Near the edges of `autoScroll` (a horizontal scroller) the scroller
//   scrolls by itself; scroll snapping is the consumer's business (e.g. off while `is-dragging`).
// - Release over another zone calls onDrop(item, target, source); release elsewhere, Esc, pointercancel,
//   window blur or a hidden page cancel. onEnd(item, dropped) runs after either. The click that follows a
//   fired press is swallowed (1 s window, keyboard clicks with detail 0 always pass); the context menu is
//   suppressed while pressing.
// - Reduced motion is a CSS concern (the ghost has no lift animation there).
// Pure geometry helpers (intersectRect, pickTarget, edgeSpeed, beyondSlop) are exported for node tests.
import { HAPTIC, vibrate } from './dom.js';

export interface Rect { left: number; top: number; right: number; bottom: number }

export interface LongPressDragOptions {
  /** Draggable elements inside root (closest match of the pointer target). */
  itemSelector: string;
  /** Drop zones inside root. */
  targetSelector: string;
  /** Presses starting inside these never start a drag. */
  ignoreSelector?: string;
  /** 'x': zones are hit by horizontal position only (columns); 'both' (default): by the point. */
  axis?: 'x' | 'both';
  /** Horizontal scroller that auto-scrolls near its edges while dragging. */
  autoScroll?: HTMLElement | null;
  pressMs?: number;
  slop?: number;
  /** Extra class for the ghost (the ghost always has `ol-drag-ghost`). */
  ghostClass?: string;
  /** Return false to refuse a drag for this item (e.g. while a write for it is pending). */
  canStart?: (item: HTMLElement) => boolean;
  onStart?: (item: HTMLElement, source: HTMLElement | null) => void;
  onDrop: (item: HTMLElement, target: HTMLElement, source: HTMLElement | null) => void;
  onEnd?: (item: HTMLElement, dropped: boolean) => void;
}

export const LONG_PRESS_MS = 350;
export const LONG_PRESS_SLOP = 10;
const CLICK_WINDOW_MS = 1000;
const EDGE_ZONE = 48;
const EDGE_MAX_SPEED = 16; // px per frame
const HIT_TOLERANCE = 24;
const DEFAULT_IGNORE = 'ol-icon-button, ol-button, ol-checkbox, ol-habit-toggle, input, textarea, select, a[href]';

/** Intersection of two rects, or null when they do not overlap. */
export function intersectRect(a: Rect, b: Rect): Rect | null {
  const r = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
  return r.right > r.left && r.bottom > r.top ? r : null;
}

/**
 * Index of the zone hit by (x, y), or -1. A zone containing the point wins; otherwise the nearest zone
 * within `tolerance` px (gaps between columns). With axis 'x' only the horizontal position counts.
 * Null entries (zones clipped away) are skipped.
 */
export function pickTarget(rects: readonly (Rect | null)[], x: number, y: number, axis: 'x' | 'both', tolerance = HIT_TOLERANCE): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  rects.forEach((r, i) => {
    if (!r) return;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const dy = axis === 'x' ? 0 : y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return bestDistance <= tolerance ? best : -1;
}

/**
 * Auto-scroll speed for a pointer at `pos` inside [start, end]: negative near start, positive near end,
 * growing linearly to `max` at the edge (and beyond it); 0 in the middle or for a degenerate range.
 */
export function edgeSpeed(pos: number, start: number, end: number, zone = EDGE_ZONE, max = EDGE_MAX_SPEED): number {
  if (end - start <= zone * 2 || zone <= 0) return 0;
  if (pos < start + zone) return -Math.round(max * Math.min(1, (start + zone - pos) / zone));
  if (pos > end - zone) return Math.round(max * Math.min(1, (pos - (end - zone)) / zone));
  return 0;
}

/** True when a press moved too far to still count as a long press. */
export function beyondSlop(dx: number, dy: number, slop = LONG_PRESS_SLOP): boolean {
  return Math.hypot(dx, dy) > slop;
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function viewportRect(): Rect {
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
}

export function attachLongPressDrag(root: HTMLElement, opts: LongPressDragOptions): () => void {
  const pressMs = opts.pressMs ?? LONG_PRESS_MS;
  const slop = opts.slop ?? LONG_PRESS_SLOP;
  const ignore = opts.ignoreSelector ?? DEFAULT_IGNORE;
  const axis = opts.axis ?? 'both';

  let timer = 0;
  let pointerId = -1;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let item: HTMLElement | null = null;
  let source: HTMLElement | null = null;
  let target: HTMLElement | null = null;
  let ghost: HTMLElement | null = null;
  let dragging = false;
  let frame = 0;
  let firedAt = Number.NEGATIVE_INFINITY;

  const recentlyFired = (): boolean => performance.now() - firedAt < CLICK_WINDOW_MS;

  const setTarget = (next: HTMLElement | null): void => {
    const shown = next === source ? null : next;
    if (shown === target) return;
    target?.classList.remove('is-drop-target');
    target = shown;
    target?.classList.add('is-drop-target');
  };

  const hitTest = (): void => {
    const zones = [...root.querySelectorAll<HTMLElement>(opts.targetSelector)].filter((z) => !z.hidden && z.getClientRects().length > 0);
    const view = viewportRect();
    const scroller = opts.autoScroll ?? null;
    const scrollClip = scroller ? intersectRect(rectOf(scroller), view) : null;
    const rects = zones.map((z) => {
      const clipped = intersectRect(rectOf(z), view);
      if (!clipped) return null;
      return scroller && scrollClip && scroller.contains(z) ? intersectRect(clipped, scrollClip) : clipped;
    });
    const index = pickTarget(rects, lastX, lastY, axis);
    setTarget(index >= 0 ? zones[index] ?? null : null);
  };

  const placeGhost = (): void => {
    if (!ghost) return;
    ghost.style.setProperty('--ol-drag-x', `${lastX - startX}px`);
    ghost.style.setProperty('--ol-drag-y', `${lastY - startY}px`);
  };

  const tick = (): void => {
    frame = 0;
    if (!dragging) return;
    const scroller = opts.autoScroll;
    if (scroller && scroller.scrollWidth > scroller.clientWidth) {
      const clip = intersectRect(rectOf(scroller), viewportRect());
      const speed = clip ? edgeSpeed(lastX, clip.left, clip.right) : 0;
      if (speed !== 0) {
        const before = scroller.scrollLeft;
        scroller.scrollLeft = before + speed;
        if (scroller.scrollLeft !== before) hitTest();
      }
    }
    frame = window.requestAnimationFrame(tick);
  };

  const removeWindowListeners = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onCancel);
    document.removeEventListener('visibilitychange', onVisibility);
  };

  /** Ends a press or drag; runs onDrop when `drop` and a foreign zone is targeted. */
  const finish = (drop: boolean): void => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    removeWindowListeners();
    const wasDragging = dragging;
    const el = item;
    const from = source;
    const to = target;
    dragging = false;
    item = null;
    source = null;
    pointerId = -1;
    setTarget(null);
    ghost?.remove();
    ghost = null;
    root.classList.remove('is-dragging');
    if (!wasDragging || !el) return;
    el.classList.remove('is-drag-source');
    const dropped = drop && to !== null && to !== from && el.isConnected && to.isConnected;
    if (dropped) {
      try {
        opts.onDrop(el, to, from);
      } catch (err) {
        console.error(err);
      }
    }
    opts.onEnd?.(el, dropped);
  };

  const lift = (): void => {
    timer = 0;
    const el = item;
    if (!el || !el.isConnected || (opts.canStart && !opts.canStart(el))) {
      finish(false);
      return;
    }
    firedAt = performance.now();
    dragging = true;
    source = el.closest<HTMLElement>(opts.targetSelector);
    const box = el.getBoundingClientRect();
    const clone = el.cloneNode(true);
    if (clone instanceof HTMLElement) {
      clone.removeAttribute('id');
      for (const withId of clone.querySelectorAll('[id]')) withId.removeAttribute('id');
      clone.removeAttribute('style');
      clone.classList.add('ol-drag-ghost');
      if (opts.ghostClass) clone.classList.add(opts.ghostClass);
      clone.setAttribute('aria-hidden', 'true');
      clone.inert = true;
      const tint = getComputedStyle(el).getPropertyValue('--tint').trim();
      if (tint) clone.style.setProperty('--tint', tint);
      clone.style.setProperty('--ol-drag-left', `${box.left}px`);
      clone.style.setProperty('--ol-drag-top', `${box.top}px`);
      clone.style.setProperty('--ol-drag-w', `${box.width}px`);
      ghost = clone;
      document.body.append(clone);
    }
    el.classList.add('is-drag-source');
    root.classList.add('is-dragging');
    window.getSelection()?.removeAllRanges();
    vibrate(HAPTIC.tick);
    placeGhost();
    opts.onStart?.(el, source);
    hitTest();
    frame = window.requestAnimationFrame(tick);
  };

  const onDown = (event: PointerEvent): void => {
    if (item || dragging) return;
    firedAt = Number.NEGATIVE_INFINITY;
    if (!event.isPrimary || event.button !== 0) return;
    const el = event.target instanceof Element ? event.target : null;
    if (!el || el.closest(ignore)) return;
    const found = el.closest<HTMLElement>(opts.itemSelector);
    if (!found || !root.contains(found)) return;
    item = found;
    pointerId = event.pointerId;
    startX = lastX = event.clientX;
    startY = lastY = event.clientY;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onCancel);
    document.addEventListener('visibilitychange', onVisibility);
    timer = window.setTimeout(lift, pressMs);
  };

  function onMove(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    lastX = event.clientX;
    lastY = event.clientY;
    if (!dragging) {
      if (beyondSlop(lastX - startX, lastY - startY, slop)) finish(false);
      return;
    }
    event.preventDefault();
    placeGhost();
    hitTest();
  }

  function onUp(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    lastX = event.clientX;
    lastY = event.clientY;
    if (dragging) hitTest();
    finish(true);
  }

  function onCancel(): void {
    finish(false);
  }

  function onVisibility(): void {
    if (document.hidden) finish(false);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (dragging) {
      event.preventDefault();
      event.stopPropagation();
    }
    finish(false);
  }

  const onTouchMove = (event: TouchEvent): void => {
    if (dragging && event.cancelable) event.preventDefault();
  };

  const onClick = (event: MouseEvent): void => {
    if (!recentlyFired() || event.detail === 0) return;
    firedAt = Number.NEGATIVE_INFINITY;
    event.preventDefault();
    event.stopPropagation();
  };

  const onContextMenu = (event: Event): void => {
    if (timer || dragging || recentlyFired()) event.preventDefault();
  };

  const onDragStart = (event: Event): void => {
    if (item) event.preventDefault();
  };

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('touchmove', onTouchMove, { passive: false });
  root.addEventListener('click', onClick, true);
  root.addEventListener('contextmenu', onContextMenu);
  root.addEventListener('dragstart', onDragStart);
  return () => {
    finish(false);
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('touchmove', onTouchMove);
    root.removeEventListener('click', onClick, true);
    root.removeEventListener('contextmenu', onContextMenu);
    root.removeEventListener('dragstart', onDragStart);
  };
}
