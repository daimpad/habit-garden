// WISSEN note editor /wissen/n/:noteId (Phase 4, A.2 W3/W4, A.3 Screen 3; decisions of 13.10.2026: plain
// Markdown source with a toolbar and a Vorschau toggle, the calm card language of PLANUNG).
// Layout: head with back, the note's tags (explicit tags as removable chips, inline `#tags` of the text as
// fixed chips marked "im Text", "+ Schlagwort" with an inline input and suggestions), segmented control
// Quelltext · Vorschau and ⋯ (Anheften/Lösen, Archivieren, Als Markdown exportieren, Löschen; the actions with
// their toasts and Rückgängig come from screens/note-actions.ts, after the pending changes are saved). Body: the whole note in a textarea (title =
// first line; journal notes keep their fixed title, shown as a caption). Dock (sticky above the bottom nav or
// the on-screen keyboard via visualViewport): `#` / `[[` suggestions, the status „Speichert …“/„Gespeichert“
// (aria-live polite) and the toolbar B I H • 1. ☐ ⟨⟩ # 🔗 ☑ ↶ ↷. Below the text: „Rückverweise“ (notes that link
// here, tasks whose linkedNoteIds contain this note), hidden when empty.
//
// Details of this implementation:
// - Autosave: 500 ms after the last input; at once on tag changes, blur, visibilitychange (hidden), pagehide
//   and unmount. While the caret ends a `#tag` that is still being typed, the debounced save waits up to
//   2.5 s without input (a short pause in "#gar…" would otherwise store the stray tag "gar"); such a tag
//   joins the head chips at the same moment. Saves run one after another (saveNoteContent derives title and
//   tagPaths); a failed save is retried after 3 s and shows a calm status line.
// - Live updates of the note (e.g. a journal append from HEUTE) replace the text only while the textarea is
//   not focused and nothing is unsaved or being saved; the undo history starts anew then.
// - Leaving a note without text (only whitespace; explicit tags do not count, a note from a filtered list
//   starts with them; journal notes excepted) deletes it silently.
// - Undo/redo: own snapshot stack (value + selection), since programmatic edits (setRangeText) bypass the
//   native history. Typing is coalesced into bursts (same kind, < 1 s apart, a typed space or newline ends
//   the word); Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y and beforeinput historyUndo/historyRedo use it.
// - Toolbar: buttons keep the textarea focus (pointerdown prevented), so the keyboard stays open; roving
//   tabindex with arrow keys (role toolbar). Ctrl/Cmd+B and Ctrl/Cmd+I in the textarea.
// - Enter inside a list item continues the list (beforeinput insertLineBreak, so it also works with
//   on-screen keyboards); Enter on an empty item ends it. Editing helpers live in services/markdown.ts.
// - `#` autocomplete: while the caret is in a `#tag` token (outside code), a listbox above the toolbar
//   offers up to six existing tag paths (prefix of the path or a segment). ArrowDown/Up choose
//   (aria-activedescendant), Enter takes the chosen one (without a choice Enter stays a line break), Tab takes
//   the chosen or first one, Escape closes it for this token; a tap inserts the full path plus a space.
//   Offered are only paths in use: the tagPaths of all notes (archived ones included) and their ancestors.
// - `[[` (or the toolbar's „Notiz verlinken“) opens the same listbox with linkCandidates (query = text after
//   `[[`); Enter/Tab take the chosen or first note, a tap the tapped one: `[[query` becomes
//   `[Titel](note:<id>)`. No match → a hint row. Escape closes and keeps the text.
// - „Aufgabe aus Zeile“ (toolbar and ⋯): the caret's line becomes a task in the first active area (inbox: no
//   project, no date) with linkedNoteIds [this note]; a plain line or list item turns into `- [ ] …` (task
//   items stay, headings, quotes, tables and code lines are left as they are). Toast with Rückgängig: deletes
//   the task and restores the line if it is unchanged.
// - Vorschau: renderMarkdown() (sanitized) via raw(); task boxes toggle with click/Space/Enter
//   (toggleTaskLine, saved at once), tags navigate to /wissen?tag=…, links open in a new tab, note links open
//   the note in the app (missing notes: not clickable, aria-disabled).
// - main.ts focuses the screen's <h1> (visually hidden, the note title) right after mount; once the note is
//   loaded the textarea takes the focus with the caret at the start.
import type { Subscription } from 'dexie';
import '../components/ol-chip.js';
import '../components/ol-empty-state.js';
import '../components/ol-icon-button.js';
import '../components/ol-segmented.js';
import { showToast } from '../components/ol-toast.js';
import { fmt, t } from '../i18n/de.js';
import type { Id, Note, Task } from '../model.js';
import { firstActiveArea } from '../repo/areas.js';
import { deleteNote, getNote, note$, notes$, saveNoteContent } from '../repo/notes.js';
import { createTask, deleteTask, linkedTasks$ } from '../repo/tasks.js';
import { normalizeTagPath, normalizeTagPaths } from '../repo/tags.js';
import { back, type Route } from '../router.js';
import {
  applyEdit, continueList, cycleHeading, insertLinkMark, insertTagMark, linkTokenAt, renderMarkdown, suggestTags, tagTokenAt,
  toggleCode, toggleInline, toggleLines, toggleTaskLine, type TagToken, type TextEdit,
} from '../services/markdown.js';
import {
  backlinksOf, deriveTitle, explicitTags, inlineTags, lineAt, linkCandidates, noteLinkMarkdown, tagQueryString,
  taskTitleFromLine,
} from '../services/notes.js';
import { emit, h, icon, raw, render, setVar, type SafeHtml } from '../util/dom.js';
import { exportNotesMarkdown } from '../services/notes-export.js';
import { archiveNote, deleteNoteAsked, togglePin } from './note-actions.js';
import { failed, openActionMenu } from './sheets/task.js';

const SAVE_DELAY = 500;
const RETRY_DELAY = 3000;
const BURST_MS = 1000;
const HISTORY_MAX = 200;
const SUGGEST_MAX = 6;
/** How long a save waits while the caret ends a `#tag` being typed (ms of no input). */
const TAG_HOLD_MS = 2500;

type Mode = 'source' | 'preview';
type Tool = 'bold' | 'italic' | 'heading' | 'bullet' | 'ordered' | 'task' | 'code' | 'tag' | 'link' | 'taskline' | 'undo' | 'redo';
type Status = '' | 'saving' | 'saved' | 'failed';

interface ToolDef { tool: Tool; icon: string; label: string; keys?: string }

const FORMAT_TOOLS: readonly ToolDef[] = [
  { tool: 'bold', icon: 'bold', label: t.noteToolBold, keys: 'Control+B Meta+B' },
  { tool: 'italic', icon: 'italic', label: t.noteToolItalic, keys: 'Control+I Meta+I' },
  { tool: 'heading', icon: 'heading', label: t.noteToolHeading },
  { tool: 'bullet', icon: 'list', label: t.noteToolList },
  { tool: 'ordered', icon: 'list-ordered', label: t.noteToolOrdered },
  { tool: 'task', icon: 'list-todo', label: t.noteToolTask },
  { tool: 'code', icon: 'code', label: t.noteToolCode },
  { tool: 'tag', icon: 'hash', label: t.noteToolTag },
  { tool: 'link', icon: 'link', label: t.noteToolLink },
  { tool: 'taskline', icon: 'square-check', label: t.noteToolTaskFromLine },
];
const HISTORY_TOOLS: readonly ToolDef[] = [
  { tool: 'undo', icon: 'undo-2', label: t.noteToolUndo, keys: 'Control+Z Meta+Z' },
  { tool: 'redo', icon: 'redo-2', label: t.noteToolRedo, keys: 'Control+Shift+Z Meta+Shift+Z Control+Y' },
];

interface Snap { value: string; start: number; end: number }
/** One row of a suggestion listbox; a hint row (no match) cannot be chosen. */
interface Option { key: string; label: string; icon: string; hint?: boolean }
/** Open suggestions in the textarea: `#tag` (replace [start, end)) or `[[query` (replace [start, caret)). */
interface Suggest { kind: 'tag' | 'note'; start: number; end: number; anchor: number; items: Option[]; active: number }
/** A line turned into a task item by „Aufgabe aus Zeile“ (for Rückgängig). */
interface LineChange { start: number; before: string; after: string }

const TASK_ITEM = /^\s*(?:>\s*)*[-*+][ \t]+\[[ xX]\][ \t]/u;
const NO_TASK_LINE = /^\s*(?:>|\||#{1,6}\s|`{3,}|~{3,})|^ {4}/u;

let seq = 0;

export function mount(view: HTMLElement, route: Route): () => void {
  const editor = new NoteEditor(view, route.params['noteId'] ?? '');
  editor.start();
  return () => editor.destroy();
}

function req<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`note-editor: missing ${selector}`);
  return el;
}

function detailOf<T>(event: Event): T | null {
  return event instanceof CustomEvent ? (event.detail as T) : null;
}

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function isMod(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

function tagOptions(paths: readonly string[]): Option[] {
  return paths.map((path) => ({ key: path, label: path, icon: 'hash' }));
}

/** Text of a list item without its nested lists (accessible name of a task box). */
function itemText(li: Element | null): string {
  if (!li) return '';
  return [...li.childNodes]
    .filter((node) => !(node instanceof HTMLElement && (node.tagName === 'UL' || node.tagName === 'OL')))
    .map((node) => node.textContent ?? '')
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
}

class NoteEditor {
  private readonly uid = `ol-note-${++seq}`;
  private readonly subs: Subscription[] = [];
  private readonly cleanups: Array<() => void> = [];
  private destroyed = false;
  /** Deleted or archived from the ⋯ menu: no more saves, no silent delete. */
  private gone = false;
  /** The delete dialog of the ⋯ menu is open or deleting. */
  private deleting = false;

  private note: Note | null = null;
  private missing = false;
  private body = '';
  private explicit: string[] = [];
  /** Tag paths in use (all notes' tagPaths and their ancestors): the suggestions. */
  private tagPaths: string[] = [];
  private allNotes: Note[] = [];
  /** Ids of all notes (for missing note links in the preview); null until loaded. */
  private noteIds: Set<string> | null = null;
  private linkedTasks: Task[] = [];
  private backlinksKey = '';
  private mode: Mode = 'source';

  private savedSig = '';
  private chain: Promise<void> = Promise.resolve();
  private inFlight = 0;
  private saveTimer = 0;
  private retryTimer = 0;
  private saveFailed = false;

  private history: Snap[] = [];
  private index = 0;
  private burst: 'insert' | 'delete' | null = null;
  private lastTypeAt = 0;
  private lastEditAt = 0;

  private suggest: Suggest | null = null;
  /** `kind:anchor` of the suggestions closed with Escape (until the caret leaves that token). */
  private dismissed: string | null = null;
  private tagItems: string[] = [];
  private tagActive = -1;
  private tagsKey = '';

  private readonly root: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly journal: HTMLElement;
  private readonly tagList: HTMLElement;
  private readonly addChip: HTMLElement;
  private readonly tagForm: HTMLElement;
  private readonly tagInput: HTMLInputElement;
  private readonly tagListbox: HTMLElement;
  private readonly modeEl: HTMLElement;
  private readonly ta: HTMLTextAreaElement;
  private readonly preview: HTMLElement;
  private readonly dock: HTMLElement;
  private readonly suggestEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly goneEl: HTMLElement;
  private readonly backlinksEl: HTMLElement;

  constructor(private readonly view: HTMLElement, private readonly id: Id) {
    this.renderSkeleton();
    const v = this.view;
    this.root = req(v, '.ol-note');
    this.heading = req(v, '.ol-note__heading');
    this.journal = req(v, '.ol-note__journal');
    this.tagList = req(v, '.ol-note__tag-list');
    this.addChip = req(v, '.ol-note__tag-add');
    this.tagForm = req(v, '.ol-note__tag-form');
    this.tagInput = req<HTMLInputElement>(v, '.ol-note__tag-input');
    this.tagListbox = req(v, '.ol-note__tag-listbox');
    this.modeEl = req(v, '.ol-note__mode');
    this.ta = req<HTMLTextAreaElement>(v, '.ol-note__text');
    this.preview = req(v, '.ol-note__preview');
    this.dock = req(v, '.ol-note__dock');
    this.suggestEl = req(v, '.ol-note__suggest');
    this.statusEl = req(v, '.ol-note__status');
    this.toolbar = req(v, '.ol-note__toolbar');
    this.goneEl = req(v, '.ol-note__gone');
    this.backlinksEl = req(v, '.ol-note__backlinks');
    this.bind();
  }

  // --- Lifecycle ---

  start(): void {
    try {
      this.subs.push(note$(this.id).subscribe({
        next: (note) => this.guard(() => this.onNote(note)),
        error: (err: unknown) => console.error(err),
      }));
      this.subs.push(notes$(true).subscribe({
        next: (notes: Note[]) => this.guard(() => this.onNotes(notes)),
        error: (err: unknown) => console.error(err),
      }));
      this.subs.push(linkedTasks$(this.id).subscribe({
        next: (tasks: Task[]) => this.guard(() => {
          this.linkedTasks = tasks;
          this.renderBacklinks();
        }),
        error: (err: unknown) => console.error(err),
      }));
    } catch (err) {
      console.error(err);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const sub of this.subs) sub.unsubscribe();
    this.subs.length = 0;
    for (const off of this.cleanups) off();
    this.cleanups.length = 0;
    window.clearTimeout(this.retryTimer);
    const note = this.note;
    if (!note || this.gone || this.missing) {
      window.clearTimeout(this.saveTimer);
      return;
    }
    if (note.kind !== 'journal' && this.body.trim() === '') {
      // A note without text is not kept (explicit tags alone come from a filtered list).
      window.clearTimeout(this.saveTimer);
      const id = this.id;
      void this.chain.then(() => deleteNote(id)).catch((err: unknown) => console.error(err));
      return;
    }
    void this.flush();
  }

  private guard(fn: () => void): void {
    if (this.destroyed) return;
    try {
      fn();
    } catch (err) {
      console.error(err);
    }
  }

  // --- Skeleton and events ---

  private renderSkeleton(): void {
    const id = this.uid;
    const tool = (def: ToolDef, first: boolean): SafeHtml => h`<button type="button" class="ol-note__tool" data-tool="${def.tool}"
      aria-label="${def.label}" title="${def.label}" tabindex="${first ? '0' : '-1'}"${def.keys ? h` aria-keyshortcuts="${def.keys}"` : ''}>${icon(def.icon, 20)}</button>`;
    render(this.view, h`
      <div class="ol-note" data-loading>
        <header class="ol-note__head">
          <ol-icon-button class="ol-note__back" icon="arrow-left" label="${t.actionBack}"></ol-icon-button>
          <h1 class="ol-note__heading ol-visually-hidden">${t.noteHeadingNew}</h1>
          <div class="ol-note__tags">
            <ul class="ol-note__tag-list" aria-label="${t.noteTagsAria}"></ul>
            <ol-chip class="ol-note__tag-add" variant="assist" icon="plus" label="${t.noteTagAdd}" aria-label="${t.noteTagAddAria}"></ol-chip>
            <div class="ol-note__tag-form" hidden>
              <input class="ol-note__tag-input" id="${id}-tag" type="text" role="combobox" aria-autocomplete="list"
                aria-expanded="false" aria-controls="${id}-tags" aria-label="${t.noteTagInputLabel}"
                placeholder="${t.noteTagInputPlaceholder}" autocomplete="off" autocapitalize="none" spellcheck="false"
                enterkeyhint="done" maxlength="200">
              <ul class="ol-note__listbox ol-note__tag-listbox" id="${id}-tags" role="listbox" aria-label="${t.noteTagSuggestions}" hidden></ul>
            </div>
          </div>
          <ol-segmented class="ol-note__mode" label="${t.noteModeAria}" value="source">
            <button type="button" data-value="source">${t.noteModeSource}</button>
            <button type="button" data-value="preview">${t.noteModePreview}</button>
          </ol-segmented>
          <ol-icon-button class="ol-note__more" icon="ellipsis" label="${t.actionMore}"></ol-icon-button>
        </header>
        <p class="ol-note__journal ol-caption" hidden></p>
        <div class="ol-note__body">
          <label class="ol-visually-hidden" for="${id}-text">${t.noteBodyLabel}</label>
          <textarea class="ol-note__text" id="${id}-text" rows="8" placeholder="${t.notePlaceholder}" spellcheck="true"
            autocapitalize="sentences" aria-autocomplete="list" aria-controls="${id}-suggest"></textarea>
          <div class="ol-note__preview ol-md" hidden></div>
        </div>
        <section class="ol-note__backlinks" aria-labelledby="${id}-backlinks" hidden>
          <h2 class="ol-label" id="${id}-backlinks">${t.noteBacklinks}</h2>
          <ul class="ol-note__backlink-list"></ul>
        </section>
        <div class="ol-note__dock">
          <ul class="ol-note__listbox ol-note__suggest" id="${id}-suggest" role="listbox" aria-label="${t.noteTagSuggestions}" hidden></ul>
          <p class="ol-note__status ol-caption" role="status" aria-live="polite"></p>
          <div class="ol-note__toolbar" role="toolbar" aria-label="${t.noteToolbarAria}" aria-controls="${id}-text">
            <div class="ol-note__tools">${FORMAT_TOOLS.map((def, i) => tool(def, i === 0))}</div>
            <div class="ol-note__tools ol-note__tools--history">${HISTORY_TOOLS.map((def) => tool(def, false))}</div>
          </div>
        </div>
        <ol-empty-state class="ol-note__gone" icon="file-x" message="${t.noteMissing}" action="${t.noteMissingBack}" hidden></ol-empty-state>
      </div>`);
  }

  private listen<K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (event: HTMLElementEventMap[K]) => void): void {
    el.addEventListener(type, (event) => this.guard(() => fn(event)));
  }

  private bind(): void {
    const ta = this.ta;
    req(this.view, '.ol-note__back').addEventListener('click', () => back());
    req(this.view, '.ol-note__more').addEventListener('click', () => this.openMenu());
    this.goneEl.addEventListener('ol-action', () => back());
    this.modeEl.addEventListener('ol-change', (event) => {
      const value = detailOf<{ value?: string }>(event)?.value;
      if (value === 'source' || value === 'preview') this.guard(() => this.setMode(value));
    });

    // Textarea
    this.listen(ta, 'beforeinput', (event) => this.onBeforeInput(event));
    this.listen(ta, 'input', (event) => this.onInput(event));
    this.listen(ta, 'keydown', (event) => this.onKeyDown(event));
    this.listen(ta, 'blur', () => {
      this.closeSuggest();
      this.renderTags();
      void this.flush();
    });
    this.listen(ta, 'pointerdown', () => {
      this.burst = null;
    });
    this.listen(ta, 'click', () => this.updateSuggest());
    this.listen(ta, 'keyup', (event) => {
      if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') this.updateSuggest();
    });
    const onSelection = (): void => this.guard(() => {
      if (document.activeElement === ta) this.updateSuggest();
    });
    document.addEventListener('selectionchange', onSelection);
    this.cleanups.push(() => document.removeEventListener('selectionchange', onSelection));

    // Suggestions (both listboxes): keep the focus in the field, take the tapped option.
    for (const list of [this.suggestEl, this.tagListbox]) {
      list.addEventListener('pointerdown', (event) => event.preventDefault());
      list.addEventListener('mousedown', (event) => event.preventDefault());
    }
    this.listen(this.suggestEl, 'click', (event) => {
      const key = this.optionKey(event);
      if (key) this.acceptSuggest(key);
    });
    this.listen(this.tagListbox, 'click', (event) => {
      const key = this.optionKey(event);
      if (key) this.commitTag(key, true);
    });
    this.listen(this.backlinksEl, 'click', (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-path]') : null;
      const path = button?.dataset['path'];
      if (button && path) {
        void this.flush();
        emit(button, 'ol-navigate', { path });
      }
    });

    // Toolbar
    this.toolbar.addEventListener('pointerdown', (event) => {
      if (event.target instanceof Element && event.target.closest('.ol-note__tool')) event.preventDefault();
    });
    this.toolbar.addEventListener('mousedown', (event) => {
      if (event.target instanceof Element && event.target.closest('.ol-note__tool')) event.preventDefault();
    });
    this.listen(this.toolbar, 'click', (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>('.ol-note__tool') : null;
      const tool = button?.dataset['tool'] as Tool | undefined;
      if (!button || !tool || button.getAttribute('aria-disabled') === 'true') return;
      this.rove(button);
      this.runTool(tool);
    });
    this.listen(this.toolbar, 'keydown', (event) => this.onToolbarKey(event));
    // Narrow screens scroll the format tools: fade the edge where more tools are hidden.
    const tools = req<HTMLElement>(this.toolbar, '.ol-note__tools');
    const edges = (): void => {
      const max = tools.scrollWidth - tools.clientWidth;
      tools.toggleAttribute('data-more-start', max > 1 && tools.scrollLeft > 1);
      tools.toggleAttribute('data-more-end', max > 1 && tools.scrollLeft < max - 1);
    };
    tools.addEventListener('scroll', edges, { passive: true });
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(edges);
      observer.observe(tools);
      this.cleanups.push(() => observer.disconnect());
    }
    // A tool reached with the keyboard scrolls into view.
    this.toolbar.addEventListener('focusin', (event) => {
      if (event.target instanceof HTMLElement && tools.contains(event.target)) event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });

    // Tags in the head
    this.listen(this.addChip, 'click', () => this.openTagForm());
    this.tagList.addEventListener('ol-remove', (event) => {
      const value = detailOf<{ value?: string }>(event)?.value;
      if (value) this.guard(() => this.removeTag(value));
    });
    this.listen(this.tagInput, 'input', () => this.updateTagSuggestions());
    this.listen(this.tagInput, 'keydown', (event) => this.onTagKey(event));
    this.listen(this.tagForm, 'focusout', (event) => {
      const to = event.relatedTarget;
      if (to instanceof Node && this.tagForm.contains(to)) return;
      if (this.tagForm.hidden) return;
      const value = this.tagInput.value;
      this.closeTagForm(false);
      if (value.trim() !== '') this.commitTag(value, false);
    });

    // Preview
    this.listen(this.preview, 'click', (event) => this.onPreviewActivate(event));
    this.listen(this.preview, 'keydown', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.matches('.ol-md-check') && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault();
        if (!event.repeat) this.onPreviewActivate(event);
      } else if (target?.matches('.ol-md-tag') && event.key === 'Enter') {
        event.preventDefault();
        this.onPreviewActivate(event);
      }
    });

    // Save when the page goes away; keep the dock above the on-screen keyboard.
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') void this.flush();
    };
    const onPageHide = (): void => void this.flush();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    this.cleanups.push(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    });
    const vv = window.visualViewport;
    if (vv) {
      const onViewport = (): void => this.guard(() => this.placeDock());
      vv.addEventListener('resize', onViewport);
      vv.addEventListener('scroll', onViewport);
      this.cleanups.push(() => {
        vv.removeEventListener('resize', onViewport);
        vv.removeEventListener('scroll', onViewport);
      });
    }
  }

  // --- Note state ---

  /** Comparable save state: body plus the explicit tags that are not inline tags of the body. */
  private sig(body: string, explicit: readonly string[]): string {
    const inline = new Set(inlineTags(body));
    return `${normalizeTagPaths(explicit).filter((p) => !inline.has(p)).join('\n')}\u0000${body}`;
  }

  private dirty(): boolean {
    return this.sig(this.body, this.explicit) !== this.savedSig;
  }

  private onNote(note: Note | undefined): void {
    if (!note) {
      if (!this.gone && !this.deleting) this.showMissing();
      return;
    }
    const first = this.note === null;
    this.note = note;
    if (this.missing) {
      // Restored elsewhere (e.g. Rückgängig): back to editing.
      this.missing = false;
      this.goneEl.hidden = true;
      this.root.removeAttribute('data-missing');
    }
    const external = this.sig(note.body, explicitTags(note));
    if (first) {
      this.adopt(note);
      this.root.removeAttribute('data-loading');
      this.placeDock();
      this.focusText();
    } else if (external !== this.savedSig && external !== this.sig(this.body, this.explicit) && !this.busy()) {
      this.adopt(note);
    }
    this.renderMeta();
  }

  /** Whether the user is editing: focused textarea or tag field, unsaved or saving changes. */
  private busy(): boolean {
    const active = document.activeElement;
    return active === this.ta || active === this.tagInput || this.dirty() || this.inFlight > 0 || this.saveTimer !== 0;
  }

  /** Takes the stored note as the editor state (first load and accepted external changes). */
  private adopt(note: Note): void {
    this.body = note.body;
    this.explicit = explicitTags(note);
    this.savedSig = this.sig(this.body, this.explicit);
    if (this.ta.value !== note.body) this.ta.value = note.body;
    this.ta.setSelectionRange(0, 0);
    this.resetHistory();
    this.renderTags();
    this.renderHeading();
    this.autosize();
    if (this.mode === 'preview') this.renderPreview();
  }

  private renderMeta(): void {
    const note = this.note;
    if (!note) return;
    this.journal.hidden = note.kind !== 'journal';
    setText(this.journal, note.kind === 'journal' ? fmt(t.noteJournalTitle, { title: note.title }) : '');
    this.renderHeading();
  }

  private renderHeading(): void {
    const note = this.note;
    const title = note?.kind === 'journal' ? note.title : deriveTitle(this.body);
    setText(this.heading, title || t.noteHeadingNew);
  }

  private titleText(): string {
    return this.heading.textContent ?? t.noteHeadingNew;
  }

  private showMissing(): void {
    this.missing = true;
    this.root.removeAttribute('data-loading');
    this.root.setAttribute('data-missing', '');
    this.goneEl.hidden = false;
    this.closeTagForm(false);
    this.closeSuggest();
    setText(this.heading, t.noteMissing);
  }

  /** Focus the textarea once the note is there, unless the user moved focus elsewhere meanwhile. */
  private focusText(): void {
    const active = document.activeElement;
    const free = active === null || active === document.body || active === this.view || active === this.heading;
    if (!free || this.mode !== 'source') return;
    this.ta.focus({ preventScroll: true });
    this.ta.setSelectionRange(0, 0);
  }

  // --- Saving ---

  private setStatus(status: Status): void {
    const text = status === 'saving' ? t.noteStatusSaving : status === 'saved' ? t.noteStatusSaved : status === 'failed' ? t.noteStatusFailed : '';
    setText(this.statusEl, text);
    this.statusEl.dataset['status'] = status;
  }

  private scheduleSave(): void {
    if (!this.note || this.gone) return;
    window.clearTimeout(this.saveTimer);
    if (!this.dirty()) {
      this.saveTimer = 0;
      if (this.inFlight === 0 && this.statusEl.dataset['status'] === 'saving') this.setStatus('saved');
      return;
    }
    this.setStatus('saving');
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = 0;
      // A tag that is still being typed ("#gar…") is not stored yet: it would leave a stray tag row.
      // Leaving the token, blur, hiding the page and unmounting save as usual.
      if (this.tagHold()) {
        this.scheduleSave();
        return;
      }
      this.renderTags();
      void this.flush();
    }, SAVE_DELAY);
  }

  /** The `#tag` token the caret sits at the end of while typing in the textarea. */
  private tagInProgress(): TagToken | null {
    const ta = this.ta;
    if (this.mode !== 'source' || document.activeElement !== ta || ta.selectionStart !== ta.selectionEnd) return null;
    const token = tagTokenAt(ta.value, ta.selectionStart);
    return token && token.end === ta.selectionStart ? token : null;
  }

  /** tagInProgress() while the last input is less than TAG_HOLD_MS ago (then the tag counts as typed). */
  private tagHold(): TagToken | null {
    return performance.now() - this.lastEditAt < TAG_HOLD_MS ? this.tagInProgress() : null;
  }

  /** Starts saving the current state right away (no-op when nothing changed); resolves when it is stored. */
  private flush(): Promise<void> {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = 0;
    if (!this.note || this.gone || this.missing || !this.dirty()) return this.chain;
    const body = this.body;
    const explicit = [...this.explicit];
    const sig = this.sig(body, explicit);
    this.inFlight++;
    if (!this.destroyed) this.setStatus('saving');
    this.chain = this.chain
      .then(async () => {
        if (sig === this.savedSig) return;
        try {
          const saved = await saveNoteContent(this.id, body, explicit);
          if (saved) this.savedSig = sig;
        } catch (err) {
          console.error(err);
          this.saveFailed = true;
        }
      })
      .finally(() => {
        this.inFlight--;
        this.afterSave();
      });
    return this.chain;
  }

  private afterSave(): void {
    if (this.destroyed) return;
    if (this.saveFailed) {
      this.saveFailed = false;
      this.setStatus('failed');
      window.clearTimeout(this.retryTimer);
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = 0;
        void this.flush();
      }, RETRY_DELAY);
      return;
    }
    if (this.inFlight > 0) return;
    this.setStatus(this.dirty() ? 'saving' : 'saved');
  }

  // --- Text changes and history ---

  private snap(): Snap {
    return { value: this.ta.value, start: this.ta.selectionStart, end: this.ta.selectionEnd };
  }

  private resetHistory(): void {
    this.history = [this.snap()];
    this.index = 0;
    this.burst = null;
    this.updateHistoryTools();
  }

  private pushHistory(): void {
    this.history.splice(this.index + 1);
    this.history.push(this.snap());
    if (this.history.length > HISTORY_MAX) this.history.shift();
    this.index = this.history.length - 1;
  }

  /** The current entry remembers the selection the user made since (restored on undo of later edits). */
  private syncSelection(): void {
    const top = this.history[this.index];
    if (top && top.value === this.ta.value) {
      top.start = this.ta.selectionStart;
      top.end = this.ta.selectionEnd;
    }
  }

  private onInput(event: Event): void {
    const type = event instanceof InputEvent ? event.inputType : '';
    const data = event instanceof InputEvent ? event.data ?? '' : '';
    const kind = type.startsWith('delete') ? 'delete'
      : type === 'insertText' || type === 'insertCompositionText' ? 'insert' : null;
    const now = performance.now();
    if (kind !== null && this.burst === kind && now - this.lastTypeAt < BURST_MS && this.index > 0) {
      this.history[this.index] = this.snap();
    } else {
      this.pushHistory();
    }
    this.burst = kind === 'insert' && /\s$/u.test(data) ? null : kind;
    this.lastTypeAt = now;
    this.changed();
  }

  /** After any change of the textarea value. */
  private changed(): void {
    this.body = this.ta.value;
    this.lastEditAt = performance.now();
    this.autosize();
    this.renderTags();
    this.renderHeading();
    this.updateHistoryTools();
    this.scheduleSave();
    if (this.mode === 'preview') this.renderPreview();
    else this.updateSuggest();
  }

  /** Programmatic edit (toolbar, list continuation, autocomplete): one undo step. */
  private apply(edit: TextEdit): void {
    const ta = this.ta;
    this.syncSelection();
    if (this.mode === 'source' && document.activeElement !== ta) ta.focus({ preventScroll: true });
    ta.setRangeText(edit.text, edit.start, edit.end, 'preserve');
    ta.setSelectionRange(edit.selStart, edit.selEnd);
    this.burst = null;
    this.pushHistory();
    this.changed();
    this.revealCaret();
  }

  private restore(snap: Snap): void {
    const ta = this.ta;
    ta.value = snap.value;
    if (this.mode === 'source') ta.focus({ preventScroll: true });
    ta.setSelectionRange(snap.start, snap.end);
    this.burst = null;
    this.changed();
    this.revealCaret();
  }

  private undo(): void {
    if (this.index <= 0) return;
    this.syncSelection();
    this.index--;
    const snap = this.history[this.index];
    if (snap) this.restore(snap);
  }

  private redo(): void {
    if (this.index >= this.history.length - 1) return;
    this.index++;
    const snap = this.history[this.index];
    if (snap) this.restore(snap);
  }

  private updateHistoryTools(): void {
    const undo = this.toolbar.querySelector('[data-tool="undo"]');
    const redo = this.toolbar.querySelector('[data-tool="redo"]');
    undo?.setAttribute('aria-disabled', this.index <= 0 ? 'true' : 'false');
    redo?.setAttribute('aria-disabled', this.index >= this.history.length - 1 ? 'true' : 'false');
  }

  private onBeforeInput(event: InputEvent): void {
    const type = event.inputType;
    if (type === 'historyUndo' || type === 'historyRedo') {
      event.preventDefault();
      if (type === 'historyUndo') this.undo();
      else this.redo();
      return;
    }
    if ((type === 'insertLineBreak' || type === 'insertParagraph') && !event.isComposing) {
      const ta = this.ta;
      if (ta.selectionStart !== ta.selectionEnd) return;
      const edit = continueList(ta.value, ta.selectionStart);
      if (!edit) return;
      event.preventDefault();
      this.apply(edit);
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (this.suggest && this.onSuggestKey(event)) return;
    if (isMod(event) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'b' || key === 'i') {
        event.preventDefault();
        this.runTool(key === 'b' ? 'bold' : 'italic');
        return;
      }
      if (key === 'z' || key === 'y') {
        event.preventDefault();
        if (key === 'y' || event.shiftKey) this.redo();
        else this.undo();
        return;
      }
    }
    if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End' || event.key.startsWith('Page')) {
      this.burst = null;
    }
  }

  // --- Toolbar ---

  private runTool(tool: Tool): void {
    if (this.mode !== 'source') return;
    if (tool === 'undo') {
      this.undo();
      return;
    }
    if (tool === 'redo') {
      this.redo();
      return;
    }
    if (tool === 'taskline') {
      void this.taskFromLine();
      return;
    }
    const ta = this.ta;
    const value = ta.value;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    let edit: TextEdit;
    switch (tool) {
      case 'bold':
      case 'italic':
        edit = toggleInline(value, s, e, tool);
        break;
      case 'heading':
        edit = cycleHeading(value, s, e);
        break;
      case 'bullet':
      case 'ordered':
      case 'task':
        edit = toggleLines(value, s, e, tool);
        break;
      case 'code':
        edit = toggleCode(value, s, e);
        break;
      case 'tag':
        edit = insertTagMark(value, s, e);
        this.dismissed = null;
        break;
      case 'link':
        edit = insertLinkMark(value, s, e);
        this.dismissed = null;
        break;
    }
    this.apply(edit);
  }

  /** Roving tabindex: the last used tool is the toolbar's tab stop. */
  private rove(button: HTMLElement): void {
    for (const el of this.toolButtons()) el.tabIndex = el === button ? 0 : -1;
  }

  private toolButtons(): HTMLElement[] {
    return [...this.toolbar.querySelectorAll<HTMLElement>('.ol-note__tool')];
  }

  private onToolbarKey(event: KeyboardEvent): void {
    const buttons = this.toolButtons();
    const at = buttons.findIndex((b) => b === document.activeElement);
    if (at < 0) return;
    let next: HTMLElement | undefined;
    if (event.key === 'ArrowRight') next = buttons[(at + 1) % buttons.length];
    else if (event.key === 'ArrowLeft') next = buttons[(at - 1 + buttons.length) % buttons.length];
    else if (event.key === 'Home') next = buttons[0];
    else if (event.key === 'End') next = buttons[buttons.length - 1];
    else return;
    event.preventDefault();
    if (!next) return;
    this.rove(next);
    next.focus();
  }

  // --- Layout helpers ---

  /** Grows the textarea with its content (the page scrolls, not the field). */
  private autosize(): void {
    const ta = this.ta;
    if (ta.hidden || !ta.isConnected) return;
    const y = window.scrollY;
    ta.style.setProperty('height', 'auto');
    const cs = getComputedStyle(ta);
    const borders = (Number.parseFloat(cs.borderTopWidth) || 0) + (Number.parseFloat(cs.borderBottomWidth) || 0);
    ta.style.setProperty('height', `${Math.ceil(ta.scrollHeight + borders)}px`);
    if (window.scrollY !== y) window.scrollTo(0, y);
  }

  /** Keeps the caret clear of the dock when it is on the last lines (typing at the end of a long note). */
  private revealCaret(): void {
    const ta = this.ta;
    if (this.mode !== 'source' || document.activeElement !== ta) return;
    if (ta.value.indexOf('\n', ta.selectionEnd) >= 0) return;
    const dockTop = this.dock.getBoundingClientRect().top;
    const bottom = ta.getBoundingClientRect().bottom - (Number.parseFloat(getComputedStyle(ta).paddingBottom) || 0);
    const over = bottom - (dockTop - 8);
    if (over > 0) window.scrollBy(0, over);
  }

  /** On-screen keyboard height (visualViewport): the dock sits above it instead of above the bottom nav. */
  private placeDock(): void {
    const vv = window.visualViewport;
    let kb = 0;
    if (vv && Math.abs(vv.scale - 1) < 0.01) kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    setVar(this.root, '--ol-note-kb', `${kb}px`);
    this.root.toggleAttribute('data-keyboard', kb > 80);
  }

  // --- Mode ---

  private setMode(mode: Mode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (this.modeEl.getAttribute('value') !== mode) this.modeEl.setAttribute('value', mode);
    this.closeSuggest();
    this.ta.hidden = mode !== 'source';
    this.preview.hidden = mode !== 'preview';
    this.toolbar.hidden = mode !== 'source';
    this.root.dataset['mode'] = mode;
    if (mode === 'preview') {
      void this.flush();
      this.renderPreview();
    } else {
      this.autosize();
    }
  }

  // --- Preview ---

  private renderPreview(): void {
    const el = this.preview;
    if (this.body.trim() === '') {
      render(el, h`<p class="ol-note__preview-empty">${t.notePreviewEmpty}</p>`);
      return;
    }
    render(el, raw(renderMarkdown(this.body, this.noteIds ? { notes: this.noteIds } : {})));
    for (const link of el.querySelectorAll<HTMLElement>('.ol-md-note--missing')) link.title = t.noteLinkMissing;
    for (const tag of el.querySelectorAll<HTMLElement>('.ol-md-tag')) {
      tag.setAttribute('role', 'link');
      tag.tabIndex = 0;
      tag.setAttribute('aria-label', fmt(t.notePreviewTagAria, { tag: tag.dataset['tag'] ?? '' }));
    }
    for (const box of el.querySelectorAll<HTMLElement>('.ol-md-check')) {
      const label = itemText(box.closest('li'));
      if (label) box.setAttribute('aria-label', label);
    }
  }

  private onPreviewActivate(event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    const check = target?.closest<HTMLElement>('.ol-md-check');
    if (check) {
      const line = Number(check.dataset['line']);
      this.toggleTask(line);
      return;
    }
    const link = target?.closest<HTMLElement>('.ol-md-note');
    if (link) {
      event.preventDefault();
      const id = link.dataset['note'];
      if (!id || link.classList.contains('ol-md-note--missing')) return;
      void this.flush();
      emit(link, 'ol-navigate', { path: `/wissen/n/${encodeURIComponent(id)}` });
      return;
    }
    const tag = target?.closest<HTMLElement>('.ol-md-tag');
    const path = tag?.dataset['tag'];
    if (tag && path) emit(tag, 'ol-navigate', { path: `/wissen${tagQueryString([path], 'or')}` });
  }

  private toggleTask(line: number): void {
    const next = toggleTaskLine(this.body, line);
    if (next === this.body) return;
    this.syncSelection();
    this.ta.value = next;
    this.pushHistory();
    this.changed();
    void this.flush();
    this.preview.querySelector<HTMLElement>(`.ol-md-check[data-line="${line}"]`)?.focus({ preventScroll: true });
  }

  // --- Tags in the head ---

  private renderTags(): void {
    // The tag being typed shows up once it is complete (caret leaves it).
    const typing = this.tagHold();
    const inline = inlineTags(typing ? this.body.slice(0, typing.hash) + this.body.slice(typing.end) : this.body);
    const explicit = this.explicit;
    const key = JSON.stringify([explicit, inline]);
    if (key === this.tagsKey) return;
    this.tagsKey = key;
    const fixed = inline.filter((path) => !explicit.includes(path));
    render(this.tagList, h`${explicit.map((path) => h`<li class="ol-note__tag" data-path="${path}"><ol-chip variant="input" value="${path}" label="${`#${path}`}"></ol-chip></li>`)}${
      fixed.map((path) => h`<li class="ol-note__tag ol-note__tag--inline" data-path="${path}" title="${fmt(t.noteTagInline, { tag: path })}"><span aria-hidden="true">#${path}</span><span class="ol-visually-hidden">${fmt(t.noteTagInlineAria, { tag: path })}</span></li>`)}`);
    this.tagList.hidden = explicit.length + fixed.length === 0;
  }

  private removeTag(path: string): void {
    const at = this.explicit.indexOf(path);
    if (at < 0) return;
    this.explicit = this.explicit.filter((p) => p !== path);
    this.renderTags();
    void this.flush();
    // Focus the neighbouring chip's × (or "+ Schlagwort") instead of losing it with the removed chip.
    const chips = [...this.tagList.querySelectorAll<HTMLElement>('ol-chip .ol-chip__remove')];
    (chips[Math.min(at, chips.length - 1)] ?? this.addChip).focus();
  }

  private openTagForm(): void {
    this.addChip.hidden = true;
    this.tagForm.hidden = false;
    this.tagInput.value = '';
    this.tagInput.focus();
    this.updateTagSuggestions();
  }

  private closeTagForm(focusAdd: boolean): void {
    if (this.tagForm.hidden) return;
    this.tagForm.hidden = true;
    this.tagItems = [];
    this.tagActive = -1;
    this.renderOptions(this.tagListbox, this.tagInput, [], -1);
    this.tagInput.value = '';
    this.addChip.hidden = false;
    if (focusAdd) this.addChip.focus();
  }

  /** Adds an explicit tag (normalized; tags already on the note are skipped). */
  private commitTag(input: string, close: boolean): void {
    const path = normalizeTagPath(input);
    if (close) this.closeTagForm(true);
    if (path === '' || this.explicit.includes(path) || inlineTags(this.body).includes(path)) return;
    this.explicit = [...this.explicit, path];
    this.renderTags();
    void this.flush();
  }

  private updateTagSuggestions(): void {
    const exclude = new Set([...this.explicit, ...inlineTags(this.body)]);
    const items = suggestTags(this.tagPaths, this.tagInput.value, exclude, SUGGEST_MAX);
    if (items.join('\n') !== this.tagItems.join('\n')) this.tagActive = -1;
    this.tagItems = items;
    this.renderOptions(this.tagListbox, this.tagInput, tagOptions(items), this.tagActive);
  }

  private onTagKey(event: KeyboardEvent): void {
    const n = this.tagItems.length;
    if (event.key === 'ArrowDown' && n > 0) {
      event.preventDefault();
      this.tagActive = (this.tagActive + 1) % n;
      this.renderOptions(this.tagListbox, this.tagInput, tagOptions(this.tagItems), this.tagActive);
    } else if (event.key === 'ArrowUp' && n > 0) {
      event.preventDefault();
      this.tagActive = this.tagActive <= 0 ? n - 1 : this.tagActive - 1;
      this.renderOptions(this.tagListbox, this.tagInput, tagOptions(this.tagItems), this.tagActive);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = this.tagItems[this.tagActive];
      this.commitTag(chosen ?? this.tagInput.value, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeTagForm(true);
    }
  }

  // --- `#` and `[[` suggestions in the textarea ---

  private updateSuggest(): void {
    const ta = this.ta;
    this.renderTags();
    if (this.mode !== 'source' || document.activeElement !== ta || ta.selectionStart !== ta.selectionEnd) {
      this.closeSuggest();
      return;
    }
    const caret = ta.selectionStart;
    const next = this.linkSuggest(caret) ?? this.tagSuggest(caret);
    if (!next) {
      this.dismissed = null;
      this.closeSuggest();
      return;
    }
    if (this.dismissed === `${next.kind}:${next.anchor}`) {
      this.closeSuggest();
      return;
    }
    const prev = this.suggest;
    const same = prev !== null && prev.kind === next.kind && prev.items.map((o) => o.key).join('\n') === next.items.map((o) => o.key).join('\n');
    next.active = same ? prev.active : -1;
    this.suggest = next;
    this.renderOptions(this.suggestEl, ta, next.items, next.active);
  }

  private linkSuggest(caret: number): Suggest | null {
    const token = linkTokenAt(this.ta.value, caret);
    if (!token) return null;
    const notes = linkCandidates(this.allNotes.filter((n) => n.archived === 0), token.query, this.id, SUGGEST_MAX);
    const items: Option[] = notes.length > 0
      ? notes.map((n) => ({ key: n.id, label: n.title, icon: 'notebook-pen' }))
      : [{ key: '', label: t.noteLinkNone, icon: 'search', hint: true }];
    this.suggestEl.setAttribute('aria-label', t.noteLinkSuggestions);
    return { kind: 'note', start: token.start, end: caret, anchor: token.start, items, active: -1 };
  }

  private tagSuggest(caret: number): Suggest | null {
    const token: TagToken | null = tagTokenAt(this.ta.value, caret);
    if (!token) return null;
    const paths = suggestTags(this.tagPaths, token.query, new Set(), SUGGEST_MAX);
    if (paths.length === 0) return null;
    this.suggestEl.setAttribute('aria-label', t.noteTagSuggestions);
    return { kind: 'tag', start: token.start, end: token.end, anchor: token.hash, items: tagOptions(paths), active: -1 };
  }

  private closeSuggest(): void {
    if (!this.suggest && this.suggestEl.hidden) return;
    this.suggest = null;
    this.renderOptions(this.suggestEl, this.ta, [], -1);
  }

  /** Keyboard in the textarea while suggestions are shown; true when the key was handled. */
  private onSuggestKey(event: KeyboardEvent): boolean {
    const s = this.suggest;
    if (!s || event.altKey || isMod(event)) return false;
    const choosable = s.items.map((o, i) => (o.hint ? -1 : i)).filter((i) => i >= 0);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (choosable.length === 0) return false;
      event.preventDefault();
      const at = choosable.indexOf(s.active);
      const n = choosable.length;
      const next = event.key === 'ArrowDown' ? (at + 1) % n : at <= 0 ? n - 1 : at - 1;
      s.active = choosable[next] ?? -1;
      this.renderOptions(this.suggestEl, this.ta, s.items, s.active);
      return true;
    }
    // `#`: Enter only takes an option chosen with the arrows (else it is a line break); `[[`: the first one.
    const pick = s.active >= 0 ? s.active : s.kind === 'note' ? choosable[0] ?? -1 : -1;
    if (event.key === 'Enter' && !event.shiftKey && pick >= 0) {
      event.preventDefault();
      this.acceptSuggest(s.items[pick]?.key ?? '');
      return true;
    }
    if (event.key === 'Tab' && !event.shiftKey && choosable.length > 0) {
      event.preventDefault();
      this.acceptSuggest(s.items[s.active >= 0 ? s.active : choosable[0] ?? 0]?.key ?? '');
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dismissed = `${s.kind}:${s.anchor}`;
      this.closeSuggest();
      return true;
    }
    return false;
  }

  /** `#token` → full path plus a space; `[[query` → `[Titel](note:<id>)`. */
  private acceptSuggest(key: string): void {
    const s = this.suggest;
    if (!s || key === '') return;
    const ta = this.ta;
    let text: string;
    let caret: number;
    if (s.kind === 'tag') {
      const spaced = ta.value[s.end] === ' ';
      text = spaced ? key : `${key} `;
      caret = s.start + key.length + 1;
    } else {
      const note = this.allNotes.find((n) => n.id === key);
      if (!note) return;
      text = noteLinkMarkdown(note.title, note.id);
      caret = s.start + text.length;
    }
    this.closeSuggest();
    this.apply({ start: s.start, end: s.end, text, selStart: caret, selEnd: caret });
    this.closeSuggest();
  }

  private renderOptions(list: HTMLElement, owner: HTMLElement, items: readonly Option[], active: number): void {
    const base = list.id;
    render(list, h`${items.map((o, i) => (o.hint
      ? h`<li class="ol-note__option ol-note__option--hint" role="option" id="${base}-${i}" aria-disabled="true" aria-selected="false">${icon(o.icon, 20)}<span>${o.label}</span></li>`
      : h`<li class="ol-note__option" role="option" id="${base}-${i}" data-key="${o.key}" aria-selected="${i === active ? 'true' : 'false'}">${icon(o.icon, 20)}<span>${o.label}</span></li>`))}`);
    list.hidden = items.length === 0;
    if (owner.getAttribute('role') === 'combobox') owner.setAttribute('aria-expanded', items.length > 0 ? 'true' : 'false');
    if (active >= 0 && items.length > 0) {
      owner.setAttribute('aria-activedescendant', `${base}-${active}`);
      list.children[active]?.scrollIntoView({ block: 'nearest' });
    } else {
      owner.removeAttribute('aria-activedescendant');
    }
  }

  private optionKey(event: Event): string | undefined {
    const option = event.target instanceof Element ? event.target.closest<HTMLElement>('[role="option"]') : null;
    return option?.dataset['key'];
  }

  // --- All notes: tag paths, link targets, backlinks ---

  private onNotes(notes: Note[]): void {
    this.allNotes = notes;
    const paths = new Set<string>();
    for (const note of notes) {
      for (const path of note.tagPaths) {
        const parts = path.split('/');
        for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join('/'));
      }
    }
    this.tagPaths = [...paths].sort((a, b) => a.localeCompare(b, 'de'));
    const ids = new Set(notes.map((n) => n.id));
    const changed = this.noteIds === null || ids.size !== this.noteIds.size || [...ids].some((id) => !this.noteIds?.has(id));
    this.noteIds = ids;
    if (changed && this.mode === 'preview') this.renderPreview();
    if (!this.tagForm.hidden) this.updateTagSuggestions();
    this.renderBacklinks();
  }

  private renderBacklinks(): void {
    const notes = backlinksOf(this.allNotes, this.id);
    const tasks = this.linkedTasks;
    const key = JSON.stringify([notes.map((n) => [n.id, n.title]), tasks.map((x) => [x.id, x.title, x.status])]);
    if (key === this.backlinksKey) return;
    this.backlinksKey = key;
    this.backlinksEl.hidden = notes.length + tasks.length === 0;
    const row = (path: string, glyph: string, title: string, kind: string): SafeHtml => h`<li><button type="button" class="ol-note__backlink" data-path="${path}">
      <span class="ol-note__backlink-icon" aria-hidden="true">${icon(glyph, 20)}</span>
      <span class="ol-note__backlink-text"><span class="ol-note__backlink-title">${title}</span><span class="ol-note__backlink-kind ol-caption">${kind}</span></span>
      <span class="ol-note__backlink-chevron" aria-hidden="true">${icon('chevron-right', 20)}</span>
    </button></li>`;
    render(req(this.backlinksEl, '.ol-note__backlink-list'), h`${notes.map((n) => row(`/wissen/n/${encodeURIComponent(n.id)}`, 'notebook-pen', n.title || t.wissenUntitled, t.noteBacklinkNote))}${
      tasks.map((x) => row(`/aufgabe/${encodeURIComponent(x.id)}`, x.status === 'done' ? 'circle-check' : 'square-check', x.title, x.status === 'done' ? t.noteBacklinkTaskDone : t.noteBacklinkTask))}`);
  }

  // --- „Aufgabe aus Zeile“ ---

  private async taskFromLine(): Promise<void> {
    const line = lineAt(this.body, this.ta.selectionStart);
    const title = taskTitleFromLine(line.text);
    if (title === '') {
      showToast(t.noteTaskLineEmpty);
      return;
    }
    try {
      const area = await firstActiveArea();
      if (!area) {
        showToast(t.noteTaskNoArea);
        return;
      }
      const task = await createTask({ title, areaId: area.id, linkedNoteIds: [this.id] });
      const change = this.markTaskLine(line);
      showToast(t.toastNoteTaskCreated, { action: { label: t.actionUndo, onAction: () => void this.undoTaskFromLine(task.id, change) } });
    } catch (err) {
      failed(err);
    }
  }

  /** Turns the line into `- [ ] …` when it is plain text or a list item (and still unchanged). */
  private markTaskLine(line: { start: number; end: number; text: string }): LineChange | null {
    if (this.destroyed || this.body.slice(line.start, line.end) !== line.text) return null;
    if (TASK_ITEM.test(line.text) || NO_TASK_LINE.test(line.text)) return null;
    const caret = Math.min(Math.max(this.ta.selectionStart, line.start), line.end);
    const edit = toggleLines(this.body, caret, caret, 'task');
    if (applyEdit(this.body, edit) === this.body) return null;
    this.apply(edit);
    void this.flush();
    return { start: line.start, before: line.text, after: edit.text };
  }

  private async undoTaskFromLine(taskId: Id, change: LineChange | null): Promise<void> {
    try {
      await deleteTask(taskId);
      if (!change) return;
      const end = change.start + change.after.length;
      if (!this.destroyed) {
        if (this.body.slice(change.start, end) !== change.after) return;
        this.apply({ start: change.start, end, text: change.before, selStart: change.start, selEnd: change.start });
        void this.flush();
        return;
      }
      const note = await getNote(this.id);
      if (!note || note.body.slice(change.start, end) !== change.after) return;
      await saveNoteContent(this.id, note.body.slice(0, change.start) + change.before + note.body.slice(end), explicitTags(note));
    } catch (err) {
      failed(err);
    }
  }

  // --- ⋯ menu (shared note actions, screens/note-actions.ts) ---

  private openMenu(): void {
    const note = this.note;
    if (!note || this.missing) return;
    openActionMenu(this.titleText(), [
      note.pinned === 1
        ? { label: t.noteUnpin, icon: 'pin-off', run: () => void this.pin() }
        : { label: t.notePin, icon: 'pin', run: () => void this.pin() },
      { label: t.noteToolTaskFromLine, icon: 'square-check', run: () => void this.taskFromLine() },
      { label: t.noteArchive, icon: 'archive', run: () => void this.archive() },
      { label: t.noteExportMarkdown, icon: 'download', run: () => void this.exportMarkdown() },
      { label: t.actionDelete, icon: 'trash-2', danger: true, run: () => void this.remove() },
    ]);
  }

  /** The stored note after the pending changes are saved. */
  private async latest(): Promise<Note | undefined> {
    await this.flush();
    return (await getNote(this.id)) ?? this.note ?? undefined;
  }

  private async pin(): Promise<void> {
    const note = await this.latest();
    if (note) await togglePin(note);
  }

  private async exportMarkdown(): Promise<void> {
    const note = await this.latest();
    if (note) await exportNotesMarkdown([note], note);
  }

  private async archive(): Promise<void> {
    const note = await this.latest();
    if (!note || this.destroyed) return;
    this.gone = true;
    await archiveNote(note);
    back();
  }

  private async remove(): Promise<void> {
    const note = await this.latest();
    if (!note || this.gone || this.destroyed) return;
    this.deleting = true;
    const deleted = await deleteNoteAsked(note);
    this.deleting = false;
    if (!deleted) return;
    this.gone = true;
    window.clearTimeout(this.retryTimer);
    back();
  }
}
