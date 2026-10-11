// CONTRACT STUB – implemented in AP6.
// <ol-dialog heading="…" destructive> on a native <dialog>, width min(100% - 48px, 360px), radius lg.
// Actions right-aligned: ghost "Abbrechen" + filled (or danger when destructive) confirm.
// destructive → initial focus on "Abbrechen". Events ol-confirm, ol-cancel. Esc = cancel.
// Uses <form method="dialog"> (allowed under form-action 'none') or plain buttons; no server submit.

export interface ConfirmOptions { title: string; body?: string; confirmLabel: string; cancelLabel?: string; destructive?: boolean }
export interface Choice { value: string; label: string; hint?: string; variant?: 'filled' | 'tonal' | 'danger' }
export interface ChoiceOptions { title: string; body?: string; choices: Choice[]; cancelLabel?: string }

export class OlDialog extends HTMLElement {
  static observedAttributes = ['heading', 'destructive'];
  connectedCallback(): void {}
}

if (!customElements.get('ol-dialog')) customElements.define('ol-dialog', OlDialog);

/** Resolves true on confirm, false on cancel/Esc. The dialog removes itself afterwards. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  void opts;
  return Promise.resolve(false);
}

/** Resolves the chosen value, or null on cancel (e.g. import mode "Zusammenführen"/"Wiederherstellen"). */
export function choiceDialog(opts: ChoiceOptions): Promise<string | null> {
  void opts;
  return Promise.resolve(null);
}
