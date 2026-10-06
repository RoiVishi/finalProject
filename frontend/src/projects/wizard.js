/**
 * TASK-1 project wizard — pure logic (validation, payload). Mirrors
 * backend/src/projects/dto/create-project.dto.ts and layout.ts so the user gets
 * feedback per step; the server re-validates everything and its messages win.
 */
import { he } from '../i18n/he.js';
import { EMAIL_RULE } from '../auth/validation.js';

export const MAX_FLOORS = 80; // layout.ts
export const MAX_ZONES_PER_FLOOR = 20; // layout.ts
export const MAX_TEAM = 50; // CreateProjectDto @ArrayMaxSize(50)
/** Roles a person can be invited as. OWNER is excluded: the creator becomes owner. */
export const INVITABLE_ROLES = ['project_manager', 'engineer', 'subcontractor', 'inspector'];

const v = he.validation;

/** §2 note (3) — UI heuristic only; the server enforces the same rule (canCreateProject). */
export function canCreateProject(profession) {
  return profession === 'main_contractor' || profession === 'project_manager';
}

export const defaultZoneName = (i) => `אגף ${i}`;

export function emptyWizard() {
  return {
    details: { name: '', address: '', description: '', plannedStart: '', plannedEnd: '' },
    layout: { floors: 5, zonesPerFloor: 4, zoneNames: [] },
    team: [],
  };
}

export function validateDetails(d) {
  const e = {};
  const name = (d.name ?? '').trim();
  if (name.length < 2 || name.length > 120) e.name = v.projectName;
  if (d.plannedStart && d.plannedEnd && d.plannedEnd < d.plannedStart) e.plannedEnd = v.dateOrder;
  return e;
}

/** Zone names padded / trimmed to exactly Z entries, defaults where blank. */
export function resolvedZoneNames(layout) {
  const z = Number(layout.zonesPerFloor) || 0;
  return Array.from({ length: Math.max(0, Math.min(z, MAX_ZONES_PER_FLOOR)) }, (_, i) =>
    (layout.zoneNames?.[i] ?? '').trim() || defaultZoneName(i + 1));
}

const isIntIn = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;

export function validateLayout(layout) {
  const e = {};
  const f = Number(layout.floors);
  const z = Number(layout.zonesPerFloor);
  if (!isIntIn(f, 1, MAX_FLOORS)) e.floors = v.floors(MAX_FLOORS);
  if (!isIntIn(z, 1, MAX_ZONES_PER_FLOOR)) e.zonesPerFloor = v.zones(MAX_ZONES_PER_FLOOR);
  if (!e.zonesPerFloor) {
    const names = resolvedZoneNames(layout).map((n) => n.toLowerCase());
    if (new Set(names).size !== names.length) e.zoneNames = v.zoneNamesUnique;
  }
  return e;
}

/** Returns { rows: [{email?, role?}] per row, form?: string } — empty when valid. */
export function validateTeam(team, creatorEmail) {
  const rows = team.map(() => ({}));
  let form;
  if (team.length > MAX_TEAM) form = v.tooMany;
  const seen = new Map();
  const me = (creatorEmail ?? '').trim().toLowerCase();
  team.forEach((m, i) => {
    const email = (m.email ?? '').trim().toLowerCase();
    if (!EMAIL_RULE.test(email)) rows[i].email = v.email;
    else if (me && email === me) rows[i].email = v.selfInvite;
    else if (seen.has(email)) rows[i].email = v.duplicateEmail;
    else seen.set(email, i);
    if (!INVITABLE_ROLES.includes(m.role)) rows[i].role = v.role;
  });
  return { rows, form };
}

export const teamIsValid = ({ rows, form }) => !form && rows.every((r) => Object.keys(r).length === 0);

/** The single POST /projects body: three wizard steps, one request. */
export function buildCreatePayload(w) {
  const d = w.details;
  const opt = (s) => (s && s.trim() ? s.trim() : undefined);
  const zoneNames = resolvedZoneNames(w.layout);
  const allDefault = zoneNames.every((n, i) => n === defaultZoneName(i + 1));
  return {
    details: {
      name: d.name.trim(),
      ...(opt(d.address) && { address: opt(d.address) }),
      ...(opt(d.description) && { description: opt(d.description) }),
      ...(d.plannedStart && { plannedStart: d.plannedStart }),
      ...(d.plannedEnd && { plannedEnd: d.plannedEnd }),
    },
    layout: {
      floors: Number(w.layout.floors),
      zonesPerFloor: Number(w.layout.zonesPerFloor),
      // Defaults are filled in by the server; send names only when the user changed them.
      ...(!allDefault && { zoneNames }),
    },
    ...(w.team.length > 0 && {
      team: w.team.map((m) => ({
        email: m.email.trim().toLowerCase(),
        role: m.role,
        ...(m.role === 'subcontractor' && opt(m.trade) && { trade: opt(m.trade) }),
      })),
    }),
  };
}
