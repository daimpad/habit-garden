// Search normalisation (C.4): lower case, no diacritics, ß → ss. The rankings live with their screens:
// services/notes.ts (notes: title > tag > text) and services/planning.ts (tasks).

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
