// Horizontal swipe on list rows (A.2 P7, A.3 "Ansicht Liste", A.3 Fokus): the row follows the finger,
// a coloured action layer with icon and label is revealed behind it, and releasing past the threshold
// (35 % of the row width, or a quick flick) runs the action for that direction. Vertical scrolling keeps
// working: the gesture only starts once the movement is clearly horizontal (touch-action: pan-y on rows).
// Mouse drags work the same way; every swipe action also has a button or sheet alternative, so the
// gesture is never the only way (keyboard users never need it).
// Reduced motion: the row snaps without the slide animation.
import { HAPTIC, motionReduced, vibrate } from './dom.js';

export type SwipeDirection = 'right' | 'left';

export interface SwipeAction {
  /** Label shown on the revealed layer (and used for aria-hidden decoration only). */
  label: string;
  /** Lucide icon name for the layer. */
  icon: string;
  /** 'done' (primary green) or 'neutral' (sage) background. */
  tone: 'done' | 'neutral';
}

export interface SwipeOptions {
  /** Rows inside `root` that can be swiped (closest match of the pointer target). */
  rowSelector: string;
  /** Action for a direction, or null when that direction does nothing for this row. */
  actionFor: (row: HTMLElement, direction: SwipeDirection) => SwipeAction | null;
  onSwipe: (row: HTMLElement, direction: SwipeDirection) => void;
  /** Builds the layer content (icon + label) for a row; called once per gesture. */
  renderLayer: (layer: HTMLElement, action: SwipeAction, direction: SwipeDirection) => void;
}

const START_SLOP = 10;
const THRESHOLD = 0.35;
const FLICK_SPEED = 0.6; // px per ms
const IGNORE = 'ol-checkbox, ol-habit-toggle, button, ol-button, ol-icon-button, input, textarea, a';

/** Decides the action of a release: past the threshold, or a quick flick of at least 40 px. */
export function swipeOutcome(dx: number, width: number, ms: number): SwipeDirection | null {
  const distance = Math.abs(dx);
  if (width <= 0 || distance < 40) return null;
  const fast = ms > 0 && distance / ms >= FLICK_SPEED;
  if (distance / width < THRESHOLD && !fast) return null;
  return dx > 0 ? 'right' : 'left';
}

export function attachSwipe(root: HTMLElement, opts: SwipeOptions): () => void {
  let row: HTMLElement | null = null;
  let layer: HTMLElement | null = null;
  let pointerId = -1;
  let startX = 0;
  let startY = 0;
  let startT = 0;
  let dx = 0;
  let active = false;
  let armed: SwipeDirection | null = null;

  const reset = (animate: boolean): void => {
    const el = row;
    const ly = layer;
    row = null;
    layer = null;
    active = false;
    armed = null;
    pointerId = -1;
    if (!el) return;
    el.removeAttribute('data-swiping');
    const done = (): void => {
      el.style.removeProperty('transform');
      el.style.removeProperty('transition');
      ly?.remove();
    };
    if (!animate || motionReduced() || typeof el.animate !== 'function') {
      done();
      return;
    }
    el.style.setProperty('transition', 'transform 180ms cubic-bezier(.2,0,0,1)');
    el.style.setProperty('transform', 'translateX(0)');
    window.setTimeout(done, 200);
  };

  const ensureLayer = (direction: SwipeDirection): boolean => {
    if (!row) return false;
    const action = opts.actionFor(row, direction);
    if (!action) return false;
    if (!layer || layer.dataset['direction'] !== direction) {
      layer?.remove();
      layer = document.createElement('div');
      layer.className = 'ol-swipe-layer';
      layer.dataset['direction'] = direction;
      layer.dataset['tone'] = action.tone;
      layer.setAttribute('aria-hidden', 'true');
      opts.renderLayer(layer, action, direction);
      row.parentElement?.insertBefore(layer, row);
      const r = row.getBoundingClientRect();
      const p = row.offsetParent instanceof HTMLElement ? row.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
      layer.style.setProperty('left', `${r.left - p.left}px`);
      layer.style.setProperty('top', `${row.offsetTop}px`);
      layer.style.setProperty('width', `${r.width}px`);
      layer.style.setProperty('height', `${r.height}px`);
    }
    return true;
  };

  const down = (event: PointerEvent): void => {
    if (!event.isPrimary || event.button !== 0 || row) return;
    const target = event.target instanceof Element ? event.target : null;
    const hit = target?.closest<HTMLElement>(opts.rowSelector);
    if (!target || !hit || !root.contains(hit)) return;
    // Controls inside the row keep their own click; the gesture starts on the row body.
    if (target.closest(IGNORE) && !target.closest('.ol-heute__title, .ol-plan__title, .ol-wissen__card')) return;
    row = hit;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startT = performance.now();
    dx = 0;
  };

  const move = (event: PointerEvent): void => {
    if (!row || event.pointerId !== pointerId) return;
    const mx = event.clientX - startX;
    const my = event.clientY - startY;
    if (!active) {
      if (Math.abs(my) > START_SLOP && Math.abs(my) > Math.abs(mx)) {
        reset(false);
        return;
      }
      if (Math.abs(mx) < START_SLOP) return;
      active = true;
      row.setAttribute('data-swiping', '');
      try {
        row.setPointerCapture(pointerId);
      } catch {
        // The pointer may already be gone; the gesture still works with bubbling events.
      }
    }
    const direction: SwipeDirection = mx > 0 ? 'right' : 'left';
    if (!ensureLayer(direction)) {
      dx = 0;
      row.style.setProperty('transform', 'translateX(0)');
      return;
    }
    dx = mx;
    row.style.setProperty('transform', `translateX(${dx}px)`);
    const next = swipeOutcome(dx, row.offsetWidth, Number.POSITIVE_INFINITY);
    if (next !== armed) {
      armed = next;
      layer?.toggleAttribute('data-armed', next !== null);
      if (next) vibrate(HAPTIC.tick);
    }
  };

  const up = (event: PointerEvent): void => {
    if (!row || event.pointerId !== pointerId) return;
    if (!active) {
      reset(false);
      return;
    }
    const el = row;
    const outcome = swipeOutcome(dx, el.offsetWidth, performance.now() - startT);
    const hasAction = outcome !== null && opts.actionFor(el, outcome) !== null;
    // Swallow the click that follows a swipe on the row.
    const swallow = (e: Event): void => {
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 400);
    reset(true);
    if (outcome && hasAction) opts.onSwipe(el, outcome);
  };

  const cancel = (event: PointerEvent): void => {
    if (row && event.pointerId === pointerId) reset(true);
  };

  root.addEventListener('pointerdown', down);
  root.addEventListener('pointermove', move);
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', cancel);
  return () => {
    reset(false);
    root.removeEventListener('pointerdown', down);
    root.removeEventListener('pointermove', move);
    root.removeEventListener('pointerup', up);
    root.removeEventListener('pointercancel', cancel);
  };
}
