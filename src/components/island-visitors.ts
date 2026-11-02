// Besucher im Garten (Gamification Teil 2, 02.11.2026): the twelve animals in the island's style (flat shapes, a
// darker side, small highlights, no outlines), ported from the approved image draft. Pure string builders.
// Each animal is drawn around its base (feet or belly at 0,0) about Keimi's size or smaller; its colours are
// literal like the flora (they keep them in both themes). On the island islandSvg places them at VISITOR_AT;
// visitorGlyph() draws one alone for the album (a silhouette while still open: one fill from CSS).
import type { VisitorId } from '../services/visitors.js';

/** Same placeholder as in island.ts (replaced once by islandSvg). */
const ID_MARK = '§';
const f = (v: number): string => String(Math.round(v * 10) / 10);
const shadow = (rx: number, ry: number, gradient: boolean): string => gradient
  ? `<ellipse rx="${rx}" ry="${ry}" fill="url(#${ID_MARK}g-sh)"/>`
  : `<ellipse class="v-sh" rx="${rx}" ry="${ry}"/>`;

type Art = (sh: (rx: number, ry: number) => string) => string;

const ART: Readonly<Record<VisitorId, Art>> = {
  bee: () => '<g transform="translate(0 -10)">'
    + '<ellipse cx="-1.6" cy="-4.6" rx="3.4" ry="4.6" fill="#FFFFFF" opacity=".78" transform="rotate(-24 -1.6 -4.6)"/>'
    + '<ellipse cx="2.2" cy="-4.2" rx="2.8" ry="3.8" fill="#EAF4F8" opacity=".85" transform="rotate(20 2.2 -4.2)"/>'
    + '<ellipse rx="5.4" ry="4" fill="#F2C14E"/>'
    + '<path d="M-1.8 -3.8C-.8 -1.4 -.8 1.4 -1.8 3.8L.4 4C1.4 1.4 1.4 -1.4 .4 -4Z" fill="#5A4030"/>'
    + '<path d="M2.4 -3.3C3.2 -1.2 3.2 1.2 2.4 3.3L3.8 2.6C4.4 .9 4.4 -.9 3.8 -2.6Z" fill="#5A4030"/>'
    + '<ellipse cx="-.5" cy="1.8" rx="4.6" ry="1.9" fill="#D9A33B" opacity=".55"/>'
    + '<circle cx="-5.4" cy="-.4" r="2.6" fill="#5A4030"/><circle cx="-6.2" cy="-1" r=".7" fill="#fff"/>'
    + '<path d="M5.2 0l2 .2" stroke="#5A4030" stroke-width="1" stroke-linecap="round"/>'
    + '<ellipse cx="-1.4" cy="-1.8" rx="1.8" ry=".8" fill="#FFE7A3"/></g>',
  robin: (sh) => sh(8, 1.6)
    + '<path d="M5 -6L12 -8.5L11.5 -5.5Z" fill="#7A5A40"/>'
    + '<ellipse cx="1.5" cy="-6.5" rx="7" ry="5.6" fill="#8E6B4E"/>'
    + '<ellipse cx="-2.6" cy="-5.8" rx="4.6" ry="4.6" fill="#E07A4F"/>'
    + '<ellipse cx="-2" cy="-3" rx="3.8" ry="2.4" fill="#F4E6D2"/>'
    + '<circle cx="-3.6" cy="-11" r="4.2" fill="#8E6B4E"/>'
    + '<path d="M-7.2 -11.2C-7.6 -8.4 -5.6 -7 -3.4 -7.4C-5.2 -8.6 -5.6 -10 -5.2 -11.6Z" fill="#E07A4F"/>'
    + '<path d="M3 -9.5C5.5 -8 6.8 -6 7 -3.4C4.5 -4.4 3 -6.4 3 -9.5Z" fill="#7A5A40"/>'
    + '<circle cx="-4.8" cy="-12" r="1.05" fill="#2B3A2E"/><circle cx="-5.1" cy="-12.3" r=".35" fill="#fff"/>'
    + '<path d="M-7.6 -11.2L-10 -10.6L-7.6 -9.8Z" fill="#5A4030"/>'
    + '<path d="M-1 -1.4V.4M2 -1.4V.4" stroke="#7A5A40" stroke-width=".8" stroke-linecap="round"/>',
  hedgehog: (sh) => {
    const spikes: string[] = [];
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (1.02 + i * 0.105);
      const bx = 1.5 + Math.cos(a) * 10.5;
      const by = -6 + Math.sin(a) * 7.5;
      spikes.push(`M${f(bx - 2)} ${f(by + 1)}L${f(1.5 + Math.cos(a) * 14)} ${f(-6 + Math.sin(a) * 10.4)}L${f(bx + 2)} ${f(by + 1.4)}Z`);
    }
    return sh(13, 2.6)
      + `<path d="${spikes.join('')}" fill="#7A5A44"/>`
      + '<path d="M-10 -1C-11 -10 -3 -15.5 4 -15C11 -14.5 14 -8 13 -1Z" fill="#8F6D52"/>'
      + '<path d="M4 -15C11 -14.5 14 -8 13 -1L10 -1C11 -7 9 -12 4 -15Z" fill="#7A5A44"/>'
      + '<path d="M-3 -12.5l1.6 -2.6M2 -13.6l1 -2.8M7 -12.8l1.8 -2.4M-6.5 -9.5l-1.2 -2.4" stroke="#A88566" stroke-width="1" stroke-linecap="round"/>'
      + '<path d="M-10 -1C-11.5 -5 -11 -8 -9 -9.5C-6.5 -10.5 -4 -8 -3 -5C-3 -2.5 -5 -1 -10 -1Z" fill="#E6CDAE"/>'
      + '<path d="M-9 -7.2C-12 -6.6 -14.4 -5 -15.2 -3.8C-13 -2.6 -10 -2.6 -7.6 -3.6Z" fill="#E6CDAE"/>'
      + '<circle cx="-15.2" cy="-3.9" r="1.2" fill="#4A3826"/>'
      + '<circle cx="-9.4" cy="-6.6" r="1" fill="#2B3A2E"/><circle cx="-9.7" cy="-6.9" r=".32" fill="#fff"/>'
      + '<ellipse cx="-7.6" cy="-4.4" rx="1.3" ry=".8" fill="#F2A39A" opacity=".7"/>'
      + '<ellipse cx="-5.4" cy="-.6" rx="2" ry="1" fill="#C9AC8C"/><ellipse cx="5.6" cy="-.6" rx="2" ry="1" fill="#6E5140"/>';
  },
  snail: (sh) => sh(10, 1.8)
    + '<path d="M-11 0C-11 -2.4 -9 -3.4 -6 -3.4H7C9 -3.4 10.4 -2 10.4 0Z" fill="#CDB89A"/>'
    + '<path d="M-9.4 -2.6C-10.6 -5 -10.4 -7.4 -9.6 -9.4M-8 -3C-8.4 -5.6 -7.6 -7.8 -6.4 -9.2" stroke="#CDB89A" stroke-width="1.3" fill="none" stroke-linecap="round"/>'
    + '<circle cx="-9.6" cy="-9.8" r="1.3" fill="#B49C7C"/><circle cx="-6.2" cy="-9.6" r="1.3" fill="#B49C7C"/>'
    + '<circle cx="1.6" cy="-8.4" r="7.4" fill="#D99A5E"/>'
    + '<path d="M1.6 -15.8A7.4 7.4 0 0 1 1.6 -1C6 -2 8.6 -5 8.6 -8.4C8.6 -12 6 -15 1.6 -15.8Z" fill="#C0824A"/>'
    + '<circle cx="2.2" cy="-8.6" r="4.4" fill="#E6B07A"/><circle cx="2.8" cy="-8.8" r="2.2" fill="#D99A5E"/><circle cx="3" cy="-9" r=".9" fill="#C0824A"/>'
    + '<ellipse cx="-1.4" cy="-12.4" rx="2" ry="1" fill="#F4D3AC" opacity=".8" transform="rotate(-30 -1.4 -12.4)"/>'
    + '<circle cx="-9.1" cy="-6.3" r=".75" fill="#2B3A2E"/>',
  frog: () => '<g transform="translate(0 2)">'
    + '<path d="M0 0L11 -2A12 5.6 0 1 0 11 2Z" fill="#4F8A4C" transform="translate(-1 1)" opacity=".5"/>'
    + '<path d="M0 0L11 -2A12 5.6 0 1 0 11 2Z" fill="#6FA35A"/>'
    + '<ellipse cx="-6.4" cy="-1" rx="3.6" ry="2" fill="#6FA35A"/><ellipse cx="6.4" cy="-1" rx="3.6" ry="2" fill="#5E9150"/>'
    + '<path d="M-6 -2C-7 -9 -3.5 -11.5 0 -11.5C3.5 -11.5 7 -9 6 -2C3 0 -3 0 -6 -2Z" fill="#82B866"/>'
    + '<path d="M3 -11C6 -9.5 7 -6 6 -2C4.5 -1.2 3 -1 1.6 -.8C4 -4 4.4 -8 3 -11Z" fill="#6FA35A"/>'
    + '<ellipse cx="0" cy="-3.4" rx="3.6" ry="1.9" fill="#E4EFC8"/>'
    + '<circle cx="-3.4" cy="-11" r="2.8" fill="#82B866"/><circle cx="3.4" cy="-11" r="2.8" fill="#82B866"/>'
    + '<circle cx="-3.4" cy="-11.2" r="1.5" fill="#2B3A2E"/><circle cx="3.4" cy="-11.2" r="1.5" fill="#2B3A2E"/>'
    + '<circle cx="-3" cy="-11.7" r=".5" fill="#fff"/><circle cx="3.8" cy="-11.7" r=".5" fill="#fff"/>'
    + '<path d="M-2.2 -6.6q2.2 1.6 4.4 0" stroke="#3E6B3A" stroke-width=".9" fill="none" stroke-linecap="round"/>'
    + '<ellipse cx="-4.4" cy="-7.4" rx="1.2" ry=".7" fill="#F2A39A" opacity=".7"/><ellipse cx="4.4" cy="-7.4" rx="1.2" ry=".7" fill="#F2A39A" opacity=".7"/></g>',
  tit: (sh) => sh(7.5, 1.5)
    + '<path d="M5 -6L11.5 -9L11 -5.6Z" fill="#4E7FB8"/>'
    + '<ellipse cx="1.5" cy="-6.4" rx="6.6" ry="5.4" fill="#86A985"/>'
    + '<ellipse cx="-2.4" cy="-5.4" rx="4.4" ry="4.4" fill="#F2D04E"/>'
    + '<path d="M-2.4 -9.4V-1.6" stroke="#3E4A55" stroke-width="1.2" stroke-linecap="round" opacity=".55"/>'
    + '<circle cx="-3.4" cy="-10.8" r="4" fill="#FFFFFF"/>'
    + '<path d="M-7.2 -11.6C-6.6 -14.6 -3.6 -15.6 -1 -14.8C.6 -14 1 -12.6 .4 -11.6Z" fill="#5B8FC9"/>'
    + '<path d="M-7.4 -10.4L.4 -10.6" stroke="#3E4A55" stroke-width="1.1" stroke-linecap="round"/>'
    + '<path d="M2.6 -9.4C5.4 -8 6.8 -5.6 6.8 -3C4.4 -4 2.8 -6.4 2.6 -9.4Z" fill="#5B8FC9"/>'
    + '<circle cx="-4.6" cy="-10.6" r=".95" fill="#2B3A2E"/><circle cx="-4.9" cy="-10.9" r=".32" fill="#fff"/>'
    + '<path d="M-7.3 -9.8L-9.4 -9.4L-7.3 -8.6Z" fill="#3E4A55"/>'
    + '<path d="M-1 -1.3V.4M1.8 -1.3V.4" stroke="#6E6A70" stroke-width=".8" stroke-linecap="round"/>',
  ladybug: (sh) => '<g transform="scale(1.15)">' + sh(8, 1.6)
    + '<path d="M-7.4 -1C-10 -1 -11 -3.4 -9.6 -5.4C-8.2 -6.8 -6 -5.8 -5.8 -4Z" fill="#3A2A24"/>'
    + '<path d="M-10 -5.2l-2.2 -2.4M-9 -5.8l-.8 -3" stroke="#3A2A24" stroke-width=".7" stroke-linecap="round"/>'
    + '<path d="M-7 0C-7 -6 -3.5 -8.5 0 -8.5C3.5 -8.5 7 -6 7 0Z" fill="#D9534F"/>'
    + '<path d="M0 -8.5C3.5 -8.5 7 -6 7 0H0Z" fill="#B9433F"/>'
    + '<path d="M0 -8.5V0" stroke="#3A2A24" stroke-width=".8"/>'
    + '<g fill="#3A2A24"><circle cx="-3.4" cy="-4.8" r="1.2"/><circle cx="3.2" cy="-5" r="1.1"/><circle cx="-2.2" cy="-1.9" r=".9"/><circle cx="3.8" cy="-1.9" r=".9"/></g>'
    + '<circle cx="-8.8" cy="-3.8" r=".45" fill="#fff"/>'
    + '<ellipse cx="-3" cy="-6.8" rx="2" ry=".9" fill="#fff" opacity=".4"/></g>',
  duck: () => '<ellipse cy="1.2" rx="15" ry="3" fill="#FFFFFF" opacity=".35"/>'
    + '<path d="M10 -6L14.6 -10.6L13 -5Z" fill="#DCD3C2"/>'
    + '<path d="M-12 -6C-12 -1 -7 1 0 1C7 1 12 -2 12 -7C9 -5 5 -6 3 -8C1 -10 -4 -11 -8 -9Z" fill="#F4EFE3"/>'
    + '<path d="M-10 -2.4C-6 0 3 .6 11 -3.6C9 -.6 4 1 0 1C-5 1 -8.6 -.2 -10 -2.4Z" fill="#DCD3C2"/>'
    + '<path d="M-2 -7.6C2 -9 6 -8 8.6 -5.6C5 -4.2 0 -4.4 -2 -7.6Z" fill="#E4DCCB"/>'
    + '<circle cx="-8" cy="-13" r="4.6" fill="#F4EFE3"/>'
    + '<path d="M-12 -13.6L-17.4 -12.6L-12 -11.2Z" fill="#E9A23B"/>'
    + '<circle cx="-9.4" cy="-14" r=".95" fill="#2B3A2E"/><circle cx="-9.7" cy="-14.3" r=".32" fill="#fff"/>'
    + '<ellipse cx="-7.2" cy="-11.6" rx="1.3" ry=".7" fill="#F2A39A" opacity=".6"/>',
  squirrel: () => '<path d="M3 -2C12 -1 16 -8 15 -16C14 -23 8 -26 4 -23C8 -21 10 -16 8 -12C6.5 -9 3 -8.5 1 -9Z" fill="#C8743A"/>'
    + '<path d="M8 -12C10 -16 8 -21 4 -23C9 -24.5 13.5 -21 14.4 -15.4C14 -10 10 -6 5.5 -5.5Z" fill="#DB8C4E"/>'
    + '<path d="M-5 0C-6.5 -6 -4 -11.5 0 -12C4 -12.5 5.5 -7 4 0Z" fill="#B9672F"/>'
    + '<path d="M-3.5 -1C-4 -5 -2.5 -8 0 -8.4C1.6 -6 1.4 -3 0 -1Z" fill="#F1DDBF"/>'
    + '<circle cx="-1.4" cy="-14.2" r="4.6" fill="#C8743A"/>'
    + '<path d="M-4.6 -17L-5 -21.4L-1.8 -18.2Z" fill="#B9672F"/><path d="M1 -17.8L2 -22L3.4 -17.2Z" fill="#B9672F"/>'
    + '<path d="M-5.6 -13.4C-7.6 -12.8 -8.2 -11.4 -6.8 -10.6C-5.4 -10.2 -4 -11 -3.4 -12Z" fill="#F1DDBF"/>'
    + '<circle cx="-7.4" cy="-11.4" r=".8" fill="#4A3826"/>'
    + '<circle cx="-3" cy="-15" r="1" fill="#2B3A2E"/><circle cx="-3.3" cy="-15.3" r=".32" fill="#fff"/>'
    + '<ellipse cx="-4.6" cy="-6.4" rx="1.9" ry="1.6" fill="#8A5A2E"/><circle cx="-4.6" cy="-7.4" r="1.2" fill="#A06A38"/>'
    + '<ellipse cx="-2.6" cy="-.4" rx="2.4" ry="1.1" fill="#9E5A2A"/>',
  owl: () => '<path d="M-12 1.4H12" stroke="#8C5A3C" stroke-width="2.6" stroke-linecap="round"/>'
    + '<path d="M-9.5 -2C-11.5 -8 -11 -15 -8.6 -19.4L-8.4 -22.4L-5.4 -20.6C-2 -22 2 -22 5.4 -20.6L8.4 -22.4L8.6 -19.4C11 -15 11.5 -8 9.5 -2C6 1 -6 1 -9.5 -2Z" fill="#9C7A5E"/>'
    + '<path d="M3 -21C7.5 -19 10.6 -14 10.2 -8C10 -5 9.8 -3.4 9.5 -2C7.6 -.4 5 .4 2.4 .7C6 -4 6.4 -14 3 -21Z" fill="#86664C"/>'
    + '<path d="M-6.6 -1C-7.6 -5 -6.8 -9 -4 -10.4H4C6.8 -9 7.6 -5 6.6 -1C3 .6 -3 .6 -6.6 -1Z" fill="#D9C2A0"/>'
    + '<path d="M-3 -6.6l1 1.2M1.6 -7l1 1.2M-1 -3.8l1 1.2M3 -4l.8 1" stroke="#B89C78" stroke-width=".8" stroke-linecap="round"/>'
    + '<circle cx="-4" cy="-15" r="3.6" fill="#F2EAD8"/><circle cx="4" cy="-15" r="3.6" fill="#F2EAD8"/>'
    + '<circle cx="-4" cy="-15" r="1.7" fill="#2B3A2E"/><circle cx="4" cy="-15" r="1.7" fill="#2B3A2E"/>'
    + '<circle cx="-3.4" cy="-15.6" r=".55" fill="#fff"/><circle cx="4.6" cy="-15.6" r=".55" fill="#fff"/>'
    + '<path d="M-1.4 -12.6L0 -9.8L1.4 -12.6Z" fill="#E0A040"/>'
    + '<path d="M-3.4 .2v1.8M-1.6 .4v1.6M1.6 .4v1.6M3.4 .2v1.8" stroke="#E0A040" stroke-width=".9" stroke-linecap="round"/>',
  dragonfly: () => '<g transform="translate(0 -12) rotate(-12)">'
    + '<ellipse cx="-7" cy="-4.6" rx="7.4" ry="2.3" fill="#E8F6FA" opacity=".8" transform="rotate(-10 -7 -4.6)"/>'
    + '<ellipse cx="7" cy="-4.6" rx="7.4" ry="2.3" fill="#E8F6FA" opacity=".8" transform="rotate(10 7 -4.6)"/>'
    + '<ellipse cx="-6.4" cy="-.8" rx="6.2" ry="2" fill="#D6EEF4" opacity=".8" transform="rotate(12 -6.4 -.8)"/>'
    + '<ellipse cx="6.4" cy="-.8" rx="6.2" ry="2" fill="#D6EEF4" opacity=".8" transform="rotate(-12 6.4 -.8)"/>'
    + '<rect x="-1.2" y="-4" width="2.4" height="16" rx="1.2" fill="#4FA3B8"/>'
    + '<path d="M-1.2 2h2.4M-1.2 5h2.4M-1.2 8h2.4" stroke="#3B8094" stroke-width=".7"/>'
    + '<ellipse cy="-5" rx="2" ry="2.6" fill="#3B8094"/>'
    + '<circle cx="-1.4" cy="-8" r="1.6" fill="#2E6E80"/><circle cx="1.4" cy="-8" r="1.6" fill="#2E6E80"/>'
    + '<circle cx="-1.8" cy="-8.4" r=".5" fill="#fff"/><circle cx="1" cy="-8.4" r=".5" fill="#fff"/></g>',
  mole: () => '<path d="M-15 1C-14 -5 -8 -8 0 -8C8 -8 14 -5 15 1Z" fill="#9C7458"/>'
    + '<path d="M2 -8C8 -8 14 -5 15 1H6C7 -3 6 -6 2 -8Z" fill="#86624A"/>'
    + '<g fill="#B08A6C"><circle cx="-9" cy="-2" r="1"/><circle cx="8" cy="-3" r=".9"/><circle cx="2" cy="-5.4" r=".8"/></g>'
    + '<path d="M-8 -6C-9 -12 -5 -16 0 -16C5 -16 9 -12 8 -6Z" fill="#5A4B5A"/>'
    + '<path d="M3 -15.6C6.6 -14.4 8.6 -10.6 8 -6H4C5 -9 4.6 -13 3 -15.6Z" fill="#4A3D4A"/>'
    + '<ellipse cy="-9.4" rx="2.6" ry="1.9" fill="#E8A0A8"/><ellipse cx="-.6" cy="-9.9" rx="1" ry=".6" fill="#F6C6CC"/>'
    + '<path d="M-3.4 -12.4q.8 -.6 1.6 0M1.8 -12.4q.8 -.6 1.6 0" stroke="#2B2530" stroke-width=".8" fill="none" stroke-linecap="round"/>'
    + '<path d="M-10 -6.4C-12.6 -6.8 -13.6 -5 -12.6 -3.8C-11.2 -3 -9.6 -4 -9 -5.4Z" fill="#E8A0A8"/>'
    + '<path d="M10 -6.4C12.6 -6.8 13.6 -5 12.6 -3.8C11.2 -3 9.6 -4 9 -5.4Z" fill="#E8A0A8"/>',
};

/*
 * Places keep clear of Keimi's speech bubble (about x 146–454, y 250–306 at its widest), the people figures and the
 * plant slots.
 */
/** Base point of each visitor on the island (viewBox units), whether it flies (drawn above everything) and its depth. */
export const VISITOR_AT: Readonly<Record<VisitorId, { x: number; y: number; air?: boolean; flip?: boolean; z?: number }>> = {
  bee: { x: 162, y: 244, air: true },
  // On the bench under the big tree (on the grass there when the bench is missing).
  robin: { x: 476, y: 233, z: 249 },
  hedgehog: { x: 380, y: 322 },
  snail: { x: 572, y: 320 },
  frog: { x: 84, y: 291 },
  tit: { x: 236, y: 186 },
  ladybug: { x: 262, y: 404 },
  duck: { x: 118, y: 295 },
  squirrel: { x: 510, y: 228, flip: true },
  // On a branch in front of the big tree's crown (depth after the tree, base y 228).
  owl: { x: 446, y: 192, z: 229 },
  dragonfly: { x: 100, y: 262, air: true },
  mole: { x: 214, y: 318 },
};

/** A visitor on the island at its place; `arrive` lets it come in (CSS .i-visit-new). */
export function visitorOnIsland(id: VisitorId, arrive: boolean): { y: number; air: boolean; svg: string } {
  const at = VISITOR_AT[id];
  const k = 1.15;
  const art = ART[id]((rx, ry) => shadow(rx, ry, true));
  const svg = `<g class="i-visitor${arrive ? ' i-visit-new' : ''}" data-visitor="${id}"><g transform="translate(${at.x} ${at.y}) scale(${at.flip ? -k : k} ${k})">${art}</g></g>`;
  return { y: at.z ?? at.y, air: at.air === true, svg };
}

/** One visitor alone (album card), 48 px high by default; `open` draws it as a soft silhouette. */
const GLYPH_SCALE: Partial<Record<VisitorId, number>> = { bee: 1.9, ladybug: 1.45, dragonfly: 1.25, tit: 1.25, robin: 1.2 };

export function visitorGlyph(id: VisitorId, open: boolean, size = 48): string {
  const k = GLYPH_SCALE[id];
  const drawn = ART[id]((rx, ry) => shadow(rx, ry, false));
  const art = k ? `<g transform="translate(0 -6) scale(${k}) translate(0 6)">${drawn}</g>` : drawn;
  const w = Math.round(size * 1.2);
  return `<svg class="ol-visitor-glyph${open ? ' ol-visitor-glyph--open' : ''}" viewBox="-19 -27 38 32" width="${w}" height="${size}" aria-hidden="true" focusable="false">${art}</svg>`;
}
