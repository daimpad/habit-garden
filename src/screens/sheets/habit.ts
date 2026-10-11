// CONTRACT STUB – implemented in AP7. Habit sheet /gewohnheit/:habitId and habit editor (F §4.13, A.3).
import type { OlSheet } from '../../components/ol-sheet.js';
import type { Id } from '../../model.js';

/** routed: opened by the router for /gewohnheit/:id (history="none"). */
export function openHabitSheet(habitId: Id, opts: { routed?: boolean } = {}): OlSheet {
  throw new Error(`not implemented: openHabitSheet ${habitId} ${String(opts.routed)}`);
}

/** Editor for name, area, rhythm and time of day (A.3 "⋯ Bearbeiten"). */
export function openHabitEditor(habitId: Id): OlSheet {
  throw new Error(`not implemented: openHabitEditor ${habitId}`);
}
