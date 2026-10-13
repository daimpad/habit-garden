// PLANUNG helpers (services/planning.ts): list groups, inbox rule, project plant stage.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Day, Task } from '../model.js';
import { groupForList, inScope, isInbox, listGroupOf, projectStage } from '../services/planning.js';

process.env.TZ = 'Europe/Berlin';

const TODAY: Day = '2026-10-13'; // a Tuesday; ISO week ends on Sunday 2026-10-18

let seq = 0;
const task = (patch: Partial<Task> = {}): Task => ({
  id: `t${++seq}`, areaId: 'a1', projectId: null, parentId: null, title: 'X', status: 'open', important: 0, urgent: 0,
  dueHasTime: 0, reminders: [], sortKey: 'V', createdAt: `2026-10-0${(seq % 9) + 1}T08:00:00.000Z`, updatedAt: '2026-10-01T08:00:00.000Z',
  ...patch,
});

describe('list groups', () => {
  test('overdue, today, this week, later, without date', () => {
    assert.equal(listGroupOf({ dueDay: '2026-10-12' }, TODAY), 'overdue');
    assert.equal(listGroupOf({ dueDay: TODAY }, TODAY), 'today');
    assert.equal(listGroupOf({ dueDay: '2026-10-14' }, TODAY), 'week');
    assert.equal(listGroupOf({ dueDay: '2026-10-18' }, TODAY), 'week');
    assert.equal(listGroupOf({ dueDay: '2026-10-19' }, TODAY), 'later');
    assert.equal(listGroupOf({}, TODAY), 'noDate');
  });
  test('on a Sunday "this week" is empty', () => {
    assert.equal(listGroupOf({ dueDay: '2026-10-19' }, '2026-10-18'), 'later');
  });
  test('year change: the week reaches into January', () => {
    assert.equal(listGroupOf({ dueDay: '2027-01-03' }, '2026-12-30'), 'week');
  });
  test('groups are sorted: dated by due order, undated newest first', () => {
    const a = task({ dueDay: '2026-10-15', dueAt: '2026-10-14T22:00:00.000Z' });
    const b = task({ dueDay: '2026-10-14', dueAt: '2026-10-13T22:00:00.000Z' });
    const old = task({ createdAt: '2026-10-01T08:00:00.000Z' });
    const young = task({ createdAt: '2026-10-10T08:00:00.000Z' });
    const g = groupForList([a, b, old, young], TODAY);
    assert.deepEqual(g.week.map((x) => x.id), [b.id, a.id]);
    assert.deepEqual(g.noDate.map((x) => x.id), [young.id, old.id]);
  });
});

describe('inbox and scope', () => {
  test('inbox: open, top-level, no project, no date', () => {
    assert.equal(isInbox(task()), true);
    assert.equal(isInbox(task({ projectId: 'p1' })), false);
    assert.equal(isInbox(task({ dueDay: TODAY })), false);
    assert.equal(isInbox(task({ status: 'done' })), false);
    assert.equal(isInbox(task({ parentId: 'x' })), false);
  });
  test('scope by area and project', () => {
    const list = [task({ areaId: 'a1', projectId: 'p1' }), task({ areaId: 'a2' })];
    assert.equal(inScope(list, {}).length, 2);
    assert.equal(inScope(list, { areaId: 'a2' }).length, 1);
    assert.equal(inScope(list, { projectId: 'p1' }).length, 1);
  });
});

describe('project plant', () => {
  test('stage by share done', () => {
    assert.equal(projectStage(0, 0), 0);
    assert.equal(projectStage(0, 4), 1);
    assert.equal(projectStage(1, 4), 2);
    assert.equal(projectStage(2, 4), 3);
    assert.equal(projectStage(3, 4), 3);
    assert.equal(projectStage(4, 4), 4);
  });
});
