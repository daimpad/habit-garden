// CONTRACT STUB – implemented in AP6. Pure functions returning SVG markup strings
// (no gradients, no animation in the markup, no style="" attributes because of the CSP).
// Geometry: F §4.11 (approved: data 1:1, own code; provenance in README).
import type { FlowerId, Stage } from '../model.js';

/** Flower glyph, viewBox 0 0 24 24, centre (12, 12). */
export function flower(id: FlowerId, size = 24): string {
  throw new Error(`not implemented: flower ${id} ${size}`);
}

/** Plant in stage 0–4, viewBox 0 0 160 190; grow group has class "ol-plant__grow". */
export function plant(stage: Stage, flowerId: FlowerId, tint: string): string {
  throw new Error(`not implemented: plant ${stage} ${flowerId} ${tint}`);
}

/**
 * Petal colour for burst particles ("Blütenfarbe"): the flower's ray colour,
 * or for white-rayed flowers a visible accent (bellis tip pink, otherwise the area tint).
 */
export function petalColor(flowerId: FlowerId, tint: string): string {
  throw new Error(`not implemented: petalColor ${flowerId} ${tint}`);
}
