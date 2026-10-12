// <ol-plant stage="0..4" flower="bellis" tint="#7FA36F" size="32|120" streak="12" [streak-unit="weeks"] [ground]></ol-plant>
// role="img", aria-label = fmt(t.habitPlantAria, { stage: stageName, n: streak }); with streak-unit="weeks"
// (timesPerWeek habits) the streak is read in weeks (t.habitPlantAriaWeeks).
// `size` is the width in px (height = size · 190/160). `ground` draws the plant without pot, growing
// from a soil mound (meadow; height = size · 152/160). Changing `stage` re-renders the SVG
// (no animation by itself); callers set the new stage first, then call grow()/wobble().
import { GENERIC_TINT, type Stage } from '../model.js';
import { fmt, stageName, t } from '../i18n/de.js';
import { motionReduced, raw, render } from '../util/dom.js';
import { GROUND_VIEW_H, isFlowerId, plant, PLANT_VIEW_H, safeTint } from './flora.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STAGES: readonly Stage[] = [0, 1, 2, 3, 4];
const GROW_MS = 400;
const WOBBLE_MS = 400;
const EASE_GROW = 'cubic-bezier(.2,.9,.3,1.2)';
/** How long the previous drawing stays available for a crossfade after a stage change. */
const PREV_TTL_MS = 1500;
/** y of the soil and of the topmost part per stage, in viewBox units (x is always 80). */
const SOIL_Y = 141;
const TOP_Y: Readonly<Record<Stage, number>> = { 0: 134, 1: 112, 2: 77, 3: 50, 4: 47 };

function settle(anim: Animation): Promise<void> {
  return anim.finished.then(() => undefined, () => undefined);
}

function cssValue(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Crossfade duration (token --duration-crossfade, never zeroed, max 120 ms). */
function crossfadeMs(): number {
  const ms = parseFloat(cssValue('--duration-crossfade', '120'));
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 120) : 120;
}

export class OlPlant extends HTMLElement {
  static observedAttributes = ['stage', 'flower', 'tint', 'size', 'streak', 'streak-unit', 'ground'];

  #key = '';
  #prevGrow: SVGGElement | null = null;
  #prevAt = 0;
  #growAnim: Animation | null = null;
  #wobbleAnim: Animation | null = null;

  connectedCallback(): void {
    this.setAttribute('role', 'img');
    this.#render();
    this.#syncLabel();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue || !this.isConnected) return;
    if (name !== 'streak' && name !== 'streak-unit') this.#render();
    if (name === 'stage' || name === 'streak' || name === 'streak-unit') this.#syncLabel();
  }

  get stage(): Stage {
    return STAGES[Math.trunc(Number(this.getAttribute('stage')))] ?? 0;
  }

  /** Growth animation of .ol-plant__grow: scale .55 → 1.08 → 1, 400 ms, --ease-grow, origin 80px 141px. Crossfade under reduced motion. */
  grow(): Promise<void> {
    if (motionReduced()) return this.#crossfade();
    const grow = this.#part('.ol-plant__grow');
    this.#prevGrow = null;
    if (!grow) return Promise.resolve();
    this.#growAnim?.cancel();
    const anim = grow.animate(
      [{ transform: 'scale(.55)' }, { transform: 'scale(1.08)', offset: 0.7 }, { transform: 'scale(1)' }],
      { duration: GROW_MS, easing: cssValue('--ease-grow', EASE_GROW) },
    );
    this.#growAnim = anim;
    return settle(anim);
  }

  /** One wobble (rotate ±4°, two periods, 400 ms) around the pot rim; applied to the wrapper, not the grow group. */
  wobble(): Promise<void> {
    const target = this.#part('.ol-plant__wobble');
    if (!target) return Promise.resolve();
    this.#wobbleAnim?.cancel();
    const anim = motionReduced()
      ? target.animate([{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }], { duration: crossfadeMs(), easing: 'linear' })
      : target.animate(
        [0, 4, -4, 4, -4, 0].map((deg) => ({ transform: `rotate(${deg}deg)`, easing: 'ease-in-out' })),
        { duration: WOBBLE_MS },
      );
    this.#wobbleAnim = anim;
    return settle(anim);
  }

  /** Sets the stage with a crossfade (B.4: 120 ms; used when the stage drops or under reduced motion). */
  crossfadeTo(stage: number): Promise<void> {
    const next = STAGES[Math.trunc(stage)] ?? 0;
    if (next === this.stage && this.#part('.ol-plant__grow')) return Promise.resolve();
    this.setAttribute('stage', String(next));
    return this.#crossfade();
  }

  /** Viewport coordinates of the pot's soil (drops) and of the flower head or topmost part (burst). */
  anchorPoints(): { soil: { x: number; y: number }; head: { x: number; y: number } } {
    const box = (this.querySelector('svg') ?? this).getBoundingClientRect();
    const x = box.left + box.width / 2;
    const viewH = this.hasAttribute('ground') ? GROUND_VIEW_H : PLANT_VIEW_H;
    return {
      soil: { x, y: box.top + (box.height * SOIL_Y) / viewH },
      head: { x, y: box.top + (box.height * TOP_Y[this.stage]) / viewH },
    };
  }

  #part(selector: string): SVGGElement | null {
    return this.querySelector<SVGGElement>(selector);
  }

  #size(): number {
    const size = Number(this.getAttribute('size'));
    return Number.isFinite(size) && size > 0 ? size : 120;
  }

  #render(): void {
    const attr = this.getAttribute('flower');
    const flower = isFlowerId(attr) ? attr : 'generic';
    const tint = safeTint(this.getAttribute('tint') ?? GENERIC_TINT);
    const stage = this.stage;
    const size = this.#size();
    const ground = this.hasAttribute('ground');
    const key = `${stage}|${flower}|${tint}|${size}|${ground ? 'g' : 'p'}`;
    if (key === this.#key && this.querySelector('svg')) return;
    const oldGrow = this.#part('.ol-plant__grow');
    render(this, raw(plant(stage, flower, tint, size, ground)));
    this.#growAnim = null;
    this.#wobbleAnim = null;
    if (oldGrow && this.#key) {
      this.#prevGrow = oldGrow;
      this.#prevAt = performance.now();
    }
    this.#key = key;
  }

  #syncLabel(): void {
    const streak = Math.max(0, Math.trunc(Number(this.getAttribute('streak')) || 0));
    const stage = stageName(this.stage);
    if (this.getAttribute('streak-unit') === 'weeks') {
      const weeks = streak === 1 ? t.streakWeeksOne : fmt(t.streakWeeks, { n: streak });
      this.setAttribute('aria-label', fmt(t.habitPlantAriaWeeks, { stage, weeks }));
    } else {
      this.setAttribute('aria-label', fmt(t.habitPlantAria, { stage, n: streak }));
    }
  }

  /** Fades the previous drawing (if it was replaced just now) out and the current one in. */
  #crossfade(): Promise<void> {
    const grow = this.#part('.ol-plant__grow');
    const wobble = this.#part('.ol-plant__wobble');
    const prev = this.#prevGrow && performance.now() - this.#prevAt < PREV_TTL_MS ? this.#prevGrow : null;
    this.#prevGrow = null;
    if (!grow || !wobble) return Promise.resolve();
    const ms = crossfadeMs();
    const pending: Array<Promise<void>> = [];
    let ghost: SVGGElement | null = null;
    if (prev) {
      ghost = document.createElementNS(SVG_NS, 'g');
      ghost.setAttribute('class', 'ol-plant__ghost');
      prev.removeAttribute('class');
      ghost.append(prev);
      wobble.after(ghost);
      pending.push(settle(ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'linear', fill: 'forwards' })));
    }
    pending.push(settle(grow.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'linear' })));
    return Promise.all(pending).then(() => {
      ghost?.remove();
    });
  }
}

if (!customElements.get('ol-plant')) customElements.define('ol-plant', OlPlant);
