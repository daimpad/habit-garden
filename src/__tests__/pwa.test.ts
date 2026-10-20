// Installable app (services/pwa.ts): install state and device detection.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { installState, isIosDevice } from '../services/pwa.js';

describe('install state', () => {
  test('running as an app wins over everything else', () => {
    assert.equal(installState({ standalone: true, prompt: true, ios: true }), 'installed');
  });
  test('the browser prompt comes before the iPhone instructions', () => {
    assert.equal(installState({ standalone: false, prompt: true, ios: false }), 'prompt');
    assert.equal(installState({ standalone: false, prompt: true, ios: true }), 'prompt');
  });
  test('without a prompt: instructions for iOS, else the browser menu', () => {
    assert.equal(installState({ standalone: false, prompt: false, ios: true }), 'ios');
    assert.equal(installState({ standalone: false, prompt: false, ios: false }), 'manual');
  });
});

describe('iOS detection', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const ipadOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';
  test('iPhone and iPad (also iPadOS posing as a Mac with touch)', () => {
    assert.equal(isIosDevice(iphone, 5), true);
    assert.equal(isIosDevice(ipadOS, 5), true);
  });
  test('a Mac without touch and Android are not iOS', () => {
    assert.equal(isIosDevice(ipadOS, 0), false);
    assert.equal(isIosDevice(android, 5), false);
  });
});
