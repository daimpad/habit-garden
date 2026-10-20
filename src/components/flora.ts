// Flower glyphs and potted plants as SVG markup strings (pure functions, no DOM).
// No gradients, no animation and no style="" in the markup (CSP). Token colours are
// applied through classes (see the ol-flower / ol-plant sections in components.css);
// the fill/stroke attributes next to them are fallbacks with the same values.
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
// Plant, viewBox 0 0 160 190 (own geometry of 20.10.2026 in the style of the Garten-Insel; it replaces the
// earlier shapes after the "Tend" reference). Soil line at y 141, stem foot at x 80. Stage 0 is a seed
// with a curled tip, 1 a sprout with two round seed leaves, 2 leaves, 3 a bud, 4 the flower head.
// Leaves are rounded ovals on a short stalk with a darker lower half and a light midrib; they sit at
// points along the stem curve. The same parts, painted through classes, draw the island plants
// (components/island.ts), so both stay one shape.

/** How the plant parts are painted: attribute strings, either fixed colours or classes (island, night). */
export interface PlantPaint {
  leaf: string;
  leafOld: string;
  shade: string;
  stem: string;
  /** Attributes of the bud body; empty: the colour comes from the referencing <use fill>. */
  bud: string;
  /** Midribs and leaf stalks (left out where the plant is drawn tiny, e.g. on the island). */
  fine: boolean;
}

const LEAF = '#7DB862';
const PLANT_PAINT: PlantPaint = {
  leaf: `fill="${LEAF}"`,
  leafOld: 'fill="#6CA855"',
  shade: 'fill="#4F8F45"',
  stem: 'stroke="#4E8245"',
  bud: '',
  fine: true,
};
const VEIN = '#EAF6D2';

type Pt = readonly [number, number];

function bezierAt(p: readonly Pt[], t: number): Pt {
  const [p0, p1, p2, p3] = p as [Pt, Pt, Pt, Pt];
  const u = 1 - t;
  const at = (i: 0 | 1): number => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i];
  return [at(0), at(1)];
}

/** Stem curve of a stage: height and sway (gentle S). */
const STEMS: Readonly<Record<1 | 2 | 3 | 4, readonly [h: number, sway: number]>> = {
  1: [30, 3], 2: [64, 6], 3: [86, 7], 4: [94, 8],
};

function stemPoints(stage: 1 | 2 | 3 | 4): Pt[] {
  const [h, sway] = STEMS[stage];
  return [[80, 141], [80 + sway, 141 - h * 0.38], [80 - sway * 0.9, 141 - h * 0.72], [80 + sway * 0.25, 141 - h]];
}

/** Top of the stem of a stage (where bud and flower head sit); the seed has none (soil centre). */
export function plantTop(stage: Stage): Pt {
  if (stage === 0) return [80, 141];
  const pts = stemPoints(stage);
  return pts[3] ?? [80, 141];
}

/** Leaves: position along the stem (0 foot … 1 top), angle and length. */
const LEAVES: Readonly<Record<2 | 3 | 4, readonly (readonly [t: number, angle: number, len: number])[]>> = {
  2: [[0.34, -28, 25], [0.56, -150, 27], [0.78, -40, 21], [0.97, -118, 12], [0.97, -62, 11]],
  3: [[0.24, -158, 31], [0.43, -22, 30], [0.62, -146, 26], [0.8, -36, 20]],
  4: [[0.2, -20, 33], [0.38, -156, 32], [0.57, -32, 27], [0.75, -140, 21], [0.88, -50, 14]],
};

function plantLeaf([x, y]: Pt, angle: number, len: number, paint: PlantPaint, old: boolean): string {
  const L = len;
  const W = len * 0.5;
  const blade = `M0 0C${num(L * 0.1)} ${num(-W * 0.95)} ${num(L * 0.6)} ${num(-W * 1.12)} ${num(L)} 0C${num(L * 0.68)} ${num(W * 0.86)} ${num(L * 0.16)} ${num(W * 0.8)} 0 0Z`;
  const shade = `M0 0C${num(L * 0.16)} ${num(W * 0.8)} ${num(L * 0.68)} ${num(W * 0.86)} ${num(L)} 0C${num(L * 0.62)} ${num(W * 0.2)} ${num(L * 0.28)} ${num(W * 0.14)} 0 0Z`;
  const rib = `M${num(L * 0.08)} 0C${num(L * 0.38)} ${num(-W * 0.14)} ${num(L * 0.66)} ${num(-W * 0.1)} ${num(L * 0.9)} ${num(-W * 0.02)}`;
  const parts = `<path d="${blade}" ${old ? paint.leafOld : paint.leaf}/><path d="${shade}" ${paint.shade} fill-opacity=".35"/>`;
  if (!paint.fine) return `<g transform="translate(${num(x)} ${num(y)}) rotate(${num(angle)}) translate(3 0)">${parts}</g>`;
  return `<g transform="translate(${num(x)} ${num(y)}) rotate(${num(angle)})">`
    + `<path d="M0 0L3 0" ${paint.stem} stroke-width="1.6" stroke-linecap="round"/>`
    + `<g transform="translate(3 0)">${parts}`
    + `<path d="${rib}" fill="none" stroke="${VEIN}" stroke-opacity=".55" stroke-width="1" stroke-linecap="round"/></g></g>`;
}

/** Round seed leaf of the sprout, mirrored for the left one. */
function seedLeaf([x, y]: Pt, side: 1 | -1, paint: PlantPaint): string {
  return `<g transform="translate(${num(x)} ${num(y)}) scale(${side} 1)">`
    + `<path d="M0 0C3 -9 13 -13 19 -8C22 -5 19 1 12 3C7 4.5 2 3 0 0Z" ${paint.leaf}/>`
    + `<path d="M0 0C5 2 12 3.5 19 -2C18 1.5 15 3 12 3C7 4.5 2 3 0 0Z" ${paint.shade} fill-opacity=".35"/>`
    + (paint.fine ? `<path d="M2 -1C7 -5 12 -6.5 16 -5" fill="none" stroke="${VEIN}" stroke-opacity=".55" stroke-width="1" stroke-linecap="round"/>` : '')
    + '</g>';
}

/** Bud at the stem top: teardrop in `paint.bud` (or the inherited fill), soft shading, two cupped sepals. */
export function plantBud([x, y]: Pt, paint: PlantPaint): string {
  return `<g transform="translate(${num(x)} ${num(y)})">`
    + `<path d="M0 -19C7 -15 9.5 -6 6 1C4 4.5 -4 4.5 -6 1C-9.5 -6 -7 -15 0 -19Z" ${paint.bud}/>`
    + '<path d="M0 -19C7 -15 9.5 -6 6 1C4 4.5 1 5 0 4.5C3 -3 3 -12 0 -19Z" fill="#000000" fill-opacity=".12"/>'
    + `<path d="M-3 -14C-4.5 -10 -4.5 -6 -3.5 -3" fill="none" stroke="${WHITE}" stroke-opacity=".45" stroke-width="1.4" stroke-linecap="round"/>`
    + `<path d="M0 6C-5 6 -9 2 -10 -4C-6 -2 -3 0 0 3C3 0 6 -2 10 -4C9 2 5 6 0 6Z" ${paint.leaf}/>`
    + `<path d="M0 6C-3 6 -5.5 4.5 -7 2.5C-4 3 -2 3.5 0 4.5C2 3.5 4 3 7 2.5C5.5 4.5 3 6 0 6Z" ${paint.shade} fill-opacity=".4"/>`
    + '</g>';
}

/**
 * Stem and leaves of stages 1–4 (no bud, no head), in plant coordinates; island.ts scales the same
 * parts into its symbols.
 */
export function plantStem(stage: 1 | 2 | 3 | 4, paint: PlantPaint): string {
  const pts = stemPoints(stage);
  const [h] = STEMS[stage];
  const [p0, p1, p2, p3] = pts as [Pt, Pt, Pt, Pt];
  let out = `<path d="M${num(p0[0])} ${num(p0[1])}C${num(p1[0])} ${num(p1[1])} ${num(p2[0])} ${num(p2[1])} ${num(p3[0])} ${num(p3[1])}" fill="none" ${paint.stem} stroke-width="${num(2.4 + h * 0.016)}" stroke-linecap="round"/>`;
  if (stage === 1) {
    out += seedLeaf(p3, 1, paint) + seedLeaf(p3, -1, paint)
      // The next leaf already showing between the two.
      + `<path transform="translate(${num(p3[0])} ${num(p3[1])})" d="M0 0C-1.5 -3 -.5 -6.5 2.5 -7.5C2.5 -4.5 1.5 -1.5 0 0Z" ${paint.leaf}/>`;
    return out;
  }
  LEAVES[stage].forEach(([t, angle, len], i) => {
    out += plantLeaf(bezierAt(pts, t), angle, len, paint, stage > 2 && i < 2);
  });
  return out;
}

// Pot: terracotta bowl with a rounded rim, a shaded right side, a glint and dark soil. The body keeps
// the class ol-plant__pot (token colour); the overlays are translucent so both themes work.
const POT = `<path class="ol-plant__pot" d="M47 147H113C112 164 109 177 103.5 183.5C101.5 186 99 187 96 187H64C61 187 58.5 186 56.5 183.5C51 177 48 164 47 147Z" fill="${CLAY}"/>`
  + '<path d="M96 147H113C112 164 109 177 103.5 183.5C101.5 186 99 187 96 187H92C98 178 100 163 96 147Z" fill="#000000" fill-opacity=".1"/>'
  + `<path d="M55 152C55.5 162 57.5 171 61 178" fill="none" stroke="${WHITE}" stroke-opacity=".28" stroke-width="3" stroke-linecap="round"/>`
  + '<rect x="40" y="135" width="80" height="15" rx="7.5" fill="#C9795D"/>'
  + '<rect x="40" y="144" width="80" height="6" rx="3" fill="#000000" fill-opacity=".08"/>'
  + `<path d="M47 139.5H70" stroke="${WHITE}" stroke-opacity=".3" stroke-width="2.4" stroke-linecap="round"/>`
  + '<ellipse cx="80" cy="140.5" rx="35" ry="4.6" fill="#6B4C3B"/>'
  + '<circle cx="66" cy="140" r="1.1" fill="#8A6650"/><circle cx="95" cy="141" r="1.3" fill="#8A6650"/><circle cx="102" cy="139.6" r=".8" fill="#8A6650"/>';

// Seed half in the soil, a curled tip already showing, three specks of sun.
const SEED = '<path d="M60 141C64 133 96 133 100 141Z" fill="#8A6650"/>'
  + '<g transform="translate(82 135.5) rotate(-18)"><ellipse rx="6.2" ry="4.3" fill="#B08354"/>'
  + '<path d="M-3.6 -.8C-1 .8 2 .8 4 -.6" fill="none" stroke="#7D5A38" stroke-width="1" stroke-linecap="round"/></g>'
  + `<path d="M84 131.5C84 127 87.5 125 90 126.5C88 127.5 87 129.5 87 132" fill="none" stroke="${LEAF}" stroke-width="2" stroke-linecap="round"/>`
  + `<circle class="ol-plant__sun" cx="100" cy="122" r="1.7" fill="${SUN}"/>`
  + `<circle class="ol-plant__sun" cx="66" cy="126" r="1.2" fill="${SUN}" fill-opacity=".7"/>`
  + `<circle class="ol-plant__sun" cx="94" cy="114" r=".9" fill="${SUN}" fill-opacity=".6"/>`;

function plantBody(stage: Stage, flowerId: FlowerId, tint: string, width: number): string {
  if (stage === 0) return SEED;
  let out = plantStem(stage, PLANT_PAINT);
  const [tx, ty] = plantTop(stage);
  if (stage === 3) out += plantBud([tx, ty], { ...PLANT_PAINT, bud: `fill="${tint}"` });
  if (stage === 4) {
    out += `<g class="ol-plant__head" transform="translate(${num(tx - 36)} ${num(ty - 36)}) scale(3)">${flowerBody(flowerId, outlineWidth((width / 160) * 3, 1.6))}</g>`;
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
