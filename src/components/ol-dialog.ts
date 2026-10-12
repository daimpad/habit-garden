// <ol-dialog heading="…" destructive> on a native <dialog>, width min(100% - 48px, 360px), radius lg.
// Actions right-aligned: ghost "Abbrechen" + filled (or danger when destructive) confirm.
// destructive → initial focus on "Abbrechen". Events ol-confirm, ol-cancel. Esc = cancel.
// Uses <form method="dialog"> (allowed under form-action 'none') or plain buttons; no server submit.
//
// Details of this implementation:
// - Plain ol-button elements, no form. Esc, scrim tap and a history popstate (the sheet underneath
//   is being closed by Back) cancel. The browser closing the dialog on its own also counts as cancel.
// - The promise resolves synchronously inside the click handler (user activation still counts, e.g.
//   for Notification.requestPermission()); the closing fade runs afterwards and the element removes itself.
// - ol-confirm carries detail { value } ('confirm' for confirmDialog, the choice value for choiceDialog).
// - destructive: role="alertdialog", haptic warn (B.4 "Dialog öffnet"), initial focus on Abbrechen.
//   choiceDialog: initial focus on the first choice, on Abbrechen when a choice is `danger`.
// - Open: fade + scale .96 → 1 (200 ms); close: fade 150 ms; reduced motion: 120 ms crossfades only.
import { t } from '../i18n/de.js';
import { emit, h, HAPTIC, motionReduced, render, vibrate } from '../util/dom.js';
import './ol-button.js';
import {
  captureFocusReturn, firstFocusable, focusWithinOrLost, historySettled, lockScroll, popModal, pushModal, restoreFocus,
  setFocusReturn, type FocusReturn,
} from './ol-sheet.js';

export interface ConfirmOptions { title: string; body?: string; confirmLabel: string; cancelLabel?: string; destructive?: boolean }
export interface Choice { value: string; label: string; hint?: string; variant?: 'filled' | 'tonal' | 'danger' }
export interface ChoiceOptions { title: string; body?: string; choices: Choice[]; cancelLabel?: string }

export interface DialogConfig { body?: string; confirmLabel?: string; cancelLabel?: string; choices?: Choice[] }

const CONFIRM = 'confirm';
const OPEN_MS = 200;
const CLOSE_MS = 150;
const CROSSFADE_MS = 120;

let dialogSeq = 0;

export class OlDialog extends HTMLElement {
  static observedAttributes = ['heading', 'destructive'];

  private config: DialogConfig = {};
  private dialogEl: HTMLDialogElement | null = null;
  private phase: 'idle' | 'open' | 'closing' | 'closed' = 'idle';
  private settle: ((value: string | null) => void) | null = null;
  private unlock: (() => void) | null = null;
  private focusReturn: FocusReturn | null = null;
  private anim: Animation | null = null;
  private downOnScrim = false;

  connectedCallback(): void {
    this.build();
  }

  /** Removed from outside while open: counts as cancel; releases scroll lock and modal stack. */
  disconnectedCallback(): void {
    if (this.phase === 'open') this.decide(null);
    if (this.phase === 'closing') this.finish();
  }

  attributeChangedCallback(name: string): void {
    const dialog = this.dialogEl;
    if (!dialog) return;
    if (name === 'heading') {
      const title = dialog.querySelector('.ol-dialog__title');
      if (title) title.textContent = this.getAttribute('heading') ?? '';
    } else {
      const destructive = this.hasAttribute('destructive');
      if (destructive) dialog.setAttribute('role', 'alertdialog');
      else dialog.removeAttribute('role');
      dialog.querySelector('ol-button[data-role="confirm"]')?.setAttribute('variant', destructive ? 'danger' : 'filled');
    }
  }

  /** Body text, button labels and choices; set before the element is connected. */
  configure(config: DialogConfig): void {
    this.config = { ...config };
  }

  /** Opens the dialog; resolves the chosen value ('confirm' or a choice value) or null on cancel. */
  open(): Promise<string | null> {
    this.build();
    const dialog = this.dialogEl;
    if (!dialog || this.phase !== 'idle' || !this.isConnected) return Promise.resolve(null);
    this.phase = 'open';
    const result = new Promise<string | null>((resolve) => {
      this.settle = resolve;
    });
    this.focusReturn = captureFocusReturn();
    setFocusReturn(dialog, this.focusReturn);
    dialog.showModal();
    pushModal(dialog);
    this.unlock = lockScroll();
    this.setAttribute('open', '');
    this.focusInitial();
    if (this.isCautious()) vibrate(HAPTIC.warn);
    void getComputedStyle(dialog, '::backdrop').opacity;
    this.setAttribute('visible', '');
    this.anim = motionReduced()
      ? dialog.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CROSSFADE_MS, easing: 'linear' })
      : dialog.animate(
        [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: OPEN_MS, easing: 'cubic-bezier(0,0,0,1)' },
      );
    // A history.back() still pending from a sheet closed just before must not cancel this dialog.
    void historySettled().then(() => {
      if (this.phase === 'open') window.addEventListener('popstate', this.onPopState);
    });
    return result;
  }

  /** Cancels the dialog (same as Esc). */
  cancel(): void {
    this.decide(null);
  }

  private isCautious(): boolean {
    return this.hasAttribute('destructive') || (this.config.choices ?? []).some((c) => c.variant === 'danger');
  }

  private build(): void {
    if (this.dialogEl) return;
    dialogSeq += 1;
    const id = `ol-dialog-${dialogSeq}`;
    const heading = this.getAttribute('heading') ?? '';
    const destructive = this.hasAttribute('destructive');
    const { body, confirmLabel, choices = [] } = this.config;
    const cancelLabel = this.config.cancelLabel ?? t.actionCancel;
    const describedBy = body ? h` aria-describedby="${id}-body"` : '';
    const role = destructive ? h` role="alertdialog"` : '';
    render(
      this,
      h`<dialog class="ol-dialog__dialog" tabindex="-1" aria-labelledby="${id}-title"${describedBy}${role}>
  <h2 class="ol-dialog__title ol-heading" id="${id}-title">${heading}</h2>
  ${body ? h`<p class="ol-dialog__body ol-body" id="${id}-body">${body}</p>` : ''}
  ${choices.length > 0 ? h`<div class="ol-dialog__choices">${choices.map((c) => h`<div class="ol-dialog__choice">
    <ol-button variant="${c.variant ?? 'tonal'}" label="${c.label}" data-value="${c.value}"></ol-button>
    ${c.hint ? h`<p class="ol-dialog__hint ol-caption">${c.hint}</p>` : ''}
  </div>`)}</div>` : ''}
  <div class="ol-dialog__actions">
    <ol-button variant="ghost" label="${cancelLabel}" data-role="cancel"></ol-button>
    ${confirmLabel ? h`<ol-button variant="${destructive ? 'danger' : 'filled'}" label="${confirmLabel}" data-role="confirm"></ol-button>` : ''}
  </div>
</dialog>`,
    );
    const dialog = this.querySelector<HTMLDialogElement>(':scope > dialog.ol-dialog__dialog');
    if (!dialog) return;
    this.dialogEl = dialog;
    dialog.addEventListener('click', this.onClick);
    dialog.addEventListener('pointerdown', this.onPointerDown);
    dialog.addEventListener('cancel', this.onCancel);
    dialog.addEventListener('close', this.onNativeClose);
  }

  private focusInitial(): void {
    const dialog = this.dialogEl;
    if (!dialog) return;
    const cancel = dialog.querySelector<HTMLElement>('ol-button[data-role="cancel"]');
    const confirm = dialog.querySelector<HTMLElement>('ol-button[data-role="confirm"]');
    const firstChoice = dialog.querySelector<HTMLElement>('.ol-dialog__choices ol-button');
    const target = this.isCautious() ? cancel : (firstChoice ?? confirm ?? cancel);
    target?.focus({ preventScroll: true });
    if (!dialog.contains(document.activeElement)) (firstFocusable(dialog) ?? dialog).focus({ preventScroll: true });
  }

  private decide(value: string | null): void {
    if (this.phase !== 'open') return;
    this.phase = 'closing';
    window.removeEventListener('popstate', this.onPopState);
    const dialog = this.dialogEl;
    if (dialog) {
      dialog.dataset['closing'] = '';
      popModal(dialog);
    }
    this.removeAttribute('visible');
    this.setAttribute('dismissing', '');
    if (value === null) emit(this, 'ol-cancel');
    else emit(this, 'ol-confirm', { value });
    this.settle?.(value);
    this.settle = null;
    if (!dialog || !dialog.open) {
      this.finish();
      return;
    }
    const from = Number(getComputedStyle(dialog).opacity) || 1;
    this.anim?.cancel();
    this.anim = dialog.animate([{ opacity: from }, { opacity: 0 }], {
      duration: motionReduced() ? CROSSFADE_MS : CLOSE_MS, easing: 'linear', fill: 'forwards',
    });
    this.anim.finished.then(() => this.finish(), () => this.finish());
  }

  private finish(): void {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    const dialog = this.dialogEl;
    let hadFocus = false;
    if (dialog) {
      popModal(dialog);
      hadFocus = focusWithinOrLost(dialog);
      if (dialog.open) dialog.close();
    }
    this.unlock?.();
    this.unlock = null;
    if (hadFocus) restoreFocus(this.focusReturn);
    this.anim?.cancel();
    this.anim = null;
    this.removeAttribute('open');
    this.removeAttribute('dismissing');
    this.remove();
  }

  private isOutside(event: MouseEvent): boolean {
    const dialog = this.dialogEl;
    if (!dialog || event.target !== dialog) return false;
    const r = dialog.getBoundingClientRect();
    return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.downOnScrim = this.isOutside(event);
  };

  private readonly onClick = (event: MouseEvent): void => {
    const onScrim = this.downOnScrim && this.isOutside(event);
    this.downOnScrim = false;
    if (onScrim) {
      this.decide(null);
      return;
    }
    const target = event.target instanceof Element ? event.target.closest('ol-button') : null;
    if (!(target instanceof HTMLElement) || !this.contains(target)) return;
    if (target.dataset['role'] === 'cancel') this.decide(null);
    else if (target.dataset['role'] === 'confirm') this.decide(CONFIRM);
    else if (target.dataset['value'] !== undefined) this.decide(target.dataset['value']);
  };

  private readonly onCancel = (event: Event): void => {
    event.preventDefault();
    this.decide(null);
  };

  private readonly onNativeClose = (): void => {
    if (this.phase === 'open') this.decide(null);
    if (this.phase === 'closing') this.finish();
  };

  private readonly onPopState = (): void => {
    this.decide(null);
  };
}

if (!customElements.get('ol-dialog')) customElements.define('ol-dialog', OlDialog);

function createDialog(title: string, destructive: boolean, config: DialogConfig): OlDialog {
  const el = document.createElement('ol-dialog') as OlDialog;
  el.setAttribute('heading', title);
  if (destructive) el.setAttribute('destructive', '');
  el.configure(config);
  document.body.append(el);
  return el;
}

/** Resolves true on confirm, false on cancel/Esc. The dialog removes itself afterwards. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const el = createDialog(opts.title, opts.destructive ?? false, {
    body: opts.body, confirmLabel: opts.confirmLabel, cancelLabel: opts.cancelLabel,
  });
  return el.open().then((value) => value === CONFIRM);
}

/** Resolves the chosen value, or null on cancel (e.g. import mode "Zusammenführen"/"Wiederherstellen"). */
export function choiceDialog(opts: ChoiceOptions): Promise<string | null> {
  const el = createDialog(opts.title, false, { body: opts.body, choices: opts.choices, cancelLabel: opts.cancelLabel });
  return el.open();
}
