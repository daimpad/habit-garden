// CONTRACT STUB – implemented in AP4. Pure functions, calendar components only.
import type { Day, Recurrence } from '../model.js';

/**
 * First occurrence strictly after `after`, aligned to `anchor` (the first
 * occurrence / recurrenceAnchor):
 * - daily: anchor + k·interval days
 * - weekly: listed ISO weekdays (1 = Mo … 7 = So) in weeks anchorWeek + k·interval
 * - monthly: day N (clamped to the month's last day) or 'last', months anchor + k·interval
 * - afterCompletion: after + days
 * - timesPerWeek: habits only → throws RangeError
 */
export function nextOccurrence(rec: Recurrence, anchor: Day, after: Day): Day {
  throw new Error(`not implemented: nextOccurrence ${rec.kind} ${anchor} ${after}`);
}
