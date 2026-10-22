/**
 * PRED-3 / NFR-USE-1 (KAN-67): turns GET /tasks/:id/explanation into what the
 * detail panel shows. Pure, so the display rules run under `node --test`.
 *
 * Display rules
 *  - Reasons, never scores: each reason is its Hebrew label, the activity's own
 *    value for it (a fact, e.g. "7 ימים"), and an arrow — raises or lowers the
 *    risk. The SHAP contribution itself is never printed; it only sets the
 *    relative length of the bar, so the strongest reason reads as the strongest.
 *  - The band shown is the explanation's own band. The backend explains the
 *    CURRENT plan, so after an edit it can differ from the cached band on the
 *    row (KAN-26 stale); the panel then says that it was just recalculated.
 *  - Honesty notes: a project-history caveat when the service flags the number
 *    as a transfer prior, and a note when the strongest reason is about the
 *    project as a whole rather than the activity (book, risk R21).
 */

/** Machine-readable abstain reasons (ai-service REQUIRED_FEATURES / ABSTAIN_LOW_HISTORY). */
export const ABSTAIN_REASONS_HE = {
  missing_planned_dates: 'לפעילות אין תאריכי התחלה וסיום מתוכננים.',
  missing_project_timeline: 'ציר הזמן המתוכנן של הפרויקט לא ידוע.',
  low_project_history: 'הפרויקט עדיין בתחילתו, ואין מספיק היסטוריה כדי לחזות.',
};
const ABSTAIN_FALLBACK_HE = 'חסרים נתונים שהמודל צריך כדי לחזות.';

const TASK_TYPE_HE = { TT_Task: 'משימה', TT_Mile: 'אבן דרך', TT_FinMile: 'אבן דרך מסיימת', TT_LOE: 'משימת ליווי' };
const PROJECT_LEVEL = new Set(['proj_span_days', 'proj_n_tasks']);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const whole = (v) => Math.round(v).toLocaleString('he-IL');

/** The activity's own value for a reason, as words. Null when there is nothing worth saying. */
export function valueText(feature, value) {
  if (feature === 'task_type') return value ? TASK_TYPE_HE[value] ?? null : null;
  const v = num(value);
  if (v === null) return feature === 'total_float_hr' || feature === 'free_float_hr' ? 'לא ידוע' : null;
  switch (feature) {
    case 'planned_duration_days':
    case 'proj_span_days':
      return `${whole(v)} ימים`;
    case 'proj_n_tasks':
      return `${whole(v)} פעילויות`;
    case 'total_float_hr':
    case 'free_float_hr':
      return `${whole(v)} שעות`;
    case 'rel_position':
      return v < 1 / 3 ? 'בתחילת הפרויקט' : v < 2 / 3 ? 'באמצע הפרויקט' : 'בסוף הפרויקט';
    default:
      return whole(v); // counts: predecessors, successors, upstream, downstream
  }
}

/** Strip the unit hint the service appends to some labels: "משך מתוכנן (ימים)" → "משך מתוכנן". */
const cleanLabel = (label) => String(label ?? '').replace(/\s*\([^)]*\)\s*$/, '');

/**
 * @param expl     the GET /tasks/:id/explanation body
 * @param cached   the row's cached band ('low'|'medium'|'high'|null) and freshness
 * @returns { state: 'explained'|'abstained', band, reasons[], notes[], abstainText? }
 */
export function explanationView(expl, cached = {}) {
  if (!expl || expl.status === 'abstained' || !expl.prediction) {
    return {
      state: 'abstained',
      abstainText: ABSTAIN_REASONS_HE[expl?.abstainReason] ?? ABSTAIN_FALLBACK_HE,
      reasons: [],
      notes: [],
    };
  }
  const items = (expl.contributions ?? []).filter((c) => typeof c.contribution === 'number');
  const top = Math.max(...items.map((c) => Math.abs(c.contribution)), 0) || 1;
  const reasons = items.map((c) => ({
    feature: c.feature,
    label: cleanLabel(c.label),
    value: valueText(c.feature, c.value),
    direction: c.direction === 'lowers' || c.contribution < 0 ? 'lowers' : 'raises',
    weight: Math.max(0.08, Math.abs(c.contribution) / top), // bar length 0..1 — never shown as a number
  }));

  const band = expl.prediction.riskLevel;
  const notes = [];
  if (cached.freshness === 'stale' || (cached.band && cached.band !== band)) notes.push('recalculated');
  if (expl.reliability === 'low_transfer_prior') notes.push('transfer_prior');
  if (reasons[0] && PROJECT_LEVEL.has(reasons[0].feature)) notes.push('project_level');
  return { state: 'explained', band, reasons, notes };
}
