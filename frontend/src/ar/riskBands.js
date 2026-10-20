/**
 * Single source of truth for the risk bands and the colour scale.
 *
 * Requirement AR-4 (Requirements Document v1.3, section 4.10) states that the AR
 * view must be coloured by *the same* band configuration and the same scale as
 * TWIN-1, and that changing one boundary here must change both views
 * identically. PRED-11 states that the bands are configuration, never constants
 * scattered through application code. This module is where that promise lives:
 * both DigitalTwin.jsx and the AR renderer import from here, and nowhere else
 * defines a risk colour.
 *
 * Since registry v6 the bands ship WITH the served model (meta.json → risk_bands, chosen by a
 * documented protocol on train-side data; the AI service echoes them in /health). Until the
 * backend forwards them to the client, the values below are a synced copy: riskBands.test.js
 * fails the build whenever they differ from the newest registry's meta.json.
 *
 * What the probability means since v6: the risk that the activity takes LONGER THAN PLANNED
 * (duration overrun, target `grew`) — not a late finish date. The UI shows the band, never the
 * percentage: the bands are ordered correctly, but the upper ones over-state the observed rate.
 */

/** Lower bound of each band on the served probability, [0..1] — synced from registry v6 meta.json. */
export const RISK_BANDS = {
  medium: 0.29,   // risk_bands.t1 = decision threshold (F1-optimal on the calibration slice)
  high: 0.8558,   // risk_bands.t2 = top 10% of the calibration slice
};

/** What the risk is about (shown as the title wherever a band is shown). */
export const RISK_TITLE_HE = 'סיכון חריגה במשך';

/** The one colour scale used by the 2D Twin and by AR. */
export const RISK_COLORS = {
  low: '#4caf50',
  medium: '#ff9800',
  high: '#f44336',
  done: '#90a4ae',
  unknown: '#9e9e9e',
};

/** Hebrew labels, rendered through the same dictionary discipline as PRED-13. */
export const RISK_LABELS_HE = {
  low: 'נמוך',
  medium: 'בינוני',
  high: 'גבוה',
  done: 'הושלם',
  unknown: 'אין מספיק נתונים',
};

/**
 * Map a served probability (field `late_probability` / `lateProbability`; since v6 = duration overrun) to a band.
 * `null`/`undefined` means the service abstained (PRED-10) — never guess.
 */
export function bandFor(prob) {
  if (prob == null || Number.isNaN(prob)) return 'unknown';
  if (prob >= RISK_BANDS.high) return 'high';
  if (prob >= RISK_BANDS.medium) return 'medium';
  return 'low';
}

/** Legend rows, in display order — shared by the 2D legend and the AR overlay. */
export const LEGEND = [
  { key: 'done', label: RISK_LABELS_HE.done },
  { key: 'low', label: RISK_LABELS_HE.low },
  { key: 'medium', label: RISK_LABELS_HE.medium },
  { key: 'high', label: RISK_LABELS_HE.high },
];
