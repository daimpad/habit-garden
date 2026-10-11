// CONTRACT STUB – implemented in AP6.
// <ol-habit-toggle state="pending|done|skipped|partial" progress="0..1" today-done label="…"></ol-habit-toggle>
// Ring 28 px, stroke 2.5, primary; 48 px target. role="checkbox", tabindex 0, Space/Enter/click.
// aria-checked: "true" when today-done (or state done for daily habits), "mixed" for partial, else "false".
// timesPerWeek rows: progress = min(1, done/target) draws the partial ring; state 'done' when the
// week target is met; attribute today-done adds an inner dot (today's log exists).
// On activation the element optimistically flips (fill 220 ms) and emits
// `ol-change` (detail: { done: boolean }) — `done` = the requested state of today's log.
// The owner persists (toggleLog) and re-renders the authoritative state.

export interface HabitToggleChange { done: boolean }

export class OlHabitToggle extends HTMLElement {
  static observedAttributes = ['state', 'progress', 'today-done', 'label', 'disabled'];
  connectedCallback(): void {}
  attributeChangedCallback(): void {}
}

if (!customElements.get('ol-habit-toggle')) customElements.define('ol-habit-toggle', OlHabitToggle);
