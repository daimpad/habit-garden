// CONTRACT STUB – implemented in AP7. Capture sheet (F §4.13, A.2 G1/G2, B.3 sheet layout).
import type { OlSheet } from '../../components/ol-sheet.js';
import type { Id } from '../../model.js';

export type CaptureType = 'task' | 'habit' | 'note';
export interface CaptureOptions { type?: CaptureType; areaId?: Id; projectId?: Id | null }

export function openCapture(opts: CaptureOptions = {}): OlSheet {
  throw new Error(`not implemented: openCapture ${opts.type ?? ''}`);
}
