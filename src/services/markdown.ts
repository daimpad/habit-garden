// TODO(phase-4): markdown-it (html: false, linkify), task lists, inline tags,
// DOMPurify.sanitize with ADD_ATTR ['target'], links rel="noopener noreferrer" (C.4).

/** Phase 1 stub: returns the escaped text in a paragraph. */
export function renderMarkdown(source: string): string {
  const escaped = source.replace(/[&<>"']/gu, (ch) => `&#${ch.charCodeAt(0)};`);
  return `<p>${escaped}</p>`;
}
