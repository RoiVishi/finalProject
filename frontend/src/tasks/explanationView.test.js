import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ABSTAIN_REASONS_HE, explanationView, valueText } from './explanationView.js';

const body = (over = {}) => ({
  status: 'explained', reliability: 'within_project_history', abstainReason: null,
  prediction: { lateProbability: 0.42, riskLevel: 'medium', modelVersion: 'v6' }, baseProbability: 0.39,
  contributions: [
    { feature: 'planned_duration_days', label: 'משך מתוכנן (ימים)', value: 12, contribution: 0.2, direction: 'raises' },
    { feature: 'rel_position', label: 'מיקום בציר הזמן של הפרויקט', value: 0.8, contribution: -0.05, direction: 'lowers' },
    { feature: 'total_float_hr', label: 'מרווח כולל (שעות)', value: null, contribution: 0.01, direction: 'raises' },
  ],
  ...over,
});

test('reasons: label without the unit hint, the value as words, direction, relative bar length', () => {
  const v = explanationView(body());
  assert.equal(v.state, 'explained');
  assert.equal(v.band, 'medium');
  assert.deepEqual(v.reasons.map((r) => [r.label, r.value, r.direction]), [
    ['משך מתוכנן', '12 ימים', 'raises'],
    ['מיקום בציר הזמן של הפרויקט', 'בסוף הפרויקט', 'lowers'],
    ['מרווח כולל', 'לא ידוע', 'raises'],
  ]);
  assert.equal(v.reasons[0].weight, 1);
  assert.equal(v.reasons[1].weight, 0.25);
  assert.equal(v.reasons[2].weight, 0.08, 'tiny reasons keep a visible bar');
  assert.deepEqual(v.notes, []);
});

test('the scores never reach the view model as text', () => {
  const v = explanationView(body());
  const text = JSON.stringify(v.reasons.map(({ label, value, direction }) => ({ label, value, direction })));
  assert.doesNotMatch(text, /0\.2|0\.05|0\.42|%/);
});

test('notes: recalculated (stale or different band), transfer prior, project-level top reason', () => {
  assert.deepEqual(explanationView(body(), { band: 'medium', freshness: 'current' }).notes, []);
  assert.deepEqual(explanationView(body(), { band: 'high', freshness: 'current' }).notes, ['recalculated']);
  assert.deepEqual(explanationView(body(), { band: 'medium', freshness: 'stale' }).notes, ['recalculated']);
  assert.deepEqual(explanationView(body({ reliability: 'low_transfer_prior' })).notes, ['transfer_prior']);
  const proj = body({ contributions: [{ feature: 'proj_span_days', label: 'משך הפרויקט (ימים)', value: 81, contribution: -0.18, direction: 'lowers' }] });
  assert.deepEqual(explanationView(proj).notes, ['project_level']);
});

test('abstained: a Hebrew reason for every machine reason, and a fallback', () => {
  for (const reason of Object.keys(ABSTAIN_REASONS_HE)) {
    const v = explanationView({ status: 'abstained', abstainReason: reason, prediction: null, contributions: [] });
    assert.equal(v.state, 'abstained');
    assert.equal(v.abstainText, ABSTAIN_REASONS_HE[reason]);
  }
  assert.match(explanationView({ status: 'abstained', abstainReason: 'something_new' }).abstainText, /חסרים נתונים/);
  assert.equal(explanationView(null).state, 'abstained');
});

test('value texts per feature', () => {
  assert.equal(valueText('proj_span_days', 81), '81 ימים');
  assert.equal(valueText('proj_n_tasks', 1091), '1,091 פעילויות');
  assert.equal(valueText('rel_position', 0.1), 'בתחילת הפרויקט');
  assert.equal(valueText('rel_position', 0.5), 'באמצע הפרויקט');
  assert.equal(valueText('n_pred', 2), '2');
  assert.equal(valueText('task_type', 'TT_Mile'), 'אבן דרך');
  assert.equal(valueText('task_type', null), null);
  assert.equal(valueText('upstream_cnt', null), null);
});
