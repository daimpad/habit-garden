// Targets of the "Verschieben" sheet (A.3 Liste: Heute / Morgen / Wochenende / Datum). Pure.
import type { Day } from '../model.js';
import { addDays, isoWeekday } from '../util/date.js';

/** The coming Saturday; on a Saturday or Sunday the weekend is now (today). */
export function weekendDay(today: Day): Day {
  const wd = isoWeekday(today);
  return wd >= 6 ? today : addDays(today, 6 - wd);
}
