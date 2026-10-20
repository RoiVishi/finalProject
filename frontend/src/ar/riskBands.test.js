import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bandFor, RISK_BANDS, RISK_TITLE_HE } from './riskBands.js';

// PRED-12: one source of truth. The served model ships its bands in meta.json; the client copy
// must equal the NEWEST registry version's bands, or the Twin/AR/cards would colour differently
// from the risk_level the backend stores.
const REGISTRY = join(dirname(fileURLToPath(import.meta.url)), '../../../ai-service/model/registry');

function newestMeta() {
  if (!existsSync(REGISTRY)) return null;
  const versions = readdirSync(REGISTRY).filter((d) => /^v\d+$/.test(d)).sort((a, b) => +a.slice(1) - +b.slice(1));
  for (const v of versions.reverse()) {
    const p = join(REGISTRY, v, 'meta.json');
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  }
  return null;
}

test('client bands equal the served model bands (newest registry meta.json)', (t) => {
  const meta = newestMeta();
  if (!meta || !meta.risk_bands) return t.skip('no registry with bands in this checkout');
  assert.equal(RISK_BANDS.medium, meta.risk_bands.t1);
  assert.equal(RISK_BANDS.high, meta.risk_bands.t2);
});

test('the title names what the risk is about (v6: duration overrun)', () => {
  const meta = newestMeta();
  if (meta && meta.target === 'grew') assert.equal(RISK_TITLE_HE, 'סיכון חריגה במשך');
});

test('bandFor: boundaries are inclusive from below; abstention stays unknown', () => {
  assert.equal(bandFor(RISK_BANDS.medium - 1e-9), 'low');
  assert.equal(bandFor(RISK_BANDS.medium), 'medium');
  assert.equal(bandFor(RISK_BANDS.high), 'high');
  assert.equal(bandFor(null), 'unknown');
  assert.equal(bandFor(Number.NaN), 'unknown');
});
