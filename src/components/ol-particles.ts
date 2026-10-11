// CONTRACT STUB – implemented in AP6.
// Exactly one <ol-particles> at <body> (main.ts appends it). position: fixed,
// pointer-events: none, aria-hidden. Pool of 24 <span>; Web Animations API;
// no action under reduced motion; clears on visibilitychange (hidden).

export class OlParticles extends HTMLElement {
  connectedCallback(): void {}

  /** 3–5 water drops falling onto (x, y), 520–680 ms, end state scale(1.5,.3), opacity 0. */
  drops(x: number, y: number): void {
    void x; void y;
  }

  /** 8–12 petals in `color`, 4 star sparks (sun, clip-path), 3 sage leaves radiating from (x, y). */
  burst(x: number, y: number, color: string, big = false): void {
    void x; void y; void color; void big;
  }

  /** 4 sparks around (x, y) (focus 3/3, streak milestones 7/30/100; B.4). */
  sparks(x: number, y: number): void {
    void x; void y;
  }
}

if (!customElements.get('ol-particles')) customElements.define('ol-particles', OlParticles);

/** The single instance (created on first use if missing). */
export function particles(): OlParticles {
  let el = document.querySelector<OlParticles>('ol-particles');
  if (!el) {
    el = document.createElement('ol-particles') as OlParticles;
    document.body.append(el);
  }
  return el;
}
