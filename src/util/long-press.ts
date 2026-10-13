// Long press on list rows (B.4, S16), shared by HEUTE and WISSEN. Rows are the direct children of the
// list that carry data-id.
const LONG_PRESS_MS = 350;
const LONG_PRESS_SLOP = 10;
const LONG_PRESS_CLICK_WINDOW_MS = 1000;

/**
 * Long press (350 ms) on a row of `list` (B.4, S16): cancelled after 10 px of movement; a click within
 * 1 s after a fired long press is swallowed (touch browsers may send none, so the flag expires); the
 * context menu is suppressed while pressing. Presses that start on the checkbox or toggle are ignored.
 */
export function attachLongPress(list: HTMLElement, onLong: (row: HTMLElement) => void): () => void {
  let timer = 0;
  let pointerId = -1;
  let startX = 0;
  let startY = 0;
  let firedAt = Number.NEGATIVE_INFINITY;
  const recentlyFired = (): boolean => performance.now() - firedAt < LONG_PRESS_CLICK_WINDOW_MS;
  const cancel = (): void => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };
  const down = (event: PointerEvent): void => {
    firedAt = Number.NEGATIVE_INFINITY;
    cancel();
    if (!event.isPrimary || event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('ol-checkbox, ol-habit-toggle')) return;
    const row = target.closest<HTMLElement>('[data-id]');
    if (!row || row.parentElement !== list) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    timer = window.setTimeout(() => {
      timer = 0;
      if (!row.isConnected) return;
      firedAt = performance.now();
      onLong(row);
    }, LONG_PRESS_MS);
  };
  const move = (event: PointerEvent): void => {
    if (!timer || event.pointerId !== pointerId) return;
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > LONG_PRESS_SLOP) cancel();
  };
  const click = (event: MouseEvent): void => {
    // Only the pointer's own click is swallowed; a keyboard activation (detail 0) always goes through.
    if (!recentlyFired() || event.detail === 0) return;
    firedAt = Number.NEGATIVE_INFINITY;
    event.preventDefault();
    event.stopPropagation();
  };
  const menu = (event: Event): void => {
    if (timer || recentlyFired()) event.preventDefault();
  };
  list.addEventListener('pointerdown', down);
  list.addEventListener('pointermove', move);
  list.addEventListener('pointerup', cancel);
  list.addEventListener('pointercancel', cancel);
  list.addEventListener('click', click, true);
  list.addEventListener('contextmenu', menu);
  return () => {
    cancel();
    list.removeEventListener('pointerdown', down);
    list.removeEventListener('pointermove', move);
    list.removeEventListener('pointerup', cancel);
    list.removeEventListener('pointercancel', cancel);
    list.removeEventListener('click', click, true);
    list.removeEventListener('contextmenu', menu);
  };
}
