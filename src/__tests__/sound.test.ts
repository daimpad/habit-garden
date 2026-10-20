// Klänge (services/sound.ts): the pure rules (level, visibility, repeat and priority gaps) and the settings value.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_SETTINGS } from '../model.js';
import { upgradeProfile } from '../repo/profile.js';
import {
  DEFAULT_SOUND_LEVEL, isSoundLevel, LEVEL_GAIN, mayPlay, PRIORITY, REPEAT_MS, SOUND_GAIN, SOUND_IDS, YIELD_MS,
} from '../services/sound.js';
import { parseImport } from '../services/transfer.js';

const on = { level: 'soft' as const, hidden: false };

describe('sound rules', () => {
  test('off and hidden never play', () => {
    assert.equal(mayPlay('water', 1000, { level: 'off', hidden: false, last: null }), false);
    assert.equal(mayPlay('water', 1000, { level: 'normal', hidden: true, last: null }), false);
    assert.equal(mayPlay('water', 1000, { ...on, last: null }), true);
  });
  test('the same sound waits REPEAT_MS', () => {
    const last = { id: 'tap' as const, at: 1000 };
    assert.equal(mayPlay('tap', 1000 + REPEAT_MS - 1, { ...on, last }), false);
    assert.equal(mayPlay('tap', 1000 + REPEAT_MS, { ...on, last }), true);
  });
  test('a less notable sound yields to a recent more notable one', () => {
    const last = { id: 'milestone' as const, at: 1000 };
    assert.equal(mayPlay('water', 1000 + YIELD_MS - 1, { ...on, last }), false);
    assert.equal(mayPlay('water', 1000 + YIELD_MS, { ...on, last }), true);
    // Equal priority yields too (tap right after water).
    assert.equal(mayPlay('tap', 1100, { ...on, last: { id: 'water', at: 1000 } }), false);
  });
  test('a more notable sound plays at once', () => {
    assert.equal(mayPlay('grow', 1010, { ...on, last: { id: 'water', at: 1000 } }), true);
    assert.equal(mayPlay('milestone', 1010, { ...on, last: { id: 'bloom', at: 1000 } }), true);
  });
  test('tables cover every sound; gains stay below 1', () => {
    for (const id of SOUND_IDS) {
      assert.ok(SOUND_GAIN[id] > 0 && SOUND_GAIN[id] <= 1, id);
      assert.ok(PRIORITY[id] >= 1, id);
    }
    assert.equal(LEVEL_GAIN.off, 0);
    assert.ok(LEVEL_GAIN.soft < LEVEL_GAIN.normal && LEVEL_GAIN.normal <= 1);
  });
});

describe('sound setting', () => {
  test('default is soft, valid values only', () => {
    assert.equal(DEFAULT_SETTINGS.sound, 'soft');
    assert.equal(DEFAULT_SOUND_LEVEL, 'soft');
    assert.equal(isSoundLevel('normal'), true);
    assert.equal(isSoundLevel('loud'), false);
    assert.equal(isSoundLevel(undefined), false);
  });
  test('older profiles without the field read as soft', () => {
    const settings = { ...DEFAULT_SETTINGS } as Partial<typeof DEFAULT_SETTINGS>;
    delete settings.sound;
    const profile = upgradeProfile({
      key: 'profile', schemaVersion: 2, settings: settings as typeof DEFAULT_SETTINGS, onboardingDone: 1, createdAt: '2026-10-01T08:00:00.000Z',
    });
    assert.equal(profile.settings.sound, 'soft');
    const off = upgradeProfile({
      key: 'profile', schemaVersion: 2, settings: { ...DEFAULT_SETTINGS, sound: 'off' }, onboardingDone: 1, createdAt: '2026-10-01T08:00:00.000Z',
    });
    assert.equal(off.settings.sound, 'off');
  });
  test('import keeps a valid level and rejects others', () => {
    const file = (sound: unknown): string => JSON.stringify({
      format: 'olife', version: 1, exportedAt: '2026-10-20T08:00:00.000Z',
      tables: {
        profile: [{ key: 'profile', settings: { sound }, onboardingDone: 1, createdAt: '2026-10-01T08:00:00.000Z' }],
        areas: [], projects: [], tasks: [], habits: [], habitLogs: [], notes: [], tags: [], moodLogs: [], dayPlans: [],
      },
    });
    const parsed = parseImport(file('off')) as unknown as { tables: { profile: Array<{ settings: { sound: string } }> } };
    assert.equal(parsed.tables.profile[0]?.settings.sound, 'off');
    assert.throws(() => parseImport(file('loud')));
  });
});
