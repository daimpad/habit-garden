// <ol-input label="Titel" value="" type="text|date|time|number|search" name="title" placeholder=""
//           error="…" helper="…" inputmode="…" required multiline rows-max="6" autofocus
//           min="" max="" step=""></ol-input>
// Label 13/500 above (<label for>), field 48 px (min 16 px font), surface, 1 px border, focus border
// primary; error → aria-invalid + aria-describedby + danger text; helper text 12 px.
// `multiline` renders an auto-growing <textarea> (up to rows-max lines).
// The inner control's native `input` event bubbles; `change` is re-emitted as
// `ol-change` (detail: { value: string }).
//
// Details of this implementation:
// - Field border 1.5 px text-2 (S29); placeholder in text-2 (never text-3).
// - `value` getter returns the live value of the inner control; the setter writes the control and
//   the attribute. A changed `value` attribute updates the control (an unchanged one does not, so a
//   re-render with the same attribute never overwrites what the user typed).
// - The error message replaces the helper text while present; aria-describedby points at the visible one.
// - `autofocus` is forwarded to the inner control (a <dialog> opened with showModal() focuses it);
//   additional attributes `autocomplete` and `maxlength` are forwarded when present at render time.
// - Switching `multiline` later swaps the control and keeps value and focus.
import { emit, h, render } from '../util/dom.js';

export interface InputChange { value: string }

type Control = HTMLInputElement | HTMLTextAreaElement;

let counter = 0;

const FORWARDED = ['name', 'placeholder', 'inputmode', 'min', 'max', 'step'] as const;

export class OlInput extends HTMLElement {
  static observedAttributes = ['label', 'value', 'type', 'name', 'placeholder', 'error', 'helper', 'inputmode', 'required', 'multiline', 'rows-max', 'disabled', 'min', 'max', 'step'];

  private control: Control | null = null;
  private labelEl: HTMLLabelElement | null = null;
  private helperEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;
  private uid = '';

  connectedCallback(): void {
    this.ensureSkeleton();
    this.sync();
    this.autosize();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (!this.control) return;
    if (name === 'value') {
      if (oldValue !== newValue && this.control.value !== (newValue ?? '')) {
        this.control.value = newValue ?? '';
        this.autosize();
      }
      return;
    }
    if (name === 'multiline' && this.control instanceof HTMLTextAreaElement !== this.hasAttribute('multiline')) {
      this.swapControl();
    }
    this.sync();
  }

  get value(): string {
    return this.control ? this.control.value : this.getAttribute('value') ?? '';
  }
  set value(v: string) {
    if (this.control && this.control.value !== v) {
      this.control.value = v;
      this.autosize();
    }
    this.setAttribute('value', v);
  }

  /** The inner <input> or <textarea> (null before the first connect). */
  get field(): Control | null {
    return this.control;
  }

  /** Focuses the inner control. */
  focusInput(): void {
    this.control?.focus();
  }

  private ensureSkeleton(): void {
    if (this.control) return;
    const existing = this.querySelector<Control>(':scope > .ol-input__field');
    if (existing) {
      this.uid = existing.id;
    } else {
      counter += 1;
      this.uid = `ol-input-${counter}`;
      const id = this.uid;
      const field = this.hasAttribute('multiline')
        ? h`<textarea class="ol-input__field ol-input__field--multiline" id="${id}" rows="1"></textarea>`
        : h`<input class="ol-input__field" id="${id}">`;
      render(
        this,
        h`<label class="ol-input__label" for="${id}"></label>${field}<p class="ol-input__helper" id="${id}-helper" hidden></p><p class="ol-input__error" id="${id}-error" hidden></p>`,
      );
    }
    this.control = this.querySelector<Control>(':scope > .ol-input__field');
    this.labelEl = this.querySelector<HTMLLabelElement>(':scope > .ol-input__label');
    this.helperEl = this.querySelector<HTMLElement>(':scope > .ol-input__helper');
    this.errorEl = this.querySelector<HTMLElement>(':scope > .ol-input__error');
    if (this.control) {
      if (!existing) {
        this.control.value = this.getAttribute('value') ?? '';
        this.forwardOnce(this.control);
      }
      this.listen(this.control);
    }
  }

  private forwardOnce(control: Control): void {
    if (this.hasAttribute('autofocus')) control.setAttribute('autofocus', '');
    for (const attr of ['autocomplete', 'maxlength'] as const) {
      const value = this.getAttribute(attr);
      if (value !== null) control.setAttribute(attr, value);
    }
  }

  private listen(control: Control): void {
    control.addEventListener('change', this.onChange);
    control.addEventListener('input', this.onInput);
  }

  private swapControl(): void {
    const old = this.control;
    if (!old) return;
    const hadFocus = document.activeElement === old;
    const value = old.value;
    old.removeEventListener('change', this.onChange);
    old.removeEventListener('input', this.onInput);
    const holder = document.createElement('div');
    render(
      holder,
      this.hasAttribute('multiline')
        ? h`<textarea class="ol-input__field ol-input__field--multiline" id="${this.uid}" rows="1"></textarea>`
        : h`<input class="ol-input__field" id="${this.uid}">`,
    );
    const next = holder.firstElementChild;
    if (!(next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement)) return;
    old.replaceWith(next);
    this.control = next;
    next.value = value;
    this.forwardOnce(next);
    this.listen(next);
    if (hadFocus) next.focus();
  }

  private sync(): void {
    const control = this.control;
    if (!control) return;

    const label = this.getAttribute('label') ?? '';
    if (this.labelEl) {
      if (this.labelEl.textContent !== label) this.labelEl.textContent = label;
      this.labelEl.hidden = label === '';
    }

    if (control instanceof HTMLInputElement) {
      const type = this.getAttribute('type') || 'text';
      if (control.getAttribute('type') !== type) control.setAttribute('type', type);
    }
    for (const attr of FORWARDED) {
      const value = this.getAttribute(attr);
      if (value === null) control.removeAttribute(attr);
      else if (control.getAttribute(attr) !== value) control.setAttribute(attr, value);
    }
    control.required = this.hasAttribute('required');
    control.disabled = this.hasAttribute('disabled');

    const error = this.getAttribute('error')?.trim() ?? '';
    const helper = this.getAttribute('helper')?.trim() ?? '';
    if (this.errorEl) {
      if (this.errorEl.textContent !== error) this.errorEl.textContent = error;
      this.errorEl.hidden = error === '';
    }
    if (this.helperEl) {
      if (this.helperEl.textContent !== helper) this.helperEl.textContent = helper;
      this.helperEl.hidden = helper === '' || error !== '';
    }
    if (error) control.setAttribute('aria-invalid', 'true');
    else control.removeAttribute('aria-invalid');
    const describedBy = error ? `${this.uid}-error` : helper ? `${this.uid}-helper` : '';
    if (describedBy) control.setAttribute('aria-describedby', describedBy);
    else control.removeAttribute('aria-describedby');
    this.toggleAttribute('data-invalid', error !== '');

    const rowsMax = Number(this.getAttribute('rows-max') ?? '6');
    const rows = String(Number.isFinite(rowsMax) && rowsMax >= 1 ? Math.floor(rowsMax) : 6);
    if (this.style.getPropertyValue('--ol-input-rows-max') !== rows) this.style.setProperty('--ol-input-rows-max', rows);
    this.autosize();
  }

  /** Grows a textarea with its content up to rows-max lines (CSS max-height), then it scrolls. */
  private autosize(): void {
    const control = this.control;
    if (!(control instanceof HTMLTextAreaElement) || !control.isConnected) return;
    control.style.height = 'auto';
    const cs = getComputedStyle(control);
    const borders = (Number.parseFloat(cs.borderTopWidth) || 0) + (Number.parseFloat(cs.borderBottomWidth) || 0);
    const max = Number.parseFloat(cs.maxHeight);
    const content = control.scrollHeight + borders;
    const height = Number.isFinite(max) ? Math.min(content, max) : content;
    control.style.height = `${Math.ceil(height)}px`;
  }

  private readonly onInput = (): void => {
    this.autosize();
  };

  private readonly onChange = (): void => {
    if (!this.control) return;
    emit<InputChange>(this, 'ol-change', { value: this.control.value });
  };
}

if (!customElements.get('ol-input')) customElements.define('ol-input', OlInput);
