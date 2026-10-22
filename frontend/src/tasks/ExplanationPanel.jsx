import React, { useEffect, useState } from 'react';
import { RISK_COLORS, RISK_LABELS_HE } from '../ar/riskBands.js';
import { he } from '../i18n/he.js';
import { explanationView } from './explanationView.js';
import { freshnessOf, lastBandOf, riskOf } from './taskView.js';

const w = he.tasks.why;

/**
 * "Why" section of the detail panel (PRED-3 via GET /tasks/:id/explanation,
 * NFR-USE-1: every displayed risk comes with a human-readable explanation).
 *
 * Not fetched for a completed activity (nothing to predict) or for a
 * subcontractor looking at someone else's activity (AUTH-2 — the server would
 * refuse it anyway, so we do not ask). Refetched when the inputs the
 * prediction depends on change, so an edit in the panel is explained afresh.
 */
export default function ExplanationPanel({ task, viewer, api }) {
  const risk = riskOf(task, viewer);
  const skip = risk === 'done' || risk === 'hidden';
  const [state, setState] = useState({ loading: !skip, data: null, error: null });
  const [tick, setTick] = useState(0);
  const inputsKey = [
    task.id, task.plannedStart, task.plannedEnd, task.predictedAt,
    (task.predecessors ?? []).map((p) => p.id).join(','),
  ].join('|');

  useEffect(() => {
    if (skip) return undefined;
    let live = true;
    setState({ loading: true, data: null, error: null });
    api.explanation(task.id).then(
      (data) => live && setState({ loading: false, data, error: null }),
      (e) => live && setState({ loading: false, data: null, error: e?.messages ?? [he.errors.generic] }),
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputsKey, skip, tick]);

  if (risk === 'done') return null;

  return (
    <section className="td-section why" aria-labelledby="why-title" aria-busy={state.loading}>
      <div id="why-title" className="eyebrow">{w.title}</div>
      {risk === 'hidden' && <p className="card-caption">{w.hidden}</p>}
      {!skip && state.loading && <p className="card-caption">{w.loading}</p>}
      {!skip && state.error && (
        <div className="why-error" role="alert">
          <span>{state.error[0]}</span>
          <button type="button" className="back-btn" onClick={() => setTick((n) => n + 1)}>{w.retry}</button>
        </div>
      )}
      {!skip && state.data && <ExplanationBody data={state.data} task={task} />}
    </section>
  );
}

function ExplanationBody({ data, task }) {
  const view = explanationView(data, { band: lastBandOf(task), freshness: freshnessOf(task) });
  if (view.state === 'abstained') {
    return (
      <div className="why-abstained">
        <strong>{w.abstained}</strong> {view.abstainText}
      </div>
    );
  }
  return (
    <>
      <div className="why-heading" style={{ '--risk': RISK_COLORS[view.band] }}>
        <span className="risk-dot" aria-hidden="true" />
        {w.heading(RISK_LABELS_HE[view.band])}
      </div>
      <ul className="why-reasons">
        {view.reasons.map((r) => (
          <li key={r.feature} className={`why-reason ${r.direction}`}>
            <span className="why-arrow" aria-label={w[r.direction]} title={w[r.direction]}>
              {r.direction === 'raises' ? '↑' : '↓'}
            </span>
            <span className="why-text">
              <span className="why-label">{r.label}</span>
              {r.value && <span className="why-value">{r.value}</span>}
            </span>
            <span className="why-bar" aria-hidden="true"><span style={{ width: `${Math.round(r.weight * 100)}%` }} /></span>
          </li>
        ))}
      </ul>
      <p className="card-caption">{w.legend}</p>
      {view.notes.map((n) => <p key={n} className="why-note">{w.notes[n]}</p>)}
    </>
  );
}
