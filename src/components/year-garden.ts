// Jahresgarten (Einsichten, 02.11.2026): twelve small beds, one per month, as one standalone SVG with literal
// colours (no classes needed), so the same markup shows in the Rückblick and can be saved as a picture.
// A bed holds as many sprouts as the month was watered (share of scheduled waterings, up to MAX_SPROUTS), the
// month's full blooms as flowers in their area colour, a lantern per trace and a bee per visitor (at most three of
// each); future months are a bare bed. Month name and percent below each bed.
import type { FlowerId } from '../model.js';
import { flowerBody } from './flora.js';

export interface BedArt {
  label: string;
  /** 0–1, null: nothing due or not yet. */
  rate: number | null;
  future: boolean;
  blooms: ReadonlyArray<{ flower: FlowerId; tint: string }>;
  traces: number;
  visitors: number;
}

const MAX_SPROUTS = 9;
const COLS = 3;
const CELL_W = 110;
const CELL_H = 84;
const TOP = 34;
const f = (v: number): string => String(Math.round(v * 10) / 10);
const esc = (s: string): string => s.replace(/[&<>"]/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

function sprout(x: number, y: number, k: number): string {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(k)})"><path d="M0 0C0 -5 .6 -9 0 -13" stroke="#5E8F4E" stroke-width="1.4" fill="none" stroke-linecap="round"/>`
    + '<path d="M0 -8C-2 -12 -6 -13 -8 -11C-6 -8.6 -3 -7.6 0 -8Z" fill="#7DB862"/><path d="M0 -10C2 -14 6 -15 8.4 -13C6.4 -10.4 3 -9.4 0 -10Z" fill="#6CA855"/></g>';
}

function lantern(x: number, y: number): string {
  return `<g transform="translate(${f(x)} ${f(y)})"><rect x="-.9" y="-16" width="1.8" height="16" rx=".8" fill="#8C6A4E"/>`
    + '<circle cy="-19" r="7" fill="#FFD27A" opacity=".35"/><rect x="-2.6" y="-22" width="5.2" height="5.6" rx="1" fill="#FFD98A"/>'
    + '<path d="M-3.6 -21.6L0 -25L3.6 -21.6Z" fill="#C96A5A"/></g>';
}

function bee(x: number, y: number): string {
  return `<g transform="translate(${f(x)} ${f(y)})"><ellipse cx="-1" cy="-3" rx="2.4" ry="3.2" fill="#fff" opacity=".85" transform="rotate(-24 -1 -3)"/>`
    + '<ellipse rx="3.6" ry="2.7" fill="#F2C14E"/><path d="M-1 -2.6V2.6M1.4 -2.4V2.4" stroke="#5A4030" stroke-width="1"/><circle cx="-3.6" r="1.7" fill="#5A4030"/></g>';
}

/** The whole picture; `title` on top (e.g. "Jahresgarten 2026"), each bed with its label and percent. */
export function yearGardenSvg(title: string, beds: readonly BedArt[], width?: number): string {
  const rows = Math.ceil(beds.length / COLS);
  const W = COLS * CELL_W + 20;
  const H = TOP + rows * CELL_H + 10;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" class="ol-year-svg" viewBox="0 0 ${W} ${H}"${width ? ` width="${width}" height="${Math.round((width * H) / W)}"` : ''} role="img" aria-label="${esc(title)}">`;
  s += `<rect width="${W}" height="${H}" rx="14" fill="#F7F3E6"/>`;
  s += `<text x="${W / 2}" y="22" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="700" fill="#2F4F3A">${esc(title)}</text>`;
  beds.forEach((bed, i) => {
    const cx = 10 + (i % COLS) * CELL_W + CELL_W / 2;
    const cy = TOP + Math.floor(i / COLS) * CELL_H + 48;
    // Bed: grass rim, soil.
    s += `<ellipse cx="${cx}" cy="${cy + 3}" rx="44" ry="15" fill="${bed.future ? '#E4E0D2' : '#A8CB86'}"/>`;
    s += `<ellipse cx="${cx}" cy="${cy}" rx="39" ry="12" fill="${bed.future ? '#D9D1C3' : '#B98B62'}"/>`;
    s += `<ellipse cx="${cx - 6}" cy="${cy - 3}" rx="22" ry="5" fill="${bed.future ? '#E8E2D6' : '#C99A70'}" opacity=".7"/>`;
    // Sprouts spread evenly over MAX_SPROUTS places across the bed (staggered), as many as the month was watered.
    const n = bed.rate === null ? 0 : Math.round(bed.rate * MAX_SPROUTS);
    for (let k = 0; k < n; k++) {
      const slot = Math.round(((k + 0.5) * MAX_SPROUTS) / n - 0.5);
      const x = cx - 30 + slot * 7.5;
      const y = cy + 2 + (slot % 2 ? -5 : 2);
      s += sprout(x, y, 0.95 + (slot % 3) * 0.12);
    }
    // Full blooms as flowers on stems, in the middle of the bed.
    bed.blooms.slice(0, 3).forEach((b, j) => {
      const x = cx - 12 + j * 12;
      const y = cy - 3;
      s += `<path d="M${x} ${y}V${y - 18}" stroke="#5E8F4E" stroke-width="1.6" stroke-linecap="round"/>`;
      s += `<g transform="translate(${f(x - 8)} ${f(y - 34)}) scale(.68)">${flowerBody(b.flower, 1.6, `yg${i}-${j}-`)}</g>`;
    });
    for (let k = 0; k < Math.min(3, bed.traces); k++) s += lantern(cx + 30 - k * 7, cy + 2);
    for (let k = 0; k < Math.min(3, bed.visitors); k++) s += bee(cx - 30 + k * 9, cy - 24 - (k % 2) * 5);
    s += `<text x="${cx}" y="${cy + 30}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="9.5" font-weight="600" fill="#2F4F3A">${esc(bed.label)}</text>`;
  });
  return `${s}</svg>`;
}

/** The picture as PNG: the SVG drawn on a canvas at `scale` (browser only). */
export async function yearGardenPng(svg: string, scale = 2): Promise<Blob> {
  const box = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/u.exec(svg);
  const w = Number(box?.[1] ?? 350);
  const hgt = Number(box?.[2] ?? 438);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.width = w * scale;
    img.height = hgt * scale;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('year-garden: image failed'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = hgt * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('year-garden: no canvas');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('year-garden: no blob'))), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
