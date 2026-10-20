/**
 * DASH-5 card values — formatting only. Every number comes from GET /projects
 * as is (riskIndex, blockedCount are computed by the backend), so the card
 * always equals the API.
 */
import { bandFor, RISK_LABELS_HE } from '../ar/riskBands.js';
import { he } from '../i18n/he.js';

/** riskIndex is the mean served probability (since v6: duration overrun) in [0..1]; null = no current prediction.
 *  Shown as a BAND only — the upper bands over-state the observed rate, so no percentage is displayed. */
export function riskView(riskIndex, riskScope) {
  const label = riskScope === 'own' ? he.home.riskOwn : he.home.riskIndex;
  if (riskIndex === null || riskIndex === undefined) {
    return { label, value: null, text: he.home.noPrediction, band: 'unknown' };
  }
  const band = bandFor(riskIndex);
  // NFR-USE-1: never a bare score — the band name is what the user sees.
  return { label, value: riskIndex, band, text: RISK_LABELS_HE[band] };
}

export function roleView(role, trade) {
  const name = he.roles[role] ?? role;
  return trade ? `${name} · ${trade}` : name;
}
