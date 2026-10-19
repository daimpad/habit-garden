// Guided tour (services/tour.ts): step data, optional steps, light and bubble placement, scroll target.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  GAP, GUTTER, isTourId, place, scrollTarget, SPOT_PAD, spotRect, TOURS, type Rect, type Viewport,
} from '../services/tour.js';

const phone: Viewport = { width: 390, height: 844, top: 0, bottom: 780 };
const bubble = { w: 358, h: 190 };

describe('tour steps', () => {
  test('main tour: ten steps from welcome to end, with the two "Ausprobieren" steps', () => {
    const ids = TOURS.main.map((s) => s.id);
    assert.deepEqual(ids, ['welcome', 'island', 'habit', 'water', 'focus', 'fab', 'planung', 'wissen', 'settings', 'end']);
    assert.deepEqual(TOURS.main.filter((s) => s.tryIt).map((s) => `${s.id}:${s.tryIt}`), ['habit:habit', 'focus:focus']);
    assert.equal(TOURS.main[0]?.targets.length, 0);
  });
  test('every step has a title, a short text and unique ids per tour', () => {
    for (const [id, steps] of Object.entries(TOURS)) {
      assert.ok(steps.length >= 4, id);
      assert.equal(new Set(steps.map((s) => s.id)).size, steps.length, id);
      for (const s of steps) {
        assert.ok(s.title.length > 0 && s.text.length > 0, `${id}/${s.id}`);
        assert.ok(s.text.length <= 220, `${id}/${s.id} text too long (${s.text.length})`);
        assert.doesNotMatch(s.text, /!/u);
      }
    }
  });
  test('chapters stay on their own area', () => {
    assert.ok(TOURS.heute.every((s) => s.route === '/heute'));
    assert.ok(TOURS.planung.every((s) => s.route === '/planung'));
    assert.ok(TOURS.wissen.every((s) => s.route === '/wissen'));
  });
  test('isTourId', () => {
    assert.equal(isTourId('main'), true);
    assert.equal(isTourId('wissen'), true);
    assert.equal(isTourId('toString'), false);
    assert.equal(isTourId(undefined), false);
  });
});

describe('light and bubble', () => {
  test('light = target plus padding, clipped to the visible area', () => {
    assert.deepEqual(spotRect({ x: 20, y: 100, w: 100, h: 40 }, phone), { x: 20 - SPOT_PAD, y: 100 - SPOT_PAD, w: 100 + 2 * SPOT_PAD, h: 40 + 2 * SPOT_PAD });
    const clipped = spotRect({ x: 0, y: 700, w: 390, h: 200 }, phone);
    assert.ok(clipped && clipped.x >= 4 && clipped.y + clipped.h <= phone.bottom - 4);
    assert.equal(spotRect({ x: 0, y: 900, w: 100, h: 40 }, phone), null);
  });
  test('below when it fits, else above, else over the lower part', () => {
    const top: Rect = { x: 16, y: 80, w: 200, h: 48 };
    const p1 = place(top, bubble, phone);
    assert.equal(p1.side, 'below');
    assert.equal(p1.bubble.y, top.y + top.h + SPOT_PAD + GAP);
    const low: Rect = { x: 16, y: 640, w: 200, h: 48 };
    const p2 = place(low, bubble, phone);
    assert.equal(p2.side, 'above');
    assert.ok(p2.bubble.y + bubble.h <= low.y - SPOT_PAD);
    const tall: Rect = { x: 0, y: 40, w: 390, h: 700 };
    const p3 = place(tall, bubble, phone);
    assert.equal(p3.side, 'over');
    assert.equal(p3.bubble.y, phone.bottom - GUTTER - bubble.h);
  });
  test('the bubble stays inside the gutters; the pointer aims at the light', () => {
    const right: Rect = { x: 340, y: 20, w: 40, h: 40 };
    const p = place(right, bubble, phone);
    assert.equal(p.bubble.x, phone.width - GUTTER - bubble.w);
    assert.ok(p.bubble.x >= GUTTER);
    assert.ok(Math.abs(p.bubble.x + p.pointer - (right.x + right.w / 2)) <= 24 + 0.01);
    const wide = place({ x: 600, y: 200, w: 120, h: 40 }, bubble, { width: 1280, height: 800, top: 0, bottom: 800 });
    assert.equal(wide.bubble.x + wide.pointer, 660);
  });
  test('without a target Keimi stands in the middle', () => {
    const p = place(null, bubble, phone);
    assert.equal(p.side, 'center');
    assert.equal(p.spot, null);
    assert.equal(p.bubble.x, (390 - 358) / 2);
    assert.equal(p.bubble.y, (780 - 190) / 2);
  });
});

describe('scroll target', () => {
  test('no scroll when light and bubble already fit', () => {
    assert.equal(scrollTarget({ x: 16, y: 120, w: 200, h: 60 }, bubble, phone), null);
  });
  test('a target below the fold is brought up so light and bubble are centred together', () => {
    const r: Rect = { x: 16, y: 1400, w: 358, h: 120 };
    const y = scrollTarget(r, bubble, phone);
    assert.ok(y !== null);
    const moved = { ...r, y: y ?? 0 };
    const p = place(moved, bubble, phone);
    assert.notEqual(p.side, 'over');
    assert.ok(p.bubble.y + bubble.h <= phone.bottom - GUTTER + 0.01);
  });
  test('a target taller than the room starts near the top', () => {
    assert.equal(scrollTarget({ x: 0, y: 300, w: 390, h: 640 }, bubble, phone), phone.top + GUTTER + SPOT_PAD);
  });
});
