// repo/projects pure helpers: computeProjectStats (top-level tasks only, done/total, nextDue = earliest
// due day of the open tasks, tasks without project ignored) and projectResolver (the "@" lookup of the
// capture sheet: active projects of active areas first, then areas; ambiguity falls back to areas).
// Runs against the tsc output (npm test); scripts/run-tests.mjs sets TZ=Europe/Berlin.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Day, Project, Task } from '../model.js';
import { computeProjectStats, projectResolver } from '../repo/projects.js';
import { parseQuickSyntax } from '../services/quick-syntax.js';

process.env.TZ = 'Europe/Berlin';

const STAMP = '2026-10-01T08:00:00.000Z';
let seq = 0;

const task = (projectId: string | null, extra: Partial<Task> = {}): Task => ({
  id: `t${++seq}`, areaId: 'a1', projectId, parentId: null, title: 'x', status: 'open', important: 0, urgent: 0,
  dueHasTime: 0, reminders: [], sortKey: 'V', createdAt: STAMP, updatedAt: STAMP, ...extra,
});
const due = (day: Day): Partial<Task> => ({ dueDay: day, dueAt: `${day}T00:00:00.000Z` });

describe('computeProjectStats', () => {
  test('counts done and total per project; tasks without project are ignored', () => {
    const stats = computeProjectStats([
      task('p1'), task('p1', { status: 'done' }), task('p1', { status: 'doing' }), task('p2', { status: 'done' }), task(null),
    ]);
    assert.deepEqual(stats.get('p1'), { done: 1, total: 3 });
    assert.deepEqual(stats.get('p2'), { done: 1, total: 1 });
    assert.equal(stats.size, 2);
  });

  test('subtasks do not count', () => {
    const stats = computeProjectStats([task('p1'), task('p1', { parentId: 'tx', status: 'done' }), task('p1', { parentId: 'tx' })]);
    assert.deepEqual(stats.get('p1'), { done: 0, total: 1 });
  });

  test('nextDue is the earliest due day of the tasks that are not done', () => {
    const stats = computeProjectStats([
      task('p1', due('2026-10-20')),
      task('p1', { ...due('2026-10-05'), status: 'done' }),
      task('p1', { ...due('2026-10-14'), status: 'doing' }),
      task('p1'),
      task('p1', { ...due('2026-10-02'), parentId: 'tx' }),
    ]);
    assert.equal(stats.get('p1')?.nextDue, '2026-10-14');
  });

  test('no open dated task: no nextDue', () => {
    const stats = computeProjectStats([task('p1'), task('p1', { ...due('2026-10-05'), status: 'done' })]);
    assert.equal(stats.get('p1')?.nextDue, undefined);
    assert.equal('nextDue' in (stats.get('p1') ?? {}), false);
  });
});

describe('projectResolver', () => {
  const AREAS = [{ id: 'a-wohn', name: 'Wohnen & Alltag' }, { id: 'a-ber', name: 'Beruf & Karriere' }];
  const project = (id: string, name: string, areaId = 'a-wohn', status: Project['status'] = 'active') => ({ id, name, areaId, status });
  const PROJECTS = [
    project('p-bad', 'Bad renovieren'),
    project('p-umzug', 'Umzug'),
    project('p-bew', 'Bewerbung', 'a-ber'),
    project('p-alt', 'Altlasten', 'a-wohn', 'archived'),
    project('p-gone', 'Garten', 'a-archived'),
    project('p-wo1', 'Wochenplan'),
  ];
  const resolve = projectResolver(PROJECTS, AREAS);

  test('a project match wins and is reported as a project', () => {
    assert.deepEqual(resolve('umzug'), { kind: 'project', id: 'p-umzug' });
    assert.deepEqual(resolve('bad'), { kind: 'project', id: 'p-bad' });
    assert.deepEqual(resolve('renov'), { kind: 'project', id: 'p-bad' });
    assert.deepEqual(resolve('BEWERB'), { kind: 'project', id: 'p-bew' });
  });

  test('falls back to areas when no project matches', () => {
    assert.deepEqual(resolve('beruf'), { kind: 'area', id: 'a-ber' });
    assert.deepEqual(resolve('alltag'), { kind: 'area', id: 'a-wohn' });
  });

  test('a project prefix wins over an area prefix ("@wo" → Wochenplan, not Wohnen)', () => {
    assert.deepEqual(resolve('wo'), { kind: 'project', id: 'p-wo1' });
  });

  test('archived projects and projects of inactive areas are not candidates', () => {
    assert.equal(resolve('altlasten'), undefined);
    assert.equal(resolve('garten'), undefined);
  });

  test('several matching projects: the areas decide, else nothing', () => {
    const twin = projectResolver([...PROJECTS, project('p-bew2', 'Bewerbung', 'a-ber')], AREAS);
    assert.equal(twin('bewerbung'), undefined);
    const withArea = projectResolver([project('x1', 'Wohnung streichen'), project('x2', 'Wohnung putzen')], AREAS);
    assert.deepEqual(withArea('wohn'), { kind: 'area', id: 'a-wohn' });
  });

  test('through parseQuickSyntax: target project, no areaId, word removed from the title', () => {
    const parsed = parseQuickSyntax('Fliesen kaufen @bad morgen', { today: '2026-10-13', areas: AREAS, resolveAt: resolve });
    assert.deepEqual(parsed.target, { kind: 'project', id: 'p-bad' });
    assert.equal(parsed.areaId, undefined);
    assert.equal(parsed.title, 'Fliesen kaufen');
    assert.equal(parsed.dueDay, '2026-10-14');
  });
});
