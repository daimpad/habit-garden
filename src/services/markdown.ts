// Markdown for WISSEN (Phase 4, A.2 W3/W4, C.4): markdown-it with html: false, linkify and breaks.
// - markdownToHtml(source) is the pure step (node-testable): markdown-it plus the token transformations below.
//   Its output is NOT safe on its own; the browser only ever uses renderMarkdown(), which sanitizes it.
// - renderMarkdown(source) = DOMPurify.sanitize(markdownToHtml(source)) with ADD_ATTR ['target'] and
//   FORBID_ATTR ['style'] (CSP style-src 'self': no inline styles may reach the DOM).
// Transformations:
// - Task items `- [ ] text` / `- [x] text` (also `*`, `+`, `1.`): the list item gets class ol-md-task (its list
//   ol-md-tasklist) and starts with a non-form checkbox
//   <span class="ol-md-check" role="checkbox" aria-checked="…" data-line="N" tabindex="0">, N = 0-based source
//   line of the item, for toggleTaskLine().
// - Inline tags `#a/b` (same rule as services/notes.ts inlineTags: after line start, whitespace or an opening
//   bracket/comma/semicolon, first character a letter, never in code or link text) become
//   <span class="ol-md-tag" data-tag="a/b">#a/b</span> (data-tag normalized like stored tag paths).
// - Links: only relative links and http(s), mailto, tel; target="_blank" rel="noopener noreferrer".
//   Images are rendered as links (img-src 'self' would block remote images).
// - Headings are shifted one level down (the editor page owns the <h1>); table alignment becomes a class
//   (ol-md-align-left|center|right) instead of markdown-it's style attribute.
import MarkdownIt from 'markdown-it';
import type { StateCore, Token } from 'markdown-it';
import DOMPurify from 'dompurify';
import { normalizeTagPath } from '../repo/tags.js';

// Tag body: first character a letter; segments of letters, digits, '_' and '-' separated by '/'.
const TAG_AT = /#([\p{L}][\p{L}\p{N}_-]*(?:\/[\p{L}\p{N}_-]+)*)/gu;
const TAG_BEFORE = /[\s(\[{,;]/u;
const TASK_PREFIX = /^\[([ xX])\](?:[ \t]+|$)/u;
const SAFE_SCHEME = /^(?:https?|mailto|tel):/iu;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;

function escHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** Only scheme-less (relative) links and http(s), mailto, tel. */
export function isSafeLink(url: string): boolean {
  const value = url.trim();
  return ANY_SCHEME.test(value) ? SAFE_SCHEME.test(value) : true;
}

function htmlToken(state: StateCore, html: string): Token {
  const token = new state.Token('html_inline', '', 0);
  token.content = html;
  return token;
}

function textToken(state: StateCore, text: string): Token {
  const token = new state.Token('text', '', 0);
  token.content = text;
  return token;
}

/** Task list items: class on <li>/<ul>, the "[ ] " prefix replaced by the checkbox span. */
function taskItems(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const item = tokens[i];
    if (item?.type !== 'list_item_open') continue;
    const para = tokens[i + 1];
    const inline = tokens[i + 2];
    if (para?.type !== 'paragraph_open' || inline?.type !== 'inline' || !inline.children) continue;
    const first = inline.children[0];
    if (first?.type !== 'text') continue;
    const match = TASK_PREFIX.exec(first.content);
    if (!match) continue;
    const line = para.map?.[0] ?? item.map?.[0];
    if (line === undefined) continue;
    const checked = match[1] !== ' ';
    first.content = first.content.slice(match[0].length);
    if (first.content === '') inline.children.shift();
    inline.children.unshift(htmlToken(state,
      `<span class="ol-md-check" role="checkbox" aria-checked="${checked ? 'true' : 'false'}" data-line="${line}" tabindex="0"></span>`));
    item.attrJoin('class', 'ol-md-task');
    if (checked) item.attrJoin('class', 'ol-md-task--done');
    // The enclosing list: the nearest bullet/ordered list open token before this item at level - 1.
    for (let j = i - 1; j >= 0; j--) {
      const open = tokens[j];
      if (open && (open.type === 'bullet_list_open' || open.type === 'ordered_list_open') && open.level === item.level - 1) {
        if (!(open.attrGet('class') ?? '').includes('ol-md-tasklist')) open.attrJoin('class', 'ol-md-tasklist');
        break;
      }
    }
  }
}

/** Last source character a non-text inline token stands for (decides whether a following '#' starts a tag). */
function trailingChar(token: Token): string {
  switch (token.type) {
    case 'softbreak':
    case 'hardbreak':
      return '\n';
    case 'link_close':
    case 'image':
      return ')';
    case 'code_inline':
      return '`';
    case 'html_inline':
      // Only our own tokens (html: false): the task checkbox replaces "[ ] ", so a space came before.
      return ' ';
    default:
      return token.markup.slice(-1) || 'x';
  }
}

/** Splits text into text and tag tokens; `prev` is the source character before the text ('' = line start). */
function tagTokens(state: StateCore, text: string, escaped: ReadonlySet<number>, prev: string): Token[] | null {
  const out: Token[] = [];
  let last = 0;
  for (const match of text.matchAll(TAG_AT)) {
    const at = match.index ?? 0;
    if (escaped.has(at)) continue;
    const before = at === 0 ? prev : text[at - 1] ?? '';
    if (before !== '' && !TAG_BEFORE.test(before)) continue;
    const path = normalizeTagPath(match[1] ?? '');
    if (path === '') continue;
    if (at > last) out.push(textToken(state, text.slice(last, at)));
    out.push(htmlToken(state, `<span class="ol-md-tag" data-tag="${escHtml(path)}">${escHtml(match[0])}</span>`));
    last = at + match[0].length;
  }
  if (out.length === 0) return null;
  if (last < text.length) out.push(textToken(state, text.slice(last)));
  return out;
}

/**
 * Inline tags in the text runs of each inline token. Runs before markdown-it's text_join: a run of adjacent
 * text / text_special (backslash escape) tokens is scanned as one string, escaped characters never start a tag.
 */
function inlineTagRule(state: StateCore): void {
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue;
    const children = block.children;
    const next: Token[] = [];
    let linkDepth = 0;
    let prev = '';
    let i = 0;
    while (i < children.length) {
      const token = children[i];
      if (!token) break;
      if (token.type !== 'text' && token.type !== 'text_special') {
        if (token.type === 'link_open') linkDepth++;
        else if (token.type === 'link_close') linkDepth = Math.max(0, linkDepth - 1);
        next.push(token);
        prev = trailingChar(token);
        i++;
        continue;
      }
      // Collect the run.
      const run: Token[] = [];
      let text = '';
      const escaped = new Set<number>();
      while (i < children.length) {
        const t = children[i];
        if (!t || (t.type !== 'text' && t.type !== 'text_special')) break;
        if (t.type === 'text_special') for (let k = 0; k < t.content.length; k++) escaped.add(text.length + k);
        text += t.content;
        run.push(t);
        i++;
      }
      const split = linkDepth > 0 ? null : tagTokens(state, text, escaped, prev);
      // Escaped characters render as their plain content, so a split run needs no text_special tokens.
      next.push(...(split ?? run));
      prev = text.slice(-1) || prev;
    }
    block.children = next;
  }
}

/** Table alignment as class instead of style="text-align:…"; headings one level down. */
function blockAttrs(state: StateCore): void {
  for (const token of state.tokens) {
    if (token.type === 'th_open' || token.type === 'td_open') {
      const style = token.attrGet('style');
      if (style !== null) {
        const align = /text-align:\s*(left|center|right)/u.exec(style)?.[1];
        token.attrs = (token.attrs ?? []).filter(([name]) => name !== 'style');
        if (align) token.attrJoin('class', `ol-md-align-${align}`);
      }
    } else if (token.type === 'heading_open' || token.type === 'heading_close') {
      const level = Number(token.tag.slice(1));
      if (level >= 1 && level <= 6) token.tag = `h${Math.min(6, level + 1)}`;
    }
  }
}

function createParser(): MarkdownIt {
  const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });
  const validate = md.validateLink.bind(md);
  md.validateLink = (url: string): boolean => validate(url) && isSafeLink(url);
  md.core.ruler.after('inline', 'ol_task_items', (state) => {
    taskItems(state);
  });
  md.core.ruler.before('text_join', 'ol_inline_tags', (state) => {
    inlineTagRule(state);
  });
  md.core.ruler.push('ol_block_attrs', (state) => {
    blockAttrs(state);
  });

  const renderer = md.renderer;
  const defaultLink = renderer.rules.link_open
    ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token) {
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener noreferrer');
    }
    return defaultLink(tokens, idx, options, env, self);
  };
  // Images as links: the alt text (or the address) opens the image in a new tab.
  renderer.rules.image = (tokens, idx) => {
    const token = tokens[idx];
    const src = token?.attrGet('src') ?? '';
    const alt = token?.children ? token.children.map((c) => c.content).join('') : token?.content ?? '';
    const label = alt.trim() || src;
    return `<a href="${escHtml(src)}" target="_blank" rel="noopener noreferrer" class="ol-md-image">${escHtml(label)}</a>`;
  };
  return md;
}

let parser: MarkdownIt | null = null;

/** Markdown → HTML with the transformations above. NOT sanitized: use renderMarkdown() for the DOM. */
export function markdownToHtml(source: string): string {
  parser ??= createParser();
  return parser.render(source);
}

/** Markdown → sanitized HTML for raw() (browser only: DOMPurify needs a DOM). */
export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(markdownToHtml(source), {
    ADD_ATTR: ['target'],
    FORBID_ATTR: ['style'],
    FORBID_TAGS: ['style', 'img', 'svg', 'math', 'form', 'input', 'button', 'iframe'],
  });
}

// List marker (optionally inside blockquotes) followed by a task box.
const TASK_LINE = /^(\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])(\])/u;

/** Flips `[ ]` ↔ `[x]` of the task item on the 0-based line; any other line leaves the source unchanged. */
export function toggleTaskLine(source: string, line: number): string {
  if (!Number.isInteger(line) || line < 0) return source;
  const lines = source.split('\n');
  const current = lines[line];
  if (current === undefined) return source;
  const match = TASK_LINE.exec(current);
  if (!match) return source;
  const mark = match[2] === ' ' ? 'x' : ' ';
  lines[line] = `${match[1] ?? ''}${mark}${match[3] ?? ''}${current.slice(match[0].length)}`;
  return lines.join('\n');
}
