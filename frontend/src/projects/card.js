/**
 * DASH-5 card values — formatting only. Every number comes from GET /projects
 * as is (riskIndex, blockedCount are computed by the backend), so the card
 * always equals the API.
 */
import { bandFor, RISK_LABELS_HE } from '../ar/riskBands.js';
import { he } from '../i18n/he.js';

/** riskIndex is a mean probability in [0..1]; null = no current prediction. */
export function riskView(riskIndex, riskScope) {
  const label = riskScope === 'own' ? he.home.riskOwn : he.home.riskIndex;
  if (riskIndex === null || riskIndex === undefined) {
    return { label, value: null, text: he.home.noPrediction, band: 'unknown' };
  }
  const band = bandFor(riskIndex);
  // NFR-USE-1: never a bare score — the band name always goes with the number.
  return { label, value: riskIndex, band, text: `${(Math.round(riskIndex * 1000) / 10).toFixed(1)}% · ${RISK_LABELS_HE[band]}` };
}

export function roleView(role, trade) {
  const name = he.roles[role] ?? role;
  return trade ? `${name} · ${trade}` : name;
}
