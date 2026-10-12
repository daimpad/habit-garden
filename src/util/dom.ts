// DOM helpers. Markup is built with the h`` template: every interpolated
// value is escaped unless it is already SafeHtml (another h`` result, raw()
// for trusted generator output such as flora SVG, or icon()).
// Never put style="" into markup: the CSP (style-src 'self') blocks it.
// Dynamic values go through el.style.setProperty('--x', value).
import { appUrl } from './base.js';

const ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;',
};

export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"'`]/gu, (ch) => ESCAPES[ch] ?? ch);
}

export class SafeHtml {
  constructor(readonly html: string) {}
  toString(): string {
    return this.html;
  }
}

export type HtmlValue = SafeHtml | string | number | boolean | null | undefined | readonly HtmlValue[];

function toHtml(value: HtmlValue): string {
  if (value === null || value === undefined || value === false || value === true) return '';
  if (value instanceof SafeHtml) return value.html;
  if (Array.isArray(value)) return value.map(toHtml).join('');
  return esc(value);
}

/** Template helper: h`<p>${userText}</p>` escapes userText. */
export function h(strings: TemplateStringsArray, ...values: HtmlValue[]): SafeHtml {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) out += toHtml(values[i] as HtmlValue) + (strings[i + 1] ?? '');
  return new SafeHtml(out);
}

/** Marks generator output (e.g. flora SVG) as trusted. Never use for user text. */
export function raw(html: string): SafeHtml {
  return new SafeHtml(html);
}

/** Replaces the content of el. */
export function render(el: Element, content: SafeHtml): void {
  el.innerHTML = content.html;
}

export function qs<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`qs: no element for ${selector}`);
  return el;
}

export function qsMaybe<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function qsa<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

/** Dispatches a bubbling CustomEvent (names carry the ol- prefix). */
export function emit<T>(target: EventTarget, name: `ol-${string}`, detail?: T): boolean {
  return target.dispatchEvent(new CustomEvent<T>(name, { bubbles: true, cancelable: true, detail }));
}

/** Build stamp from <meta name="olife-build">. */
export function buildHash(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="olife-build"]')?.content ?? 'dev';
}

let spriteUrl: string | null = null;

/** Lucide icon from the self-hosted sprite (under the base path, util/base.ts). */
export function icon(name: string, size: 20 | 24 | 32 = 24): SafeHtml {
  spriteUrl ??= `${appUrl('/assets/icons.svg')}?v=${encodeURIComponent(buildHash())}`;
  const cls = size === 24 ? 'ol-icon' : `ol-icon ol-icon--${size}`;
  return h`<svg class="${cls}" aria-hidden="true" focusable="false"><use href="${spriteUrl}#i-${name}"></use></svg>`;
}

/** True when motion should be reduced (system setting or in-app setting). */
export function motionReduced(): boolean {
  if (document.documentElement.dataset['motion'] === 'reduced') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Haptic feedback (B.4); silently ignored where unsupported. */
export const HAPTIC = { tick: [8], confirm: [12, 40, 12], warn: [20] } as const;

export function vibrate(pattern: readonly number[]): void {
  try {
    navigator.vibrate?.([...pattern]);
  } catch {
    // Vibration API unavailable or blocked.
  }
}

/** Sets a CSS custom property (CSP-safe alternative to style attributes). */
export function setVar(el: HTMLElement | SVGElement, name: `--${string}`, value: string): void {
  el.style.setProperty(name, value);
}
