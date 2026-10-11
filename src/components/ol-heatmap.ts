// CONTRACT STUB – implemented in AP6.
// <ol-heatmap habit-id="…" weeks="12"></ol-heatmap>
// Loads the habit and its logs itself via liveQuery (repo/habits habit$, repo/habitLogs habitLogs$),
// levels from growth.stageAt (l0..l4). 13-column grid (weekday column Mo/Mi/Fr + 12 weeks,
// Monday first, last column contains today). One focusable element (tabindex 0, role="group",
// aria-label t.heatmapAria). Keys: ↑/↓ ±1 day, ←/→ ±7 days, Enter/Space toggle, Home/End.
// Tooltip role="tooltip" clamped to the viewport; cursor changes announced in an aria-live="polite" region.
// Click/tap on a past (or today's) cell moves the cursor there and toggles it. Future cells: aria-hidden, not toggleable.
// The component does NOT write: it emits `ol-toggle-day` (detail: { day }) and the owner calls toggleLog.
// Re-renders must keep focus and cursor (update cell classes in place).
// Approved exception (Rückfrage 2): cells are 12 px, below the 48 px touch target; documented in code.

export interface ToggleDayDetail { day: string }

export class OlHeatmap extends HTMLElement {
  static observedAttributes = ['habit-id', 'weeks'];
  connectedCallback(): void {}
  disconnectedCallback(): void {}
  attributeChangedCallback(): void {}
}

if (!customElements.get('ol-heatmap')) customElements.define('ol-heatmap', OlHeatmap);
