// util/swipe.ts: release outcome (threshold 35 % of the row, quick flick, minimum 40 px).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { swipeOutcome } from '../util/swipe.js';

test('past 35 % of the width runs the action of the direction', () => {
  assert.equal(swipeOutcome(140, 360, 2000), 'right');
  assert.equal(swipeOutcome(-140, 360, 2000), 'left');
});
test('short slow moves do nothing', () => {
  assert.equal(swipeOutcome(100, 360, 2000), null);
  assert.equal(swipeOutcome(30, 360, 10), null);
});
test('a quick flick counts below the threshold', () => {
  assert.equal(swipeOutcome(-80, 360, 100), 'left');
});
test('zero width never triggers', () => {
  assert.equal(swipeOutcome(200, 0, 100), null);
});
