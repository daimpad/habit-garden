// Garten-Insel: the HEUTE hero artwork as one SVG string (pure function, no DOM).
// Ported from the approved prototype (island.js, 13.10.2026). Details of this implementation:
// - Colours come from CSS custom properties through short classes (screens.css, section "island";
//   tokens --isl-* in tokens.css, light and dark): i-* fills, k-* strokes, s-* gradient stops. Only area
//   tints, flower glyphs and a few small accents (fruit, blossoms) are literal fills; they keep their
//   colour in both themes like the flora in flora.ts.
// - No style="" and no <style> (CSP style-src 'self'); positions are SVG attributes only. No filters.
// - Every id carries `prefix` (written as ID_MARK below and replaced once at the end), so two islands
//   on one page never share gradients or symbols.
// - Night parts (lit windows, lantern, moonlight on the pond, fireflies, sleeping Keimi) carry .i-night,
//   day-only parts .i-day; CSS shows one or the other (dark theme or the hero's night phase).
// - Places of areas the user does not have become a calm clearing; natural landmarks (pond with stream
//   and waterfall, the big tree) are terrain and always present. Flourish 0–3 adds details per place.
import { flowerBody, safeTint } from './flora.js';
import { t, fmt } from '../i18n/de.js';
import type { FlowerId, Stage } from '../model.js';
import type { Decor, Flourish, PlaceKey } from '../services/island.js';

export const VIEW_W = 600;
export const VIEW_H = 560;

/** Placeholder for the id prefix inside the markup. */
const ID_MARK = '§';

/** A plant in a slot: its stage and whether it was watered today (damp soil). */
export interface IslandPlant { stage: Stage; wet: boolean }

export interface IslandArea {
  lvl: Flourish;
  flower: FlowerId;
  tint: string;
  /** The plants in the slots (max. 6, already chosen). */
  plants: readonly IslandPlant[];
  /** Plants not shown ("+n"). */
  more: number;
}

export interface IslandInput {
  areas: Partial<Record<PlaceKey, IslandArea>>;
  /** Shared flower bed for areas beyond the seven places. */
  extra: IslandArea | null;
  decor: Decor;
  /** Unique id prefix, e.g. "hgi1-". */
  prefix: string;
}

type Pt = readonly [number, number];
interface Drawable { y: number; svg: string }

const f = (v: number): string => String(Math.round(v * 10) / 10);

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function at<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new RangeError(`island: index ${i}`);
  return v;
}

/** Closed (or open) Catmull-Rom spline through points, as cubic Béziers. */
function smooth(pts: readonly Pt[], closed = true, k = 1 / 6): string {
  const n = pts.length;
  const p = (i: number): Pt => at(pts, closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i)));
  const [x0, y0] = p(0);
  let d = `M${f(x0)} ${f(y0)}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [a, b, c, e] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    d += `C${f(b[0] + (c[0] - a[0]) * k)} ${f(b[1] + (c[1] - a[1]) * k)} ${f(c[0] - (e[0] - b[0]) * k)} ${f(c[1] - (e[1] - b[1]) * k)} ${f(c[0])} ${f(c[1])}`;
  }
  return d + (closed ? 'Z' : '');
}

/** #rgb / #rrggbb → #rrggbb. */
function hex6(hex: string): string {
  return hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;
}

/** Mixes a colour with white (k = 0..1). */
function lighten(hex: string, k: number): string {
  const n = parseInt(hex6(hex).slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// ---------------------------------------------------------------------------
// Island shape: a slightly wobbly superellipse seen from above at 3/4.

const CX = 300;
const CY = 262;
const A = 272;
const B = 146;
const EXP = 2 / 2.6;
const PTS: readonly Pt[] = (() => {
  const pts: Pt[] = [];
  const N = 40;
  for (let i = 0; i < N; i++) {
    const th = (2 * Math.PI * i) / N;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const w = 1 + 0.016 * Math.sin(5 * th + 0.7) + 0.01 * Math.sin(11 * th + 2);
    pts.push([CX + A * w * Math.sign(c) * Math.abs(c) ** EXP, CY + B * w * Math.sign(s) * Math.abs(s) ** EXP]);
  }
  return pts;
})();
/** Front rim, left → right. */
const FRONT: readonly Pt[] = PTS.slice(0, 21).reverse();

function rimY(x: number): number {
  for (let i = 0; i < FRONT.length - 1; i++) {
    const [x0, y0] = at(FRONT, i);
    const [x1, y1] = at(FRONT, i + 1);
    if (x >= x0 && x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return CY;
}

function depth(x: number): number {
  const u = (x - 300) / 290;
  return 12 + 116 * Math.max(0, 1 - u * u) ** 1.6;
}

function cliffBottom(): Pt[] {
  const out: Pt[] = [];
  const M = 16;
  for (let i = 0; i <= M; i++) {
    const x = 566 - (532 * i) / M;
    const u = (x - 300) / 290;
    const lump = (i % 2 ? 9 : -4) * Math.max(0, 1 - u * u) ** 0.5;
    out.push([x, rimY(x) + depth(x) + lump]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Definitions: gradients (stop colours via classes) and reusable glyphs.

const ref = (name: string): string => `url(#${ID_MARK}${name})`;
const use = (name: string, attrs = ''): string => `<use href="#${ID_MARK}${name}"${attrs}/>`;

function leaf(x: number, y: number, angle: number, len: number, cls = 'i-leaf'): string {
  const w = len * 0.36;
  return `<path class="${cls}" transform="translate(${f(x)} ${f(y)}) rotate(${angle})" d="M0 0C${f(len * 0.28)} ${f(-w)} ${f(len * 0.74)} ${f(-w * 0.95)} ${f(len)} 0C${f(len * 0.74)} ${f(w * 0.8)} ${f(len * 0.28)} ${f(w * 0.85)} 0 0Z"/>`;
}
const stem = (d: string): string => `<path class="k-stem" d="${d}" stroke-width="1.4" stroke-linecap="round"/>`;

const PLANT_DEFS = [
  // 0 seed in a soil mound
  `<g id="${ID_MARK}p0"><ellipse cy="-1" rx="6.5" ry="2.9" class="i-soil-hi"/><ellipse cy="-2.4" rx="2.7" ry="1.7" fill="#A57B52" transform="rotate(-24 0 -2.4)"/><circle cx="4.5" cy="-7" r="1" fill="#F2C14E"/></g>`,
  // 1 sprout
  `<g id="${ID_MARK}p1">${stem('M0 0Q.8 -4 0 -7')}${leaf(0, -7, -150, 6.5)}${leaf(0, -7, -30, 6.5)}</g>`,
  // 2 leaves
  `<g id="${ID_MARK}p2">${stem('M0 0C1.2 -5 -1 -9 0 -14')}${leaf(0, -3.5, -160, 8, 'i-leaf-lo')}${leaf(0, -6.5, -18, 8.5)}${leaf(0, -10, -152, 7)}${leaf(0, -14, -40, 6)}${leaf(0, -14, -128, 5)}</g>`,
  // 3 bud (the bud itself is "bud", filled with the area tint)
  `<g id="${ID_MARK}p3">${stem('M0 0C1.4 -7 -1.2 -12 0 -18')}${leaf(0, -3.5, -162, 9, 'i-leaf-lo')}${leaf(0, -6.5, -16, 9.5)}${leaf(0, -10.5, -154, 8)}${leaf(0, -14, -26, 7.5)}</g>`,
  // 4 bloom (the head is "f-<flower>")
  `<g id="${ID_MARK}p4">${stem('M0 0C1.5 -7 -1.2 -14 0 -21')}${leaf(0, -3.5, -164, 10, 'i-leaf-lo')}${leaf(0, -6.5, -14, 10.5)}${leaf(0, -11, -152, 9)}${leaf(0, -14.5, -28, 8)}</g>`,
  `<g id="${ID_MARK}bl"><circle r="2.2"/><circle r=".8" fill="#E9A23B"/></g>`,
  `<g id="${ID_MARK}wet"><ellipse rx="6.5" ry="2.4" class="i-wet"/><circle cx="-3" cy="-.4" r=".8" class="i-water-hi"/><circle cx="2.6" cy=".5" r=".6" class="i-water-hi"/></g>`,
  `<g id="${ID_MARK}bud"><path d="M0 -27C3.4 -25 3.8 -20.5 0 -18C-3.8 -20.5 -3.4 -25 0 -27Z"/><path class="i-leaf-lo" d="M-3 -19.6Q0 -16.4 3 -19.6Q0 -18 -3 -19.6Z"/></g>`,
].join('');

type Stop = readonly [offset: number, cls: string, opacity?: number];

function gradient(type: 'radialGradient' | 'linearGradient', name: string, attrs: string, list: readonly Stop[]): string {
  const stops = list.map(([o, c, op]) => `<stop offset="${o}" class="${c}"${op === undefined ? '' : ` stop-opacity="${op}"`}/>`).join('');
  return `<${type} id="${ID_MARK}${name}"${attrs ? ` ${attrs}` : ''}>${stops}</${type}>`;
}

function defs(flowers: ReadonlySet<FlowerId>): string {
  const rad = (name: string, attrs: string, list: readonly Stop[]): string => gradient('radialGradient', name, attrs, list);
  const lin = (name: string, attrs: string, list: readonly Stop[]): string => gradient('linearGradient', name, attrs, list);
  return '<defs>'
    + `<path id="${ID_MARK}top" d="${smooth(PTS)}"/>`
    + rad('g-top', 'cx=".42" cy=".3" r=".78"', [[0, 's-grass-hi'], [0.55, 's-grass'], [1, 's-grass-lo']])
    + lin('g-cliff', 'x2="0" y2="1"', [[0, 's-earth'], [0.45, 's-earth-lo'], [1, 's-rock']])
    + rad('g-water', 'cx=".4" cy=".3" r=".8"', [[0, 's-water-hi'], [0.5, 's-water'], [1, 's-water-lo']])
    + lin('g-wf', 'x2="0" y2="1"', [[0, 's-water-hi'], [0.7, 's-water'], [1, 's-water', 0]])
    + rad('g-fol', 'cx=".36" cy=".28" r=".85"', [[0, 's-fol-hi'], [0.55, 's-fol'], [1, 's-fol-lo']])
    + lin('g-roof', 'x2="0" y2="1"', [[0, 's-roof-hi'], [1, 's-roof']])
    + lin('g-side', '', [[0.45, 's-shadow', 0], [1, 's-shadow', 0.3]])
    + rad('g-sh', '', [[0, 's-shadow', 0.3], [1, 's-shadow', 0]])
    + rad('g-glow', '', [[0, 's-glow', 0.75], [0.45, 's-glow', 0.28], [1, 's-glow', 0]])
    + rad('g-keimi', 'cx=".38" cy=".3" r=".8"', [[0, 's-keimi-hi'], [0.6, 's-keimi'], [1, 's-keimi-lo']])
    + lin('g-cloud', 'x2="0" y2="1"', [[0.4, 's-cloud'], [1, 's-cloud-lo']])
    + PLANT_DEFS
    + [...flowers].map((id) => `<g id="${ID_MARK}f-${id}">${flowerBody(id, 1.6, `${ID_MARK}r-${id}-`)}</g>`).join('')
    + '</defs>';
}

const sh = (cx: number | string, cy: number | string, rx: number | string, ry: number | string): string =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${ref('g-sh')}"/>`;
const glow = (cx: number, cy: number, r: number, cls = 'i-night'): string =>
  `<circle${cls ? ` class="${cls}"` : ''} cx="${f(cx)}" cy="${f(cy)}" r="${r}" fill="${ref('g-glow')}"/>`;
const blob = (cx: number | string, cy: number | string, r: number | string): string =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${ref('g-fol')}"/>`;

// ---------------------------------------------------------------------------
// Island body: clouds, cliff, grass lip, top.

function cloud(x: number, y: number, s: number, flip = false): string {
  // One opaque shape in a group with opacity, so overlapping circles show no seams at night.
  const c: ReadonlyArray<readonly [number, number, number]> = [[-30, 2, 16], [-12, -8, 20], [10, -12, 22], [32, -2, 17], [44, 6, 11], [-42, 8, 10]];
  const k = flip ? -1 : 1;
  const circles = c.map(([cx, cy, r]) => `<circle cx="${f(x + cx * s * k)}" cy="${f(y + cy * s)}" r="${f(r * s)}"/>`).join('');
  return `<g class="i-cloudset"><g fill="${ref('g-cloud')}">${circles}<rect x="${f(x - 44 * s)}" y="${f(y)}" width="${f(90 * s)}" height="${f(16 * s)}" rx="${f(8 * s)}"/></g></g>`;
}

function floatRock(x: number, y: number, w: number): string {
  const h = w * 0.9;
  return `<path fill="${ref('g-cliff')}" d="M${f(x - w)} ${y}C${f(x - w)} ${f(y + h * 0.5)} ${f(x - w * 0.2)} ${f(y + h)} ${x} ${f(y + h)}C${f(x + w * 0.3)} ${f(y + h * 0.9)} ${f(x + w)} ${f(y + h * 0.4)} ${f(x + w)} ${y}Z"/>`
    + `<ellipse class="i-lip" cx="${x}" cy="${f(y + 1.5)}" rx="${w}" ry="${f(w * 0.36)}"/><ellipse class="i-grass" cx="${x}" cy="${y}" rx="${w}" ry="${f(w * 0.34)}"/>`;
}

function body(): string {
  const bottom = cliffBottom();
  const cliff = smooth([...FRONT, ...bottom]);
  const band: Pt[] = [];
  for (let i = 0; i <= 14; i++) {
    const x = 40 + (520 * i) / 14;
    band.push([x, rimY(x) + depth(x) * 0.48 + (i % 2 ? 3 : -2)]);
  }
  const rock = smooth([...band, ...bottom.slice(1, -1)]);
  const strata = (k: number, off: number): string => smooth(Array.from({ length: 12 }, (_, i): Pt => {
    const x = 50 + (500 * i) / 11;
    return [x, rimY(x) + depth(x) * k + off + Math.sin(i * 1.7) * 2];
  }), false);
  let s = '<g class="i-body">';
  s += `<path d="${cliff}" fill="${ref('g-cliff')}"/>`;
  s += `<path class="i-rock" d="${rock}" opacity=".55"/>`;
  s += `<path class="k-earth-lo" d="${strata(0.24, 6)}" stroke-width="3" opacity=".45" stroke-linecap="round"/>`;
  s += `<path class="k-earth-lo" d="${strata(0.62, 0)}" stroke-width="2" opacity=".35" stroke-linecap="round"/>`;
  // Light from the upper left: the right part of the cliff falls into shade.
  s += `<path d="${cliff}" fill="${ref('g-side')}"/>`;
  const pebbles: ReadonlyArray<readonly [number, number, number]> = [[150, 30, 5], [262, 52, 4], [356, 30, 6], [430, 58, 4], [318, 86, 5], [212, 74, 3.5], [500, 34, 4]];
  s += pebbles.map(([x, dy, r]) => `<ellipse class="i-stone-lo" cx="${x}" cy="${f(rimY(x) + dy)}" rx="${r}" ry="${f(r * 0.7)}" opacity=".7"/>`).join('');
  const roots: ReadonlyArray<readonly [number, number]> = [[118, 26], [244, 34], [372, 30], [470, 22], [330, 40]];
  s += `<path class="k-root" stroke-width="1.6" stroke-linecap="round" d="${roots.map(([x, l]) => `M${x} ${f(rimY(x) + 8)}c-2 ${f(l * 0.4)} 3 ${f(l * 0.6)} 0 ${l}`).join('')}"/>`;
  s += '</g>';
  // Grass lip (the top shape shifted down), hanging tufts, then the top surface.
  s += use('top', ' class="i-lip" transform="translate(0 11)"');
  s += `<path class="i-lip" d="${[70, 108, 160, 228, 276, 340, 398, 452, 506, 540].map((x) => `M${x - 5} ${f(rimY(x) + 9)}q2 7 5 9q2-5 5-9z`).join('')}"/>`;
  s += use('top', ` fill="${ref('g-top')}"`);
  return s;
}

function vines(): string {
  // Flowering vines hanging from the lip (lush only).
  const list: ReadonlyArray<readonly [number, number]> = [[132, 34], [372, 46], [468, 28], [258, 22]];
  return list.map(([x, l]) => {
    const y = rimY(x) + 8;
    const dots = [0.3, 0.55, 0.8, 1].map((k, i) => `<circle cx="${f(x + (i % 2 ? 2.5 : -2.5))}" cy="${f(y + l * k)}" r="${i === 3 ? 2.4 : 2.8}" class="${i % 2 ? 'i-leaf' : 'i-leaf-lo'}"/>`).join('');
    return `<path class="k-leaf" d="M${x} ${f(y)}c-3 ${f(l * 0.3)} 3 ${f(l * 0.6)} 0 ${l}" stroke-width="1.4"/>${dots}<circle cx="${f(x + 2.5)}" cy="${f(y + l * 0.55)}" r="1.8" fill="#F4C6CF"/><circle cx="${f(x - 2.5)}" cy="${f(y + l * 0.8)}" r="1.6" fill="#fff"/>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Ground layer: grass texture, wild flowers, pond, stream, paths, beds.

/** Rough keep-out boxes for scattered decoration (places, paths, Keimi). */
const KEEP_OUT: ReadonlyArray<readonly [number, number, number, number]> = [
  [236, 100, 380, 240], [92, 150, 200, 246], [392, 80, 560, 262], [36, 248, 180, 322],
  [456, 230, 580, 330], [404, 330, 500, 392], [56, 300, 168, 386], [264, 214, 356, 410],
  [160, 290, 222, 410], [300, 290, 470, 320], [310, 320, 380, 392], [206, 344, 280, 396],
];

function insideTop(x: number, y: number, m = 18): boolean {
  const u = Math.abs(x - CX) / (A - m);
  const v = Math.abs(y - CY) / (B - m * 0.6);
  return u ** 2.6 + v ** 2.6 < 1;
}

const isFree = (x: number, y: number): boolean =>
  insideTop(x, y) && !KEEP_OUT.some(([x0, y0, x1, y1]) => x > x0 && x < x1 && y > y0 && y < y1);

function scatter(seed: number, count: number): Array<[number, number, number]> {
  const r = rng(seed);
  const out: Array<[number, number, number]> = [];
  let guard = 0;
  while (out.length < count && guard++ < 4000) {
    const x = CX + (r() * 2 - 1) * A;
    const y = CY + (r() * 2 - 1) * B;
    if (isFree(x, y)) out.push([x, y, r()]);
  }
  return out;
}

const WILD_COLORS = ['#FFFFFF', '#F4C6CF', '#F2C14E', '#C9B6E4', '#FFFFFF', '#F6B48C'];
const WILD_COUNT: Readonly<Record<Decor, number>> = { low: 0, mid: 14, lush: 30 };

function groundDecor(decor: Decor): string {
  let s = '<ellipse class="i-grass-hi" cx="214" cy="200" rx="60" ry="20" opacity=".5"/><ellipse class="i-grass-hi" cx="388" cy="256" rx="54" ry="16" opacity=".45"/><ellipse class="i-grass-hi" cx="250" cy="352" rx="40" ry="12" opacity=".4"/>';
  s += `<path class="k-grass-lo" stroke-width="1.5" stroke-linecap="round" d="${scatter(7, 30).map(([x, y]) => `M${f(x - 3)} ${f(y)}l1.5-4M${f(x)} ${f(y)}v-5M${f(x + 3)} ${f(y)}l-1.5-4`).join('')}"/>`;
  s += scatter(21, WILD_COUNT[decor]).map(([x, y, q]) => {
    const c = WILD_COLORS[Math.floor(q * WILD_COLORS.length)] ?? '#FFFFFF';
    return blossom(x, y, c);
  }).join('');
  return s;
}

/** A small blossom (white, pink, …) with a yellow centre. */
function blossom(x: number, y: number, color: string): string {
  return use('bl', ` x="${f(x)}" y="${f(y)}" fill="${color}"`);
}

function lilyPad(x: number, y: number, r: number): string {
  const ry = r * 0.5;
  return `<path class="i-pad" d="M${x} ${y}L${f(x + r * 0.97)} ${f(y - ry * 0.25)}A${r} ${f(ry)} 0 1 0 ${f(x + r * 0.97)} ${f(y + ry * 0.25)}Z"/>`;
}

/** Small blossoms on an ellipse around a place (flourish 3). */
function bloomRing(cx: number, cy: number, rx: number, ry: number, tint: string, seed: number): string {
  const r = rng(seed);
  const colors = [lighten(tint, 0.45), '#FFFFFF', '#F2C14E', '#F4C6CF'];
  let s = '';
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.05 + (0.9 * i) / 8) + (r() - 0.5) * 0.2;
    const x = cx - rx * Math.cos(a);
    const y = cy + ry * Math.sin(a) * (i % 2 ? 1 : -0.4);
    s += blossom(x, y, colors[i % colors.length] ?? '#FFFFFF');
  }
  return s;
}

const POND = { cx: 106, cy: 282, rx: 54, ry: 25 } as const;

function pond(area: IslandArea | undefined): string {
  const lvl = area?.lvl ?? 0;
  const { cx, cy, rx, ry } = POND;
  const on = (deg: number, k = 1): Pt => [cx + rx * k * Math.cos((deg * Math.PI) / 180), cy + ry * k * Math.sin((deg * Math.PI) / 180)];
  let s = `<ellipse class="i-bank" cx="${cx}" cy="${cy + 3}" rx="${rx + 7}" ry="${ry + 5}"/>`;
  s += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${ref('g-water')}"/>`;
  s += `<path class="k-water-hi" d="M${cx - 36} ${cy - 5}q14-7 30-7M${cx + 8} ${cy + 11}q12 3 24-2" stroke-width="2" stroke-linecap="round" opacity=".8"/>`;
  s += `<ellipse class="i-night i-moonlight" cx="${cx + 14}" cy="${cy + 4}" rx="16" ry="3"/>`;
  const pads: ReadonlyArray<readonly [number, number, number]> = [[-16, 6, 7], [22, -6, 6], [2, 13, 5.5], [-34, -1, 5]];
  s += pads.slice(0, area ? 2 + Math.min(2, lvl) : 1).map(([x, y, r]) => lilyPad(cx + x, cy + y, r)).join('');
  if (lvl >= 2) s += `<circle cx="${cx - 14}" cy="${cy + 4}" r="2.6" fill="#F4C6CF"/><circle cx="${cx - 14}" cy="${cy + 4}" r="1" fill="#F2C14E"/><circle cx="${cx + 23}" cy="${cy - 7.5}" r="2.2" fill="#FFFFFF"/><circle cx="${cx + 23}" cy="${cy - 7.5}" r=".9" fill="#F2C14E"/>`;
  // Bank stones (gap at the outlet, bottom right).
  const stones = [70, 95, 120, 150, 180, 205, 235, 265, 295, 325, 352, 15].map((d) => on(d, 1.08));
  s += stones.map(([x, y], i) => `<ellipse class="${i % 3 ? 'i-stone' : 'i-stone-lo'}" cx="${f(x)}" cy="${f(y)}" rx="${4 + (i % 3)}" ry="${f(2.6 + (i % 2))}"/>`).join('');
  if (lvl >= 1) {
    // Reeds with cattails.
    const x = cx - rx - 2;
    const y = cy + 6;
    s += `<path class="k-leaf" stroke-width="1.6" stroke-linecap="round" d="M${x} ${y}q-1-12 2-20M${x + 4} ${y + 1}q0-14 4-22M${x - 4} ${y + 2}q-3-9-1-16"/>`;
    s += `<rect x="${x + 0.6}" y="${y - 22}" width="3" height="7" rx="1.5" fill="#8C5A3C"/><rect x="${x + 6.6}" y="${y - 24}" width="3" height="8" rx="1.5" fill="#8C5A3C"/>`;
  }
  if (lvl >= 3 && area) s += bloomRing(cx, cy + 2, rx + 12, ry + 10, area.tint, 3);
  return s;
}

const STREAM_TOP = 'M146 298C160 322 194 330 190 350C187 370 199 386 201 ';

function stream(): string {
  const d = STREAM_TOP + f(rimY(201) - 1);
  return `<path class="k-bank" d="${d}" stroke-width="16" stroke-linecap="round"/>`
    + `<path class="k-water" d="${d}" stroke-width="10" stroke-linecap="round"/>`
    + `<path class="k-water-hi" d="${d}" stroke-width="2" stroke-dasharray="5 9" stroke-linecap="round"/>`;
}

function waterfall(): string {
  const r = rimY(201) - 3;
  let s = `<path fill="${ref('g-wf')}" d="M194 ${f(r)}C192 ${f(r + 30)} 196 ${f(r + 62)} 192 ${f(r + 92)}L214 ${f(r + 92)}C210 ${f(r + 62)} 212 ${f(r + 30)} 209 ${f(r)}Z"/>`;
  s += `<path class="k-water-hi" stroke-width="1.6" stroke-linecap="round" d="M198 ${f(r + 6)}c-1 18 1 34 -1 52M204 ${f(r + 10)}c1 20 -1 40 1 62M208 ${f(r + 4)}c-1 12 1 22 0 30"/>`;
  s += `<ellipse class="i-cloud" cx="201" cy="${f(r + 1)}" rx="9" ry="2.5" opacity=".8"/>`;
  return s;
}

function paths(areas: IslandInput['areas']): string {
  const main = 'M300 218C300 240 272 252 276 274C280 296 330 300 330 326C330 350 342 372 346 404';
  const left = 'M288 304C258 314 238 338 214 346M162 357C150 358 140 356 128 354';
  const right = 'M320 312C360 306 410 300 452 302';
  const d = main + left + right;
  let s = `<path class="k-path-lo" d="${d}" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<path class="k-path" d="${d}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>`;
  // Stepping stones to the bench and the shed, and by the blanket.
  const stones: Array<readonly [number, number]> = [[340, 244], [372, 250], [404, 252], [452, 318], [446, 334]];
  if (areas.work) stones.push([262, 258], [236, 248], [212, 242]);
  s += stones.map(([x, y]) => `<ellipse class="i-path-lo" cx="${x}" cy="${y + 1}" rx="8" ry="4"/><ellipse class="i-path" cx="${x}" cy="${y}" rx="7" ry="3.4"/>`).join('');
  s += '<g class="i-path-lo"><circle cx="292" cy="262" r="1.6"/><circle cx="312" cy="332" r="1.4"/><circle cx="296" cy="384" r="1.6"/><circle cx="342" cy="306" r="1.3"/></g>';
  return s;
}

// ---------------------------------------------------------------------------
// Places. Each returns drawables for depth sorting (by base y).

/** A calm clearing where an area is missing: lighter grass, a faint dashed ring, three flat stones. */
function emptySpot(x: number, y: number, k = 1): Drawable {
  const svg = `<ellipse class="i-grass-hi" cx="${x}" cy="${y}" rx="${f(38 * k)}" ry="${f(14 * k)}" opacity=".8"/>`
    + `<ellipse class="k-path-lo" cx="${x}" cy="${y}" rx="${f(34 * k)}" ry="${f(12 * k)}" stroke-width="1.4" stroke-dasharray="3 5" opacity=".7"/>`
    + `<ellipse class="i-stone" cx="${f(x - 14 * k)}" cy="${f(y + 2)}" rx="5" ry="2.4"/><ellipse class="i-stone" cx="${f(x + 2 * k)}" cy="${f(y - 4)}" rx="4" ry="2"/><ellipse class="i-stone-lo" cx="${f(x + 16 * k)}" cy="${f(y + 3)}" rx="4.5" ry="2.2"/>`;
  return { y: y - 20, svg };
}

function cottage(area: IslandArea | undefined): Drawable[] {
  if (!area) return [emptySpot(300, 200, 1.5)];
  const { lvl, tint } = area;
  let s = sh(316, 214, 78, 14);
  s += '<path class="i-wall-lo" d="M348 214L372 198V150L361 124L348 166Z"/>';
  s += '<rect class="i-wall" x="252" y="166" width="96" height="48"/>';
  s += '<rect class="i-shade" x="252" y="166" width="96" height="10" opacity=".12"/>';
  s += '<rect class="i-stone" x="249" y="207" width="101" height="8" rx="2.5"/>';
  s += `<path fill="${ref('g-roof')}" d="M239 175L359 175L367 120L254 120Z"/>`;
  const rows = [134, 148, 162].map((y) => {
    const l = 239 + ((175 - y) * 15) / 55;
    const r = 359 + ((175 - y) * 8) / 55;
    return `M${f(l + 2)} ${y}H${f(r - 1)}`;
  }).join('');
  s += `<path class="k-roof-lo" d="${rows}" stroke-width="1.6" opacity=".55"/>`;
  s += '<path class="k-roof-lo" d="M359 175L367 120" stroke-width="3" stroke-linecap="round"/>';
  s += '<rect class="i-roof-lo" x="251" y="115" width="119" height="7" rx="3.5"/>';
  s += '<rect class="i-stone" x="326" y="100" width="13" height="30"/><path class="i-stone-lo" d="M339 100l5-3v28l-5 5z"/><rect class="i-roof-lo" x="324" y="96" width="21" height="6" rx="2"/>';
  s += '<path class="k-wood-lo" d="M253.5 176V207M346.5 176V207" stroke-width="3"/>';
  for (const x of [261, 319]) {
    s += `<rect class="i-wood" x="${x}" y="177" width="22" height="20" rx="3"/><rect class="i-win" x="${x + 2.5}" y="179.5" width="17" height="15" rx="1.8"/>`;
    s += `<path class="k-wood" d="M${x + 11} 179.5v15M${x + 2.5} 187h17" stroke-width="1.6"/>`;
    s += `<path class="i-day" d="M${x + 4} 191l6-9h3l-6 9z" fill="#fff" opacity=".45"/>`;
  }
  s += glow(272, 187, 30) + glow(330, 187, 30);
  // Door in the area tint.
  s += `<path fill="${tint}" d="M290 214V197a10 10 0 0 1 20 0V214Z"/><path class="k-wood-lo" d="M290 214V197a10 10 0 0 1 20 0V214" stroke-width="1.6"/>`;
  s += '<circle cx="305.5" cy="206" r="1.3" fill="#F2C14E"/><ellipse class="i-stone" cx="300" cy="217" rx="14" ry="3.6"/>';
  if (lvl >= 1) {
    // Window boxes.
    for (const x of [261, 319]) {
      s += `<rect class="i-wood-lo" x="${x - 1}" y="196" width="24" height="5" rx="1.5"/>`;
      s += `<g class="i-fol"><circle cx="${x + 4}" cy="195.5" r="3"/><circle cx="${x + 11}" cy="195" r="3.2"/><circle cx="${x + 18}" cy="195.5" r="3"/></g>`;
      s += `<circle cx="${x + 4}" cy="194" r="1.7" fill="#F4C6CF"/><circle cx="${x + 11}" cy="193.5" r="1.7" fill="#fff"/><circle cx="${x + 18}" cy="194" r="1.7" fill="#F2C14E"/>`;
    }
  }
  if (lvl >= 2) {
    // Climbing rose on the left corner and chimney smoke.
    s += blob(250, 204, 8) + blob(247, 191, 7) + blob(251, 179, 6) + blob(258, 172, 4.5);
    s += [[247, 200], [252, 188], [246, 184], [254, 176], [250, 207]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2" fill="#E98C8C"/>`).join('');
    s += '<g class="i-smoke i-day"><circle cx="334" cy="86" r="5"/><circle cx="341" cy="72" r="7" opacity=".7"/><circle cx="352" cy="56" r="9" opacity=".45"/></g>';
  }
  if (lvl >= 3) s += bloomRing(300, 222, 70, 6, tint, 11);
  return [{ y: 214, svg: s }];
}

function shed(area: IslandArea | undefined): Drawable[] {
  if (!area) return [{ y: 200, svg: emptySpot(136, 214).svg }];
  const { lvl, tint } = area;
  let s = sh(142, 220, 42, 9);
  s += '<path class="i-wood-lo" d="M156 218L168 209V166L156 182Z"/>';
  s += '<rect class="i-wood" x="110" y="182" width="46" height="36"/>';
  s += '<path class="k-wood-lo" d="M121.5 183V218M133 183V218M144.5 183V218" stroke-width="1" opacity=".5"/>';
  s += '<path class="i-fol-lo" d="M103 187L163 187L174 166L114 162Z"/><path class="k-fol" d="M103 187L163 187" stroke-width="2.4" stroke-linecap="round"/>';
  s += '<rect class="i-win" x="142" y="192" width="9" height="9" rx="1"/>';
  s += glow(146, 196, 18);
  if (lvl >= 1) {
    // Door open: warm interior, the door leaf swung out, a crate.
    s += '<rect x="121" y="194" width="15" height="24" fill="#5A4636"/><rect class="i-lamp" x="121" y="194" width="15" height="24" opacity=".35"/>';
    s += `<path fill="${tint}" d="M121 194L112 197V221L121 218Z"/>`;
    s += '<rect class="i-wood" x="94" y="206" width="13" height="11" rx="1"/><path class="k-wood-lo" d="M94 206l13 11M107 206l-13 11" stroke-width="1"/>';
  } else {
    s += `<rect fill="${tint}" x="121" y="194" width="15" height="24" rx="1"/><circle cx="133" cy="207" r="1" fill="#F2C14E"/>`;
  }
  if (lvl >= 2) {
    // Lamp above the door and a sawhorse with a plank.
    s += '<circle class="i-lamp" cx="128.5" cy="189" r="2.2"/>' + glow(128.5, 189, 16, 'i-lit');
    s += '<path class="k-wood-lo" d="M190 236l-6 -12M190 236l6 -12M214 236l-6 -12M214 236l6 -12" stroke-width="2" stroke-linecap="round"/>';
    s += '<rect class="i-wood" x="180" y="220" width="40" height="5" rx="1.5" transform="rotate(-4 200 222)"/>';
  }
  if (lvl >= 3) s += bloomRing(146, 226, 46, 6, tint, 17);
  return [{ y: 218, svg: s }];
}

function bigTree(area: IslandArea | undefined): Drawable[] {
  const lvl = area?.lvl ?? 0;
  const tint = area?.tint ?? '#C96A5A';
  let tree = sh(472, 232, 50, 11);
  tree += '<path class="i-wood-lo" d="M458 230C462 216 462 200 458 186L475 186C471 200 471 216 476 230C470 233 464 233 458 230Z"/>';
  tree += '<path class="k-wood" d="M463 226C465 212 465 200 463 190" stroke-width="2" opacity=".5"/>';
  tree += blob(452, 120, 28) + blob(488, 124, 27) + blob(430, 166, 30) + blob(505, 164, 30) + blob(467, 150, 42);
  if (area && lvl >= 1) {
    const pts: ReadonlyArray<readonly [number, number]> = [[440, 140], [470, 118], [496, 146], [452, 170], [486, 176], [430, 160], [508, 168], [462, 136], [482, 106], [446, 112], [518, 150], [470, 160]];
    const c = lighten(tint, 0.45);
    tree += pts.slice(0, lvl >= 2 ? 12 : 5).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${c}"/><circle cx="${x}" cy="${y}" r="1" fill="#F2C14E"/>`).join('');
  }
  const out: Drawable[] = [{ y: 228, svg: `<g transform="translate(10 0)">${tree}</g>` }];
  if (!area) return out;
  // Bench in front of the trunk.
  let bench = '<rect class="i-wood" x="442" y="226" width="48" height="6" rx="2"/><path class="k-wood-lo" d="M446 232V236M486 232V236" stroke-width="2.4"/>';
  bench += '<rect class="i-wood" x="439" y="235" width="54" height="6" rx="2"/><rect class="i-wood-lo" x="439" y="239" width="54" height="2.6" rx="1.3"/>';
  bench += '<path class="k-wood-lo" d="M444 241V248M488 241V248" stroke-width="2.6" stroke-linecap="round"/>';
  if (lvl >= 1) bench += `<rect fill="${tint}" x="449" y="230" width="14" height="7" rx="3"/>`;
  if (lvl >= 2) bench += `<rect fill="${lighten(tint, 0.35)}" x="468" y="230" width="14" height="7" rx="3"/><rect x="484" y="231" width="4" height="4" rx="1" fill="#fff"/>`;
  if (lvl >= 3) bench += bloomRing(466, 250, 56, 6, tint, 23);
  out.push({ y: 247, svg: `<g transform="translate(10 0)">${sh(468, 247, 30, 4) + bench}</g>` });
  return out;
}

function well(area: IslandArea | undefined): Drawable[] {
  if (!area) return [emptySpot(506, 292)];
  const { lvl, tint } = area;
  let s = sh(494, 300, 30, 7);
  s += '<rect class="i-wood-lo" x="472" y="254" width="4" height="36" rx="1"/><rect class="i-wood-lo" x="500" y="254" width="4" height="36" rx="1"/>';
  s += '<path class="i-stone" d="M470 280V297a18 6 0 0 0 36 0V280Z"/><path class="k-stone-lo" d="M470 288.5a18 6 0 0 0 36 0M479 285.5v6M495 286v6M487 294v6" stroke-width="1.2" opacity=".7"/>';
  s += '<ellipse class="i-stone-hi" cx="488" cy="280" rx="18" ry="6"/><ellipse class="i-water-lo" cx="488" cy="280.5" rx="13" ry="3.8"/>';
  s += '<rect class="i-wood" x="470" y="259" width="36" height="3" rx="1"/><path class="k-wood-lo" d="M488 262V270" stroke-width="1"/>';
  if (lvl >= 1) s += '<path class="i-wood" d="M483 269h10l-1.5 8h-7z"/>';
  if (lvl >= 2) s += '<rect class="i-water-hi" x="484" y="269" width="8" height="2" rx="1"/>';
  // Gabled roof: front gable (wood) and the two slopes seen from above (area tint).
  s += `<path fill="${tint}" d="M464 258L488 240L496 230L472 248Z"/><path fill="${lighten(tint, 0.35)}" d="M488 240L512 258L520 248L496 230Z"/>`;
  s += '<path class="i-wood-lo" d="M464 258L488 240L512 258Z"/><path class="i-wood" d="M470 256L488 243L506 256Z"/>';
  if (lvl >= 3) s += bloomRing(494, 304, 38, 5, tint, 29);
  // Fruit tree beside the well.
  const k = lvl >= 1 ? 1 : 0.78;
  const tx = 556;
  const ty = 262;
  let tree = sh(tx + 4, ty + 1, f(24 * k), 6);
  tree += `<path class="i-wood-lo" d="M${tx - 3} ${ty}C${tx - 2} ${ty - 10} ${tx - 2} ${f(ty - 18 * k)} ${tx - 4} ${f(ty - 24 * k)}L${tx + 4} ${f(ty - 24 * k)}C${tx + 3} ${f(ty - 18 * k)} ${tx + 3} ${ty - 10} ${tx + 4} ${ty}Z"/>`;
  const cy = ty - 24 * k - 13 * k;
  tree += blob(f(tx - 13 * k), f(cy + 4 * k), f(14 * k)) + blob(f(tx + 13 * k), f(cy + 3 * k), f(14 * k)) + blob(tx, f(cy - 9 * k), f(16 * k)) + blob(tx, f(cy + 6 * k), f(15 * k));
  if (lvl >= 1) {
    const fruit: ReadonlyArray<readonly [number, number]> = [[-12, 2], [10, -8], [2, 8], [-4, -12], [14, 6], [-16, -6], [6, -2], [-6, 10], [16, -2]];
    tree += fruit.slice(0, lvl >= 2 ? 9 : 4).map(([dx, dy]) => `<circle cx="${tx + dx}" cy="${f(cy + dy)}" r="3.1" fill="#E9A23B"/><circle cx="${tx + dx - 1}" cy="${f(cy + dy - 1)}" r="1" fill="#FFE2A6"/>`).join('');
  }
  if (lvl >= 2) tree += `<circle cx="${tx - 14}" cy="${ty + 4}" r="2.8" fill="#E9A23B"/><circle cx="${tx + 15}" cy="${ty + 2}" r="2.8" fill="#D98E3A"/>`;
  return [{ y: 298, svg: s }, { y: ty, svg: tree }];
}

function picnic(area: IslandArea | undefined): Drawable[] {
  if (!area) return [emptySpot(454, 360)];
  const { lvl, tint } = area;
  if (lvl === 0) {
    // Rolled-up blanket, waiting.
    return [{ y: 358, svg: sh(452, 358, 18, 4) + `<rect fill="${tint}" x="438" y="347" width="28" height="10" rx="5"/><path class="k-cream" d="M446 347v10M458 347v10" stroke-width="2" opacity=".7"/><ellipse fill="${lighten(tint, 0.3)}" cx="466" cy="352" rx="3" ry="5"/>` }];
  }
  const P: readonly Pt[] = [[420, 345], [472, 338], [490, 362], [436, 370]];
  const lerp = (p: Pt, q: Pt, k: number): Pt => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  const [p0, p1, p2, p3] = [at(P, 0), at(P, 1), at(P, 2), at(P, 3)];
  let s = sh(456, 360, 40, 12);
  s += `<path fill="${tint}" d="M${P.map((p) => p.join(' ')).join('L')}Z"/>`;
  let checks = '';
  for (const k of [0.33, 0.66]) {
    const a = lerp(p0, p1, k);
    const b = lerp(p3, p2, k);
    const c = lerp(p0, p3, k);
    const d = lerp(p1, p2, k);
    checks += `M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}M${f(c[0])} ${f(c[1])}L${f(d[0])} ${f(d[1])}`;
  }
  s += `<path class="k-cream" d="${checks}" stroke-width="4" opacity=".55"/>`;
  s += '<path class="i-shade" d="M436 370L490 362L489 365L437 373Z" opacity=".18"/>';
  if (lvl >= 2) {
    // Basket, two cups, a plate with fruit.
    s += '<path class="k-wood-lo" d="M462 346a8 8 0 0 1 16 0" stroke-width="1.8"/>';
    s += '<path class="i-wood" d="M459 346h22l-3 9h-16z"/><path class="k-wood-lo" d="M461 349.5h18" stroke-width="1" opacity=".6"/>';
    s += '<ellipse cx="440" cy="356" rx="7" ry="3" fill="#fff"/><circle cx="438" cy="355" r="2.2" fill="#D9534F"/><circle cx="442" cy="356" r="2" fill="#E9A23B"/>';
    s += '<rect x="451" y="350" width="4" height="4.6" rx="1.2" fill="#fff"/><rect x="456" y="359" width="4" height="4.6" rx="1.2" fill="#fff"/>';
  }
  if (lvl >= 3) s += bloomRing(455, 360, 52, 16, tint, 31);
  return [{ y: 362, svg: s }];
}

function nook(area: IslandArea | undefined): Drawable[] {
  if (!area) return [emptySpot(112, 348)];
  const { lvl, tint } = area;
  let s = sh(110, 356, 32, 7);
  // Stump seat.
  s += '<path class="i-wood-lo" d="M115 356V346a10 3.6 0 0 1 20 0V356a10 3.6 0 0 1 -20 0Z"/><ellipse class="i-wood-hi" cx="125" cy="346" rx="10" ry="3.6"/><ellipse class="k-wood" cx="125" cy="346" rx="5.5" ry="1.8" stroke-width="1"/>';
  // Lantern post.
  s += '<rect class="i-wood-lo" x="85" y="310" width="3.4" height="46" rx="1.4"/><path class="k-wood-lo" d="M86.5 313H99" stroke-width="2" stroke-linecap="round"/>';
  const lit = lvl >= 1;
  s += `<path fill="${tint}" d="M93 320L99 314L105 320Z"/><rect class="${lit ? 'i-lamp' : 'i-win'}" x="94.5" y="320" width="9" height="10" rx="1.5"/><rect fill="${tint}" x="93.5" y="329.5" width="11" height="2.6" rx="1"/>`;
  if (lit) {
    s += glow(99, 325, 20, 'i-lit');
    // Book stack.
    s += `<rect fill="${tint}" x="100" y="352" width="15" height="4.4" rx="1"/><rect fill="#9CB59A" x="101.5" y="348" width="12" height="4.2" rx="1"/><rect fill="#D98E73" x="100.5" y="344.4" width="13" height="3.8" rx="1"/>`;
  } else {
    s += glow(99, 325, 16);
  }
  if (lvl >= 2) {
    // Open book on the stump.
    s += '<path fill="#fff" d="M125 345.5l-8 -2.4v-3l8 2.4zM125 345.5l8 -2.4v-3l-8 2.4z"/><path class="k-wood-lo" d="M125 342.5v3" stroke-width=".8"/>';
  }
  if (lvl >= 3) s += bloomRing(110, 360, 40, 6, tint, 37);
  return [{ y: 356, svg: s }];
}

function bridge(): Drawable {
  let s = '<path class="i-wood-lo" d="M163 357Q189 341 216 347L216 352Q190 347 163 362Z"/>';
  s += '<path class="i-wood" d="M163 355Q189 339 216 345L216 349Q190 344 163 359Z"/>';
  s += '<path class="k-wood-lo" d="M172 350.5l1 3.6M181 346.6l.8 3.6M190 344.5l.6 3.5M199 343.8l.4 3.5M208 344.3v3.4" stroke-width="1" opacity=".7"/>';
  s += '<path class="k-wood-lo" d="M165 349Q189 333 214 339M166 349v6M214 339v6M190 337v6" stroke-width="1.8" stroke-linecap="round"/>';
  return { y: 352, svg: s };
}

function bush(x: number, y: number, r: number, flowers: boolean): Drawable {
  let s = sh(x + 3, y + 1, f(r * 1.3), f(r * 0.35)) + blob(f(x - r * 0.55), f(y - r * 0.55), f(r * 0.75)) + blob(f(x + r * 0.55), f(y - r * 0.5), f(r * 0.72)) + blob(x, f(y - r * 0.85), f(r * 0.8));
  if (flowers) s += `<circle cx="${f(x - r * 0.5)}" cy="${f(y - r * 0.9)}" r="1.8" fill="#fff"/><circle cx="${f(x + r * 0.4)}" cy="${f(y - r * 1.2)}" r="1.8" fill="#F4C6CF"/><circle cx="${f(x + r * 0.7)}" cy="${f(y - r * 0.5)}" r="1.6" fill="#fff"/>`;
  return { y, svg: s };
}

const KEIMI_BODY = 'M0 -41C13.5 -41 19.5 -29 19.5 -18.5C19.5 -7 11 -3 0 -3C-11 -3 -19.5 -7 -19.5 -18.5C-19.5 -29 -13.5 -41 0 -41Z';

function keimi(x: number, y: number): Drawable {
  let s = `<g class="i-keimi-root" transform="translate(${x} ${y}) scale(1.3)">`;
  s += `<ellipse rx="16" ry="4.4" fill="${ref('g-sh')}"/>`;
  s += '<ellipse class="i-keimi-lo" cx="-6.5" cy="-2.5" rx="5.4" ry="3.4"/><ellipse class="i-keimi-lo" cx="6.5" cy="-2.5" rx="5.4" ry="3.4"/>';
  s += '<ellipse class="i-keimi k-keimi" cx="-19" cy="-13" rx="3.6" ry="6.5" transform="rotate(24 -19 -13)" stroke-width="1.2"/>';
  s += '<ellipse class="i-keimi k-keimi i-wave" cx="22" cy="-31" rx="3.6" ry="7.5" transform="rotate(34 22 -31)" stroke-width="1.2"/>';
  s += `<path fill="${ref('g-keimi')}" d="${KEIMI_BODY}"/><path class="k-keimi" stroke-width="1.3" d="${KEIMI_BODY}"/>`;
  s += '<ellipse class="i-keimi-hi" cy="-12" rx="10" ry="6.5" opacity=".7"/>';
  s += '<path class="k-stem" d="M0 -40C0 -44 1 -46 0 -49" stroke-width="2" stroke-linecap="round"/>';
  s += '<path class="i-leaf k-keimi" stroke-width="1" d="M0 -47C-4 -55 -12 -58 -18 -53.5C-13 -48 -6 -46 0 -47Z"/><path class="i-leaf k-keimi" stroke-width="1" d="M0 -48C3 -58 12 -62 19 -58C15 -50.5 7 -47.5 0 -48Z"/>';
  s += '<path class="k-leafvein" d="M-1 -47.5Q-9 -51 -15 -53M1 -48.5Q9 -53 16 -57.5" stroke-width=".8"/>';
  s += '<g class="i-day"><circle cx="-6.5" cy="-24" r="2.5" fill="#2B3A2E"/><circle cx="6.5" cy="-24" r="2.5" fill="#2B3A2E"/><circle cx="-5.7" cy="-24.9" r=".9" fill="#fff"/><circle cx="7.3" cy="-24.9" r=".9" fill="#fff"/></g>';
  s += '<path class="i-night" d="M-9.2 -24q2.7 2.4 5.4 0M3.8 -24q2.7 2.4 5.4 0" stroke="#2B3A2E" stroke-width="1.4" fill="none" stroke-linecap="round"/>';
  s += '<ellipse cx="-11.5" cy="-18.5" rx="3.2" ry="1.9" fill="#F2A39A" opacity=".75"/><ellipse cx="11.5" cy="-18.5" rx="3.2" ry="1.9" fill="#F2A39A" opacity=".75"/>';
  s += '<path d="M-3.2 -19.2q3.2 3.2 6.4 0" stroke="#2B3A2E" stroke-width="1.4" fill="none" stroke-linecap="round"/>';
  return { y, svg: `${s}</g>` };
}

// ---------------------------------------------------------------------------
// Plant slots per place (base points in fill order), beds and anchors.

export const SLOTS: Readonly<Record<PlaceKey | 'extra', readonly Pt[]>> = {
  home: [[268, 233], [332, 233], [254, 231], [346, 231], [281, 235], [319, 235]],
  work: [[180, 236], [194, 238], [168, 241], [206, 242], [184, 245], [158, 236]],
  bonds: [[424, 250], [516, 250], [438, 252], [530, 252], [430, 257], [522, 257]],
  health: [[58, 266], [152, 262], [48, 286], [164, 278], [70, 310], [128, 310]],
  wealth: [[472, 314], [490, 318], [508, 315], [480, 325], [499, 326], [520, 322]],
  leisure: [[410, 362], [500, 350], [406, 378], [502, 368], [420, 390], [482, 384]],
  growth: [[146, 340], [150, 360], [72, 342], [136, 374], [112, 380], [60, 356]],
  extra: [[234, 366], [254, 368], [244, 376], [226, 375], [264, 377], [216, 365]],
};

/** Where the "+n" of a place sits (beside its slots). */
const MORE_AT: Readonly<Record<PlaceKey | 'extra', Pt>> = {
  home: [364, 240], work: [222, 250], bonds: [548, 262], health: [106, 249],
  wealth: [538, 332], leisure: [402, 344], growth: [70, 330], extra: [212, 390],
};

const BEDS: Readonly<Partial<Record<PlaceKey | 'extra', string>>> = {
  home: '<rect x="244" y="226" width="46" height="11" rx="5.5"/><rect x="310" y="226" width="46" height="11" rx="5.5"/>',
  work: '<ellipse cx="183" cy="240" rx="30" ry="8.5"/>',
  bonds: '<ellipse cx="431" cy="254" rx="17" ry="6"/><ellipse cx="523" cy="254" rx="17" ry="6"/>',
  wealth: '<ellipse cx="495" cy="320" rx="31" ry="8"/>',
  extra: '<ellipse cx="241" cy="372" rx="32" ry="10"/>',
};

/**
 * Anchors in viewBox units: Keimi's feet and head (speech bubble), the preferred centre of each place's
 * balance pill (Teil 2; the screen moves a pill to the nearest free spot if it would overlap) and of the
 * overall chip.
 */
export const ANCHORS = {
  keimi: [298, 390], keimiHead: [298, 318],
  home: [300, 92], work: [140, 146], bonds: [476, 62], health: [112, 238],
  wealth: [500, 338], leisure: [466, 400], growth: [118, 396], extra: [242, 330], total: [300, 466],
} as const satisfies Record<string, Pt>;

/** Keimi's body (feet to leaf tips) in viewBox units [x, y, width, height]; labels keep clear of it. */
export const KEIMI_BOX: readonly [number, number, number, number] = [270, 312, 58, 82];

/**
 * Tap areas over each place in viewBox units [x, y, width, height] (each side at least 74 units, about
 * 50 px on a 390 px phone); the screen lays transparent buttons over them.
 */
export const HIT_BOXES: Readonly<Record<PlaceKey | 'extra', readonly [number, number, number, number]>> = {
  home: [236, 92, 140, 146],
  work: [88, 152, 134, 86],
  bonds: [418, 92, 128, 162],
  health: [34, 240, 142, 82],
  wealth: [466, 256, 118, 84],
  leisure: [394, 342, 122, 84],
  growth: [50, 324, 112, 84],
  extra: [196, 326, 84, 84],
};

/**
 * Where people stand (feet, viewBox units), Teil 2: five slots from the bench outwards (people in rhythm
 * take them from the bench on, overdue people from the far end, services/island figureSlots); `more` is
 * the "+n" for people beyond PEOPLE_MAX. The slots keep at least 46 units between figures (24 px at
 * 320 px), stay clear of Keimi's bubble and the buildings, and were chosen (by a layout simulation) so
 * that a pill fits next to each figure for up to three people at 320 and 390 px and for five people on
 * wide screens; with five people on a phone the pills usually do not all fit and then stay hidden.
 */
export const PEOPLE_SPOTS: { slots: readonly Pt[]; more: Pt } = {
  slots: [[510, 198], [450, 198], [540, 276], [396, 198], [372, 366]],
  more: [584, 206],
};

/** Mixes a colour with a dark earth tone (k = 0..1). */
function darken(hex: string, k: number): string {
  const n = parseInt(hex6(hex).slice(1), 16);
  const to = [0x3a, 0x2a, 0x1e];
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v + ((to[i] ?? 0) - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const FIG_BODY = 'M16 14.5C23.5 14.5 27.5 21 27.5 27.5C27.5 34 22.5 37 16 37C9.5 37 4.5 34 4.5 27.5C4.5 21 8.5 14.5 16 14.5Z';

/**
 * A person as a small sprout figure (Keimi's family): round body in the person's colour, two leaves, a
 * simple face. In rhythm the leaves stand up and it smiles; overdue the leaves droop and the mouth is
 * level (shape, not only colour). Sleeping eyes at night (.i-night / .i-day like the island). viewBox
 * 0 0 32 40, feet at (16, 38); aria-hidden (the button carries the name).
 */
export function sproutFigure(color: string, state: 'fresh' | 'due'): string {
  const tint = safeTint(color);
  const body = lighten(tint, 0.3);
  const line = darken(tint, 0.45);
  const leaves = state === 'fresh'
    ? '<path class="f-leaf" d="M16 11.5C13 6.5 8.5 5 5 7C7.5 10.5 11.5 12 16 11.5Z"/><path class="f-leaf" d="M16 11C18 5 23 3 27.5 5C25.5 9.5 21 11.5 16 11Z"/>'
    : '<path class="f-leaf" d="M16 12C12 11 8 13 6.5 17C10.5 17 14 15 16 12Z"/><path class="f-leaf" d="M16 12C20 11 24 13 25.5 17C21.5 17 18 15 16 12Z"/>';
  const mouth = state === 'fresh' ? 'M14 28.6q2 2 4 0' : 'M14.3 29.3h3.4';
  return '<svg class="ol-isl__fig-svg" viewBox="0 0 32 40" width="32" height="40" aria-hidden="true" focusable="false">'
    + '<ellipse class="f-sh" cx="16" cy="38.2" rx="10" ry="2"/>'
    + `<g class="f-art"><g class="f-leaves"><path class="f-stem" d="M16 15.5V11.5" stroke-width="1.5" stroke-linecap="round"/>${leaves}</g>`
    + `<ellipse cx="11.5" cy="36.6" rx="3.3" ry="2" fill="${line}"/><ellipse cx="20.5" cy="36.6" rx="3.3" ry="2" fill="${line}"/>`
    + `<path d="${FIG_BODY}" fill="${body}" stroke="${line}" stroke-width=".9"/>`
    + '<ellipse cx="16" cy="31" rx="7" ry="3.8" fill="#FFFFFF" opacity=".28"/>'
    + '<g class="i-day"><circle cx="12.4" cy="25" r="1.6" fill="#2B3A2E"/><circle cx="19.6" cy="25" r="1.6" fill="#2B3A2E"/><circle cx="12.9" cy="24.4" r=".55" fill="#FFFFFF"/><circle cx="20.1" cy="24.4" r=".55" fill="#FFFFFF"/></g>'
    + '<path class="i-night" d="M10.8 25q1.6 1.4 3.2 0M18 25q1.6 1.4 3.2 0" stroke="#2B3A2E" stroke-width="1.1" fill="none" stroke-linecap="round"/>'
    + '<ellipse cx="9.8" cy="28.4" rx="2" ry="1.2" fill="#F2A39A" opacity=".75"/><ellipse cx="22.2" cy="28.4" rx="2" ry="1.2" fill="#F2A39A" opacity=".75"/>'
    + `<path d="${mouth}" stroke="#2B3A2E" stroke-width="1.1" fill="none" stroke-linecap="round"/></g>`
    + '</svg>';
}

function plant(x: number, y: number, { stage, wet }: IslandPlant, flowerId: FlowerId, tint: string): Drawable {
  const head = stage === 4 ? use(`f-${flowerId}`, ' transform="translate(-8.6 -30.6) scale(.72)"') : '';
  const bud = stage === 3 ? use('bud', ` fill="${tint}"`) : '';
  // Watered today: darker, damp soil with a glint of water.
  const soil = wet ? use('wet') : stage > 0 ? '<ellipse rx="5.5" ry="2" class="i-soil"/>' : '';
  return { y, svg: `<g transform="translate(${x} ${y}) scale(1.3)">${soil}${use(`p${stage}`)}${bud}${head}</g>` };
}

function moreLabel(x: number, y: number, n: number): Drawable {
  const text = fmt(t.islandMorePlants, { n });
  const w = 8 + text.length * 6.4;
  // Drawn above every plant (sorted last).
  return {
    y: VIEW_H + y,
    svg: `<g class="i-more"><rect x="${f(x - w / 2)}" y="${y - 9}" width="${f(w)}" height="14" rx="7"/><text x="${x}" y="${y + 1.5}" text-anchor="middle">${text}</text></g>`,
  };
}

function placePlants(key: PlaceKey | 'extra', area: IslandArea): Drawable[] {
  const slots = SLOTS[key];
  const list: readonly IslandPlant[] = area.plants.length > 0 ? area.plants : [{ stage: 0, wet: false }];
  const tint = safeTint(area.tint);
  const out = list.slice(0, slots.length).map((p, i) => {
    const [x, y] = at(slots, i);
    return plant(x, y, p, area.flower, tint);
  });
  if (area.more > 0) {
    const [x, y] = MORE_AT[key];
    out.push(moreLabel(x, y, area.more));
  }
  return out;
}

// ---------------------------------------------------------------------------

/** The island as an SVG string (aria-hidden; the screen adds the accessible parts). */
export function islandSvg(input: IslandInput): string {
  const areas: IslandInput['areas'] = {};
  for (const [key, area] of Object.entries(input.areas) as Array<[PlaceKey, IslandArea | undefined]>) {
    if (area) areas[key] = { ...area, tint: safeTint(area.tint) };
  }
  const extra = input.extra ? { ...input.extra, tint: safeTint(input.extra.tint) } : null;
  const flowers = new Set<FlowerId>();
  for (const a of [...Object.values(areas), extra]) if (a && a.plants.some((p) => p.stage === 4)) flowers.add(a.flower);

  let s = `<svg class="ol-isl__svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">`;
  s += defs(flowers);
  s += cloud(70, 452, 1.1) + cloud(548, 418, 0.9, true) + floatRock(64, 404, 9) + floatRock(548, 458, 7) + floatRock(522, 482, 4);
  s += body();
  if (input.decor === 'lush') s += vines();
  s += groundDecor(input.decor);
  s += pond(areas.health) + stream() + waterfall() + paths(areas);
  for (const [key, shape] of Object.entries(BEDS) as Array<[PlaceKey | 'extra', string]>) {
    if (key === 'extra' ? extra : areas[key]) s += `<g class="i-bed">${shape}</g>`;
  }

  const items: Drawable[] = [
    ...cottage(areas.home), ...shed(areas.work), ...bigTree(areas.bonds), ...well(areas.wealth),
    ...picnic(areas.leisure), ...nook(areas.growth), bridge(),
    bush(64, 216, 16, input.decor === 'lush'), bush(216, 172, 11, input.decor === 'lush'), bush(246, 400, 10, input.decor !== 'low'),
    bush(560, 304, 12, input.decor === 'lush'), bush(388, 398, 9, false),
  ];
  for (const [key, area] of Object.entries(areas) as Array<[PlaceKey, IslandArea]>) items.push(...placePlants(key, area));
  if (extra) {
    items.push(...placePlants('extra', extra));
    if (extra.lvl >= 3) items.push({ y: 378, svg: bloomRing(241, 376, 40, 6, extra.tint, 41) });
  }
  items.push(keimi(ANCHORS.keimi[0], ANCHORS.keimi[1]));
  items.sort((a, b) => a.y - b.y);
  s += items.map((it) => it.svg).join('');

  // Fireflies (night only).
  const flies: ReadonlyArray<readonly [number, number]> = [[210, 290], [380, 330], [520, 210], [160, 220], [420, 280], [90, 250], [258, 160]];
  s += `<g class="i-night">${flies.map(([x, y]) => glow(x, y, 7, '') + `<circle cx="${x}" cy="${y}" r="1.5" fill="#FFF1B8"/>`).join('')}</g>`;
  s += cloud(300, 528, 1.25) + cloud(470, 500, 0.85, true) + cloud(130, 506, 0.8);
  s += '</svg>';
  return s.split(ID_MARK).join(input.prefix);
}
