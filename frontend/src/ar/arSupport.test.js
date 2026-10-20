import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { AR_REASONS_HE, AR_UNAVAILABLE_HE, arEntryFor, detectArSupport, endSessionQuietly } from './arSupport.js';

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

/* endSessionQuietly — the "XRSession has already ended" rejection seen in the
   console when leaving AR through the browser's exit control (AR-7). */

test('ending an already-ended session does not leave an unhandled rejection', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const ended = { end: () => Promise.reject(new Error('InvalidStateError: XRSession has already ended')) };
    endSessionQuietly(ended);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('endSessionQuietly tolerates a missing session and a throwing end()', () => {
  assert.doesNotThrow(() => endSessionQuietly(null));
  assert.doesNotThrow(() => endSessionQuietly({ end: () => { throw new Error('gone'); } }));
});

/* arEntryFor — AR-1: the button only on a capable device, otherwise one line. */

test('a capable device gets the AR button', () => {
  assert.deepEqual(arEntryFor({ status: 'supported', supported: true }), { kind: 'button' });
});

test('while detection is running nothing is shown, so the row does not flicker', () => {
  assert.deepEqual(arEntryFor({ status: 'checking' }), { kind: 'none' });
  assert.deepEqual(arEntryFor(undefined), { kind: 'none' });
});

test('every unsupported reason becomes a one-line note with the long reason as detail', () => {
  for (const reason of ['no-webxr', 'insecure-context', 'no-immersive-ar', 'error']) {
    const entry = arEntryFor({ status: 'unsupported', supported: false, reason });
    assert.equal(entry.kind, 'note');
    assert.equal(entry.label, AR_UNAVAILABLE_HE[reason]);
    assert.equal(entry.detail, AR_REASONS_HE[reason]);
    assert.ok(!entry.label.includes('\n'), 'one line');
  }
});

test('an unknown reason falls back to the generic note instead of an empty chip', () => {
  const entry = arEntryFor({ status: 'unsupported', reason: 'something-new' });
  assert.equal(entry.label, AR_UNAVAILABLE_HE.error);
  assert.equal(entry.detail, AR_REASONS_HE.error);
});

test('an iPhone-like browser (no navigator.xr) ends up with the note, not the button', async () => {
  setNavigator({});
  const r = await detectArSupport();
  const entry = arEntryFor({ status: r.supported ? 'supported' : 'unsupported', ...r });
  assert.equal(entry.kind, 'note');
  assert.equal(entry.label, 'AR לא נתמך בדפדפן זה');
});
