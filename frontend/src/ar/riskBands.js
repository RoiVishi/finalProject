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
 * When the AI service starts serving real bands (PRED-11), replace the literals
 * below with the values it echoes in its response; nothing else has to change.
 */

/** Lower bound of each band on lateProbability, [0..1]. */
export const RISK_BANDS = {
  medium: 0.30,
  high: 0.65,
};

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
 * Map a served lateProbability to a band.
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
