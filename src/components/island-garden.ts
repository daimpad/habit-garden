// Gestalten (Gamification Teil 3, 02.11.2026): the things a person places on the island and the small side island,
// in the island's style, ported from the approved image draft. Pure string builders; same rules as island.ts
// (colours through classes, ids with ID_MARK, no style=""). Each thing is drawn around its base (0,0).
// SLOT_AT: the places, chosen on a fully grown island (all places, traces, shrubs, visitors, people) so nothing
// covers them; 'pond' is the Steg's own place on the pond, i1–i3 lie on the side island.
import type { GardenItemId, GardenSlotId } from '../model.js';

/** Same placeholder as in island.ts (replaced once by islandSvg). */
const ID_MARK = '§';
const sh = (rx: number, ry: number, cy = 0): string => `<ellipse cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${ID_MARK}g-sh)"/>`;
const blossom = (x: number, y: number, c: string): string => `<use href="#${ID_MARK}bl" x="${x}" y="${y}" fill="${c}"/>`;

export const SLOT_AT: Readonly<Record<GardenSlotId, readonly [number, number]>> = {
  a: [84, 182], b: [146, 148], c: [386, 150], d: [112, 236], e: [452, 288], f: [548, 190],
  pond: [122, 264],
  i1: [34, 112], i2: [72, 120], i3: [110, 112],
};

const ART: Readonly<Record<GardenItemId, () => string>> = {
  lantern: () => sh(7, 2)
    + '<rect class="i-stone-lo" x="-3.6" y="-2.6" width="7.2" height="3.2" rx="1.2"/>'
    + '<rect class="i-wood-lo" x="-1.2" y="-30" width="2.4" height="28" rx="1"/>'
    + `<circle cy="-35" r="18" fill="url(#${ID_MARK}g-glow)" class="i-lit"/>`
    + '<rect class="i-lamp" x="-3.8" y="-39" width="7.6" height="8.4" rx="1.4"/><path class="k-wood-lo" d="M-3.8 -35h7.6M0 -39v8.4" stroke-width=".7"/>'
    + '<rect class="i-wood" x="-4.8" y="-31.2" width="9.6" height="2.2" rx="1"/><path class="i-roof" d="M-5.8 -38.4L0 -43.8L5.8 -38.4Z"/>',
  flowerbed: () => {
    const cols = ['#F4C6CF', '#FFFFFF', '#F2C14E', '#C9B6E4', '#F6B48C'];
    const pts: ReadonlyArray<readonly [number, number]> = [[-11, -6], [-5, -7.5], [1, -6.4], [7, -7], [11, -5], [-8, -2.4], [-1.6, -3], [4.6, -2.6], [9.6, -1.6]];
    return sh(18, 3.6, 1)
      + '<ellipse class="i-soil-hi" cy="-2" rx="16" ry="6.4"/><ellipse class="i-soil" cy="-3" rx="14" ry="5"/>'
      + '<g class="i-fol"><circle cx="-9" cy="-5" r="3"/><circle cx="-2" cy="-6.5" r="3.4"/><circle cx="6" cy="-5.5" r="3"/><circle cx="1" cy="-2" r="3"/><circle cx="10" cy="-2.6" r="2.4"/><circle cx="-7" cy="-1" r="2.4"/></g>'
      + pts.map(([x, y], i) => blossom(x, y, cols[i % cols.length] ?? '#FFFFFF')).join('')
      + '<path class="k-wood-lo" d="M-16 -1.6Q0 6 16 -1.6" stroke-width="1.6" opacity=".6"/>';
  },
  birdhouse: () => sh(8, 2)
    + '<rect class="i-wood-lo" x="-1.4" y="-24" width="2.8" height="24" rx="1"/>'
    + '<rect class="i-wood" x="-7.5" y="-37" width="15" height="14" rx="1.5"/><path class="i-wood-lo" d="M4.5 -37H7.5V-23H4.5Z" opacity=".55"/>'
    + '<circle cy="-31.5" r="2.6" fill="#5A4636"/><rect class="i-wood-lo" x="-.6" y="-27.6" width="1.2" height="3" rx=".5"/>'
    + '<path class="i-roof" d="M-10 -36L0 -44.5L10 -36L8.6 -34.6L0 -41.8L-8.6 -34.6Z"/><path class="i-roof-lo" d="M0 -44.5L10 -36L11.4 -37.2L1.4 -45.6Z"/>'
    + '<rect class="i-wood-hi" x="-6.5" y="-35.6" width="2" height="11" rx=".8" opacity=".6"/>',
  bench: () => sh(18, 3.4)
    + '<path class="k-wood-lo" d="M-12 -6V0M12 -6V0" stroke-width="2.4" stroke-linecap="round"/>'
    + '<rect class="i-wood" x="-15" y="-17" width="30" height="5" rx="2"/><path class="k-wood-lo" d="M-11 -12V-8M11 -12V-8" stroke-width="2"/>'
    + '<rect class="i-wood" x="-16" y="-8.4" width="32" height="5" rx="2"/><rect class="i-wood-lo" x="-16" y="-5" width="32" height="2.2" rx="1.1"/>'
    + '<rect x="-10" y="-12" width="8" height="4" rx="2" fill="#E9A8B8"/>',
  windmill: () => {
    const cols = ['#F4C6CF', '#F2C14E', '#9CB59A', '#88C6D6'];
    const blades = [0, 90, 180, 270].map((a, i) => `<path transform="rotate(${a + 15})" d="M0 0C2 -3 2.2 -8 0 -11C5 -9 6.4 -3.4 0 0Z" fill="${cols[i] ?? '#F2C14E'}"/>`).join('');
    return sh(6, 1.6) + '<rect class="i-wood-lo" x="-1" y="-26" width="2" height="26" rx=".8"/>'
      + `<g transform="translate(0 -27)"><g class="i-blades">${blades}</g><circle r="1.6" fill="#FFF6E4"/></g>`;
  },
  jetty: () => {
    let planks = '';
    for (let i = 0; i < 5; i++) planks += `<rect class="${i % 2 ? 'i-wood' : 'i-wood-hi'}" x="${-14 + i * 6}" y="-7" width="5.4" height="9" rx="1"/>`;
    return '<rect class="i-wood-lo" x="-15" y="1" width="31" height="3" rx="1"/>' + planks
      + '<rect class="i-wood-lo" x="-13" y="2" width="2" height="5" rx=".8"/><rect class="i-wood-lo" x="11" y="2" width="2" height="5" rx=".8"/>'
      + '<ellipse cx="0" cy="6" rx="16" ry="2" class="k-water-hi" stroke-width="1" opacity=".7"/>';
  },
};

/** A placed thing (or its preview, `ghost`), with the reward moment's class when it just arrived. */
export function gardenItem(item: GardenItemId, slot: GardenSlotId, opts: { ghost?: boolean; arrive?: boolean } = {}): { y: number; svg: string } {
  const [x, y] = SLOT_AT[slot];
  const cls = ['i-item', opts.ghost ? 'i-ghost' : '', opts.arrive ? 'i-arrive' : ''].filter(Boolean).join(' ');
  return { y, svg: `<g class="${cls}" data-item="${item}"><g transform="translate(${x} ${y})">${ART[item]()}</g></g>` };
}

/** The small side island (upper left, floating) with its rope bridge to the island's edge. */
export function islet(): string {
  const cx = 72;
  const cy = 118;
  let s = '<g class="i-islet">';
  // Cliff, lip, grass top.
  s += `<path fill="url(#${ID_MARK}g-cliff)" d="M${cx - 50} ${cy}C${cx - 48} ${cy + 18} ${cx - 22} ${cy + 36} ${cx - 2} ${cy + 42}C${cx + 16} ${cy + 34} ${cx + 46} ${cy + 18} ${cx + 50} ${cy}Z"/>`;
  s += `<path class="k-root" stroke-width="1.4" stroke-linecap="round" d="M${cx - 16} ${cy + 22}c-2 6 2 10 0 16M${cx + 12} ${cy + 20}c2 5 -1 9 1 13"/>`;
  s += `<ellipse class="i-lip" cx="${cx}" cy="${cy + 3}" rx="51" ry="14"/>`;
  s += `<ellipse class="i-grass" cx="${cx}" cy="${cy}" rx="50" ry="13"/>`;
  s += `<ellipse class="i-grass-hi" cx="${cx - 10}" cy="${cy - 3}" rx="28" ry="5.6" opacity=".7"/>`;
  s += `<ellipse class="i-stone" cx="${cx + 40}" cy="${cy + 5}" rx="3.6" ry="2"/><ellipse class="i-stone-lo" cx="${cx - 42}" cy="${cy + 4}" rx="3" ry="1.7"/>`;
  s += blossom(cx - 20, cy + 8, '#FFFFFF') + blossom(cx + 22, cy + 8, '#F4C6CF') + blossom(cx + 2, cy + 10, '#F2C14E');
  s += '</g>';
  // Rope bridge from the side island to the island's top edge.
  const planks = [0.15, 0.32, 0.5, 0.68, 0.85].map((k) => {
    const x = 118 + k * 20;
    const y = 120 + k * 22 + Math.sin(k * Math.PI) * 5;
    return `<rect class="i-wood" x="${(x - 2.6).toFixed(1)}" y="${(y - 1.4).toFixed(1)}" width="5.2" height="2.8" rx=".8" transform="rotate(40 ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }).join('');
  s += '<path class="k-wood-lo" d="M117 116Q129 138 137 139M120 122Q131 144 139 145" stroke-width="1" stroke-linecap="round"/>' + planks;
  return s;
}

/** Ghost-free glyph of a thing for the shop (64 px wide), colours from the island classes. */
export function itemGlyph(item: GardenItemId, size = 56): string {
  const flat = item === 'flowerbed' || item === 'bench' || item === 'jetty';
  const view = flat ? '-21 -22 42 30' : '-20 -48 40 54';
  return `<svg class="ol-isl__svg ol-item-glyph" viewBox="${view}" width="${Math.round((size * (flat ? 42 : 40)) / (flat ? 30 : 54))}" height="${size}" aria-hidden="true" focusable="false">`
    + `<defs><radialGradient id="ig-sh"><stop offset="0" class="s-shadow" stop-opacity=".3"/><stop offset="1" class="s-shadow" stop-opacity="0"/></radialGradient>`
    + '<radialGradient id="ig-glow"><stop offset="0" class="s-glow" stop-opacity=".75"/><stop offset=".45" class="s-glow" stop-opacity=".28"/><stop offset="1" class="s-glow" stop-opacity="0"/></radialGradient>'
    + '<g id="ig-bl"><circle r="2.2"/><circle r=".8" fill="#E9A23B"/></g></defs>'
    + ART[item]().split(`url(#${ID_MARK}g-sh)`).join('url(#ig-sh)').split(`url(#${ID_MARK}g-glow)`).join('url(#ig-glow)').split(`#${ID_MARK}bl`).join('#ig-bl')
    + '</svg>';
}

/** The side island as a glyph for the shop card. */
export function isletGlyph(size = 56): string {
  return `<svg class="ol-isl__svg ol-item-glyph" viewBox="16 92 112 74" width="${Math.round((size * 112) / 74)}" height="${size}" aria-hidden="true" focusable="false">`
    + '<defs><linearGradient id="ig-cliff" x2="0" y2="1"><stop offset="0" class="s-earth"/><stop offset=".45" class="s-earth-lo"/><stop offset="1" class="s-rock"/></linearGradient>'
    + '<g id="ig-bl"><circle r="2.2"/><circle r=".8" fill="#E9A23B"/></g></defs>'
    + islet().split(`url(#${ID_MARK}g-cliff)`).join('url(#ig-cliff)').split(`#${ID_MARK}bl`).join('#ig-bl').replace(/<path class="k-wood-lo" d="M117[\s\S]*$/u, '')
    + '</svg>';
}
