// TODO(phase-4): in-memory search over notes and tasks; ranking title > tag > text;
// 150 ms debounce (C.4). Phase 1 only needs the normalization for the focus picker.

/** Lower case, NFD without diacritics, ß → ss (C.4). */
export function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ß/gu, 'ss');
}

/** Substring match on the normalized forms. */
export function matches(text: string, query: string): boolean {
  const q = normalizeForSearch(query.trim());
  return q === '' || normalizeForSearch(text).includes(q);
}
