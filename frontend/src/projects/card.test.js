import assert from 'node:assert/strict';
import { test } from 'node:test';
import { riskView, roleView } from './card.js';
import { invitationsApi } from '../api/invitations.js';

test('risk: band name only, never a bare score or a percentage (NFR-USE-1, v6 display rule)', () => {
  assert.deepEqual(riskView(0.4215, 'project'), { label: 'סיכון חריגה במשך', value: 0.4215, band: 'medium', text: 'בינוני' });
  assert.doesNotMatch(riskView(0.4215, 'project').text, /%|\d/);
  assert.equal(riskView(0.1, 'project').band, 'low');
  assert.equal(riskView(0.9, 'project').band, 'high');
});

test('risk: subcontractor scope is labelled as own tasks; null = no current prediction', () => {
  assert.equal(riskView(0.5, 'own').label, 'סיכון חריגה במשימות שלי');
  const none = riskView(null, 'project');
  assert.equal(none.value, null);
  assert.equal(none.band, 'unknown');
  assert.equal(none.text, 'אין עדיין חיזוי עדכני');
});

test('role label with optional trade', () => {
  assert.equal(roleView('owner'), 'קבלן ראשי (בעלים)');
  assert.equal(roleView('subcontractor', 'חשמל'), 'קבלן משנה · חשמל');
});

test('invitations API paths', async () => {
  const calls = [];
  const client = { get: async (p) => calls.push(['GET', p]), post: async (p) => calls.push(['POST', p]) };
  const api = invitationsApi(client);
  await api.mine(); await api.accept('i-1'); await api.decline('i/2');
  assert.deepEqual(calls, [['GET', '/invitations/mine'], ['POST', '/invitations/by-id/i-1/accept'], ['POST', '/invitations/by-id/i%2F2/decline']]);
});
