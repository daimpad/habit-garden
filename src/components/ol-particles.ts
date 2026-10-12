// Exactly one <ol-particles> at <body> (main.ts appends it). position: fixed,
// pointer-events: none, aria-hidden. Pool of 24 <span>; Web Animations API;
// no action under reduced motion; clears on visibilitychange (hidden).
// The layer is a manual popover so it can be raised above an open modal <dialog>.
import { motionReduced } from '../util/dom.js';

const POOL_SIZE = 24;
const BURST_DELAY_MS = 320;

type Kind = 'drop' | 'petal' | 'spark' | 'leaf';

interface Slot {
  el: HTMLSpanElement;
  anim: Animation | null;
  started: number;
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

function isWhite(color: string): boolean {
  return /^(?:#f{3}|#f{6}|white)$/iu.test(color.trim());
}

export class OlParticles extends HTMLElement {
  #slots: Slot[] = [];

  #onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.clear();
  };

  connectedCallback(): void {
    this.setAttribute('aria-hidden', 'true');
    if (!this.#slots.length) {
      for (let i = 0; i < POOL_SIZE; i++) {
        const el = document.createElement('span');
        el.className = 'ol-particles__p';
        this.append(el);
        this.#slots.push({ el, anim: null, started: 0 });
      }
    }
    document.addEventListener('visibilitychange', this.#onVisibility);
    this.#raise(true);
  }

  disconnectedCallback(): void {
    document.removeEventListener('visibilitychange', this.#onVisibility);
    this.clear();
  }

  /** 3–5 water drops falling onto (x, y), 520–680 ms, end state scale(1.5,.3), opacity 0. */
  drops(x: number, y: number): void {
    if (!this.#ready()) return;
    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const dx = (i - (count - 1) / 2) * 7 + rand(-2, 2);
      const fall = 30 + rand(0, 8);
      this.#play('drop', x, y, [
        { transform: `translate(${dx}px, ${-fall}px) scale(.7)`, opacity: 0 },
        { transform: `translate(${dx}px, ${-fall * 0.82}px) scale(.85)`, opacity: 1, offset: 0.15, easing: 'cubic-bezier(.55,0,1,.6)' },
        { transform: `translate(${dx}px, 0px) scale(1)`, opacity: 1, offset: 0.82 },
        { transform: `translate(${dx}px, 1px) scale(1.5,.3)`, opacity: 0 },
      ], { duration: rand(520, 680), delay: i * 45 });
    }
  }

  /**
   * 8–12 petals in `color`, 4 star sparks (sun, clip-path), 3 sage leaves radiating from (x, y).
   * Starts 320 ms after the call (B.4), so it can be fired together with ol-plant.grow().
   */
  burst(x: number, y: number, color: string, big = false): void {
    if (!this.#ready()) return;
    const petals = big ? 12 : 8;
    const kinds = this.#mix(petals);
    const reach = big ? 95 : 70;
    const turn = rand(0, Math.PI * 2);
    const white = isWhite(color);
    kinds.forEach((kind, i) => {
      const angle = turn + (i / kinds.length) * Math.PI * 2 + rand(-0.2, 0.2);
      const dist = reach + rand(0, 60);
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist * 0.8 - 30;
      const spin = rand(-270, 270);
      const slot = this.#play(kind, x, y, [
        { transform: 'translate(0px, 0px) scale(.3) rotate(0deg)', opacity: 0 },
        { transform: `translate(${dx * 0.6}px, ${dy * 0.6}px) scale(1) rotate(${spin * 0.5}deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${dx}px, ${dy + 60}px) scale(.8) rotate(${spin}deg)`, opacity: 0 },
      ], { duration: rand(1100, 1600), delay: BURST_DELAY_MS + rand(0, 80), easing: 'cubic-bezier(.2,.7,.3,1)' });
      if (kind === 'petal') {
        slot.el.style.setProperty('--c', color);
        slot.el.classList.toggle('ol-particles__p--white', white);
      } else if (kind === 'leaf') {
        slot.el.classList.toggle('ol-particles__p--leaf-strong', i % 2 === 1);
      }
    });
  }

  /** 4 sparks around (x, y) (focus 3/3, streak milestones 7/30/100; B.4), 500 ms. */
  sparks(x: number, y: number): void {
    if (!this.#ready()) return;
    const turn = rand(-0.3, 0.3);
    for (let i = 0; i < 4; i++) {
      const angle = turn + Math.PI / 4 + (i * Math.PI) / 2;
      const r0 = 10;
      const r1 = rand(20, 26);
      const [cx, cy] = [Math.cos(angle), Math.sin(angle)];
      this.#play('spark', x, y, [
        { transform: `translate(${cx * r0}px, ${cy * r0}px) scale(0) rotate(0deg)`, opacity: 0 },
        { transform: `translate(${cx * r1 * 0.8}px, ${cy * r1 * 0.8}px) scale(1) rotate(45deg)`, opacity: 1, offset: 0.4 },
        { transform: `translate(${cx * r1}px, ${cy * r1}px) scale(.2) rotate(90deg)`, opacity: 0 },
      ], { duration: 500, delay: i * 30, easing: 'cubic-bezier(.2,0,0,1)' });
    }
  }

  /** Stops all running particles. */
  clear(): void {
    for (const slot of this.#slots) {
      slot.anim?.cancel();
      slot.anim = null;
    }
  }

  #ready(): boolean {
    if (!this.isConnected || document.visibilityState === 'hidden' || motionReduced()) return false;
    this.#raise(false);
    return true;
  }

  /** Order of particle kinds around the circle: petals with sparks and leaves spread evenly. */
  #mix(petals: number): Kind[] {
    const total = petals + 4 + 3;
    const kinds: Array<Kind | null> = Array.from({ length: total }, () => null);
    const place = (kind: Kind, n: number, phase: number): void => {
      for (let j = 0; j < n; j++) {
        let k = Math.floor(((j + phase) * total) / n) % total;
        while (kinds[k]) k = (k + 1) % total;
        kinds[k] = kind;
      }
    };
    place('spark', 4, 0.15);
    place('leaf', 3, 0.6);
    return kinds.map((kind) => kind ?? 'petal');
  }

  #take(kind: Kind, x: number, y: number): Slot {
    let slot = this.#slots.find((s) => !s.anim);
    if (!slot) {
      // Pool exhausted: reuse the oldest particle.
      slot = this.#slots.reduce((a, b) => (b.started < a.started ? b : a));
      slot.anim?.cancel();
      slot.anim = null;
    }
    slot.el.className = `ol-particles__p ol-particles__p--${kind}`;
    slot.el.style.setProperty('--x', `${Math.round(x * 10) / 10}px`);
    slot.el.style.setProperty('--y', `${Math.round(y * 10) / 10}px`);
    return slot;
  }

  #play(kind: Kind, x: number, y: number, frames: Keyframe[], options: KeyframeAnimationOptions): Slot {
    const slot = this.#take(kind, x, y);
    const anim = slot.el.animate(frames, options);
    slot.anim = anim;
    slot.started = performance.now();
    const release = (): void => {
      if (slot.anim === anim) slot.anim = null;
    };
    anim.addEventListener('finish', release);
    anim.addEventListener('cancel', release);
    return slot;
  }

  /** Puts the layer into the top layer (above an open modal dialog); falls back to z-index. */
  #raise(initial: boolean): void {
    if (typeof this.showPopover !== 'function') return;
    try {
      if (!this.hasAttribute('popover')) this.setAttribute('popover', 'manual');
      const open = this.matches(':popover-open');
      if (open && (initial || !document.querySelector('dialog:modal'))) return;
      if (open) this.hidePopover();
      this.showPopover();
    } catch {
      // Popover API unavailable: the fixed layer with its z-index is used.
    }
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
