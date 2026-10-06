import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { AR_REASONS_HE, detectArSupport } from './arSupport.js';

/**
 * AR-1 acceptance criterion: "capability detection covered by a unit test".
 * The browser globals are faked per case; detectArSupport() must never throw,
 * because on a non-capable browser the Twin renders unchanged and no AR error
 * surfaces.
 */

const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const setNavigator = (value) =>
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
const setSecure = (isSecureContext) => { globalThis.window = { isSecureContext }; };
const xr = (isSessionSupported) => ({ xr: { isSessionSupported } });

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'navigator', original);
  else delete globalThis.navigator;
  delete globalThis.window;
});

test('a browser without WebXR is reported as no-webxr', async () => {
  setNavigator({});
  assert.deepEqual(await detectArSupport(), { supported: false, reason: 'no-webxr' });
});

test('no navigator at all (non-browser environment) is no-webxr, not a crash', async () => {
  setNavigator(undefined);
  assert.deepEqual(await detectArSupport(), { supported: false, reason: 'no-webxr' });
});

test('plain HTTP is refused before asking the device (WebXR needs a secure context)', async () => {
  let asked = false;
  setNavigator(xr(async () => { asked = true; return true; }));
  setSecure(false);
  assert.deepEqual(await detectArSupport(), { supported: false, reason: 'insecure-context' });
  assert.equal(asked, false);
});

test('a device that supports immersive-ar is supported', async () => {
  let mode;
  setNavigator(xr(async (m) => { mode = m; return true; }));
  setSecure(true);
  assert.deepEqual(await detectArSupport(), { supported: true });
  assert.equal(mode, 'immersive-ar');
});

test('WebXR without immersive-ar (e.g. VR-only desktop) is no-immersive-ar', async () => {
  setNavigator(xr(async () => false));
  setSecure(true);
  assert.deepEqual(await detectArSupport(), { supported: false, reason: 'no-immersive-ar' });
});

test('a device that throws while being asked is reported, never rethrown', async () => {
  setNavigator(xr(async () => { throw new Error('SecurityError'); }));
  setSecure(true);
  const r = await detectArSupport();
  assert.equal(r.supported, false);
  assert.equal(r.reason, 'error');
  assert.match(r.detail, /SecurityError/);
});

test('every reason the detector can return has its one Hebrew line', () => {
  for (const reason of ['no-webxr', 'insecure-context', 'no-immersive-ar', 'error']) {
    assert.ok(AR_REASONS_HE[reason]?.length > 0, `missing Hebrew message for ${reason}`);
  }
});
