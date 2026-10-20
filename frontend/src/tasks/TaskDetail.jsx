import React, { useMemo, useState } from 'react';
import { RISK_TITLE_HE } from '../ar/riskBands.js';
import { he } from '../i18n/he.js';
import { Alert } from '../pages/AuthLayout.jsx';
import { formatDate } from '../pages/AppShell.jsx';
import { RiskChip, StatusChip } from './TaskList.jsx';
import {
  STATUS_LABELS_HE, TRADE_LABELS_HE, blockerText, canManageTasks, neighbours, nextStatuses,
  predecessorCandidates, riskOf, zoneLabeler,
} from './taskView.js';

const t = he.tasks;

/**
 * One activity: facts, the named blocking answer (TASK-4), both directions of
 * the dependency graph (TASK-3) and the lifecycle moves (TASK-2). Everything is
 * read from the list rows; a change calls the API and asks the page to reload,
 * so the blocking verdicts of the neighbours refresh too.
 *
 * Controls follow the AUTH-2 matrix (MANAGE_TASKS) only to avoid offering what
 * the server will refuse — the server is the one that enforces it.
 */
export default function TaskDetail({ task, tasks, zones, viewer, api, onChanged, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [pick, setPick] = useState('');
  const zoneLabel = useMemo(() => zoneLabeler(zones), [zones]);
  const { predecessors, dependants } = useMemo(() => neighbours(task, tasks), [task, tasks]);
  const candidates = useMemo(() => predecessorCandidates(task, tasks), [task, tasks]);
  const manage = canManageTasks(viewer?.role);
  const moves = manage ? nextStatuses(task.status) : [];

  async function run(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setPick('');
      onChanged();
    } catch (e) {
      setError(e?.messages ?? [he.errors.generic]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="card td" aria-labelledby="td-title">
      <div className="td-head">
        <h2 id="td-title" className="td-title">{task.name}</h2>
        <button type="button" className="td-close" onClick={onClose} aria-label={t.close}>✕</button>
      </div>
      <div className="td-chips">
        <StatusChip task={task} />
        <span className="td-risk"><span className="td-risk-title">{RISK_TITLE_HE}</span><RiskChip risk={riskOf(task, viewer)} /></span>
      </div>

      <dl className="project-facts td-facts">
        <dt>{t.zone}</dt><dd>{zoneLabel(task.zone)}</dd>
        <dt>{t.trade}</dt><dd>{TRADE_LABELS_HE[task.trade] ?? '—'}</dd>
        <dt>{t.assignee}</dt><dd>{task.assignee?.fullName ?? t.noAssignee}</dd>
        <dt>{t.dates}</dt><dd>{formatDate(task.plannedStart)} – {formatDate(task.plannedEnd)}</dd>
        {(task.actualStart || task.actualEnd) && (
          <><dt>{t.actual}</dt><dd>{formatDate(task.actualStart)} – {task.actualEnd ? formatDate(task.actualEnd) : '…'}</dd></>
        )}
        {task.description && <><dt>{he.project.description}</dt><dd className="pre">{task.description}</dd></>}
      </dl>

      {task.status !== 'completed' && (
        task.blocked
          ? <div className="td-blocked" role="status">{blockerText(task, tasks, zoneLabel)}</div>
          : <div className="td-free">{t.canStart}</div>
      )}

      <Alert messages={error} />

      {moves.length > 0 && (
        <div className="td-section">
          <div className="eyebrow">{t.statusActions}</div>
          <div className="td-actions">
            {moves.map((s) => (
              <button
                key={s}
                type="button"
                className={s === 'planned' ? 'back-btn' : 'cta'}
                // TASK-4: "ready" is refused while anything blocks; the reason is shown above.
                disabled={busy || (s === 'ready' && task.blocked)}
                title={s === 'ready' && task.blocked ? t.readyBlocked : undefined}
                onClick={() => run(() => api.changeStatus(task.id, s))}
              >
                {t.moveTo[s] ?? STATUS_LABELS_HE[s]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="td-section">
        <div className="eyebrow">{t.predecessors}</div>
        {predecessors.length === 0 && <p className="card-caption">{t.noPredecessors}</p>}
        <ul className="td-links">
          {predecessors.map((p) => (
            <li key={p.id}>
              <span className={p.status === 'completed' ? 'td-done' : ''}>
                {p.status === 'completed' ? '✓ ' : ''}{p.name}
              </span>
              <span className="td-link-meta">{zoneLabel(p.zone)} · {STATUS_LABELS_HE[p.status] ?? p.status}</span>
              {manage && (
                <button
                  type="button"
                  className="td-remove"
                  disabled={busy}
                  aria-label={t.removeDependency(p.name)}
                  title={t.removeDependency(p.name)}
                  onClick={() => run(() => api.removeDependency(task.id, p.id))}
                >✕</button>
              )}
            </li>
          ))}
        </ul>
        {manage && candidates.length > 0 && (
          <form
            className="td-add"
            onSubmit={(e) => { e.preventDefault(); if (pick) run(() => api.addDependency(task.id, pick)); }}
          >
            <label className="sr-only" htmlFor="td-pick">{t.addPredecessor}</label>
            <select id="td-pick" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">{t.choosePredecessor}</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.name} · {zoneLabel(c.zone)}</option>)}
            </select>
            <button type="submit" className="back-btn" disabled={busy || !pick}>{busy ? t.saving : t.add}</button>
          </form>
        )}
      </div>

      <div className="td-section">
        <div className="eyebrow">{t.dependants}</div>
        {dependants.length === 0 && <p className="card-caption">{t.noDependants}</p>}
        <ul className="td-links">
          {dependants.map((d) => (
            <li key={d.id}>
              <span>{d.name}</span>
              <span className="td-link-meta">{zoneLabel(d.zone)} · {STATUS_LABELS_HE[d.status] ?? d.status}</span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
