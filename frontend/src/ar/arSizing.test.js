import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AR_SCALE_MAX, AR_SCALE_MIN, AR_TARGET_HEIGHT_M, STATUS_MISSED,
  PANEL_MAX_SCALE, PANEL_REF_DIST_M, fitScale, nextScaleMul, panelScale, statusAfterPick, thumbstickY,
} from './arSizing.js';
import { PROJECTS } from '../projects.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('fitScale: every demo building gets the same real-world height', () => {
  for (const p of PROJECTS) close(p.floors * p.floorHeight * fitScale(p), AR_TARGET_HEIGHT_M);
});

test('fitScale: the 5-floor demo building is no longer 17 cm tall', () => {
  const p = PROJECTS.find((x) => x.floors === 5);
  close(p.floors * p.floorHeight * 0.02, 0.17, 0.005); // the old fixed scale
  assert.ok(p.floors * p.floorHeight * fitScale(p) > 0.9);
});

test('fitScale: falls back to the old scale for a spec without floors', () => {
  assert.equal(fitScale({}), 0.02);
  assert.equal(fitScale(null), 0.02);
});

test('nextScaleMul: a stick at rest changes nothing', () => {
  assert.equal(nextScaleMul(1, 0.1, 0.016), 1);
  assert.equal(nextScaleMul(1, NaN, 0.016), 1);
});

test('nextScaleMul: forward grows, back shrinks, within the limits', () => {
  assert.ok(nextScaleMul(1, -1, 0.016) > 1);
  assert.ok(nextScaleMul(1, 1, 0.016) < 1);
  let m = 1;
  for (let i = 0; i < 1000; i++) m = nextScaleMul(m, -1, 0.05);
  assert.equal(m, AR_SCALE_MAX);
  for (let i = 0; i < 1000; i++) m = nextScaleMul(m, 1, 0.05);
  assert.equal(m, AR_SCALE_MIN);
});

test('thumbstickY: reads axes[3] of the first deflected controller', () => {
  const left = { gamepad: { axes: [0, 0, 0, 0.05] } };
  const right = { gamepad: { axes: [0, 0, 0, -0.8] } };
  assert.equal(thumbstickY([left, right]), -0.8);
  assert.equal(thumbstickY([left]), 0);
  assert.equal(thumbstickY([{}, { gamepad: { axes: [0, 0] } }]), 0);
  assert.equal(thumbstickY(undefined), 0);
});

test('panelScale: normal size up close, grows with distance, capped', () => {
  assert.equal(panelScale(0.5), 1);
  assert.equal(panelScale(PANEL_REF_DIST_M), 1);
  close(panelScale(2.4), 3);
  assert.equal(panelScale(100), PANEL_MAX_SCALE);
  assert.equal(panelScale(NaN), 1);
});

test('statusAfterPick: a successful pick replaces the "missed" line', () => {
  assert.equal(statusAfterPick(null), STATUS_MISSED);
  assert.equal(statusAfterPick({ label: 'קומה 3' }), 'נבחר: קומה 3');
});
