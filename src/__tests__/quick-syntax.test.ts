// services/quick-syntax: flags, "@" area lookup (normalised, ambiguous, Phase-3 resolver), tags (same
// rule as repo/tags), dates (relative, weekdays incl. today, numeric with/without year, year boundary,
// invalid calendar dates), times, first-date/first-time rule, token offsets and combinations.
// Runs against the tsc output (npm test); scripts/run-tests.mjs sets TZ=Europe/Berlin.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Day } from '../model.js';
import { normalizeTagPath } from '../repo/tags.js';
import {
  matchNamed, normalizeTagPathPure, parseQuickSyntax, type QuickContext, type QuickParse,
} from '../services/quick-syntax.js';
import { isoWeekday } from '../util/date.js';

process.env.TZ = 'Europe/Berlin';

const TODAY: Day = '2026-10-13'; // a Tuesday
const AREAS = [
  { id: 'a-fit', name: 'Gesundheit & Fitness' },
  { id: 'a-fin', name: 'Finanzen & Wohlstand' },
  { id: 'a-bez', name: 'Beziehungen' },
  { id: 'a-ber', name: 'Beruf & Karriere' },
  { id: 'a-pers', name: 'Persönliche Entwicklung' },
  { id: 'a-frei', name: 'Freizeit & Erholung' },
  { id: 'a-wohn', name: 'Wohnen & Alltag' },
];
const ctx = (today: Day = TODAY, extra: Partial<QuickContext> = {}): QuickContext => ({ today, areas: AREAS, ...extra });
const parse = (input: string, today: Day = TODAY): QuickParse => parseQuickSyntax(input, ctx(today));

describe('title and tokens', () => {
  test('plain text stays as typed, whitespace collapsed', () => {
    const r = parse('  Steuer   machen ');
    assert.equal(r.title, 'Steuer machen');
    assert.deepEqual(r.tokens, []);
    assert.equal(r.important, 0);
    assert.equal(r.urgent, 0);
    assert.equal(r.dueDay, undefined);
    assert.deepEqual(r.tagPaths, []);
  });

  test('similar words inside the title stay', () => {
    for (const input of ['Morgenroutine planen', 'Heutelieder', 'Rechnung! zahlen', 'Hallo!! Welt', 'E-Mail an a@b.de', 'Freitagsrunde', 'Frage?!']) {
      const r = parse(input);
      assert.equal(r.title, input, input);
      assert.deepEqual(r.tokens, [], input);
    }
  });

  test('a "!" glued to a word is never a flag', () => {
    const r = parse('Rechnung bezahlen!');
    assert.equal(r.title, 'Rechnung bezahlen!');
    assert.equal(r.important, 0);
  });

  test('token offsets point into the input', () => {
    const input = 'Steuer @fin morgen 14 uhr';
    const r = parse(input);
    assert.deepEqual(r.tokens.map((t) => [t.kind, input.slice(t.start, t.end)]), [
      ['area', '@fin'], ['date', 'morgen'], ['time', '14 uhr'],
    ]);
  });

  test('only syntax: the title becomes empty (the sheet falls back to the raw text)', () => {
    assert.equal(parse('morgen !').title, '');
  });
});

describe('flags', () => {
  test('! important, !! urgent, !!! both', () => {
    assert.deepEqual([parse('A !').important, parse('A !').urgent], [1, 0]);
    assert.deepEqual([parse('A !!').important, parse('A !!').urgent], [0, 1]);
    assert.deepEqual([parse('A !!!').important, parse('A !!!').urgent], [1, 1]);
    assert.deepEqual(parse('A !!!').tokens.map((t) => t.kind), ['important', 'urgent']);
  });

  test('several flag tokens add up and all leave the title', () => {
    const r = parse('! A !!');
    assert.equal(r.title, 'A');
    assert.equal(r.important, 1);
    assert.equal(r.urgent, 1);
  });
});

describe('@ area', () => {
  test('prefix of the name, case- and diacritics-insensitive', () => {
    assert.equal(parse('X @finanzen').areaId, 'a-fin');
    assert.equal(parse('X @FIN').areaId, 'a-fin');
    assert.equal(parse('X @persönlich').areaId, 'a-pers');
    assert.equal(parse('X @personliche').areaId, 'a-pers');
    assert.deepEqual(parse('X @fin').target, { kind: 'area', id: 'a-fin' });
  });

  test('prefix of a later word of the name', () => {
    assert.equal(parse('X @wohlstand').areaId, 'a-fin');
    assert.equal(parse('X @karriere').areaId, 'a-ber');
    assert.equal(parse('X @alltag').areaId, 'a-wohn');
  });

  test('ambiguous or unknown → stays in the title', () => {
    for (const input of ['X @be', 'X @f', 'X @garten', 'X @']) {
      const r = parse(input);
      assert.equal(r.areaId, undefined, input);
      assert.equal(r.title, input, input);
    }
  });

  test('ß matches ss; an exact name beats a longer prefix match', () => {
    const areas = [{ id: 's1', name: 'Sport' }, { id: 's2', name: 'Sportverein' }, { id: 'g', name: 'Große Pläne' }];
    assert.equal(parseQuickSyntax('X @sport', { today: TODAY, areas }).areaId, 's1');
    assert.equal(parseQuickSyntax('X @sportv', { today: TODAY, areas }).areaId, 's2');
    assert.equal(parseQuickSyntax('X @grosse', { today: TODAY, areas }).areaId, 'g');
    assert.equal(parseQuickSyntax('X @plane', { today: TODAY, areas }).areaId, 'g');
  });

  test('only the first resolved target counts', () => {
    const r = parse('X @fin @fit');
    assert.equal(r.areaId, 'a-fin');
    assert.equal(r.title, 'X @fit');
  });

  test('Phase 3: a resolver can look up projects first and fall back to areas', () => {
    const projects = [{ id: 'p-steuer', name: 'Steuererklärung 2026' }];
    const resolveAt: QuickContext['resolveAt'] = (q) => {
      const project = matchNamed(q, projects);
      if (project && project !== 'ambiguous') return { kind: 'project', id: project.id };
      const area = matchNamed(q, AREAS);
      return area && area !== 'ambiguous' ? { kind: 'area', id: area.id } : undefined;
    };
    const p = parseQuickSyntax('X @steuer', ctx(TODAY, { resolveAt }));
    assert.deepEqual(p.target, { kind: 'project', id: 'p-steuer' });
    assert.equal(p.areaId, undefined);
    assert.deepEqual(p.tokens.map((t) => t.kind), ['project']);
    assert.equal(parseQuickSyntax('X @fin', ctx(TODAY, { resolveAt })).areaId, 'a-fin');
  });
});

describe('# tags', () => {
  test('paths are normalised, several allowed, duplicates dropped', () => {
    const r = parse('X #Geld/Steuer #privat #geld//steuer/');
    assert.deepEqual(r.tagPaths, ['geld/steuer', 'privat']);
    assert.equal(r.title, 'X');
    assert.equal(r.tokens.filter((t) => t.kind === 'tag').length, 3);
  });

  test('"#" alone and pure numbers stay in the title', () => {
    const r = parse('Ticket #4711 und # lesen');
    assert.deepEqual(r.tagPaths, []);
    assert.equal(r.title, 'Ticket #4711 und # lesen');
  });

  test('same rule as repo/tags normalizeTagPath', () => {
    for (const input of ['#Geld/Steuer', '##a//b/', '#Größe/Übung', '#ÄRGER', '#a/ /b', `#${'x'.repeat(250)}`]) {
      assert.equal(normalizeTagPathPure(input), normalizeTagPath(input), input);
    }
  });
});

describe('dates', () => {
  test('heute, morgen, übermorgen (also uebermorgen), any case', () => {
    assert.equal(parse('X heute').dueDay, '2026-10-13');
    assert.equal(parse('X Morgen').dueDay, '2026-10-14');
    assert.equal(parse('X übermorgen').dueDay, '2026-10-15');
    assert.equal(parse('X Übermorgen').dueDay, '2026-10-15');
    assert.equal(parse('X uebermorgen').dueDay, '2026-10-15');
  });

  test('year boundary: on 31.12. "morgen" is 1.1.', () => {
    assert.equal(parse('X morgen', '2026-12-31').dueDay, '2027-01-01');
    assert.equal(parse('X übermorgen', '2026-12-31').dueDay, '2027-01-02');
  });

  test('weekdays: the next such day, today when it is that weekday', () => {
    assert.equal(isoWeekday(TODAY), 2);
    assert.equal(parse('X di').dueDay, '2026-10-13');
    assert.equal(parse('X Dienstag').dueDay, '2026-10-13');
    assert.equal(parse('X mi').dueDay, '2026-10-14');
    assert.equal(parse('X fr').dueDay, '2026-10-16');
    assert.equal(parse('X Fr.').dueDay, '2026-10-16');
    assert.equal(parse('X freitag').dueDay, '2026-10-16');
    assert.equal(parse('X mo').dueDay, '2026-10-19');
    assert.equal(parse('X So.').dueDay, '2026-10-18');
    assert.equal(parse('X samstag').dueDay, '2026-10-17');
    assert.equal(parse('X donnerstag').dueDay, '2026-10-15');
    assert.equal(parse('X mittwoch').dueDay, '2026-10-14');
    assert.equal(parse('X sonntag').dueDay, '2026-10-18');
    assert.equal(parse('X montag').dueDay, '2026-10-19');
    // Across the year boundary (Thu 31.12.2026 → Mon 4.1.2027).
    assert.equal(parse('X mo', '2026-12-31').dueDay, '2027-01-04');
  });

  test('numeric dates with and without year', () => {
    assert.equal(parse('X 15.10.').dueDay, '2026-10-15');
    assert.equal(parse('X 13.10.').dueDay, '2026-10-13'); // today is not past
    assert.equal(parse('X 1.3.').dueDay, '2027-03-01'); // past this year → next year
    assert.equal(parse('X 12.10.').dueDay, '2027-10-12');
    assert.equal(parse('X 15.10.2026').dueDay, '2026-10-15');
    assert.equal(parse('X 15.10.26').dueDay, '2026-10-15');
    assert.equal(parse('X 3.1.2027').dueDay, '2027-01-03');
    assert.equal(parse('X 29.02.2028').dueDay, '2028-02-29');
    assert.equal(parse('X 2.1.', '2026-12-31').dueDay, '2027-01-02');
  });

  test('invalid calendar dates stay in the title', () => {
    for (const input of ['X 31.02.', 'X 31.02.2026', 'X 29.02.2027', 'X 32.10.', 'X 10.13.', 'X 0.5.', 'X 15.10', 'X 1.5', 'X 15.10.202']) {
      const r = parse(input);
      assert.equal(r.dueDay, undefined, input);
      assert.equal(r.title, input, input);
    }
  });

  test('only the first date counts', () => {
    const r = parse('morgen Treffen fr');
    assert.equal(r.dueDay, '2026-10-14');
    assert.equal(r.title, 'Treffen fr');
  });
});

describe('times', () => {
  test('14:00, 9:30, 14 uhr, 14uhr, 14h, 14:30 uhr', () => {
    assert.equal(parse('X 14:00').time, '14:00');
    assert.equal(parse('X 9:30').time, '09:30');
    assert.equal(parse('X 14 uhr').time, '14:00');
    assert.equal(parse('X 14 Uhr').title, 'X');
    assert.equal(parse('X 14uhr').time, '14:00');
    assert.equal(parse('X 14h').time, '14:00');
    assert.equal(parse('X 14:30 uhr').time, '14:30');
    assert.equal(parse('X 14:30 uhr').title, 'X');
    assert.equal(parse('X 0:00').time, '00:00');
  });

  test('a time without a date means today, even when it has passed', () => {
    const r = parse('X 6:00');
    assert.equal(r.dueDay, TODAY);
    assert.equal(r.time, '06:00');
  });

  test('not a time: bare numbers, out of range, "uhr" alone', () => {
    for (const input of ['3 Eier kaufen', 'X 24:00', 'X 14:60', 'X 25 uhr', 'Uhr reparieren', 'X 14:5']) {
      const r = parse(input);
      assert.equal(r.time, undefined, input);
      assert.equal(r.title, input, input);
    }
  });

  test('only the first time counts', () => {
    const r = parse('X 9:00 bis 10:00');
    assert.equal(r.time, '09:00');
    assert.equal(r.title, 'X bis 10:00');
  });

  test('time before the date', () => {
    const r = parse('14:00 morgen Zahnarzt');
    assert.equal(r.dueDay, '2026-10-14');
    assert.equal(r.time, '14:00');
    assert.equal(r.title, 'Zahnarzt');
  });
});

describe('combinations', () => {
  test('Steuer machen @finanzen morgen ! #geld/steuer 14:00', () => {
    const input = 'Steuer machen @finanzen morgen ! #geld/steuer 14:00';
    const r = parse(input);
    assert.equal(r.title, 'Steuer machen');
    assert.equal(r.important, 1);
    assert.equal(r.urgent, 0);
    assert.equal(r.areaId, 'a-fin');
    assert.deepEqual(r.tagPaths, ['geld/steuer']);
    assert.equal(r.dueDay, '2026-10-14');
    assert.equal(r.time, '14:00');
    assert.deepEqual(r.tokens.map((t) => [t.kind, input.slice(t.start, t.end)]), [
      ['area', '@finanzen'], ['date', 'morgen'], ['important', '!'], ['tag', '#geld/steuer'], ['time', '14:00'],
    ]);
  });

  test('fr 14:00 with urgent flag, words in between stay in order', () => {
    const r = parse('!! Arzt anrufen fr 14:00 wegen Termin');
    assert.equal(r.title, 'Arzt anrufen wegen Termin');
    assert.equal(r.urgent, 1);
    assert.equal(r.dueDay, '2026-10-16');
    assert.equal(r.time, '14:00');
  });
});

describe('ambiguous "so"', () => {
  test('a bare "so" stays a word', () => {
    const r = parse('Das so lassen');
    assert.equal(r.title, 'Das so lassen');
    assert.equal(r.dueDay, undefined);
  });
  test('"so" before a time, "so." and "sonntag" mean Sunday', () => {
    assert.equal(parse('Grillen so 18:00').dueDay, '2026-10-18');
    assert.equal(parse('Grillen so.').dueDay, '2026-10-18');
    assert.equal(parse('Grillen sonntag').dueDay, '2026-10-18');
  });
});
