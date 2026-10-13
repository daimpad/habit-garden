// Long-press drag geometry (util/drag.ts): rect clipping, drop-zone hit testing, edge auto-scroll, slop.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { beyondSlop, edgeSpeed, intersectRect, pickTarget, type Rect } from '../util/drag.js';

const rect = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom });

describe('intersectRect', () => {
  test('overlapping rects', () => {
    assert.deepEqual(intersectRect(rect(0, 0, 100, 100), rect(50, 20, 200, 80)), rect(50, 20, 100, 80));
  });
  test('disjoint or touching rects give null', () => {
    assert.equal(intersectRect(rect(0, 0, 10, 10), rect(20, 0, 30, 10)), null);
    assert.equal(intersectRect(rect(0, 0, 10, 10), rect(10, 0, 20, 10)), null);
  });
});

describe('pickTarget', () => {
  // Three Kanban columns with 12 px gaps.
  const cols = [rect(16, 100, 316, 600), rect(328, 100, 628, 400), rect(640, 100, 940, 300)];

  test('the zone containing the point wins', () => {
    assert.equal(pickTarget(cols, 400, 200, 'both'), 1);
    assert.equal(pickTarget(cols, 20, 590, 'both'), 0);
  });
  test('axis x ignores the vertical position (short columns)', () => {
    assert.equal(pickTarget(cols, 700, 580, 'x'), 2);
    assert.equal(pickTarget(cols, 700, 580, 'both'), -1);
  });
  test('gaps snap to the nearest zone within the tolerance', () => {
    assert.equal(pickTarget(cols, 320, 200, 'x'), 0);
    assert.equal(pickTarget(cols, 325, 200, 'x'), 1);
    assert.equal(pickTarget(cols, 1000, 200, 'x'), -1);
    assert.equal(pickTarget(cols, 960, 200, 'x', 24), 2);
  });
  test('clipped (null) zones are skipped', () => {
    assert.equal(pickTarget([null, cols[1] ?? null], 400, 200, 'both'), 1);
    assert.equal(pickTarget([null, null], 400, 200, 'both'), -1);
  });
  test('matrix quadrants: the point picks one of four', () => {
    const quads = [rect(0, 0, 100, 100), rect(108, 0, 208, 100), rect(0, 108, 100, 208), rect(108, 108, 208, 208)];
    assert.equal(pickTarget(quads, 150, 150, 'both'), 3);
    assert.equal(pickTarget(quads, 50, 150, 'both'), 2);
    assert.equal(pickTarget(quads, 150, 50, 'both'), 1);
  });
});

describe('edgeSpeed', () => {
  test('zero in the middle, signed near the edges, capped at the edge', () => {
    assert.equal(edgeSpeed(200, 0, 400, 48, 16), 0);
    assert.equal(edgeSpeed(0, 0, 400, 48, 16), -16);
    assert.equal(edgeSpeed(24, 0, 400, 48, 16), -8);
    assert.equal(edgeSpeed(400, 0, 400, 48, 16), 16);
    assert.equal(edgeSpeed(500, 0, 400, 48, 16), 16);
    assert.equal(edgeSpeed(376, 0, 400, 48, 16), 8);
  });
  test('a range too small for two edge zones never scrolls', () => {
    assert.equal(edgeSpeed(10, 0, 90, 48, 16), 0);
  });
});

describe('beyondSlop', () => {
  test('10 px of movement is still a press, more is not', () => {
    assert.equal(beyondSlop(6, 8), false);
    assert.equal(beyondSlop(8, 7), true);
    assert.equal(beyondSlop(0, -11), true);
  });
});
