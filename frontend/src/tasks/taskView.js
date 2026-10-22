/**
 * TASK-8 (KAN-28) — the project's activity views: filters, sorting and the
 * subcontractor's "My tasks" default. Pure functions over the rows that
 * GET /tasks?projectId= returns, so every rule here runs under `node --test`.
 *
 * The rows already carry everything the views need (zone, trade, assignee,
 * status, planned dates, the computed blocking verdict and the cached
 * prediction), so filtering and sorting happen in the browser: a project has
 * at most a few hundred activities, and the backend stays untouched.
 *
 * Risk: the band is the `riskLevel` the backend cached from the AI service —
 * one source for the bands (PRED-12). The browser never maps a probability to a
 * band here and never shows the probability (v6 display rule, NFR-USE-1).
 */

/** Lifecycle labels — backend/src/tasks/task-lifecycle.ts STATUS_LABELS. */
export const STATUS_LABELS_HE = {
  planned: 'מתוכננת',
  ready: 'מוכנה להתחלה',
  in_progress: 'בביצוע',
  completed: 'הושלמה',
};

/** 'blocked' is computed on every read, never a stored status (TASK-2). */
export const BLOCKED_LABEL_HE = 'חסומה';

/** Trade categories — backend/src/tasks/task.entity.ts TRADE_LABELS. */
export const TRADE_LABELS_HE = {
  structure: 'שלד',
  electrical: 'חשמל',
  plumbing: 'אינסטלציה',
  drywall: 'גבס',
  hvac: 'מיזוג',
  finishing: 'גמר',
  other: 'אחר',
};

/** TASK-2 transitions — mirrors ALLOWED_TRANSITIONS in task-lifecycle.ts; the server still enforces them. */
export const ALLOWED_TRANSITIONS = {
  planned: ['ready'],
  ready: ['planned', 'in_progress'],
  in_progress: ['completed'],
  completed: [],
};

export const nextStatuses = (status) => ALLOWED_TRANSITIONS[status] ?? [];

/** AUTH-2 matrix row MANAGE_TASKS (backend/src/auth/permissions.ts). Hides controls only; the server decides. */
const MANAGE_TASK_ROLES = ['owner', 'project_manager', 'engineer'];
export const canManageTasks = (role) => MANAGE_TASK_ROLES.includes(role);

const BANDS = ['low', 'medium', 'high'];

/**
 * TASK-5 freshness of the cached prediction, as the backend computes it
 * (prediction-freshness.ts, sent on every row as `predictionFreshness`):
 * 'current' | 'stale' | 'abstained' | 'none'. Rows from a backend that predates
 * the field fall back to the same rule without the stale case.
 */
export function freshnessOf(task) {
  if (['current', 'stale', 'abstained', 'none'].includes(task.predictionFreshness)) return task.predictionFreshness;
  if (task.lastPredictionOutcome === 'abstained') return 'abstained';
  return task.predictedAt ? 'current' : 'none';
}

/**
 * What the risk column shows for one row, for this viewer:
 *  - 'done'    the activity is completed — no risk to show
 *  - 'hidden'  a subcontractor looking at someone else's activity: the backend
 *              withholds that prediction (AUTH-2, KAN-128), so we say so instead of "no data"
 *  - 'unknown' the AI service abstained on the last attempt (PRED-10) — "not enough data"
 *  - 'none'    no prediction has been stored yet
 *  - 'stale'   KAN-26: dates or dependencies changed after the prediction; the
 *              last band is shown only as "last known, being recalculated"
 *  - 'low' | 'medium' | 'high'  the current cached band
 */
export function riskOf(task, viewer) {
  if (task.status === 'completed') return 'done';
  if (viewer?.role === 'subcontractor' && task.assignee?.id !== viewer.userId) return 'hidden';
  const fresh = freshnessOf(task);
  if (fresh === 'abstained') return 'unknown';
  if (fresh === 'none' || !BANDS.includes(task.riskLevel)) return 'none';
  if (fresh === 'stale') return 'stale';
  return task.riskLevel;
}

/** The band a stale row last had — shown muted next to "not current". */
export const lastBandOf = (task) => (BANDS.includes(task.riskLevel) ? task.riskLevel : null);

/** Labels for the risk states that are not bands (the bands use RISK_LABELS_HE). */
export const RISK_STATE_HE = {
  none: 'אין עדיין חיזוי',
  hidden: '—',
  stale: 'לא עדכני',
};

/** "floor-3/zone-2" → 3 (TASK-1 zone ids). */
export function floorOf(zone) {
  const m = /^floor-(\d+)\//.exec(zone ?? '');
  return m ? Number(m[1]) : null;
}

export const EMPTY_FILTERS = Object.freeze({ status: '', trade: '', floor: '', assignee: '', risk: '' });

/**
 * One row against the filters. Every filter narrows; an empty value means
 * "any", so the filters combine as a plain AND (acceptance criterion 1).
 *  - status:   a lifecycle value, or 'blocked' for the computed state
 *  - assignee: a user id, 'me', or 'none' for unassigned
 *  - floor:    a floor number (as a string from a <select>)
 *  - risk:     any value riskOf() returns
 */
export function matchesFilters(task, filters, viewer) {
  const f = { ...EMPTY_FILTERS, ...filters };
  if (f.status) {
    if (f.status === 'blocked') {
      if (!task.blocked) return false;
    } else if (task.status !== f.status) return false;
  }
  if (f.trade && task.trade !== f.trade) return false;
  if (f.floor && String(floorOf(task.zone)) !== String(f.floor)) return false;
  if (f.assignee) {
    const who = task.assignee?.id ?? null;
    if (f.assignee === 'me') {
      if (!viewer?.userId || who !== viewer.userId) return false;
    } else if (f.assignee === 'none') {
      if (who) return false;
    } else if (who !== f.assignee) return false;
  }
  if (f.risk && riskOf(task, viewer) !== f.risk) return false;
  return true;
}

const dateKey = (d) => (d ? String(d).slice(0, 10) : '9999-12-31'); // undated rows sort last
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function byDate(a, b) {
  return cmp(dateKey(a.plannedStart), dateKey(b.plannedStart))
    || cmp(dateKey(a.plannedEnd), dateKey(b.plannedEnd))
    || String(a.name ?? '').localeCompare(String(b.name ?? ''), 'he');
}

// Current bands first; a stale number comes after them because it no longer describes the plan.
const RISK_RANK = { high: 0, medium: 1, low: 2, stale: 3, unknown: 4, none: 5, hidden: 6, done: 7 };

export const SORTS = {
  /** Planned start, then planned finish, then name. */
  date: () => byDate,
  /** Highest band first. Inside a band the cached probability orders the rows (it is never shown). */
  risk: (viewer) => (a, b) => {
    const ra = riskOf(a, viewer);
    const rb = riskOf(b, viewer);
    const byBand = RISK_RANK[ra] - RISK_RANK[rb];
    if (byBand) return byBand;
    const pa = typeof a.lateProbability === 'number' ? a.lateProbability : -1;
    const pb = typeof b.lateProbability === 'number' ? b.lateProbability : -1;
    return (pb - pa) || byDate(a, b);
  },
  /** "What needs me now": blocked first, then open work, completed last; dates inside each group. */
  attention: () => (a, b) =>
    (Number(Boolean(b.blocked)) - Number(Boolean(a.blocked)))
    || (Number(a.status === 'completed') - Number(b.status === 'completed'))
    || byDate(a, b),
};

export const SORT_LABELS_HE = {
  date: 'לפי תאריך',
  risk: 'לפי סיכון',
  attention: 'חסומות קודם',
};

/** Filter, then sort. Never mutates the input. */
export function viewTasks(tasks, filters, sort, viewer) {
  const compare = (SORTS[sort] ?? SORTS.date)(viewer);
  return (tasks ?? []).filter((t) => matchesFilters(t, filters, viewer)).sort(compare);
}

/**
 * The view a role lands on (acceptance criterion 2). A subcontractor opens on
 * "My tasks" with what blocks them first; everyone else sees the whole project
 * by date. Required documents will join the "first" group when DOC-1/DOC-4 land:
 * they arrive inside the same `blocked` verdict, so this rule does not change.
 */
export function defaultView(role) {
  if (role === 'subcontractor') return { filters: { ...EMPTY_FILTERS, assignee: 'me' }, sort: 'attention' };
  return { filters: { ...EMPTY_FILTERS }, sort: 'date' };
}

export const isDefaultView = (role, filters, sort) => {
  const d = defaultView(role);
  return sort === d.sort && Object.keys(EMPTY_FILTERS).every((k) => (filters[k] ?? '') === d.filters[k]);
};

/** Header numbers for the list: how many shown, of how many, and how many of the shown are blocked. */
export function summarize(all, shown) {
  return {
    total: (all ?? []).length,
    shown: (shown ?? []).length,
    blocked: (shown ?? []).filter((t) => t.blocked).length,
  };
}

/** Zone id → "קומה 3 · אגף ב" from GET /projects/:id/zones; falls back to the id. */
export function zoneLabeler(zones) {
  const byId = new Map((zones ?? []).map((z) => [z.id, z.label]));
  return (zoneId) => (zoneId ? byId.get(zoneId) ?? zoneId : '—');
}

/** Floor options for the filter: from the project layout when known, else from the rows. */
export function floorOptions(zones, tasks) {
  const seen = new Map();
  for (const z of zones ?? []) if (!seen.has(z.floor)) seen.set(z.floor, z.floorLabel ?? `קומה ${z.floor}`);
  if (seen.size === 0) {
    for (const t of tasks ?? []) {
      const f = floorOf(t.zone);
      if (f != null && !seen.has(f)) seen.set(f, `קומה ${f}`);
    }
  }
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([value, label]) => ({ value: String(value), label }));
}

/** Assignee options: active project members (GET /projects/:id/members), by name. */
export function assigneeOptions(members) {
  return (members ?? [])
    .filter((m) => m.user && (m.status ?? 'active') === 'active')
    .map((m) => ({ value: m.user.id, label: m.user.fullName || m.user.email || m.user.id }))
    .sort((a, b) => a.label.localeCompare(b.label, 'he'));
}

/** The viewer's role in this project, from the member list (GET /projects/:id does not carry it). */
export function myRoleIn(members, userId) {
  const mine = (members ?? []).find((m) => m.user?.id === userId && (m.status ?? 'active') === 'active');
  return mine?.role ?? null;
}

/**
 * The TASK-4 sentence, with zone NAMES. The backend's `summary` labels a
 * blocking predecessor with its zone id ("floor-3/zone-1"); the row's
 * `blockers` carry the same facts, so the sentence is rebuilt here with the
 * zone label the user sees everywhere else. Same wording as blocking.ts
 * summarize(); falls back to the backend summary when there are no blockers.
 */
export function blockerText(task, rows, zoneLabel) {
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));
  const render = (label, detail) => (detail ? `${label} — ${detail}` : label);
  const waiting = [];
  const missing = [];
  for (const b of task.blockers ?? []) {
    if (b.kind === 'predecessor') {
      const p = byId.get(b.id);
      const label = p ? (p.zone ? `${p.name} (${zoneLabel(p.zone)})` : p.name) : b.label;
      waiting.push(render(label, b.detail));
    } else {
      missing.push(render(b.label, b.detail));
    }
  }
  const parts = [];
  if (waiting.length) parts.push(`חסום על ידי: ${waiting.join('; ')}`);
  if (missing.length) parts.push(`ממתין לאישור: ${missing.join('; ')}`);
  return parts.length ? parts.join(' · ') : task.summary ?? '';
}

/**
 * Detail-panel graph for one activity, from the list rows alone:
 * predecessors come embedded in the row; dependants are the rows that list it.
 */
export function neighbours(task, all) {
  const rows = all ?? [];
  const predecessors = (task.predecessors ?? []).map((p) => rows.find((r) => r.id === p.id) ?? p);
  const dependants = rows.filter((r) => (r.predecessors ?? []).some((p) => p.id === task.id));
  return { predecessors, dependants };
}

/**
 * Activities that may be added as a predecessor of `task`: not itself, not
 * already a predecessor, and not something downstream of it (that would close a
 * cycle — the server refuses it too, TASK-3; filtering here just keeps the
 * choice list honest).
 */
export function predecessorCandidates(task, all) {
  const rows = all ?? [];
  const downstream = new Set();
  const queue = [task.id];
  while (queue.length) {
    const id = queue.shift();
    for (const r of rows) {
      if (!downstream.has(r.id) && (r.predecessors ?? []).some((p) => p.id === id)) {
        downstream.add(r.id);
        queue.push(r.id);
      }
    }
  }
  const existing = new Set((task.predecessors ?? []).map((p) => p.id));
  return rows
    .filter((r) => r.id !== task.id && !existing.has(r.id) && !downstream.has(r.id))
    .sort(byDate);
}
