// Flower glyphs and potted plants as SVG markup strings (pure functions, no DOM).
// No gradients, no animation and no style="" in the markup (CSP). Token colours are
// applied through classes (see the ol-flower / ol-plant sections in components.css);
// the fill/stroke attributes next to them are fallbacks with the same values.
// Geometry data follows F §4.11 1:1 (Tend reference, provenance note in README);
// the code itself is written independently.
import { GENERIC_TINT, type FlowerId, type Stage } from '../model.js';

export const FLOWER_IDS: readonly FlowerId[] = [
  'bellis', 'calendula', 'helianthus', 'centaurea', 'passiflora', 'matricaria', 'leucanthemum', 'generic',
];

export function isFlowerId(value: unknown): value is FlowerId {
  return typeof value === 'string' && (FLOWER_IDS as readonly string[]).includes(value);
}

/** True for #rgb / #rrggbb, the only tint values markup and CSS custom properties accept. */
export function isTint(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu.test(value);
}

/** Accepts #rgb / #rrggbb only, so the value can go into a fill attribute safely. */
export function safeTint(tint: string | null | undefined): string {
  return isTint(tint) ? tint : GENERIC_TINT;
}

// Fallback values of the tokens that the classes apply.
const SUN = '#F2C14E';
const SAGE = '#9CB59A';
const PRIMARY = '#2F4F3A';
const CLAY = '#D98E73';
const WHITE = '#FFFFFF';

// Glyph centre in the 24 × 24 box.
const C = 12;

/**
 * Width (in glyph units) of the outline layer under white rays; half of it stays visible.
 * Chosen per rendered size so the visible contour stays about 1–1.25 CSS px
 * (B.5: 1.25 px at 48 px; 1 px at 24 px). `pxPerUnit` = CSS px per glyph unit.
 */
function outlineWidth(pxPerUnit: number, max = 2.5): number {
  const glyphPx = pxPerUnit * 24;
  const visible = Math.min(1.25, 0.75 + glyphPx / 96);
  return Math.min(max, Math.max(0.5, (2 * visible) / pxPerUnit));
}

const num = (v: number): string => String(Math.round(v * 100) / 100);
const rad = (deg: number): number => (deg * Math.PI) / 180;

// ---------------------------------------------------------------------------
// Ray shapes. Each builder returns a closed path for a ray pointing straight up
// from radius r0 to radius r1; rays are placed with rotate(a 12 12).

/** Tapered ray with a round tip: half-width `base` at r0, tip radius `tip`. */
function roundRay(r0: number, r1: number, base: number, tip: number): string {
  const yc = C - r1 + tip;
  return `M${num(C - base)} ${num(C - r0)}L${num(C - tip)} ${num(yc)}A${num(tip)} ${num(tip)} 0 0 1 ${num(C + tip)} ${num(yc)}L${num(C + base)} ${num(C - r0)}Z`;
}

/** The part of a roundRay() beyond radius `from` (used for bellis' tips). */
function roundRayTip(r0: number, r1: number, base: number, tip: number, from: number): string {
  const yc = C - r1 + tip;
  const k = Math.min(1, Math.max(0, (from - r0) / (r1 - tip - r0)));
  const w = base + (tip - base) * k;
  return `M${num(C - w)} ${num(C - from)}L${num(C - tip)} ${num(yc)}A${num(tip)} ${num(tip)} 0 0 1 ${num(C + tip)} ${num(yc)}L${num(C + w)} ${num(C - from)}Z`;
}

/** Elliptic petal between r0 and r1 with half-width hw. */
function ovalRay(r0: number, r1: number, hw: number): string {
  const ry = (r1 - r0) / 2;
  return `M${C} ${num(C - r0)}A${num(hw)} ${num(ry)} 0 0 1 ${C} ${num(C - r1)}A${num(hw)} ${num(ry)} 0 0 1 ${C} ${num(C - r0)}Z`;
}

/** Lancet ray with a pointed tip, widest around 40 % of its length. */
function pointedRay(r0: number, r1: number, hw: number): string {
  const ym = C - (r0 + (r1 - r0) * 0.4);
  return `M${num(C - hw * 0.55)} ${num(C - r0)}Q${num(C - hw * 1.45)} ${num(ym)} ${C} ${num(C - r1)}Q${num(C + hw * 1.45)} ${num(ym)} ${num(C + hw * 0.55)} ${num(C - r0)}Z`;
}

/** Funnel-shaped ray whose outer edge carries three teeth (cornflower). */
function toothedRay(r0: number, r1: number, base: number, hw: number): string {
  const shoulder = r1 - 1.5;
  const notch = r1 - 1.2;
  const side = r1 - 0.35;
  const pts: Array<[number, number]> = [
    [-base, r0], [-hw, shoulder], [-hw * 0.86, side], [-hw * 0.43, notch], [0, r1],
    [hw * 0.43, notch], [hw * 0.86, side], [hw, shoulder], [base, r0],
  ];
  return `M${pts.map(([x, r]) => `${num(C + x)} ${num(C - r)}`).join('L')}Z`;
}

function radial(d: string, angle: number): string {
  return angle === 0 ? `<path d="${d}"/>` : `<path d="${d}" transform="rotate(${num(angle)} ${C} ${C})"/>`;
}

function evenAngles(count: number, offset = 0): number[] {
  return Array.from({ length: count }, (_, i) => offset + (360 / count) * i);
}

/**
 * A ray at each angle. With `ref` (compact markup for the island) the first ray is a path with id `ref`
 * and the others are rotated <use> copies of it.
 */
function ring(d: string, angles: readonly number[], ref?: string): string {
  if (!ref) return angles.map((a) => radial(d, a)).join('');
  const first = angles[0] ?? 0;
  return angles.map((a, i) => (i === 0
    ? `<path id="${ref}"${radial(d, a).slice(5)}`
    : `<use href="#${ref}" transform="rotate(${num(a - first)} ${C} ${C})"/>`)).join('');
}

/** White rays: one outline layer underneath, white fills on top, so neighbouring rays stay separated. */
function whiteRays(d: string, angles: readonly number[], outline: number, ref?: string): string {
  const open = `<g class="ol-flower__outline" fill="none" stroke="${PRIMARY}" stroke-width="${num(outline)}" stroke-linejoin="round">`;
  if (ref) return `${open}<g id="${ref}w">${ring(d, angles, ref)}</g></g><use href="#${ref}w" fill="${WHITE}"/>`;
  const rays = ring(d, angles);
  return `${open}${rays}</g><g fill="${WHITE}">${rays}</g>`;
}

function sunDisc(cx: number, cy: number, r: number): string {
  return `<circle class="ol-flower__sun" cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="${SUN}"/>`;
}

// Helianthus: dot grid on the disc (hexagonal rows, inside r 3.7).
const HELIANTHUS_DOTS = (() => {
  const dots: string[] = [];
  for (let row = -2; row <= 2; row++) {
    const y = row * 1.45;
    const shift = row % 2 === 0 ? 0 : 0.8;
    for (let col = -3; col <= 3; col++) {
      const x = col * 1.6 + shift;
      if (x * x + y * y <= 3.7 * 3.7) dots.push(`<circle cx="${num(C + x)}" cy="${num(C + y)}" r=".5"/>`);
    }
  }
  return `<g class="ol-flower__sun" fill="${SUN}">${dots.join('')}</g>`;
})();

// Passiflora: corona of 24 lines from r 3 to r 7.
const PASSIFLORA_CORONA = (() => {
  const segs = evenAngles(24).map((a) => {
    const s = Math.sin(rad(a));
    const c = Math.cos(rad(a));
    return `M${num(C + s * 3)} ${num(C - c * 3)}L${num(C + s * 7)} ${num(C - c * 7)}`;
  });
  return `<path d="${segs.join('')}" fill="none" stroke="#6A4C93" stroke-width=".6" stroke-linecap="round"/>`;
})();

const PASSIFLORA_CENTRE = [-90, 30, 150]
  .map((a) => `<circle cx="${num(C + Math.cos(rad(a)) * 1.25)}" cy="${num(C + Math.sin(rad(a)) * 1.25)}" r="1.2"/>`)
  .join('');

/**
 * Glyph content in the 24 × 24 coordinate system (no <svg> wrapper); `outline` is the width of the
 * outline layer under white rays in glyph units. `ids` (island, components/island.ts): unique id prefix
 * for compact markup in which repeated rays are <use> copies.
 */
export function flowerBody(id: FlowerId, outline: number, ids?: string): string {
  const ref = (key: string): string | undefined => (ids ? `${ids}${key}` : undefined);
  switch (id) {
    case 'bellis': {
      // 13 short rounded rays, outer third pink.
      const angles = evenAngles(13);
      const tip = roundRayTip(2.5, 7, 0.6, 1, 5.5);
      return whiteRays(roundRay(2.5, 7, 0.6, 1), angles, outline, ref('a'))
        + `<g fill="#E9A8B8">${ring(tip, angles, ref('b'))}</g>`
        + sunDisc(C, C, 3);
    }
    case 'calendula': {
      // Two rows of 8, offset by 22.5°, inner row shorter.
      const outer = roundRay(2.5, 9, 0.8, 1.25);
      const inner = roundRay(2.5, 7.6, 0.8, 1.25);
      return `<g fill="#E8963E">${ring(outer, evenAngles(8), ref('a'))}${ring(inner, evenAngles(8, 22.5), ref('b'))}</g>`
        + `<circle cx="${C}" cy="${C}" r="3" fill="#8A4B1F"/>`;
    }
    case 'helianthus': {
      const ray = pointedRay(4.5, 9, 1);
      return `<g class="ol-flower__sun" fill="${SUN}">${ring(ray, evenAngles(20), ref('a'))}</g>`
        + `<circle cx="${C}" cy="${C}" r="5" fill="#5A3A22"/>${HELIANTHUS_DOTS}`;
    }
    case 'centaurea': {
      const ray = toothedRay(2, 9, 0.8, 2.6);
      return `<g fill="#4C6FB3">${ring(ray, evenAngles(8), ref('a'))}</g>`
        + `<circle cx="${C}" cy="${C}" r="2.5" fill="#2B3A6B"/>`;
    }
    case 'passiflora': {
      const ray = ovalRay(2, 9, 2.1);
      return `<g fill="#B89BD1">${ring(ray, evenAngles(10), ref('a'))}</g>`
        + PASSIFLORA_CORONA
        + `<g class="ol-flower__sage" fill="${SAGE}">${PASSIFLORA_CENTRE}</g>`;
    }
    case 'matricaria': {
      // 12 narrow rays, each tilted up to 20° towards the bottom (hanging), raised centre.
      const angles = evenAngles(12).map((a) => a + 20 * Math.sin(rad(a)));
      return whiteRays(roundRay(2.5, 8.6, 0.55, 0.9), angles, outline, ref('a'))
        + `<ellipse class="ol-flower__sun" cx="${C}" cy="${C - 1}" rx="3" ry="4" fill="${SUN}"/>`;
    }
    case 'leucanthemum': {
      // 21 long, flat, narrow rays around a wide centre.
      return whiteRays(roundRay(3.5, 9, 0.5, 0.75), evenAngles(21), outline, ref('a')) + sunDisc(C, C, 4);
    }
    case 'generic':
    default: {
      const ray = ovalRay(3, 9, 2.3);
      return `<g class="ol-flower__sage" fill="${SAGE}">${ring(ray, evenAngles(8), ref('a'))}</g>`
        + sunDisc(C, C, 3.5);
    }
  }
}

/** Flower glyph, viewBox 0 0 24 24, centre (12, 12). */
export function flower(id: FlowerId, size = 24): string {
  const s = num(size > 0 ? size : 24);
  const kind = isFlowerId(id) ? id : 'generic';
  return `<svg class="ol-flower__svg" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" focusable="false">${flowerBody(kind, outlineWidth(Number(s) / 24))}</svg>`;
}

// ---------------------------------------------------------------------------
// Plant, viewBox 0 0 160 190 (F §4.11).

const STEM = '#3F6A4A';
type LeafSpec = readonly [x: number, y: number, angle: number, len: number, color: string, vein: boolean];

function stem(h: number, bend: number): string {
  return `<path d="M80 141C${num(80 + bend)} ${num(141 - h * 0.45)} ${num(80 - bend * 0.6)} ${num(141 - h * 0.75)} 80 ${num(141 - h)}" fill="none" stroke="${STEM}" stroke-width="${num(2.2 + h * 0.018)}" stroke-linecap="round"/>`;
}

function leaf([x, y, angle, len, color, vein]: LeafSpec): string {
  const w = len * 0.36;
  const blade = `M0 0C${num(len * 0.28)} ${num(-w)} ${num(len * 0.74)} ${num(-w * 0.95)} ${num(len)} 0C${num(len * 0.74)} ${num(w * 0.8)} ${num(len * 0.28)} ${num(w * 0.85)} 0 0Z`;
  const veinPath = vein
    ? `<path d="M1 0L${num(len * 0.82)} 0" fill="none" stroke="${WHITE}" stroke-opacity=".4" stroke-width="1.1" stroke-linecap="round"/>`
    : '';
  return `<g transform="translate(${num(x)} ${num(y)}) rotate(${num(angle)})"><path d="${blade}" fill="${color}"/>${veinPath}</g>`;
}

const LEAVES: Readonly<Record<1 | 2 | 3 | 4, readonly LeafSpec[]>> = {
  1: [
    [80, 116, -150, 17, '#9CB59A', true],
    [80, 116, -30, 17, '#8AAB88', true],
  ],
  2: [
    [79, 126, -160, 26, '#7FA27F', true],
    [81, 116, -18, 28, '#9CB59A', true],
    [79, 102, -150, 24, '#9CB59A', true],
    [80, 90, -30, 20, '#8AAB88', true],
    [80, 78, -120, 13, '#B4C9B0', false],
    [80, 78, -60, 13, '#B4C9B0', false],
  ],
  3: [
    [79, 128, -162, 30, '#6F956F', true],
    [81, 118, -16, 31, '#8AAB88', true],
    [79, 104, -154, 28, '#9CB59A', true],
    [81, 92, -26, 25, '#9CB59A', true],
    [80, 76, -140, 18, '#8AAB88', true],
  ],
  4: [
    [79, 130, -164, 32, '#6F956F', true],
    [81, 120, -14, 33, '#8AAB88', true],
    [79, 106, -152, 29, '#9CB59A', true],
    [81, 94, -28, 27, '#9CB59A', true],
    [80, 78, -146, 20, '#8AAB88', true],
  ],
};

const STEMS: Readonly<Record<1 | 2 | 3 | 4, readonly [h: number, bend: number]>> = {
  1: [26, 4], 2: [66, 7], 3: [88, 8], 4: [94, 9],
};

const POT = `<path class="ol-plant__pot" d="M47 150h66l-7 36H54z" fill="${CLAY}"/>`
  + '<rect x="41" y="140" width="78" height="14" rx="5" fill="#C9795D"/>'
  + `<rect x="45" y="142.5" width="18" height="3" rx="1.5" fill="${WHITE}" fill-opacity=".28"/>`
  + '<ellipse cx="80" cy="141.5" rx="34" ry="4.4" fill="#6B5040"/>';

const SEED = '<path d="M62 141c5-8 30-8 36 0z" fill="#7A5A47"/>'
  + '<g transform="translate(80 134) rotate(-24)"><ellipse rx="6.5" ry="4.2" fill="#A57B52"/>'
  + '<path d="M-4 -1c2.5 1.4 5.5 1.4 8 0" fill="none" stroke="#7D5A38" stroke-width="1"/></g>'
  + `<circle class="ol-plant__sun" cx="92" cy="120" r="1.6" fill="${SUN}"/>`
  + `<circle class="ol-plant__sun" cx="70" cy="124" r="1.2" fill="${SUN}" fill-opacity=".7"/>`;

function bud(tint: string): string {
  return '<g transform="translate(80 53)">'
    + `<path d="M0 -16C8 -10 9 2 0 8C-9 2 -8 -10 0 -16Z" fill="${tint}"/>`
    + `<path d="M-7 3C-4 9 4 9 7 3C4 5 -4 5 -7 3Z" fill="${STEM}"/>`
    + `<path d="M0 8C-5 6 -9 -1 -8 -6M0 8C5 6 9 -1 8 -6" fill="none" stroke="${STEM}" stroke-width="2" stroke-linecap="round"/>`
    + '</g>';
}

function sideBranch(tint: string): string {
  return `<path d="M81 100C92 94 99 86 101 76" fill="none" stroke="${STEM}" stroke-width="2" stroke-linecap="round"/>`
    + '<g transform="translate(101 72) rotate(18)">'
    + `<path d="M0 -8C4 -5 4.5 1 0 4C-4.5 1 -4 -5 0 -8Z" fill="${tint}"/>`
    + `<path d="M-4 2C-2 5 2 5 4 2" fill="${STEM}"/>`
    + '</g>';
}

function plantBody(stage: Stage, flowerId: FlowerId, tint: string, width: number): string {
  if (stage === 0) return SEED;
  const [h, bend] = STEMS[stage];
  let out = stem(h, bend) + LEAVES[stage].map(leaf).join('');
  if (stage === 3) out += bud(tint);
  if (stage === 4) {
    out += sideBranch(tint)
      + `<g class="ol-plant__head" transform="translate(44 11) scale(3)">${flowerBody(flowerId, outlineWidth((width / 160) * 3, 1.6))}</g>`;
  }
  return out;
}

/** viewBox height of a potted plant and of a plant growing from the ground (meadow). */
export const PLANT_VIEW_H = 190;
export const GROUND_VIEW_H = 152;

/** Height of a plant drawn `width` px wide (viewBox ratio 160 : 190, or 160 : 152 without pot). */
export function plantHeight(width: number, ground = false): number {
  return Math.round(((width * (ground ? GROUND_VIEW_H : PLANT_VIEW_H)) / 160) * 10) / 10;
}

// Meadow ground under a plant without pot: a soil mound with a few grass blades (viewBox 0 0 160 152).
const GROUND = '<ellipse cx="80" cy="143" rx="40" ry="7" fill="#8A6A52" fill-opacity=".55"/>'
  + `<path class="ol-plant__grass" d="M50 145c-2-8-1-13 3-17M58 146c0-6 2-10 6-13M104 146c1-7 4-11 8-13M112 145c2-6 1-11-2-15" fill="none" stroke="${SAGE}" stroke-width="2.4" stroke-linecap="round"/>`;

/**
 * Plant in stage 0–4, viewBox 0 0 160 190; `size` is the rendered width.
 * Pot and soil stay static; everything above the soil sits in
 * g.ol-plant__wobble > g.ol-plant__grow (both with transform-origin 80px 141px).
 * With `ground` (meadow) the pot is replaced by a soil mound and the viewBox ends at y 152.
 */
export function plant(stage: Stage, flowerId: FlowerId, tint: string, size = 120, ground = false): string {
  const st: Stage = stage >= 0 && stage <= 4 ? stage : 0;
  const kind = isFlowerId(flowerId) ? flowerId : 'generic';
  const w = size > 0 ? size : 120;
  const viewH = ground ? GROUND_VIEW_H : PLANT_VIEW_H;
  return `<svg class="ol-plant__svg" viewBox="0 0 160 ${viewH}" width="${num(w)}" height="${num(plantHeight(w, ground))}" aria-hidden="true" focusable="false">`
    + (ground ? GROUND : POT)
    + `<g class="ol-plant__wobble"><g class="ol-plant__grow">${plantBody(st, kind, safeTint(tint), w)}</g></g>`
    + '</svg>';
}

/** Ray colour of each flower that is not white (S31). */
const PETAL: Partial<Record<FlowerId, string>> = {
  calendula: '#E8963E', helianthus: SUN, centaurea: '#4C6FB3', passiflora: '#B89BD1', generic: SAGE,
};

/**
 * Petal colour for burst particles ("Blütenfarbe"): the flower's ray colour,
 * or for white-rayed flowers a visible accent (bellis tip pink, otherwise the area tint).
 */
export function petalColor(flowerId: FlowerId, tint: string): string {
  if (flowerId === 'bellis') return '#E9A8B8';
  return PETAL[flowerId] ?? safeTint(tint);
}
