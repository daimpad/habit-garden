// router.ts: parseRoute() (pure) for all routes, params, query strings and unknown paths.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { current, isTab, lastPathOf, parseRoute, routeHref, type Route } from '../router.js';

function parsed(path: string): Route {
  const route = parseRoute(path);
  assert.ok(route, `expected a route for ${path}`);
  return route;
}

describe('parseRoute: routes', () => {
  const cases: Array<[string, Route['name'], Route['tab'], boolean]> = [
    ['/start', 'start', null, false],
    ['/heute', 'heute', 'heute', false],
    ['/planung', 'planung', 'planung', false],
    ['/planung/inbox', 'planung-inbox', 'planung', false],
    ['/planung/p/p1', 'planung-project', 'planung', false],
    ['/wissen', 'wissen', 'wissen', false],
    ['/wissen/n/n1', 'wissen-note', 'wissen', false],
    ['/einstellungen', 'einstellungen', null, false],
    ['/einstellungen/daten', 'einstellungen', null, false],
    ['/aufgabe/t1', 'aufgabe', null, true],
    ['/gewohnheit/h1', 'gewohnheit', null, true],
  ];
  for (const [path, name, tab, overlay] of cases) {
    test(`${path} → ${name}`, () => {
      const route = parsed(path);
      assert.equal(route.name, name);
      assert.equal(route.path, path);
      assert.equal(route.tab, tab);
      assert.equal(route.overlay, overlay);
      assert.equal(routeHref(route), path);
      assert.equal(route.query.toString(), '');
    });
  }
});

describe('parseRoute: params', () => {
  test('project, note, task and habit ids', () => {
    assert.deepEqual(parsed('/planung/p/0b6c-11').params, { projectId: '0b6c-11' });
    assert.deepEqual(parsed('/wissen/n/abc').params, { noteId: 'abc' });
    assert.deepEqual(parsed('/aufgabe/3f2a9c1e-8d7b-4e6f-9a10-2b3c4d5e6f70').params, {
      taskId: '3f2a9c1e-8d7b-4e6f-9a10-2b3c4d5e6f70',
    });
    assert.deepEqual(parsed('/gewohnheit/h-42').params, { habitId: 'h-42' });
  });

  test('optional settings section', () => {
    assert.deepEqual(parsed('/einstellungen').params, {});
    assert.deepEqual(parsed('/einstellungen/darstellung').params, { section: 'darstellung' });
  });

  test('params are percent-decoded, the path keeps the encoding', () => {
    const route = parsed('/aufgabe/a%20b');
    assert.equal(route.params['taskId'], 'a b');
    assert.equal(route.path, '/aufgabe/a%20b');
  });

  test('routes without params have an empty params object', () => {
    assert.deepEqual(parsed('/heute').params, {});
    assert.deepEqual(parsed('/planung/inbox').params, {});
  });
});

describe('parseRoute: query and normalisation', () => {
  test('the query string is kept (A.1 tag filter)', () => {
    const route = parsed('/wissen?tag=a/b,c&op=and');
    assert.equal(route.name, 'wissen');
    assert.equal(route.path, '/wissen');
    assert.equal(route.query.get('tag'), 'a/b,c');
    assert.equal(route.query.get('op'), 'and');
    assert.equal(routeHref(route), '/wissen?tag=a/b,c&op=and');
  });

  test('query on a route with params', () => {
    const route = parsed('/planung/p/p1?view=kanban');
    assert.equal(route.params['projectId'], 'p1');
    assert.equal(route.query.get('view'), 'kanban');
  });

  test('an empty query is dropped', () => {
    assert.equal(routeHref(parsed('/heute?')), '/heute');
  });

  test('trailing and repeated slashes are normalised', () => {
    assert.equal(parsed('/heute/').path, '/heute');
    assert.equal(parsed('/planung//inbox/').path, '/planung/inbox');
    assert.equal(routeHref(parsed('/wissen/?tag=x')), '/wissen?tag=x');
  });

  test('the fragment is ignored', () => {
    const route = parsed('/einstellungen/daten#export');
    assert.equal(route.params['section'], 'daten');
    assert.equal(routeHref(route), '/einstellungen/daten');
  });

  test('routeHref falls back to path and query when href is absent', () => {
    const route: Route = {
      name: 'wissen', path: '/wissen', params: {}, query: new URLSearchParams('op=or'), overlay: false, tab: 'wissen',
    };
    assert.equal(routeHref(route), '/wissen?op=or');
  });
});

describe('parseRoute: unknown paths', () => {
  const unknown = [
    '/', '', 'heute', '/unbekannt', '/Heute', '/heute/extra', '/planung/p', '/planung/p/', '/planung/x/1',
    '/planung/p/1/2', '/wissen/n', '/aufgabe', '/aufgabe/', '/gewohnheit', '/einstellungen/daten/mehr',
    '/start/1', '/aufgabe/%E0%A4%A', '/aufgabe/%20', '/assets/icons.svg',
  ];
  for (const path of unknown) {
    test(`${JSON.stringify(path)} → null`, () => {
      assert.equal(parseRoute(path), null);
    });
  }
});

describe('router helpers without a browser', () => {
  test('isTab', () => {
    assert.equal(isTab('heute'), true);
    assert.equal(isTab('planung'), true);
    assert.equal(isTab('wissen'), true);
    assert.equal(isTab('start'), false);
    assert.equal(isTab(null), false);
  });

  test('lastPathOf defaults to the tab root', () => {
    assert.equal(lastPathOf('heute'), '/heute');
    assert.equal(lastPathOf('planung'), '/planung');
    assert.equal(lastPathOf('wissen'), '/wissen');
  });

  test('current() before startRouter is /heute', () => {
    const route = current();
    assert.equal(route.name, 'heute');
    assert.equal(route.path, '/heute');
  });
});
