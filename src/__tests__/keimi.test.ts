// Keimi wächst mit und Tagesernte (services/keimi.ts, island drawing, import check).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { islandSvg, keimiFigure } from '../components/island.js';
import { harvest, keimiLook, keimiStage, keimiStages } from '../services/keimi.js';
import { parseImport } from '../services/transfer.js';
import { addDays } from '../util/date.js';

const days = (from: string, n: number): string[] => Array.from({ length: n }, (_, i) => addDays(from, i));

describe('Keimi wächst mit', () => {
  test('a new garden: Keimling, the rest open with progress', () => {
    const s = keimiStages([], '2026-11-01', '2026-11-02');
    assert.equal(keimiStage(s), 'seedling');
    assert.equal(s[0]?.day, '2026-11-01');
    assert.deepEqual(s.find((x) => x.stage === 'sprout')?.progress, { n: 0, of: 7 });
    assert.deepEqual(s.find((x) => x.stage === 'crown')?.progress, { n: 1, of: 90 });
  });
  test('Spross after 7 days with watering, Strohhut after 30, Gießkanne after 100 waterings, Kranz after 90 days', () => {
    // Two routines watered on 30 days: 60 waterings, 30 days.
    const logs = [...days('2026-09-01', 30), ...days('2026-09-01', 30)].sort();
    const s = keimiStages(logs, '2026-09-01', '2026-11-02');
    const by = new Map(s.map((x) => [x.stage, x]));
    assert.equal(by.get('sprout')?.day, '2026-09-07');
    assert.equal(by.get('hat')?.day, '2026-09-30');
    assert.equal(by.get('can')?.day, null);
    assert.deepEqual(by.get('can')?.progress, { n: 60, of: 100 });
    assert.equal(by.get('crown')?.day, null);
    assert.equal(keimiStage(s), 'hat');
    const later = keimiStages(logs, '2026-09-01', '2026-12-05');
    assert.equal(later.find((x) => x.stage === 'crown')?.day, '2026-11-30');
    // Nothing is lost after a pause: the same history weeks later keeps the stages.
    assert.equal(keimiStage(later), 'crown');
  });
  test('look: four leaves from Spross on; the choice if reached, else the latest; none wears nothing', () => {
    const logs = days('2026-09-01', 30);
    const s = keimiStages(logs, '2026-09-01', '2026-11-02');
    assert.deepEqual(keimiLook(s, undefined), { leaves: 'four', wear: 'hat' });
    assert.deepEqual(keimiLook(s, 'none'), { leaves: 'four', wear: null });
    assert.deepEqual(keimiLook(s, 'crown'), { leaves: 'four', wear: 'hat' });
    assert.deepEqual(keimiLook(keimiStages([], null, '2026-11-02'), undefined), { leaves: 'two', wear: null });
  });
  test('drawn on the island and alone', () => {
    const svg = islandSvg({ areas: {}, extra: null, decor: 'low', prefix: 'p-', keimi: { leaves: 'four', wear: 'crown' } });
    assert.match(svg, /class="i-wear"/u);
    assert.match(svg, /M0 -49C-1.6 -54/u);
    const fig = keimiFigure({ leaves: 'two', wear: 'can' }, 64, 'kx-');
    assert.match(fig, /ol-keimi-fig/u);
    assert.match(fig, /url\(#kx-g-keimi\)/u);
    assert.doesNotMatch(fig, /§/u);
  });
});

describe('Tagesernte', () => {
  test('lines for what happened, a calm sentence either way', () => {
    const full = harvest({ watered: 3, grown: ['Lesen'], visitors: ['Biene'], tasks: 2, seeds: 7 });
    assert.deepEqual(full.lines.map((l) => l.text), [
      '3 Routinen gegossen', 'Lesen ist gewachsen', 'Biene war zu Besuch', '2 Aufgaben erledigt', '+7 Samen',
    ]);
    assert.equal(full.keimi, 'Ein guter Tag. Schlaf gut.');
    assert.equal(harvest({ watered: 1, grown: ['Lesen', 'Laufen'], visitors: [], tasks: 1, seeds: 0 }).lines[1]?.text, 'Lesen und Laufen sind gewachsen');
    assert.equal(harvest({ watered: 0, grown: ['a', 'b', 'c', 'd'], visitors: [], tasks: 0, seeds: 0 }).lines[0]?.text, '4 Pflanzen sind gewachsen');
    const quiet = harvest({ watered: 0, grown: [], visitors: [], tasks: 0, seeds: 0 });
    assert.deepEqual(quiet.lines, []);
    assert.match(quiet.keimi, /ruhiger Tag/u);
    for (const line of [...full.lines.map((l) => l.text), full.keimi, quiet.keimi]) assert.doesNotMatch(line, /!/u);
  });
  test('import keeps the outfit and the closed day', () => {
    const file = (extra: Record<string, unknown>): string => JSON.stringify({
      format: 'olife', version: 1, exportedAt: '2026-11-02T08:00:00.000Z',
      tables: {
        profile: [{ key: 'profile', settings: {}, onboardingDone: 1, createdAt: '2026-10-01T08:00:00.000Z', ...extra }],
        areas: [], projects: [], tasks: [], habits: [], habitLogs: [], notes: [], tags: [], moodLogs: [], dayPlans: [],
      },
    });
    const ok = parseImport(file({ keimi: { wear: 'hat' }, harvestDismissedFor: '2026-11-02' })) as unknown as { tables: { profile: Array<Record<string, unknown>> } };
    assert.deepEqual(ok.tables.profile[0]?.['keimi'], { wear: 'hat' });
    assert.equal(ok.tables.profile[0]?.['harvestDismissedFor'], '2026-11-02');
    assert.throws(() => parseImport(file({ keimi: { wear: 'cape' } })));
  });
});
