// Garten-Insel (Teil 1): place assignment (default flowers, custom areas, duplicate flowers, more than
// seven areas), flourish level, slot filling with "+n", decor, Keimi's sentence priority and the SVG
// builder (unique id prefix, no style attributes, size budget).
// Runs against the tsc output (npm test).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { islandSvg, type IslandArea } from '../components/island.js';
import type { FlowerId, Stage } from '../model.js';
import {
  assignPlaces, countWord, decorLevel, fillSlots, flourishLevel, keimiLine, PLACE_OF_FLOWER, placeLabel,
  type KeimiInput, type PlaceKey,
} from '../services/island.js';

const c = (key: string, flower: FlowerId): { key: string; flower: FlowerId } => ({ key, flower });

describe('assignPlaces', () => {
  test('the seven default flowers each get their own place', () => {
    const flowers = Object.keys(PLACE_OF_FLOWER) as FlowerId[];
    const { places, extra } = assignPlaces(flowers.map((f) => c(f, f)));
    assert.equal(places.size, 7);
    assert.deepEqual(extra, []);
    for (const f of flowers) assert.equal(places.get(PLACE_OF_FLOWER[f] as PlaceKey), f);
    assert.equal(places.get('home'), 'leucanthemum');
    assert.equal(places.get('health'), 'bellis');
    assert.equal(places.get('bonds'), 'helianthus');
  });

  test('a custom (generic) area takes the first free place from the cottage on, after the default flowers', () => {
    // The custom area comes first in order, but cannot take the cottage that belongs to leucanthemum.
    const { places } = assignPlaces([c('mine', 'generic'), c('home', 'leucanthemum')]);
    assert.equal(places.get('home'), 'home');
    assert.equal(places.get('bonds'), 'mine');
  });

  test('a second area with the same flower takes the next free place clockwise', () => {
    const { places } = assignPlaces([c('a', 'bellis'), c('b', 'bellis'), c('w', 'leucanthemum')]);
    assert.equal(places.get('health'), 'a');
    // Ring after health: work.
    assert.equal(places.get('work'), 'b');
    assert.equal(places.get('home'), 'w');
  });

  test('walks on past taken places (wraps around the ring)', () => {
    const { places } = assignPlaces([c('a', 'centaurea'), c('b', 'centaurea'), c('h', 'leucanthemum')]);
    assert.equal(places.get('work'), 'a');
    // Ring after work wraps to home (taken by h), then bonds.
    assert.equal(places.get('bonds'), 'b');
  });

  test('more than seven areas: the rest share the generic bed, in order', () => {
    const flowers = Object.keys(PLACE_OF_FLOWER) as FlowerId[];
    const list = [...flowers.map((f) => c(f, f)), c('x1', 'generic'), c('x2', 'bellis')];
    const { places, extra } = assignPlaces(list);
    assert.equal(places.size, 7);
    assert.deepEqual(extra, ['x1', 'x2']);
  });

  test('empty input', () => {
    const { places, extra } = assignPlaces([]);
    assert.equal(places.size, 0);
    assert.deepEqual(extra, []);
  });
});

describe('flourishLevel', () => {
  test('no routines and seeds stay modest', () => {
    assert.equal(flourishLevel([]), 0);
    assert.equal(flourishLevel([0]), 0);
    assert.equal(flourishLevel([0, 1]), 0);
  });
  test('average stage maps to 0–3', () => {
    assert.equal(flourishLevel([1]), 1);
    assert.equal(flourishLevel([2]), 1);
    assert.equal(flourishLevel([2, 3]), 2);
    assert.equal(flourishLevel([3]), 2);
    assert.equal(flourishLevel([4, 3]), 3);
    assert.equal(flourishLevel([4, 4, 4]), 3);
    assert.equal(flourishLevel([4, 2]), 2);
  });
});

describe('decorLevel', () => {
  test('wild flowers follow the average stage of all routines', () => {
    assert.equal(decorLevel([]), 'low');
    assert.equal(decorLevel([1, 1]), 'low');
    assert.equal(decorLevel([2, 1]), 'mid');
    assert.equal(decorLevel([4, 2]), 'lush');
  });
});

describe('fillSlots', () => {
  const items = (stages: Stage[]): Array<{ id: number; stage: Stage }> => stages.map((stage, id) => ({ id, stage }));

  test('up to six plants stay in order without "+n"', () => {
    const { shown, more } = fillSlots(items([0, 4, 2, 1, 3, 2]));
    assert.deepEqual(shown.map((i) => i.id), [0, 1, 2, 3, 4, 5]);
    assert.equal(more, 0);
  });

  test('more than six: the six most advanced (ties: earlier first) in their order, the rest as "+n"', () => {
    const { shown, more } = fillSlots(items([1, 4, 0, 2, 3, 1, 4, 2, 0]));
    assert.deepEqual(shown.map((i) => i.id), [0, 1, 3, 4, 6, 7]);
    assert.deepEqual(shown.map((i) => i.stage), [1, 4, 2, 3, 4, 2]);
    assert.equal(more, 3);
  });

  test('custom maximum', () => {
    const { shown, more } = fillSlots(items([2, 3, 1]), 2);
    assert.deepEqual(shown.map((i) => i.id), [0, 1]);
    assert.equal(more, 1);
  });
});

describe('placeLabel', () => {
  test('watering count, nothing due today, no routine', () => {
    assert.equal(placeLabel('Gesundheit & Fitness', 2, 3, 4), 'Gesundheit & Fitness: 2 von 3 heute gegossen');
    assert.equal(placeLabel('Beruf & Karriere', 0, 0, 2), 'Beruf & Karriere: heute nichts zu gießen');
    assert.equal(placeLabel('Wohnen & Alltag', 0, 0, 0), 'Wohnen & Alltag: noch keine Routine');
  });
});

describe('keimiLine', () => {
  const base: KeimiInput = { night: false, evening: false, habits: 3, scheduled: 3, pending: 0, focusOpen: 0, dueContact: null };

  test('priority: night first, then waiting plants, focus, people, watered', () => {
    const all: KeimiInput = { ...base, night: true, pending: 2, focusOpen: 1, dueContact: 'Lena' };
    assert.deepEqual(keimiLine(all), { reason: 'night', text: 'Der Garten ruht.' });
    assert.deepEqual(keimiLine({ ...all, night: false }), { reason: 'pending', text: 'Zwei Pflanzen warten aufs Gießen.' });
    assert.deepEqual(keimiLine({ ...all, night: false, pending: 0 }), { reason: 'focus', text: 'Noch eine Aufgabe im Fokus.' });
    assert.deepEqual(keimiLine({ ...all, night: false, pending: 0, focusOpen: 0 }), { reason: 'contact', text: 'Lena freut sich über ein Lebenszeichen.' });
    assert.deepEqual(keimiLine(base), { reason: 'watered', text: 'Alles gegossen. Der Garten blüht auf.' });
  });

  test('singular, plural and number words', () => {
    assert.equal(keimiLine({ ...base, pending: 1 }).text, 'Eine Pflanze wartet aufs Gießen.');
    assert.equal(keimiLine({ ...base, pending: 12 }).text, 'Zwölf Pflanzen warten aufs Gießen.');
    assert.equal(keimiLine({ ...base, pending: 13 }).text, '13 Pflanzen warten aufs Gießen.');
    assert.equal(keimiLine({ ...base, focusOpen: 3 }).text, 'Noch drei Aufgaben im Fokus.');
  });

  test('evening and quiet days', () => {
    assert.equal(keimiLine({ ...base, evening: true }).text, 'Alles gegossen. Zeit zum Ausruhen.');
    assert.equal(keimiLine({ ...base, habits: 0, scheduled: 0 }).reason, 'first');
    assert.equal(keimiLine({ ...base, scheduled: 0 }).reason, 'rest');
    assert.equal(keimiLine({ ...base, scheduled: 0, evening: true }).reason, 'evening');
  });

  test('never repeats the greeting', () => {
    const inputs: KeimiInput[] = [base, { ...base, night: true }, { ...base, pending: 2 }, { ...base, habits: 0, scheduled: 0 }];
    for (const input of inputs) assert.doesNotMatch(keimiLine(input).text, /Guten|Gute Nacht/u);
  });

  test('countWord', () => {
    assert.equal(countWord(2), 'zwei');
    assert.equal(countWord(5, true), 'Fünf');
    assert.equal(countWord(1), '1');
    assert.equal(countWord(20), '20');
  });
});

describe('islandSvg', () => {
  const area = (flower: FlowerId, lvl: 0 | 1 | 2 | 3, stages: Stage[], more = 0): IslandArea => ({
    lvl, flower, tint: '#C96A5A', plants: stages.map((stage, i) => ({ stage, wet: i % 2 === 0 })), more,
  });
  const full = {
    home: area('leucanthemum', 3, [4, 4, 4, 4, 4, 4], 3), work: area('centaurea', 3, [4, 4, 4, 4, 4, 4], 1),
    bonds: area('helianthus', 3, [4, 4, 4, 4, 4, 4]), health: area('bellis', 3, [4, 4, 4, 4, 4, 4]),
    wealth: area('calendula', 3, [4, 4, 4, 4, 4, 4]), leisure: area('matricaria', 3, [4, 4, 4, 4, 4, 4]),
    growth: area('passiflora', 3, [4, 4, 4, 4, 4, 4]),
  };

  test('every id carries the prefix and every reference points to an id of the same island', () => {
    const svg = islandSvg({ areas: full, extra: area('generic', 3, [4, 4, 4, 4, 4, 4], 2), decor: 'lush', prefix: 'hgi7-' });
    const ids = [...svg.matchAll(/\sid="([^"]+)"/gu)].map((m) => m[1] ?? '');
    assert.ok(ids.length > 20);
    for (const id of ids) assert.ok(id.startsWith('hgi7-'), id);
    assert.equal(new Set(ids).size, ids.length, 'ids are unique');
    const refs = [...svg.matchAll(/(?:href="#|url\(#)([^")]+)/gu)].map((m) => m[1] ?? '');
    for (const ref of refs) assert.ok(ids.includes(ref), `dangling reference ${ref}`);
    assert.ok(!svg.includes('§'));
  });

  test('no style attributes or elements (CSP), no filters', () => {
    const svg = islandSvg({ areas: full, extra: null, decor: 'lush', prefix: 'a-' });
    assert.doesNotMatch(svg, /style=|<style|filter/u);
  });

  test('stays below 70 KB at most, "+n" labels drawn', () => {
    const svg = islandSvg({ areas: full, extra: area('generic', 3, [4, 4, 4, 4, 4, 4], 9), decor: 'lush', prefix: 'hgi1-' });
    assert.ok(svg.length < 70_000, `${svg.length} bytes`);
    assert.match(svg, />\+3</u);
    assert.match(svg, />\+9</u);
  });

  test('missing areas become clearings; a place without routines shows a seed', () => {
    const low = islandSvg({ areas: { health: area('bellis', 0, []) }, extra: null, decor: 'low', prefix: 'p-' });
    assert.match(low, /stroke-dasharray="3 5"/u);
    assert.match(low, /href="#p-p0"/u);
    assert.doesNotMatch(low, /href="#p-p4"/u);
  });

  test('tints are sanitised', () => {
    const svg = islandSvg({ areas: { home: { ...area('leucanthemum', 1, [1]), tint: '"><script>' } }, extra: null, decor: 'low', prefix: 'p-' });
    assert.doesNotMatch(svg, /<script/u);
  });
});
