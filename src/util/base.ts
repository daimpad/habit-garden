// Base path of the deployment: "/" at a domain root (index.php), e.g. "/habit-garden/" for a GitHub
// Pages project site (scripts/pages.mjs). It comes from <meta name="olife-base">. App routes stay
// internal paths ("/heute", "/aufgabe/:id"); only URLs written to the address bar, link hrefs and
// asset URLs carry the base. No browser globals are touched at module load (node tests).

/** "/" or "/a/b/": leading and trailing slash, empty, "." and ".." segments dropped. */
export function normalizeBase(value: string | null | undefined): string {
  const segments = String(value ?? '')
    .trim()
    .split('/')
    .filter((s) => s !== '' && s !== '.' && s !== '..');
  return segments.length ? `/${segments.join('/')}/` : '/';
}

/** Base path from <meta name="olife-base">; "/" when the meta is missing or outside a browser. */
export function appBase(): string {
  if (typeof document === 'undefined') return '/';
  return normalizeBase(document.querySelector<HTMLMetaElement>('meta[name="olife-base"]')?.content);
}

/** Pure: base + internal path ("/heute?x", "assets/icons.svg") → URL path ("/habit-garden/heute?x"). */
export function withBase(base: string, path: string): string {
  return normalizeBase(base) + path.replace(/^\/+/u, '');
}

/**
 * Pure: URL path (optionally with ?query/#hash) → internal path ("/habit-garden/heute" → "/heute",
 * "/habit-garden" → "/"); null when the path lies outside the base.
 */
export function stripBase(base: string, path: string): string | null {
  const root = normalizeBase(base);
  if (!path.startsWith('/')) return null;
  if (root === '/') return path;
  const cut = path.search(/[?#]/u);
  const pathname = cut >= 0 ? path.slice(0, cut) : path;
  const rest = cut >= 0 ? path.slice(cut) : '';
  if (pathname === root.slice(0, -1)) return `/${rest}`;
  if (!pathname.startsWith(root)) return null;
  return `/${pathname.slice(root.length)}${rest}`;
}

/** Internal path → URL path under the current base (links, history entries, assets). */
export function appUrl(path: string): string {
  return withBase(appBase(), path);
}

/** URL path → internal path under the current base; null outside the base. */
export function appPath(path: string): string | null {
  return stripBase(appBase(), path);
}
