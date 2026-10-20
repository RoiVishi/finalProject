import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tasksApi } from '../api/tasks.js';
import { projectsApi } from '../api/projects.js';
import {
  assigneeOptions, blockerText, canManageTasks, defaultView, EMPTY_FILTERS, floorOf, floorOptions,
  isDefaultView, matchesFilters, myRoleIn, neighbours, nextStatuses, predecessorCandidates,
  riskOf, summarize, viewTasks, zoneLabeler,
} from './taskView.js';

const ME = 'u-me';
const OTHER = 'u-other';
const pm = { userId: 'u-pm', role: 'project_manager' };
const sub = { userId: ME, role: 'subcontractor' };

const at = '2026-11-01T08:00:00Z';
const t = (id, over = {}) => ({
  id,
  name: `task ${id}`,
  status: 'planned',
  trade: 'electrical',
  zone: 'floor-1/zone-1',
  plannedStart: '2026-11-10',
  plannedEnd: '2026-11-20',
  assignee: { id: ME, fullName: 'Me' },
  blocked: false,
  predecessors: [],
  ...over,
});

// A small project: two of mine (one blocked), one of someone else's, one unassigned, one completed.
const rows = [
  t('a', { plannedStart: '2026-11-12', riskLevel: 'medium', lateProbability: 0.4, predictedAt: at }),
  t('b', { plannedStart: '2026-11-15', blocked: true, trade: 'plumbing', zone: 'floor-2/zone-1',
    riskLevel: 'high', lateProbability: 0.9, predictedAt: at, predecessors: [{ id: 'c' }] }),
  t('c', { plannedStart: '2026-11-05', assignee: { id: OTHER, fullName: 'Other' }, zone: 'floor-2/zone-2',
    riskLevel: 'low', lateProbability: 0.1, predictedAt: at }),
  t('d', { plannedStart: '2026-11-01', assignee: null, lastPredictionOutcome: 'abstained' }),
  t('e', { plannedStart: '2026-10-01', status: 'completed', riskLevel: 'high', predictedAt: at }),
];
const ids = (xs) => xs.map((x) => x.id);

test('filters combine as AND — every pair narrows the result (AC 1)', () => {
  assert.deepEqual(ids(viewTasks(rows, { trade: 'electrical' }, 'date', pm)), ['e', 'd', 'c', 'a']);
  assert.deepEqual(ids(viewTasks(rows, { trade: 'electrical', floor: '2' }, 'date', pm)), ['c']);
  assert.deepEqual(ids(viewTasks(rows, { trade: 'electrical', floor: '2', assignee: ME }, 'date', pm)), []);
  assert.deepEqual(ids(viewTasks(rows, { assignee: ME, status: 'planned' }, 'date', pm)), ['a', 'b']);
  assert.deepEqual(ids(viewTasks(rows, { assignee: ME, status: 'planned', risk: 'high' }, 'date', pm)), ['b']);
  assert.deepEqual(ids(viewTasks(rows, { floor: '2', risk: 'low' }, 'date', pm)), ['c']);
});

test('each filter on its own', () => {
  assert.deepEqual(ids(viewTasks(rows, { status: 'blocked' }, 'date', pm)), ['b']);
  assert.deepEqual(ids(viewTasks(rows, { status: 'completed' }, 'date', pm)), ['e']);
  assert.deepEqual(ids(viewTasks(rows, { trade: 'plumbing' }, 'date', pm)), ['b']);
  assert.deepEqual(ids(viewTasks(rows, { floor: '1' }, 'date', pm)), ['e', 'd', 'a']);
  assert.deepEqual(ids(viewTasks(rows, { assignee: OTHER }, 'date', pm)), ['c']);
  assert.deepEqual(ids(viewTasks(rows, { assignee: 'none' }, 'date', pm)), ['d']);
  assert.deepEqual(ids(viewTasks(rows, { risk: 'unknown' }, 'date', pm)), ['d']);
  assert.deepEqual(ids(viewTasks(rows, EMPTY_FILTERS, 'date', pm)), ['e', 'd', 'c', 'a', 'b']);
});

test('"me" needs a known viewer; no viewer means no match rather than everything', () => {
  assert.equal(matchesFilters(rows[0], { assignee: 'me' }, null), false);
  assert.equal(matchesFilters(rows[0], { assignee: 'me' }, sub), true);
});

test('sorting: by date, by risk (band first, probability inside the band), blocked first', () => {
  assert.deepEqual(ids(viewTasks(rows, {}, 'date', pm)), ['e', 'd', 'c', 'a', 'b']);
  assert.deepEqual(ids(viewTasks(rows, {}, 'risk', pm)), ['b', 'a', 'c', 'd', 'e']);
  assert.deepEqual(ids(viewTasks(rows, {}, 'attention', pm)), ['b', 'd', 'c', 'a', 'e']);
  assert.deepEqual(ids(rows), ['a', 'b', 'c', 'd', 'e'], 'input is not mutated');
});

test('undated activities sort after dated ones', () => {
  const xs = [t('x', { plannedStart: null }), t('y', { plannedStart: '2027-01-01' })];
  assert.deepEqual(ids(viewTasks(xs, {}, 'date', pm)), ['y', 'x']);
});

test('subcontractor default view: own activities only, blocked first (AC 2)', () => {
  const v = defaultView('subcontractor');
  assert.deepEqual(v, { filters: { ...EMPTY_FILTERS, assignee: 'me' }, sort: 'attention' });
  assert.deepEqual(ids(viewTasks(rows, v.filters, v.sort, sub)), ['b', 'a', 'e']);
  assert.equal(isDefaultView('subcontractor', v.filters, v.sort), true);
  assert.equal(isDefaultView('subcontractor', { ...v.filters, trade: 'hvac' }, v.sort), false);
});

test('other roles open on the whole project by date', () => {
  for (const role of ['owner', 'project_manager', 'engineer', 'inspector']) {
    assert.deepEqual(defaultView(role), { filters: { ...EMPTY_FILTERS }, sort: 'date' });
  }
});

test('risk shown per row: band from the cached riskLevel, never from a probability', () => {
  assert.equal(riskOf(rows[0], pm), 'medium');
  assert.equal(riskOf({ ...rows[0], riskLevel: undefined }, pm), 'none');
  assert.equal(riskOf({ ...rows[0], predictedAt: null }, pm), 'none');
  assert.equal(riskOf(rows[3], pm), 'unknown', 'abstained → not enough data (PRED-10)');
  assert.equal(riskOf(rows[4], pm), 'done');
  // AUTH-2: a subcontractor never sees someone else's prediction, and is told so.
  assert.equal(riskOf(rows[2], sub), 'hidden');
  assert.equal(riskOf(rows[1], sub), 'high');
});

test('zone and floor helpers', () => {
  assert.equal(floorOf('floor-12/zone-3'), 12);
  assert.equal(floorOf(null), null);
  const zones = [
    { id: 'floor-1/zone-1', floor: 1, floorLabel: 'קומה 1', label: 'קומה 1 · אגף א' },
    { id: 'floor-2/zone-1', floor: 2, floorLabel: 'קומה 2', label: 'קומה 2 · אגף א' },
  ];
  const label = zoneLabeler(zones);
  assert.equal(label('floor-2/zone-1'), 'קומה 2 · אגף א');
  assert.equal(label('floor-9/zone-9'), 'floor-9/zone-9');
  assert.equal(label(null), '—');
  assert.deepEqual(floorOptions(zones, rows), [{ value: '1', label: 'קומה 1' }, { value: '2', label: 'קומה 2' }]);
  assert.deepEqual(floorOptions([], rows), [{ value: '1', label: 'קומה 1' }, { value: '2', label: 'קומה 2' }]);
});

test('members: assignee options are active members by name; my role comes from my row', () => {
  const members = [
    { role: 'owner', status: 'active', user: { id: 'u1', fullName: 'תמר' } },
    { role: 'subcontractor', status: 'active', user: { id: ME, fullName: 'אבי' } },
    { role: 'engineer', status: 'removed', user: { id: 'u3', fullName: 'גיל' } },
  ];
  assert.deepEqual(assigneeOptions(members), [{ value: ME, label: 'אבי' }, { value: 'u1', label: 'תמר' }]);
  assert.equal(myRoleIn(members, ME), 'subcontractor');
  assert.equal(myRoleIn(members, 'u3'), null, 'a removed member has no role');
});

test('permissions and lifecycle mirror the backend', () => {
  assert.equal(canManageTasks('engineer'), true);
  assert.equal(canManageTasks('subcontractor'), false);
  assert.equal(canManageTasks('inspector'), false);
  assert.deepEqual(nextStatuses('ready'), ['planned', 'in_progress']);
  assert.deepEqual(nextStatuses('completed'), []);
  assert.deepEqual(nextStatuses('bogus'), []);
});

test('detail graph: predecessors from the row, dependants from the rows that list it', () => {
  const { predecessors, dependants } = neighbours(rows[2], rows);
  assert.deepEqual(ids(predecessors), []);
  assert.deepEqual(ids(dependants), ['b']);
  assert.deepEqual(ids(neighbours(rows[1], rows).predecessors), ['c']);
  assert.equal(neighbours(rows[1], rows).predecessors[0].name, 'task c', 'resolved to the full row');
});

test('predecessor candidates exclude self, existing predecessors and anything downstream (no cycles)', () => {
  // c → b already. Adding b as a predecessor of c would close a cycle.
  assert.deepEqual(ids(predecessorCandidates(rows[2], rows)), ['e', 'd', 'a']);
  assert.deepEqual(ids(predecessorCandidates(rows[1], rows)), ['e', 'd', 'a']);
});

test('summary counts the shown rows', () => {
  const shown = viewTasks(rows, { assignee: ME }, 'date', pm);
  assert.deepEqual(summarize(rows, shown), { total: 5, shown: 3, blocked: 1 });
});

test('tasks and members API paths', async () => {
  const calls = [];
  const client = {
    get: async (p) => calls.push(['GET', p]),
    post: async (p, b) => calls.push(['POST', p, b]),
    del: async (p) => calls.push(['DELETE', p]),
  };
  const api = tasksApi(client);
  await api.list('p 1');
  await api.get('t-1');
  await api.changeStatus('t-1', 'ready');
  await api.addDependency('t-1', 't-0');
  await api.removeDependency('t-1', 't-0');
  await projectsApi(client).members('p-1');
  assert.deepEqual(calls, [
    ['GET', '/tasks?projectId=p%201'],
    ['GET', '/tasks/t-1'],
    ['POST', '/tasks/t-1/status', { status: 'ready' }],
    ['POST', '/tasks/t-1/dependencies', { predecessorId: 't-0' }],
    ['DELETE', '/tasks/t-1/dependencies/t-0'],
    ['GET', '/projects/p-1/members'],
  ]);
});

test('blocker sentence uses zone names, keeps the backend wording, and falls back to its summary', () => {
  const label = zoneLabeler([{ id: 'floor-2/zone-2', floor: 2, label: 'קומה 2 · אגף ב' }]);
  const blocked = {
    id: 'b', summary: 'raw',
    blockers: [
      { kind: 'predecessor', id: 'c', label: 'task c (floor-2/zone-2)', detail: 'Other, צפי סיום 20.11.2026' },
      { kind: 'document', id: 'doc-1', label: 'היתר חפירה' },
    ],
  };
  assert.equal(
    blockerText(blocked, rows, label),
    'חסום על ידי: task c (קומה 2 · אגף ב) — Other, צפי סיום 20.11.2026 · ממתין לאישור: היתר חפירה',
  );
  // a predecessor that is not in the loaded rows keeps the backend label
  assert.equal(blockerText({ blockers: [{ kind: 'predecessor', id: 'zz', label: 'X' }] }, rows, label), 'חסום על ידי: X');
  assert.equal(blockerText({ blockers: [], summary: 'raw' }, rows, label), 'raw');
});
