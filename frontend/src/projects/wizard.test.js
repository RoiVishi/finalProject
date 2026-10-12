import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCreatePayload, canCreateProject, emptyWizard, resolvedZoneNames, teamIsValid,
  validateDetails, validateLayout, validateTeam,
} from './wizard.js';
import { matchAppRoute } from '../routes.js';
import { projectsApi } from '../api/projects.js';

test('"New project" heuristic matches the server rule (canCreateProject)', () => {
  assert.equal(canCreateProject('main_contractor'), true);
  assert.equal(canCreateProject('project_manager'), true);
  for (const p of ['engineer', 'subcontractor', 'inspector', undefined]) assert.equal(canCreateProject(p), false);
});

test('details: name 2–120 chars, end not before start', () => {
  assert.deepEqual(validateDetails({ name: 'מגדל', plannedStart: '2026-11-01', plannedEnd: '2027-06-01' }), {});
  assert.ok(validateDetails({ name: ' a ' }).name);
  assert.ok(validateDetails({ name: 'x'.repeat(121) }).name);
  assert.ok(validateDetails({ name: 'ok', plannedStart: '2027-01-02', plannedEnd: '2027-01-01' }).plannedEnd);
  assert.deepEqual(validateDetails({ name: 'ok', plannedEnd: '2027-01-01' }), {}); // one date alone is fine
});

test('layout: integer bounds 1..80 × 1..20 and unique zone names', () => {
  assert.deepEqual(validateLayout({ floors: '5', zonesPerFloor: '4' }), {});
  assert.ok(validateLayout({ floors: 0, zonesPerFloor: 4 }).floors);
  assert.ok(validateLayout({ floors: 81, zonesPerFloor: 4 }).floors);
  assert.ok(validateLayout({ floors: 2.5, zonesPerFloor: 4 }).floors);
  assert.ok(validateLayout({ floors: 5, zonesPerFloor: 21 }).zonesPerFloor);
  assert.ok(validateLayout({ floors: 5, zonesPerFloor: 2, zoneNames: ['צפון', ' צפון '] }).zoneNames);
  // a custom name equal to another zone's default also collides
  assert.ok(validateLayout({ floors: 5, zonesPerFloor: 2, zoneNames: ['אגף 2', ''] }).zoneNames);
});

test('zone names: padded with defaults and cut to Z', () => {
  assert.deepEqual(resolvedZoneNames({ zonesPerFloor: 3, zoneNames: ['צפון'] }), ['צפון', 'אגף 2', 'אגף 3']);
  assert.deepEqual(resolvedZoneNames({ zonesPerFloor: 1, zoneNames: ['א', 'ב'] }), ['א']);
});

test('team: email, role, duplicates, self-invite', () => {
  const r = validateTeam([
    { email: 'a@b.co', role: 'engineer' },
    { email: 'A@b.co ', role: 'inspector' },
    { email: 'me@x.co', role: 'engineer' },
    { email: 'bad', role: 'owner' },
  ], 'me@x.co');
  assert.deepEqual(r.rows[0], {});
  assert.ok(r.rows[1].email); // duplicate (case/space-insensitive)
  assert.ok(r.rows[2].email); // creator
  assert.ok(r.rows[3].email && r.rows[3].role); // owner is never invitable
  assert.equal(teamIsValid(r), false);
  assert.equal(teamIsValid(validateTeam([], 'me@x.co')), true);
});

test('payload: one request shaped like CreateProjectDto', () => {
  const w = emptyWizard();
  w.details = { name: ' מגדל הים ', address: '', description: '  ', plannedStart: '2026-11-01', plannedEnd: '' };
  w.layout = { floors: '3', zonesPerFloor: '2', zoneNames: [] };
  w.team = [{ email: ' Sub@X.co ', role: 'subcontractor', trade: ' חשמל ' }, { email: 'pm@x.co', role: 'project_manager', trade: 'ignored' }];
  assert.deepEqual(buildCreatePayload(w), {
    details: { name: 'מגדל הים', plannedStart: '2026-11-01' },
    layout: { floors: 3, zonesPerFloor: 2 },
    team: [{ email: 'sub@x.co', role: 'subcontractor', trade: 'חשמל' }, { email: 'pm@x.co', role: 'project_manager' }],
  });
  w.layout.zoneNames = ['צפון'];
  w.team = [];
  const p = buildCreatePayload(w);
  assert.deepEqual(p.layout.zoneNames, ['צפון', 'אגף 2']);
  assert.equal('team' in p, false);
});

test('routes', () => {
  assert.deepEqual(matchAppRoute('/'), { name: 'home' });
  assert.deepEqual(matchAppRoute('/projects/new'), { name: 'wizard' });
  assert.deepEqual(matchAppRoute('/twin/'), { name: 'twin' });
  assert.deepEqual(matchAppRoute('/projects/3f2b6c1e-9a1d-4c3e-8f00-123456789abc'),
    { name: 'project', id: '3f2b6c1e-9a1d-4c3e-8f00-123456789abc' });
  assert.deepEqual(matchAppRoute('/projects/../../x'), { name: 'notFound' });
});

test('projects API paths', async () => {
  const calls = [];
  const client = { get: async (p) => calls.push(['GET', p]), post: async (p, b) => calls.push(['POST', p, b]) };
  const api = projectsApi(client);
  await api.list(); await api.get('abc-123-def'); await api.zones('abc-123-def'); await api.create({ x: 1 });
  assert.deepEqual(calls, [['GET', '/projects'], ['GET', '/projects/abc-123-def'], ['GET', '/projects/abc-123-def/zones'], ['POST', '/projects', { x: 1 }]]);
});
