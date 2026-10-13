// WISSEN helpers (Phase 4, A.2 W1–W4, A.3 Screen 3). Pure functions, no DOM, no Dexie, testable in node.
// - Title = first line of the body (W3); Markdown heading marks and list markers are stripped.
// - Tags: a note's tagPaths are the explicit tags from the editor head plus the inline `#a/b` tags of its
//   body (W4). Explicit tags are not stored separately: they are the stored paths that are not inline.
// - Tag filter (W2): selecting `a` also matches `a/b` (tags are a tree); several tags combine with AND or OR.
// - Search (W1): normalised substring over title, tags and body; ranking title > tag > body.
import type { Day, ISO, Note, Tag } from '../model.js';
import { normalizeTagPath, normalizeTagPaths } from '../repo/tags.js';
import { dayOfIso, diffDays, formatDayShort, formatTime, formatWeekdayShort } from '../util/date.js';
import { normalizeForSearch } from './search.js';

const TITLE_MAX = 120;
const PREVIEW_MAX = 140;

/** Strips Markdown line marks: headings, quotes, list bullets, task boxes, emphasis and code ticks. */
function plainLine(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/u, '')
    .replace(/^\s*>\s?/u, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/u, '')
    .replace(/[*_~`]+/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Index of the first line with visible text, or -1. */
function firstLineIndex(lines: readonly string[]): number {
  return lines.findIndex((line) => plainLine(line) !== '');
}

/** Title of a note from its body: the first non-empty line without Markdown marks ('' when empty). */
export function deriveTitle(body: string): string {
  const lines = body.split(/\r?\n/u);
  const i = firstLineIndex(lines);
  return i < 0 ? '' : clip(plainLine(lines[i] ?? ''), TITLE_MAX);
}

/** One preview line: the first line with text after the title line (W1 Notizkarte). */
export function previewLine(body: string): string {
  const lines = body.split(/\r?\n/u);
  const i = firstLineIndex(lines);
  if (i < 0) return '';
  for (const line of lines.slice(i + 1)) {
    if (/^\s*(?:```|~~~)/u.test(line)) continue;
    const text = plainLine(line);
    if (text !== '') return clip(text, PREVIEW_MAX);
  }
  return '';
}

// `#tag` or `#a/b`: starts with a letter, after line start or whitespace/bracket; not inside code.
const INLINE_TAG = /(^|[\s(\[{,;])#([\p{L}][\p{L}\p{N}_-]*(?:\/[\p{L}\p{N}_-]+)*)/gu;

/** Body without fenced code blocks and inline code spans (tags there are code, not tags). */
function withoutCode(body: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of body.split(/\r?\n/u)) {
    const mark = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (fence === null && mark) fence = mark[0] ?? null;
    else if (fence !== null && mark?.[0] === fence) fence = null;
    else if (fence === null) out.push(line.replace(/`[^`]*`/gu, ''));
  }
  return out.join('\n');
}

/** Inline tags of a body, normalised, without duplicates, in order of appearance. */
export function inlineTags(body: string): string[] {
  const out: string[] = [];
  for (const match of withoutCode(body).matchAll(INLINE_TAG)) {
    const path = normalizeTagPath(match[2] ?? '');
    if (path !== '' && !out.includes(path)) out.push(path);
  }
  return out;
}

/** Explicit tags of a stored note: its paths that do not come from the body. */
export function explicitTags(note: Pick<Note, 'tagPaths' | 'body'>): string[] {
  const inline = new Set(inlineTags(note.body));
  return note.tagPaths.filter((path) => !inline.has(path));
}

/** Tag paths to store: explicit tags first, then the inline tags of the body. */
export function mergeTags(explicit: readonly string[], body: string): string[] {
  return normalizeTagPaths([...explicit, ...inlineTags(body)]);
}

// --- Tag filter (W2) ---

export type TagOp = 'and' | 'or';

/** Whether `paths` contain `selected` itself or one of its descendants. */
export function hasTag(paths: readonly string[], selected: string): boolean {
  return paths.some((path) => path === selected || path.startsWith(`${selected}/`));
}

export function matchesTags(paths: readonly string[], selected: readonly string[], op: TagOp): boolean {
  if (selected.length === 0) return true;
  return op === 'and' ? selected.every((s) => hasTag(paths, s)) : selected.some((s) => hasTag(paths, s));
}

/** URL state of the filter (A.1: `/wissen?tag=a/b,c&op=and`); OR is the default and is not written. */
export function parseTagQuery(search: string): { tags: string[]; op: TagOp } {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const tags = normalizeTagPaths((params.get('tag') ?? '').split(','));
  return { tags, op: params.get('op') === 'and' ? 'and' : 'or' };
}

export function tagQueryString(tags: readonly string[], op: TagOp): string {
  if (tags.length === 0) return '';
  const tag = tags.map((t) => encodeURIComponent(t).replace(/%2F/giu, '/')).join(',');
  return op === 'and' ? `?tag=${tag}&op=and` : `?tag=${tag}`;
}

export interface TagNode {
  path: string;
  name: string;
  depth: number;
  /** Notes carrying this tag or one of its descendants. */
  count: number;
  children: TagNode[];
}

/**
 * Tag tree for the tag sheet: every known tag (stored rows plus the paths of the notes, so the tree is
 * complete even without tag rows), alphabetical per level, with note counts. Tags without notes are left out.
 */
export function buildTagTree(tags: readonly Pick<Tag, 'path'>[], notes: readonly Pick<Note, 'tagPaths'>[]): TagNode[] {
  const paths = new Set<string>();
  const add = (path: string): void => {
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join('/'));
  };
  for (const tag of tags) add(tag.path);
  for (const note of notes) for (const path of note.tagPaths) add(path);
  const nodes = new Map<string, TagNode>();
  const roots: TagNode[] = [];
  for (const path of [...paths].sort((a, b) => a.localeCompare(b, 'de'))) {
    const parts = path.split('/');
    const count = notes.filter((note) => hasTag(note.tagPaths, path)).length;
    if (count === 0) continue;
    const node: TagNode = { path, name: parts[parts.length - 1] ?? path, depth: parts.length - 1, count, children: [] };
    nodes.set(path, node);
    const parent = nodes.get(parts.slice(0, -1).join('/'));
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

// --- Search (W1) ---

/** Rank of a note for the normalised query: 0 title, 1 tag, 2 body, -1 no match; '' matches all. */
export function noteRank(note: Pick<Note, 'title' | 'body' | 'tagPaths'>, q: string): number {
  if (q === '') return 0;
  if (normalizeForSearch(note.title).includes(q)) return 0;
  if (note.tagPaths.some((path) => normalizeForSearch(path).includes(q))) return 1;
  if (normalizeForSearch(note.body).includes(q)) return 2;
  return -1;
}

const byUpdatedDesc = (a: Pick<Note, 'updatedAt'>, b: Pick<Note, 'updatedAt'>): number =>
  (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);

/** Notes for the list: filtered by query and tags, ranked (with a query) or newest first. */
export function filterNotes<T extends Pick<Note, 'title' | 'body' | 'tagPaths' | 'updatedAt'>>(
  notes: readonly T[], query: string, tags: readonly string[], op: TagOp,
): T[] {
  const q = normalizeForSearch(query.trim());
  return notes
    .map((note) => ({ note, rank: noteRank(note, q) }))
    .filter((x) => x.rank >= 0 && matchesTags(x.note.tagPaths, tags, op))
    .sort((a, b) => a.rank - b.rank || byUpdatedDesc(a.note, b.note))
    .map((x) => x.note);
}

/**
 * Where the query matches inside `text` (for highlighting in the preview): [start, end) in the original
 * string, or null. Works on the normalised form, which keeps one character per original character for
 * Latin text except "ß" (→ "ss"); then the highlight is skipped rather than misplaced.
 */
export function matchRange(text: string, query: string): [number, number] | null {
  const q = normalizeForSearch(query.trim());
  if (q === '') return null;
  const norm = normalizeForSearch(text);
  if (norm.length !== text.length) return null;
  const at = norm.indexOf(q);
  return at < 0 ? null : [at, at + q.length];
}

// --- Display ---

export interface RelativeTexts { justNow: string; minutesAgo: (n: number) => string }

/** Relative time of a note (A.3 Notizkarte): just now, minutes ago, time today, weekday this week, date. */
export function relativeTime(iso: ISO, now: Date, texts: RelativeTexts): string {
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60000);
  if (minutes < 1) return texts.justNow;
  if (minutes < 60) return texts.minutesAgo(minutes);
  const day: Day = dayOfIso(iso);
  const days = diffDays(dayOfIso(now.toISOString()), day);
  if (days <= 0) return formatTime(iso);
  if (days < 7) return formatWeekdayShort(day);
  return formatDayShort(day);
}

const TAG_TINTS = ['#7FA36F', '#D8B24A', '#C96A5A', '#5B7FB5', '#8C6FB0', '#E0925A', '#6F9C9A'] as const;

/** Leaf colour of a tag: stored colour, else a stable choice from the area palette by its root segment. */
export function tagTint(path: string | undefined, colors?: ReadonlyMap<string, string>): string | undefined {
  if (!path) return undefined;
  const root = path.split('/')[0] ?? path;
  const stored = colors?.get(path) ?? colors?.get(root);
  if (stored) return stored;
  let hash = 0;
  for (const ch of root) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return TAG_TINTS[hash % TAG_TINTS.length];
}

// --- Links (W5) ---
// A link to another note is a regular Markdown link with the `note:` scheme: `[Titel](note:<id>)`. It
// survives renaming the target, stays readable in the Markdown export, and the preview turns it into an
// in-app link (services/markdown.ts). `[[` in the editor inserts it from a note search.

const NOTE_LINK = /\]\(note:([A-Za-z0-9_-]+)\)/gu;

/** Ids of the notes a body links to, without duplicates, in order. */
export function noteLinks(body: string): string[] {
  const out: string[] = [];
  for (const match of body.matchAll(NOTE_LINK)) {
    const id = match[1] ?? '';
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Markdown for a link to a note; brackets in the title are escaped. */
export function noteLinkMarkdown(title: string, id: string): string {
  const label = (title.trim() || id).replace(/([\\[\]])/gu, '\\$1');
  return `[${label}](note:${id})`;
}

/** Notes that link to `id` (Rückverweise), newest first; the note itself is left out. */
export function backlinksOf<T extends Pick<Note, 'id' | 'body' | 'updatedAt'>>(notes: readonly T[], id: string): T[] {
  return notes.filter((n) => n.id !== id && noteLinks(n.body).includes(id)).sort(byUpdatedDesc);
}

/** The line around `caret`: [start, end) and its text. */
export function lineAt(body: string, caret: number): { start: number; end: number; text: string } {
  const at = Math.max(0, Math.min(caret, body.length));
  const start = body.lastIndexOf('\n', at - 1) + 1;
  const nl = body.indexOf('\n', at);
  const end = nl < 0 ? body.length : nl;
  return { start, end, text: body.slice(start, end) };
}

/** Task title from a note line ("Aufgabe aus Zeile"): Markdown marks, tags and links stripped to text. */
export function taskTitleFromLine(line: string): string {
  const text = plainLine(line.replace(/\[([^\]]*)\]\((?:note:[^)]*|[^)]*)\)/gu, '$1'));
  return clip(text, TITLE_MAX);
}

/** Notes matching `query` by title for the `[[` picker (newest first, max `limit`), the current note excluded. */
export function linkCandidates<T extends Pick<Note, 'id' | 'title' | 'updatedAt'>>(notes: readonly T[], query: string, exclude: string, limit = 6): T[] {
  const q = normalizeForSearch(query.trim());
  return notes
    .filter((n) => n.id !== exclude && n.title !== '' && (q === '' || normalizeForSearch(n.title).includes(q)))
    .sort(byUpdatedDesc)
    .slice(0, limit);
}
