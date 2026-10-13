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

// ---------------------------------------------------------------------------
// Source editing helpers for the note editor (pure, node-testable). Each returns a TextEdit: replace
// [start, end) of the value with `text`, then select [selStart, selEnd) (positions in the new value).

export interface TextEdit { start: number; end: number; text: string; selStart: number; selEnd: number }

/** Applies an edit to a string (what setRangeText does in the textarea). */
export function applyEdit(value: string, edit: TextEdit): string {
  return value.slice(0, edit.start) + edit.text + value.slice(edit.end);
}

function lineStartOf(value: string, pos: number): number {
  return value.lastIndexOf('\n', pos - 1) + 1;
}

function lineEndOf(value: string, pos: number): number {
  const at = value.indexOf('\n', pos);
  return at < 0 ? value.length : at;
}

function runLength(value: string, from: number, step: 1 | -1, ch: string): number {
  let n = 0;
  for (let i = step === 1 ? from : from - 1; i >= 0 && i < value.length && value[i] === ch; i += step) n++;
  return n;
}

export type InlineMark = 'bold' | 'italic' | 'code';

/**
 * Bold `**`, italic `*` or inline code `` ` `` around the selection (surrounding whitespace stays outside).
 * Toggles: an already marked selection is unmarked. An empty selection inserts the pair, caret inside.
 */
export function toggleInline(value: string, selStart: number, selEnd: number, mark: InlineMark): TextEdit {
  let s = Math.min(selStart, selEnd);
  let e = Math.max(selStart, selEnd);
  while (s < e && /\s/u.test(value[s] ?? '')) s++;
  while (e > s && /\s/u.test(value[e - 1] ?? '')) e--;
  const ch = mark === 'code' ? '`' : '*';
  const size = mark === 'bold' ? 2 : 1;
  const left = runLength(value, s, -1, ch);
  const right = runLength(value, e, 1, ch);
  const run = Math.min(left, right);
  const marked = mark === 'bold' ? run >= 2 : mark === 'italic' ? run % 2 === 1 : run >= 1;
  if (marked && s < e) {
    return { start: s - size, end: e + size, text: value.slice(s, e), selStart: s - size, selEnd: e - size };
  }
  const pair = ch.repeat(size);
  const inner = value.slice(s, e);
  return { start: s, end: e, text: pair + inner + pair, selStart: s + size, selEnd: e + size };
}

/** Heading on the caret's line cycles: none → `# ` → `## ` → none (deeper levels → none). */
export function cycleHeading(value: string, selStart: number, selEnd: number): TextEdit {
  const start = lineStartOf(value, selStart);
  const end = lineEndOf(value, start);
  const line = value.slice(start, end);
  const match = /^(#{1,6})[ \t]+/u.exec(line);
  const level = match?.[1]?.length ?? 0;
  const prefix = level === 0 ? '# ' : level === 1 ? '## ' : '';
  const old = match?.[0].length ?? 0;
  const delta = prefix.length - old;
  const rest = line.slice(old);
  const move = (pos: number): number => Math.max(start + prefix.length, pos + delta);
  return { start, end, text: prefix + rest, selStart: move(selStart), selEnd: move(selEnd) };
}

export type LineKind = 'bullet' | 'ordered' | 'task';

const LIST_MARK = /^(\s*)(?:([-*+])[ \t]+\[[ xX]\][ \t]+|([-*+])[ \t]+|(\d{1,9})([.)])[ \t]+)?/u;

function kindOf(line: string): { indent: string; marker: number; kind: LineKind | null } {
  const m = LIST_MARK.exec(line);
  const indent = m?.[1] ?? '';
  const marker = (m?.[0].length ?? 0) - indent.length;
  const kind: LineKind | null = m?.[2] ? 'task' : m?.[3] ? 'bullet' : m?.[4] ? 'ordered' : null;
  return { indent, marker, kind };
}

/**
 * List markers on the selected lines: `- `, `1. ` (numbered from 1) or `- [ ] `. When every non-empty line
 * already has this kind, the markers are removed; otherwise every line gets it (other markers are replaced).
 */
export function toggleLines(value: string, selStart: number, selEnd: number, kind: LineKind): TextEdit {
  const s = Math.min(selStart, selEnd);
  let e = Math.max(selStart, selEnd);
  // A selection ending at the start of a line does not include that line.
  if (e > s && value[e - 1] === '\n') e--;
  const start = lineStartOf(value, s);
  const end = lineEndOf(value, e);
  const lines = value.slice(start, end).split('\n');
  const multi = lines.length > 1;
  const content = lines.filter((line) => !multi || line.trim() !== '');
  const remove = content.length > 0 && content.every((line) => kindOf(line).kind === kind);
  let n = 0;
  const out = lines.map((line) => {
    if (multi && line.trim() === '') return line;
    const info = kindOf(line);
    const body = line.slice(info.indent.length + info.marker);
    if (remove) return info.indent + body;
    n++;
    const marker = kind === 'bullet' ? '- ' : kind === 'task' ? '- [ ] ' : `${n}. `;
    return info.indent + marker + body;
  });
  const text = out.join('\n');
  if (!multi && selStart === selEnd) {
    const info = kindOf(lines[0] ?? '');
    const oldPrefix = info.indent.length + info.marker;
    const newPrefix = (out[0] ?? '').length - ((lines[0] ?? '').length - oldPrefix);
    const offset = Math.max(oldPrefix, s - start) - oldPrefix;
    const caret = start + newPrefix + offset;
    return { start, end, text, selStart: caret, selEnd: caret };
  }
  return { start, end, text, selStart: start, selEnd: start + text.length };
}

/** Code: inline backticks, or a fenced block around the selected lines when the selection spans lines. */
export function toggleCode(value: string, selStart: number, selEnd: number): TextEdit {
  const s = Math.min(selStart, selEnd);
  let e = Math.max(selStart, selEnd);
  if (!value.slice(s, e).includes('\n')) return toggleInline(value, s, e, 'code');
  if (value[e - 1] === '\n') e--;
  const start = lineStartOf(value, s);
  const end = lineEndOf(value, e);
  const block = value.slice(start, end);
  const text = `\`\`\`\n${block}\n\`\`\``;
  return { start, end, text, selStart: start + 4, selEnd: start + 4 + block.length };
}

/** `#` from the toolbar: inserts `#` (a space before it when it would follow a word), caret after it. */
export function insertTagMark(value: string, selStart: number, selEnd: number): TextEdit {
  const s = Math.min(selStart, selEnd);
  const e = Math.max(selStart, selEnd);
  const before = s === 0 ? '' : value[s - 1] ?? '';
  const space = before !== '' && !TAG_BEFORE.test(before) ? ' ' : '';
  const selected = value.slice(s, e);
  const asTag = /^[\p{L}][\p{L}\p{N}_/-]*$/u.test(selected) ? selected : '';
  const text = `${space}#${asTag}`;
  const caret = s + text.length;
  return { start: s, end: e, text, selStart: caret, selEnd: caret };
}

const CONTINUE = /^(\s*(?:>[ \t]?)*)(?:([-*+])([ \t]+)\[[ xX]\]([ \t]+)|([-*+])([ \t]+)|(\d{1,9})([.)])([ \t]+))/u;

/**
 * Enter inside a list item: continues the list on the next line (`- `, `1.` → `2.`, `- [ ] `); Enter on an
 * empty item removes its marker (ends the list). null: not in a list item (or caret inside the marker).
 */
export function continueList(value: string, caret: number): TextEdit | null {
  const start = lineStartOf(value, caret);
  const end = lineEndOf(value, caret);
  const line = value.slice(start, end);
  const m = CONTINUE.exec(line);
  if (!m) return null;
  if (caret < start + m[0].length) return null;
  if (line.slice(m[0].length).trim() === '') {
    return { start, end, text: '', selStart: start, selEnd: start };
  }
  const indent = m[1] ?? '';
  let marker: string;
  if (m[2]) marker = `${m[2]}${m[3] ?? ' '}[ ]${m[4] ?? ' '}`;
  else if (m[5]) marker = `${m[5]}${m[6] ?? ' '}`;
  else marker = `${Number(m[7] ?? '0') + 1}${m[8] ?? '.'}${m[9] ?? ' '}`;
  const text = `\n${indent}${marker}`;
  return { start: caret, end: caret, text, selStart: caret + text.length, selEnd: caret + text.length };
}

const TAG_CHAR = /[\p{L}\p{N}_/-]/u;

/** Whether pos lies in code: an open inline code span on its line or a fenced block. */
function inCode(value: string, pos: number): boolean {
  const start = lineStartOf(value, pos);
  if ((value.slice(start, pos).match(/`/gu)?.length ?? 0) % 2 === 1) return true;
  let fence: string | null = null;
  for (const line of value.slice(0, start).split('\n')) {
    const mark = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (fence === null && mark) fence = mark[0] ?? null;
    else if (fence !== null && mark?.[0] === fence) fence = null;
  }
  return fence !== null;
}

export interface TagToken { hash: number; start: number; end: number; query: string }

/**
 * The `#tag` token the caret is in or right after (same rule as inline tags; `query` may be '' right after
 * typing `#`). hash = index of '#', [start, end) = the tag text after it.
 */
export function tagTokenAt(value: string, caret: number): TagToken | null {
  let start = caret;
  while (start > 0 && TAG_CHAR.test(value[start - 1] ?? '')) start--;
  const hash = start - 1;
  if (hash < 0 || value[hash] !== '#') return null;
  const before = hash === 0 ? '' : value[hash - 1] ?? '';
  if (before !== '' && !TAG_BEFORE.test(before)) return null;
  const query = value.slice(start, caret);
  if (query !== '' && !/^\p{L}/u.test(query)) return null;
  let end = caret;
  while (end < value.length && TAG_CHAR.test(value[end] ?? '')) end++;
  if (inCode(value, hash)) return null;
  return { hash, start, end, query };
}

/**
 * Existing tag paths matching a query: prefix of the path or of any segment ("bal" finds "garten/balkon").
 * Path prefixes first, then alphabetical; the query itself and `exclude` are left out.
 */
export function suggestTags(paths: readonly string[], query: string, exclude: ReadonlySet<string> = new Set(), max = 6): string[] {
  const q = query.normalize('NFC').toLocaleLowerCase('de').replace(/^#+/u, '');
  const hits: Array<{ path: string; rank: number }> = [];
  for (const path of new Set(paths)) {
    if (path === q || exclude.has(path)) continue;
    if (q === '' || path.startsWith(q)) {
      hits.push({ path, rank: 0 });
      continue;
    }
    const segments = path.split('/');
    if (segments.some((_, i) => segments.slice(i).join('/').startsWith(q))) hits.push({ path, rank: 1 });
  }
  hits.sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path, 'de'));
  return hits.slice(0, max).map((hit) => hit.path);
}
