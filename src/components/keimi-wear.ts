// Keimi wächst mit (Gamification Teil 4, 02.11.2026): what Keimi wears and its extra leaves, in Keimi's own
// coordinates (inside its translate/scale group; feet at 0,0, head top near y −41). Ported from the approved
// image draft; literal colours like the flora (straw, blossoms, the can's tin).
const f = (v: number): string => String(Math.round(v * 10) / 10);

/** Spross: two older leaves behind the stem and a small new one on top. */
export const LEAVES_BACK = '<path class="i-leaf-lo k-keimi" stroke-width=".9" d="M-1 -44C-6 -46 -12 -44 -15 -39.5C-9.5 -38 -4.5 -40 -1 -44Z"/>'
  + '<path class="i-leaf-lo k-keimi" stroke-width=".9" d="M1 -44C6 -46.5 12 -45 15.5 -40.5C10 -38.6 5 -40 1 -44Z"/>';
export const LEAF_TOP = '<path class="i-leaf k-keimi" stroke-width=".9" d="M0 -49C-1.6 -54 0 -59 2.4 -61.5C4.6 -57 3.6 -52 0 -49Z"/>';

export const STRAW_HAT = '<g class="i-wear">'
  + '<ellipse cy="-37.5" rx="21" ry="5.6" fill="#D9B46A"/><ellipse cy="-38.6" rx="19" ry="4.4" fill="#E8C985"/>'
  + '<path d="M-10.5 -38.5C-10.5 -46 -6 -50 0 -50C6 -50 10.5 -46 10.5 -38.5C5 -36.6 -5 -36.6 -10.5 -38.5Z" fill="#E8C985"/>'
  + '<path d="M3 -49.6C7.6 -48 10.5 -44 10.5 -38.5C8.6 -37.9 6.4 -37.5 4 -37.3C5.4 -41.4 5 -46 3 -49.6Z" fill="#D9B46A"/>'
  + '<path d="M-10.4 -41C-5 -39 5 -39 10.4 -41L10.5 -38.5C5 -36.6 -5 -36.6 -10.5 -38.5Z" fill="#C9584A"/></g>';

export const CROWN = ((): string => {
  const cols = ['#F4C6CF', '#FFFFFF', '#F2C14E', '#C9B6E4', '#F6B48C', '#FFFFFF', '#EFB0C0'];
  let s = '<g class="i-wear"><path d="M-17 -36.5C-10 -33.6 10 -33.6 17 -36.5" stroke="#6F9A5C" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
  for (let i = 0; i < 7; i++) {
    const k = i / 6;
    const x = -16 + k * 32;
    const y = -36.3 + Math.sin(k * Math.PI) * 2.8;
    if (i % 2) s += `<ellipse cx="${f(x)}" cy="${f(y + 1)}" rx="2.4" ry="1.3" fill="#7FA36F" transform="rotate(${i * 20 - 60} ${f(x)} ${f(y + 1)})"/>`;
    const c = cols[i] ?? '#FFFFFF';
    s += [0, 72, 144, 216, 288].map((deg) => `<circle cx="${f(x + Math.cos((deg * Math.PI) / 180) * 1.7)}" cy="${f(y - 1 + Math.sin((deg * Math.PI) / 180) * 1.7)}" r="1.7" fill="${c}"/>`).join('')
      + `<circle cx="${f(x)}" cy="${f(y - 1)}" r="1" fill="#E9A23B"/>`;
  }
  return `${s}</g>`;
})();

/** A small watering can on the ground at Keimi's right foot. */
export const CAN = '<g class="i-wear" transform="translate(23 0) scale(.85)">'
  + '<ellipse cy="1" rx="10" ry="2.2" fill="#4A3826" opacity=".12"/>'
  + '<path d="M5 -8L16 -16L17.4 -14.6L7 -5Z" fill="#7FA0A8"/><ellipse cx="17" cy="-15.6" rx="2.2" ry="1.4" fill="#9DBCC3" transform="rotate(-40 17 -15.6)"/>'
  + '<path d="M-7 -13C-7 -16 -4 -17.4 0 -17.4C4 -17.4 7 -16 7 -13V-1.6C7 0 4 1 0 1C-4 1 -7 0 -7 -1.6Z" fill="#88AEB6"/>'
  + '<path d="M3 -17C5.6 -16.4 7 -15 7 -13V-1.6C7 -.4 5.4 .4 3 .8Z" fill="#6F949C"/>'
  + '<path d="M-5 -16.6C-5 -22 5 -22 5 -16.6" stroke="#6F949C" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
  + '<rect x="-5.6" y="-12" width="3" height="9" rx="1.5" fill="#B9D3D8" opacity=".8"/></g>';

/** Tagesernte: a woven basket with fruit and a blossom (standalone svg, 72 px wide). */
export const BASKET_SVG = ((): string => {
  let weave = '';
  for (let i = 0; i < 4; i++) weave += `<path d="M-19 ${-14 + i * 4.2}Q0 ${-11 + i * 4.2} 19 ${-14 + i * 4.2}" stroke="#A97A4C" stroke-width="1.2" fill="none" opacity=".75"/>`;
  return '<svg class="ol-basket" viewBox="-26 -36 52 42" width="72" height="58" aria-hidden="true" focusable="false">'
    + '<ellipse cy="2" rx="26" ry="4" fill="#000" opacity=".12"/>'
    + '<path d="M-17 -18C-17 -34 17 -34 17 -18" stroke="#B48A5A" stroke-width="3.4" fill="none" stroke-linecap="round"/>'
    + '<circle cx="-8" cy="-21" r="5" fill="#E9A23B"/><circle cx="-9.4" cy="-22.6" r="1.4" fill="#FFE2A6"/>'
    + '<circle cx="3" cy="-22" r="5.6" fill="#D9534F"/><circle cx="1.4" cy="-23.8" r="1.5" fill="#F7B3A8"/><path d="M3 -27.4q1 -2 2.6 -2.4" stroke="#6F9A5C" stroke-width="1.1" fill="none" stroke-linecap="round"/>'
    + '<ellipse cx="11" cy="-20" rx="3.6" ry="5.6" fill="#7FA36F" transform="rotate(30 11 -20)"/>'
    + '<circle cx="-14" cy="-19.4" r="1.9" fill="#fff"/><circle cx="-14" cy="-19.4" r=".8" fill="#E9A23B"/>'
    + '<path d="M-20 -17H20L16.5 0C16 2 13 3 10 3H-10C-13 3 -16 2 -16.5 0Z" fill="#C99A62"/>'
    + '<path d="M8 -17H20L16.5 0C16 2 13 3 10 3H6Z" fill="#B48552"/>'
    + weave
    + '<rect x="-21" y="-19" width="42" height="4.6" rx="2.3" fill="#D9AE76"/></svg>';
})();
