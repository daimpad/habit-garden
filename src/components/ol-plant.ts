// CONTRACT STUB – implemented in AP6.
// <ol-plant stage="0..4" flower="bellis" tint="#7FA36F" size="32|120" streak="12"></ol-plant>
// role="img", aria-label = fmt(t.habitPlantAria, { stage: stageName, n: streak }).
// Changing `stage` re-renders the SVG (no animation by itself).

export class OlPlant extends HTMLElement {
  static observedAttributes = ['stage', 'flower', 'tint', 'size', 'streak'];
  connectedCallback(): void {}
  attributeChangedCallback(): void {}

  /** Growth animation of .ol-plant__grow: scale .55 → 1.08 → 1, 400 ms, --ease-grow, origin 80px 141px. No-op under reduced motion. */
  grow(): Promise<void> {
    return Promise.resolve();
  }

  /** One wobble (rotate ±4°, two periods, 400 ms) around the pot rim; applied to the wrapper, not the grow group. */
  wobble(): Promise<void> {
    return Promise.resolve();
  }

  /** Sets the stage with a crossfade (B.4: 120 ms; used when the stage drops or under reduced motion). */
  crossfadeTo(stage: number): Promise<void> {
    this.setAttribute('stage', String(stage));
    return Promise.resolve();
  }

  /** Viewport coordinates of the pot's soil (drops) and of the flower head (burst). */
  anchorPoints(): { soil: { x: number; y: number }; head: { x: number; y: number } } {
    const r = this.getBoundingClientRect();
    return { soil: { x: r.left + r.width / 2, y: r.top + r.height * 0.74 }, head: { x: r.left + r.width / 2, y: r.top + r.height * 0.25 } };
  }
}

if (!customElements.get('ol-plant')) customElements.define('ol-plant', OlPlant);
