// CONTRACT STUB – implemented in AP7. Task sheet /aufgabe/:taskId (F §4.13, A.3).
import type { OlSheet } from '../../components/ol-sheet.js';
import type { Id } from '../../model.js';

/** routed: opened by the router for /aufgabe/:id (history="none"). */
export function openTaskSheet(taskId: Id, opts: { routed?: boolean } = {}): OlSheet {
  throw new Error(`not implemented: openTaskSheet ${taskId} ${String(opts.routed)}`);
}
