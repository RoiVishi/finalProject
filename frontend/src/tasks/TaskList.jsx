import React, { useMemo } from 'react';
import { RISK_COLORS, RISK_LABELS_HE, RISK_TITLE_HE } from '../ar/riskBands.js';
import { he } from '../i18n/he.js';
import { formatDate } from '../pages/AppShell.jsx';
import {
  BLOCKED_LABEL_HE, RISK_STATE_HE, SORT_LABELS_HE, STATUS_LABELS_HE, TRADE_LABELS_HE,
  assigneeOptions, blockerText, floorOptions, isDefaultView, riskOf, summarize, viewTasks, zoneLabeler,
} from './taskView.js';
import './tasks.css';

const t = he.tasks;

/** Band chip — the band name only, never a number (NFR-USE-1, v6 display rule). */
export function RiskChip({ risk }) {
  if (risk === 'hidden') {
    return <span className="risk-chip hidden" title={t.hiddenRisk}>{RISK_STATE_HE.hidden}</span>;
  }
  const label = RISK_LABELS_HE[risk] ?? RISK_STATE_HE[risk] ?? RISK_STATE_HE.none;
  const color = RISK_COLORS[risk] ?? RISK_COLORS.unknown;
  return (
    <span className={`risk-chip ${risk}`} style={{ '--risk': color }} title={RISK_TITLE_HE}>
      <span className="risk-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function StatusChip({ task }) {
  if (task.blocked && task.status !== 'completed') return <span className="chip warn">{BLOCKED_LABEL_HE}</span>;
  const kind = task.status === 'completed' ? 'ok' : task.status === 'in_progress' ? 'progress' : 'muted';
  return <span className={`chip ${kind}`}>{STATUS_LABELS_HE[task.status] ?? task.status}</span>;
}

function Select({ id, label, value, onChange, children }) {
  return (
    <label className="tl-filter" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
    </label>
  );
}

/**
 * TASK-8: the project's activities with filters and sorting. Controlled — the
 * page owns filters/sort (so the default view can depend on the role) and the
 * selection (the detail panel sits beside the list).
 */
export default function TaskList({
  tasks, zones, members, viewer, filters, sort, onFilters, onSort, selectedId, onSelect,
}) {
  const shown = useMemo(() => viewTasks(tasks, filters, sort, viewer), [tasks, filters, sort, viewer]);
  const counts = summarize(tasks, shown);
  const zoneLabel = useMemo(() => zoneLabeler(zones), [zones]);
  const floors = useMemo(() => floorOptions(zones, tasks), [zones, tasks]);
  const people = useMemo(() => assigneeOptions(members), [members]);
  const set = (key) => (value) => onFilters({ ...filters, [key]: value });
  const mine = filters.assignee === 'me';
  const isSub = viewer?.role === 'subcontractor';

  return (
    <section className="card tl" aria-labelledby="tl-title">
      <div className="tl-head">
        <h2 id="tl-title" className="tl-title">{mine ? t.myTitle : t.title}</h2>
        <div className="tl-count" data-testid="tl-count">
          {t.count(counts.shown, counts.total)}
          {counts.blocked > 0 && <span className="tl-count-blocked"> · {t.blockedCount(counts.blocked)}</span>}
        </div>
      </div>

      {tasks.length > 0 && (
        <div className="tl-filters" role="group" aria-label={t.filters}>
          <Select id="f-status" label={t.status} value={filters.status} onChange={set('status')}>
            <option value="">{t.any}</option>
            {Object.entries(STATUS_LABELS_HE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value="blocked">{BLOCKED_LABEL_HE}</option>
          </Select>
          <Select id="f-trade" label={t.trade} value={filters.trade} onChange={set('trade')}>
            <option value="">{t.any}</option>
            {Object.entries(TRADE_LABELS_HE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select id="f-floor" label={t.floor} value={filters.floor} onChange={set('floor')}>
            <option value="">{t.any}</option>
            {floors.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </Select>
          <Select id="f-assignee" label={t.assignee} value={filters.assignee} onChange={set('assignee')}>
            <option value="">{t.any}</option>
            <option value="me">{t.me}</option>
            <option value="none">{t.unassigned}</option>
            {people.filter((p) => p.value !== viewer?.userId).map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </Select>
          <Select id="f-risk" label={t.risk} value={filters.risk} onChange={set('risk')}>
            <option value="">{t.any}</option>
            {['high', 'medium', 'low', 'unknown'].map((k) => <option key={k} value={k}>{RISK_LABELS_HE[k]}</option>)}
            <option value="none">{RISK_STATE_HE.none}</option>
          </Select>
          <Select id="f-sort" label={t.sort} value={sort} onChange={onSort}>
            {Object.entries(SORT_LABELS_HE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          {!isDefaultView(viewer?.role, filters, sort) && (
            <button type="button" className="tl-reset" onClick={() => onFilters(null)}>{t.reset}</button>
          )}
        </div>
      )}

      {tasks.length === 0 && <p className="card-caption">{t.empty}</p>}
      {tasks.length > 0 && shown.length === 0 && <p className="card-caption">{t.noMatch}</p>}

      {shown.length > 0 && (
        <ul className="tl-rows">
          {shown.map((task) => {
            const risk = riskOf(task, viewer);
            const active = task.id === selectedId;
            return (
              <li key={task.id}>
                <button
                  type="button"
                  className={`tl-row${active ? ' active' : ''}${task.blocked && task.status !== 'completed' ? ' blocked' : ''}`}
                  aria-pressed={active}
                  onClick={() => onSelect(active ? null : task.id)}
                >
                  <span className="tl-main">
                    <span className="tl-name">{task.name}</span>
                    <span className="tl-meta">
                      {zoneLabel(task.zone)}
                      {task.trade && <> · {TRADE_LABELS_HE[task.trade] ?? task.trade}</>}
                      {' · '}{task.assignee?.fullName ?? t.noAssignee}
                      {' · '}{formatDate(task.plannedStart)} – {formatDate(task.plannedEnd)}
                    </span>
                    {task.blocked && task.status !== 'completed' && (
                      <span className="tl-blocker">{blockerText(task, tasks, zoneLabel)}</span>
                    )}
                  </span>
                  <span className="tl-side">
                    <StatusChip task={task} />
                    <RiskChip risk={risk} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {isSub && !mine && <p className="card-caption">{t.hiddenRisk}</p>}
    </section>
  );
}
