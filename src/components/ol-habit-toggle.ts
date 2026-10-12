// <ol-habit-toggle state="pending|done|skipped|partial" progress="0..1" today-done label="…"
//   [caption="Heute gießen" caption-done="Gegossen"]></ol-habit-toggle>
// Ring 28 px, stroke 2.5, primary; 48 px target. role="checkbox", tabindex 0, Space/Enter/click.
// aria-checked: "true" when today-done (or state done for daily habits), "mixed" for partial, else "false".
// timesPerWeek rows: progress = min(1, done/target) draws the partial ring; state 'done' when the
// week target is met; attribute today-done adds an inner dot (today's log exists).
// On activation the element optimistically flips (fill 220 ms) and emits
// `ol-change` (detail: { done: boolean }) — `done` = the requested state of today's log.
// The owner persists (toggleLog) and re-renders the authoritative state.
//
// Details of this implementation:
// - A habit is treated as daily when the `progress` attribute is absent; then `state` alone
//   describes today's log and the optimistic flip sets state done/pending. With `progress`
//   (timesPerWeek) the flip toggles `today-done`; the owner sets state/progress afterwards.
// - Visuals: pending = primary ring; partial = sage track + primary arc (stroke-dasharray);
//   done = primary fill (220 ms) with a check when today's log exists (daily: always);
//   skipped = dashed ring in text-3; today-done on a non-filled ring = inner dot.
// - timesPerWeek with the week target met but no log today reports aria-checked="mixed".
// - `disabled` (e.g. while toggleLog is pending) keeps focus and tab order, sets aria-disabled
//   and ignores activation.
// - Plays HAPTIC.tick when it fills; owners do not need to vibrate for the plain toggle.
// - With `caption` the toggle becomes a pill (ring + text, garden cards); CSS shows `caption` while
//   today's log is open and `caption-done` once it exists, so the optimistic flip switches the text too.
// - preventDefault() on `ol-change` reverts the optimistic flip.
import { emit, h, HAPTIC, render, vibrate } from '../util/dom.js';

export interface HabitToggleChange { done: boolean }

const RADIUS = 12.75; // 28 px outer diameter with a 2.5 stroke
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export class OlHabitToggle extends HTMLElement {
  static observedAttributes = ['state', 'progress', 'today-done', 'label', 'disabled', 'caption', 'caption-done'];

  private arc: SVGCircleElement | null = null;
  private captionTodo: HTMLElement | null = null;
  private captionDone: HTMLElement | null = null;

  connectedCallback(): void {
    if (!this.hasAttribute('role')) this.setAttribute('role', 'checkbox');
    if (!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '0');
    if (!this.hasAttribute('state')) this.setAttribute('state', 'pending');
    this.ensureSkeleton();
    this.addEventListener('click', this.onClick);
    this.addEventListener('keydown', this.onKeyDown);
    this.sync();
  }

  disconnectedCallback(): void {
    this.removeEventListener('click', this.onClick);
    this.removeEventListener('keydown', this.onKeyDown);
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.sync();
  }

  /** Current state attribute (unknown values read as pending). */
  get state(): 'pending' | 'done' | 'skipped' | 'partial' {
    const value = this.getAttribute('state');
    return value === 'done' || value === 'skipped' || value === 'partial' ? value : 'pending';
  }

  /** Whether today's log exists, as far as the attributes say. */
  get todayDone(): boolean {
    return this.hasAttribute('today-done') || (this.state === 'done' && !this.hasAttribute('progress'));
  }

  private progress(): number {
    const value = Number(this.getAttribute('progress') ?? '0');
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  }

  private ensureSkeleton(): void {
    if (this.arc) return;
    const c = 14;
    render(
      this,
      h`<svg class="ol-habit-toggle__svg" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" focusable="false">
        <circle class="ol-habit-toggle__fill" cx="${c}" cy="${c}" r="${RADIUS}"></circle>
        <circle class="ol-habit-toggle__ring" cx="${c}" cy="${c}" r="${RADIUS}"></circle>
        <circle class="ol-habit-toggle__arc" cx="${c}" cy="${c}" r="${RADIUS}" transform="rotate(-90 ${c} ${c})"></circle>
        <circle class="ol-habit-toggle__dot" cx="${c}" cy="${c}" r="3.5"></circle>
        <path class="ol-habit-toggle__check" d="M8.75 14.25l3.5 3.5 7-7.25" pathLength="1"></path>
      </svg>`,
    );
    this.arc = this.querySelector<SVGCircleElement>('.ol-habit-toggle__arc');
  }

  private syncCaption(): void {
    const todo = this.getAttribute('caption');
    if (todo === null) return;
    if (!this.captionTodo || !this.captionDone) {
      const box = document.createElement('span');
      box.className = 'ol-habit-toggle__caption';
      box.setAttribute('aria-hidden', 'true');
      this.captionTodo = document.createElement('span');
      this.captionTodo.className = 'ol-habit-toggle__todo';
      this.captionDone = document.createElement('span');
      this.captionDone.className = 'ol-habit-toggle__done';
      box.append(this.captionTodo, this.captionDone);
      this.append(box);
    }
    const done = this.getAttribute('caption-done') ?? todo;
    if (this.captionTodo.textContent !== todo) this.captionTodo.textContent = todo;
    if (this.captionDone.textContent !== done) this.captionDone.textContent = done;
  }

  private sync(): void {
    this.ensureSkeleton();
    this.syncCaption();
    const state = this.state;
    const checked = this.todayDone ? 'true' : state === 'partial' || state === 'done' ? 'mixed' : 'false';
    if (this.getAttribute('aria-checked') !== checked) this.setAttribute('aria-checked', checked);
    const label = this.getAttribute('label');
    if (label && this.getAttribute('aria-label') !== label) this.setAttribute('aria-label', label);
    if (this.hasAttribute('disabled')) this.setAttribute('aria-disabled', 'true');
    else this.removeAttribute('aria-disabled');
    if (this.arc) {
      const length = (this.progress() * CIRCUMFERENCE).toFixed(2);
      this.arc.style.strokeDasharray = `${length} ${CIRCUMFERENCE.toFixed(2)}`;
    }
  }

  private activate(): void {
    if (this.hasAttribute('disabled')) return;
    const done = !this.todayDone;
    const weekly = this.hasAttribute('progress');
    const before = { state: this.getAttribute('state'), todayDone: this.hasAttribute('today-done') };
    if (weekly) this.toggleAttribute('today-done', done);
    else this.setAttribute('state', done ? 'done' : 'pending');
    if (done) vibrate(HAPTIC.tick);
    if (!emit<HabitToggleChange>(this, 'ol-change', { done })) {
      if (before.state === null) this.removeAttribute('state');
      else this.setAttribute('state', before.state);
      this.toggleAttribute('today-done', before.todayDone);
    }
  }

  private readonly onClick = (): void => {
    this.activate();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    if (!event.repeat) this.activate();
  };
}

if (!customElements.get('ol-habit-toggle')) customElements.define('ol-habit-toggle', OlHabitToggle);
