// Lebendige Insel (Gamification Teil 1, 02.11.2026): seasonal details, the rainbow and the reward moment for the
// island (components/island.ts calls these while it builds its SVG string). Pure string builders, no DOM.
// Ported from the approved image draft. Same rules as island.ts: colours through classes (i-snow, i-ice …,
// screens.css) except small natural accents (autumn leaves, blossoms, petals), which keep their colour like the
// flora; ids carry the placeholder ID_MARK, which islandSvg replaces with its prefix; no style="" (CSP).
// Motion (falling leaves and snow, petals, the rainbow fading in) is CSS and stops under reduced motion.

/** Same placeholder as in island.ts (replaced once by islandSvg). */
const ID_MARK = '§';

export type Blob = readonly [x: number, y: number, r: number];

const f = (v: number): string => String(Math.round(v * 10) / 10);

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The crown circles of the big tree (before its translate(10 0)) and of a bush (island.ts bush()). */
export const BIG_TREE_CROWN: readonly Blob[] = [[452, 120, 28], [488, 124, 27], [430, 166, 30], [505, 164, 30], [467, 150, 42]];

export function bushCrown(x: number, y: number, r: number): Blob[] {
  return [[x - r * 0.55, y - r * 0.55, r * 0.75], [x + r * 0.55, y - r * 0.5, r * 0.72], [x, y - r * 0.85, r * 0.8]];
}

// ---------------------------------------------------------------------------
// Autumn

export const AUTUMN = ['#C8643A', '#E0A040', '#D4A64A', '#B9533A', '#E8B65A', '#CF7A3C'] as const;
const LEAF = 'M0 -5C3.2 -3.2 3.2 2.2 0 5C-3.2 2.2 -3.2 -3.2 0 -5Z';

/** Shared symbols of the seasons (islandSvg adds them to its <defs> for every season but summer). */
export const SEASON_DEFS = `<g id="${ID_MARK}lf"><path d="${LEAF}"/><path d="M0 -5C2 -3 2.4 1 0 5Z" class="i-shade" opacity=".14"/>`
  + '<path d="M0 -3.6V4.4" stroke="#FFF3D6" stroke-width=".5" opacity=".55" fill="none"/></g>'
  + `<g id="${ID_MARK}cb">${[0, 72, 144, 216, 288].map((deg) => `<circle cx="${f(Math.cos((deg * Math.PI) / 180) * 0.55)}" cy="${f(Math.sin((deg * Math.PI) / 180) * 0.55)}" r=".55"/>`).join('')}<circle r=".32" fill="#F2C14E"/></g>`;

function leaf(x: number, y: number, rot: number, color: string, s = 1, squash = 1): string {
  const scale = squash === 1 ? f(s) : `${f(s)} ${f(s * squash)}`;
  return `<use href="#${ID_MARK}lf" transform="translate(${f(x)} ${f(y)}) scale(${scale}) rotate(${Math.round(rot)})" fill="${color}"/>`;
}

/** Warm speckles over round crowns. */
export function crownTint(blobs: readonly Blob[], seed: number, colors: readonly string[], n: number): string {
  const r = rng(seed);
  let s = '';
  for (let i = 0; i < n; i++) {
    const [cx, cy, rad] = blobs[Math.floor(r() * blobs.length)] ?? [0, 0, 0];
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * rad * 0.8;
    s += `<circle cx="${f(cx + Math.cos(a) * d)}" cy="${f(cy + Math.sin(a) * d)}" r="${f(rad * (0.07 + r() * 0.07))}" fill="${colors[i % colors.length] ?? '#C8643A'}" opacity="${f(0.35 + r() * 0.35)}"/>`;
  }
  return s;
}

/** A small pile of fallen leaves on the grass (base centre x, y; width w). */
export function leafPile(x: number, y: number, w: number, seed: number): string {
  const r = rng(seed);
  let s = `<ellipse cx="${f(x + 2)}" cy="${f(y + 1)}" rx="${f(w * 0.62)}" ry="${f(w * 0.16)}" fill="url(#${ID_MARK}g-sh)"/>`;
  s += `<ellipse cx="${f(x)}" cy="${f(y - 1.4)}" rx="${f(w * 0.5)}" ry="${f(w * 0.17)}" fill="#B8703C" opacity=".55"/>`;
  for (let i = 0; i < Math.round(w * 0.9); i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r());
    const lx = x + Math.cos(a) * d * w * 0.45;
    const ly = y - 2 + Math.sin(a) * d * w * 0.14 - (1 - d) * w * 0.12;
    s += leaf(lx, ly, r() * 360, AUTUMN[(i + seed) % AUTUMN.length] ?? '#C8643A', 0.75, 0.55);
  }
  return s;
}

/** Leaves drifting down (CSS: .i-fall, each with its own delay and sway). */
export function fallingLeaves(seed: number, n: number, box: readonly [number, number, number, number]): string {
  const r = rng(seed);
  let s = '<g class="i-falls">';
  for (let i = 0; i < n; i++) {
    const x = box[0] + r() * (box[2] - box[0]);
    const y = box[1] + r() * (box[3] - box[1]);
    s += `<g class="i-fall">${leaf(x, y, r() * 360, AUTUMN[i % AUTUMN.length] ?? '#C8643A', 0.75 + r() * 0.5)}</g>`;
  }
  return `${s}</g>`;
}

// ---------------------------------------------------------------------------
// Winter

/** A shape drawn twice: a shaded copy shifted down, then snow. */
const snowPath = (d: string, dy = 2.4): string =>
  `<path class="i-snow-lo" d="${d}" transform="translate(0 ${dy})"/><path class="i-snow" d="${d}"/>`;

/** Snow caps on the buildings and objects of the places that exist (island.ts appends them to each drawable). */
export const SNOW = {
  cottage: (): string => snowPath('M249 121C249 113 255 111 262 111L362 111C369 111 372 114 370.5 121L362 157C358 163 352 158 347 161C342 165 336 159 330 162C323 166 317 160 310 163C303 166 296 160 289 163C282 166 275 160 268 163C261 166 254 160 247 162L244.5 158Z', 3)
    + '<path class="k-snow" d="M262 116H360" stroke-width="2" stroke-linecap="round"/>'
    + snowPath('M322 96C322 92 325 91 328 91H341C345 91 347 93 347 96V98H322Z', 1.6),
  shed: (): string => snowPath('M112 162C112 159 115 158 119 158.4L171 162.4C176 162.8 177 165 175.4 168L169.5 177C165 180 161 176 157 179C152 182 147 177 142 180C137 183 132 178 127 181C122 183 116 179 110 181L106 182Z', 2.2),
  well: (): string => snowPath('M465.5 255.5L488 239.5L496 229.5L473 246.5Z', 1.6) + snowPath('M489 239.5L511 255.5L519.5 247.5L496.5 229.5Z', 1.6)
    + '<path class="k-snow" d="M488 240L496 230" stroke-width="3" stroke-linecap="round"/>',
  /** Bench under the big tree, in the tree group's coordinates (before translate(10 0)). */
  bench: (): string => snowPath('M441 225.5C441 223.5 443 223 445 223H487C489.5 223 490.5 224 490 226L489 227.5H441Z', 1.2)
    + snowPath('M438 234.5C438 233 440 232.5 442 232.5H490C492 232.5 493.5 233.5 493 235.5H438Z', 1.2),
  nook: (): string => snowPath('M92 320L99 313L106 320Z', 1)
    + snowPath('M115.5 345.5C116 342.6 120 341.6 125 341.6C130 341.6 134 342.6 134.5 345.5C130 347.5 120 347.5 115.5 345.5Z', 1),
  bridge: (): string => '<path class="k-snow" d="M165 348Q189 332 214 338" stroke-width="2.4" stroke-linecap="round"/>',
};

/** Snow caps on round crowns: soft ellipses clipped to the crown (id must be unique per island). */
export function crownSnow(blobs: readonly Blob[], id: string, k = 0.62): string {
  const clip = `<clipPath id="${ID_MARK}${id}">${blobs.map(([x, y, r]) => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}"/>`).join('')}</clipPath>`;
  const caps = blobs.map(([x, y, r]) => `<ellipse cx="${f(x - r * 0.08)}" cy="${f(y - r * 1.02)}" rx="${f(r * 1.08)}" ry="${f(r * k)}"/>`).join('');
  return `<defs>${clip}</defs><g clip-path="url(#${ID_MARK}${id})"><g class="i-snow-lo" transform="translate(0 2.6)">${caps}</g><g class="i-snow">${caps}</g></g>`;
}

/** The pond under ice (drawn over the water, below the bank stones). */
export function frozenPond(cx: number, cy: number, rx: number, ry: number): string {
  let s = `<ellipse class="i-ice-lo" cx="${cx}" cy="${cy + 1}" rx="${rx - 2}" ry="${f(ry - 1.5)}"/>`;
  s += `<ellipse class="i-ice" cx="${cx}" cy="${cy}" rx="${rx - 3}" ry="${f(ry - 2.5)}"/>`;
  s += `<path class="k-snow" d="M${cx - 34} ${cy - 6}Q${cx - 14} ${cy - 16} ${cx + 12} ${cy - 14}" stroke-width="2.6" stroke-linecap="round" opacity=".9"/>`;
  s += `<path class="k-snow" d="M${cx - 22} ${cy + 2}Q${cx - 6} ${cy - 4} ${cx + 6} ${cy - 3}" stroke-width="1.6" stroke-linecap="round" opacity=".75"/>`;
  s += `<path class="k-ice" d="M${cx + 12} ${cy + 8}l8 -4l6 3M${cx + 20} ${cy + 4}l2 -5" stroke-width=".8" stroke-linecap="round" opacity=".8"/>`;
  s += `<path class="i-snow" opacity=".85" d="M${cx - 46} ${cy - 6}C${cx - 44} ${cy - 16} ${cx - 26} ${cy - 24} ${cx} ${cy - 24}C${cx + 24} ${cy - 24} ${cx + 42} ${cy - 17} ${cx + 47} ${cy - 8}C${cx + 40} ${cy - 14} ${cx + 24} ${cy - 20} ${cx} ${cy - 20}C${cx - 24} ${cy - 20} ${cx - 40} ${cy - 14} ${cx - 46} ${cy - 6}Z"/>`;
  return s;
}

/** Soft snow drifts on the grass. */
export function snowDrifts(): string {
  const drifts: readonly Blob[] = [[214, 200, 50], [388, 262, 46], [250, 352, 36], [520, 352, 40], [90, 336, 26], [160, 250, 22], [420, 380, 30]];
  return `<defs><radialGradient id="${ID_MARK}g-drift"><stop offset=".3" class="s-snow" stop-opacity=".8"/><stop offset="1" class="s-snow" stop-opacity="0"/></radialGradient></defs>`
    + drifts.map(([x, y, rx]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${f(rx * 0.27)}" fill="url(#${ID_MARK}g-drift)"/>`).join('');
}

/** Falling snow (CSS: .i-flake drifts down slowly). */
export function snowfall(seed: number, n: number, box: readonly [number, number, number, number]): string {
  const r = rng(seed);
  let s = '<g class="i-flakes">';
  for (let i = 0; i < n; i++) {
    const x = box[0] + r() * (box[2] - box[0]);
    const y = box[1] + r() * (box[3] - box[1]);
    s += `<g class="i-flake"><circle class="i-snow" cx="${f(x)}" cy="${f(y)}" r="${f(0.9 + r() * 1.9)}" opacity="${f(0.55 + r() * 0.45)}"/></g>`;
  }
  return `${s}</g>`;
}

/** Keimi's scarf, in Keimi's own coordinates (inside its translate/scale group). */
export const SCARF = '<g class="i-scarf"><path d="M-17 -12.5C-9 -9 9 -9 17 -12.5L17.6 -7.6C9 -4 -9 -4 -17.6 -7.6Z" fill="#C9584A"/>'
  + '<path d="M-17.6 -7.6C-9 -4 9 -4 17.6 -7.6L17.4 -6.2C9 -2.8 -9 -2.8 -17.4 -6.2Z" fill="#A6463B"/>'
  + '<path d="M-10 -9.6L-8.4 -4.8M-2 -8.8V-4.2M6 -9L5.4 -4.4M13 -10.4L12 -5.6" stroke="#7FA36F" stroke-width="1.3" stroke-linecap="round"/>'
  + '<path d="M8 -7.5C9.5 -3 9 1 7.5 5.5L13 6.4C14 2 13.6 -2.5 12.6 -7.4Z" fill="#B44F43"/>'
  + '<path d="M7.6 4.2L13.2 5L12.9 6.6L7.3 5.8Z" fill="#7FA36F"/><path d="M8.4 6.4v1.8M10.2 6.6v1.9M12 6.8v1.8" stroke="#C9584A" stroke-width=".9" stroke-linecap="round"/></g>';

// ---------------------------------------------------------------------------
// Spring and summer

const BLOSSOM_COLORS = ['#F4C6CF', '#F7D7DE', '#FFFFFF', '#EFB0C0', '#F4C6CF'] as const;

/** Five-petal blossoms spread over round crowns. */
export function crownBlossoms(blobs: readonly Blob[], seed: number, n: number): string {
  const r = rng(seed);
  let s = '';
  for (let i = 0; i < n; i++) {
    const [cx, cy, rad] = blobs[Math.floor(r() * blobs.length)] ?? [0, 0, 0];
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * rad * 0.85;
    const rr = 2.2 + r() * 1.3;
    const c = BLOSSOM_COLORS[i % BLOSSOM_COLORS.length] ?? '#F4C6CF';
    s += `<use href="#${ID_MARK}cb" transform="translate(${f(cx + Math.cos(a) * d)} ${f(cy + Math.sin(a) * d)}) scale(${f(rr)})" fill="${c}"/>`;
  }
  return s;
}

/** Summer evening: more fireflies (night only), some larger. */
export const SUMMER_FLIES: readonly Blob[] = [
  [120, 200, 1], [300, 250, 1.2], [470, 270, 1], [60, 320, 1.1], [430, 360, 1.3], [190, 300, 1.2],
];

/** Soft rainbow behind the island (by day; fades towards its feet). */
export function rainbow(): string {
  const cx = 300;
  const cy = 340;
  const r0 = 290;
  const cols = ['#F4B3B3', '#F7CFA0', '#F6E6A2', '#BFE0B0', '#AFD3E6', '#C9B9E4'];
  const arcs = cols.map((c, i) => {
    const r = r0 - i * 9;
    return `<path d="M${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}" stroke="${c}"/>`;
  }).join('');
  return `<defs><linearGradient id="${ID_MARK}g-rb" x1="0" y1="0" x2="0" y2="340" gradientUnits="userSpaceOnUse"><stop offset=".45" stop-color="#fff"/><stop offset=".86" stop-color="#fff" stop-opacity="0"/></linearGradient>`
    + `<mask id="${ID_MARK}m-rb" maskUnits="userSpaceOnUse" x="-100" y="-100" width="800" height="500"><rect x="-100" y="-100" width="800" height="500" fill="url(#${ID_MARK}g-rb)"/></mask></defs>`
    + `<g class="i-day i-rainbow" mask="url(#${ID_MARK}m-rb)"><g fill="none" stroke-width="9" opacity=".55">${arcs}</g></g>`;
}

// ---------------------------------------------------------------------------
// Reward moment: a soft spotlight and petals swirling around a newly placed object (base x, y).

const PETAL_COLORS = ['#F4C6CF', '#FFFFFF', '#F7D7DE', '#F2C14E', '#EFB0C0'] as const;

export function arriveFx(x: number, y: number, seed: number): string {
  const r = rng(seed);
  const cy = y - 18;
  let petals = '';
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + r() * 0.4;
    const k = 0.75 + r() * 0.4;
    const px = x + Math.cos(a) * 24 * k;
    const py = cy + Math.sin(a) * 20 * k;
    petals += `<ellipse cx="${f(px)}" cy="${f(py)}" rx="${f(2.2 + r())}" ry="${f(1.2 + r() * 0.5)}" transform="rotate(${f(r() * 180)} ${f(px)} ${f(py)})" fill="${PETAL_COLORS[i % PETAL_COLORS.length] ?? '#FFFFFF'}" opacity="${f(0.7 + r() * 0.3)}"/>`;
  }
  return `<g class="i-fx" aria-hidden="true"><g class="i-fx-light">`
    + `<ellipse cx="${x}" cy="${y}" rx="24" ry="8" fill="url(#${ID_MARK}g-glow)" opacity=".8"/>`
    + `<ellipse class="k-spot" cx="${x}" cy="${y}" rx="16" ry="5.4" stroke-width="1.6"/>`
    + `<ellipse class="k-spot" cx="${x}" cy="${y}" rx="21" ry="7.4" stroke-width=".8" stroke-dasharray="2 4" opacity=".7"/></g>`
    + `<g class="i-fx-petals">${petals}</g></g>`;
}
