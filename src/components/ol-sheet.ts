// CONTRACT STUB – implemented in AP6.
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

export type Detent = 'half' | 'full';
export type DismissReason = 'action' | 'escape' | 'scrim' | 'drag' | 'history' | 'route';
export interface SheetOptions { title: string; detent?: Detent; history?: 'push' | 'none'; id?: string; headerActions?: boolean }

export class OlSheet extends HTMLElement {
  /** Containers filled by the caller after createSheet(). */
  headerActionsEl!: HTMLElement;
  bodyEl!: HTMLElement;
  footerEl!: HTMLElement;
  connectedCallback(): void {}
  get detent(): Detent {
    return this.getAttribute('detent') === 'full' ? 'full' : 'half';
  }
  set detent(value: Detent) {
    this.setAttribute('detent', value);
  }
  setTitle(title: string): void {
    void title;
  }
  open(): void {}
  close(reason: DismissReason = 'action'): void {
    void reason;
  }
}

if (!customElements.get('ol-sheet')) customElements.define('ol-sheet', OlSheet);

/** Creates a sheet appended to <body> (not yet open). Fill bodyEl/footerEl, then call open(). */
export function createSheet(opts: SheetOptions): OlSheet {
  const el = document.createElement('ol-sheet') as OlSheet;
  void opts;
  document.body.append(el);
  return el;
}
