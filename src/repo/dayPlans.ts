// CONTRACT STUB – implemented in AP5. Signatures are binding; bodies are placeholders.
import type { Observable } from 'dexie';
import type { Day, DayPlan, Id } from '../model.js';

export class FocusFullError extends Error {
  constructor() {
    super('focus limit reached');
    this.name = 'FocusFullError';
  }
}

/** Replaces the focus of day; throws FocusFullError for more than 3 ids (F §4.7). */
export function setFocus(day: Day, taskIds: Id[]): Promise<void> {
  throw new Error(`not implemented: setFocus ${day} ${taskIds.length}`);
}

/** Appends one task; no-op when already present; throws FocusFullError when 3 are set. */
export function addToFocus(day: Day, taskId: Id): Promise<void> {
  throw new Error(`not implemented: addToFocus ${day} ${taskId}`);
}

export function removeFromFocus(day: Day, taskId: Id): Promise<void> {
  throw new Error(`not implemented: removeFromFocus ${day} ${taskId}`);
}

export function getFocus(day: Day): Promise<Id[]> {
  throw new Error(`not implemented: getFocus ${day}`);
}

/** liveQuery of the DayPlan of day (undefined when none exists). */
export function dayPlan$(day: Day): Observable<DayPlan | undefined> {
  throw new Error(`not implemented: dayPlan$ ${day}`);
}

/** True when any DayPlan ever had a task (used for the "Erste Schritte" card). */
export function anyFocusEver(): Promise<boolean> {
  throw new Error('not implemented: anyFocusEver');
}
