#!/usr/bin/env node
/**
 * Demo data for ForeSite (NFR-DEMO): two fictional projects with a team,
 * activities, dependencies, progress and one pending invitation.
 *
 * It talks to the public REST API only, the same way the browser does, so
 * every rule of the backend (validation, permissions, lifecycle, blocking)
 * applies and no backend code or database schema is touched.
 *
 * Usage:
 *   DEMO_PASSWORD='...' node deploy/seed-demo.mjs https://foresite-sce.duckdns.org/api
 *   DEMO_PASSWORD='...' node deploy/seed-demo.mjs http://localhost:3000
 *   add --predict to also ask the AI service for a prediction on open activities
 *
 * Safe to run twice: existing users log in instead of registering, and a
 * project whose name already exists for its owner is skipped.
 *
 * Known limit: the API stamps actualStart / actualEnd with today's date when
 * a status changes, so completed activities all finish "today". Planned dates
 * are placed relative to today so the picture still looks like a live site.
 */

const args = process.argv.slice(2);
const BASE = (args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000').replace(/\/$/, '');
const PREDICT = args.includes('--predict');
const PASSWORD = process.env.DEMO_PASSWORD;

if (!PASSWORD || !/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(PASSWORD)) {
  console.error('Set DEMO_PASSWORD (at least 8 characters, a letter and a digit).');
  process.exit(1);
}

// ---- people (fictional; example.com is reserved for examples) -------------

const PEOPLE = {
  owner: { email: 'dana.owner@example.com', fullName: 'דנה כהן', phone: '050-1234567', profession: 'main_contractor' },
  pm: { email: 'yossi.pm@example.com', fullName: 'יוסי לוי', phone: '052-2345678', profession: 'project_manager' },
  engineer: { email: 'noa.engineer@example.com', fullName: 'נועה ברק', phone: '054-3456789', profession: 'engineer' },
  electric: { email: 'avi.electric@example.com', fullName: 'אבי זרם', phone: '053-4567890', profession: 'subcontractor' },
  plumbing: { email: 'moshe.plumbing@example.com', fullName: 'משה צנרת', phone: '058-5678901', profession: 'subcontractor' },
  inspector: { email: 'rina.inspector@example.com', fullName: 'רינה פקח', phone: '050-6789012', profession: 'inspector' },
};

// ---- tiny HTTP client ------------------------------------------------------

async function api(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('; ') : (data?.message ?? text);
    const err = new Error(`${method} ${path} → ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const userIdOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;

async function signIn(person) {
  try {
    const { access_token } = await api('POST', '/auth/register', null, { ...person, password: PASSWORD });
    console.log(`  + registered ${person.email}`);
    return access_token;
  } catch (registerError) {
    // Already registered (the API does not say so explicitly) → log in instead.
    try {
      const { access_token } = await api('POST', '/auth/login', null, { email: person.email, password: PASSWORD });
      console.log(`  = exists, logged in ${person.email}`);
      return access_token;
    } catch {
      throw registerError;
    }
  }
}

// ---- dates -----------------------------------------------------------------

const DAY = 86_400_000;
const today = new Date(new Date().toISOString().slice(0, 10));
const day = (offset) => new Date(today.getTime() + offset * DAY).toISOString().slice(0, 10);

// ---- project A: a four-storey residential building, mid-execution ---------

/**
 * Per floor: structure → (plumbing ∥ electrical) → drywall → HVAC → finishing,
 * and each floor's structure waits for the floor below. `target` is where the
 * activity should end up; the script walks it there through the real lifecycle.
 */
function buildingPlan() {
  const start = -45; // the site opened 45 days ago
  const plan = [];
  const target = {
    1: { structure: 'completed', plumbing: 'completed', electrical: 'completed', drywall: 'completed', hvac: 'completed', finishing: 'in_progress' },
    2: { structure: 'completed', plumbing: 'completed', electrical: 'in_progress' },
    3: { structure: 'in_progress' },
    4: {},
  };

  for (let f = 1; f <= 4; f += 1) {
    const s = start + (f - 1) * 14;
    const t = target[f];
    const add = (key, name, trade, zone, from, days, deps, who) => {
      plan.push({
        key: `${key}${f}`, name: `${name} — קומה ${f}`, trade, zone: `floor-${f}/zone-${zone}`,
        plannedStart: day(from), plannedEnd: day(from + days - 1), estimatedDurationDays: days,
        deps: deps.map((d) => `${d}`), assignee: who, target: t[key] ?? 'planned',
      });
    };
    add('structure', 'יציקת שלד ותקרה', 'structure', 1, s, 12, f > 1 ? [`structure${f - 1}`] : [], 'engineer');
    add('plumbing', 'צנרת מים וביוב', 'plumbing', 1, s + 12, 8, [`structure${f}`], 'plumbing');
    add('electrical', 'תשתית חשמל ותקשורת', 'electrical', 2, s + 12, 8, [`structure${f}`], 'electric');
    add('drywall', 'קירות גבס', 'drywall', 2, s + 20, 7, [`plumbing${f}`, `electrical${f}`], null);
    add('hvac', 'התקנת מיזוג', 'hvac', 1, s + 27, 5, [`drywall${f}`], null);
    add('finishing', 'ריצוף וצבע', 'finishing', 2, s + 32, 8, [`hvac${f}`], null);
  }
  return plan;
}

// ---- project B: a small renovation, just planned --------------------------

function renovationPlan() {
  return [
    { key: 'demo', name: 'פירוק ופינוי', trade: 'other', zone: 'floor-1/zone-1', plannedStart: day(7), plannedEnd: day(11), estimatedDurationDays: 5, deps: [], assignee: null, target: 'planned' },
    { key: 'elec', name: 'החלפת לוח חשמל', trade: 'electrical', zone: 'floor-1/zone-1', plannedStart: day(12), plannedEnd: day(16), estimatedDurationDays: 5, deps: ['demo'], assignee: null, target: 'planned' },
    { key: 'paint', name: 'צביעת כיתות', trade: 'finishing', zone: 'floor-2/zone-1', plannedStart: day(17), plannedEnd: day(23), estimatedDurationDays: 7, deps: ['elec'], assignee: null, target: 'planned' },
  ];
}

const PATH = { planned: [], ready: ['ready'], in_progress: ['ready', 'in_progress'], completed: ['ready', 'in_progress', 'completed'] };

async function seedProject({ ownerToken, details, layout, team, acceptors, plan, assigneeIds }) {
  const existing = (await api('GET', '/projects', ownerToken)).find((p) => p.name === details.name);
  if (existing) {
    console.log(`  = project "${details.name}" already exists — skipped`);
    return null;
  }

  const project = await api('POST', '/projects', ownerToken, { details, layout, team });
  console.log(`  + project "${details.name}" (${layout.floors}×${layout.zonesPerFloor})`);

  for (const [who, token] of acceptors) {
    const mine = await api('GET', '/invitations/mine', token);
    const inv = mine.find((i) => i.project.id === project.id);
    if (inv) {
      await api('POST', `/invitations/by-id/${inv.id}/accept`, token);
      console.log(`    ${who} joined as ${inv.role}`);
    }
  }

  const ids = {};
  for (const item of plan) {
    const task = await api('POST', '/tasks', ownerToken, {
      projectId: project.id, name: item.name, trade: item.trade, zone: item.zone,
      plannedStart: item.plannedStart, plannedEnd: item.plannedEnd,
      estimatedDurationDays: item.estimatedDurationDays,
      ...(item.assignee ? { assigneeId: assigneeIds[item.assignee] } : {}),
    });
    ids[item.key] = task.id;
    for (const dep of item.deps) {
      await api('POST', `/tasks/${task.id}/dependencies`, ownerToken, { predecessorId: ids[dep] });
    }
  }
  console.log(`    ${plan.length} activities with dependencies`);

  // Plan order is topological, so every predecessor is finished before its dependants move.
  for (const item of plan) {
    for (const status of PATH[item.target]) {
      await api('POST', `/tasks/${ids[item.key]}/status`, ownerToken, { status });
    }
  }
  const done = plan.filter((p) => p.target === 'completed').length;
  const running = plan.filter((p) => p.target === 'in_progress').length;
  console.log(`    progress: ${done} completed, ${running} in progress`);

  return { project, ids, plan };
}

async function main() {
  console.log(`Seeding ${BASE}`);
  const tokens = {};
  for (const [key, person] of Object.entries(PEOPLE)) tokens[key] = await signIn(person);
  const ids = Object.fromEntries(Object.entries(tokens).map(([k, t]) => [k, userIdOf(t)]));

  const a = await seedProject({
    ownerToken: tokens.owner,
    details: {
      name: 'מגדל אורנים — הדגמה',
      address: 'רחוב האורנים 12, עיר לדוגמה',
      description: 'פרויקט הדגמה: בניין מגורים בן 4 קומות באמצע הביצוע.',
      plannedStart: day(-45), plannedEnd: day(45),
    },
    layout: { floors: 4, zonesPerFloor: 2, zoneNames: ['אגף צפוני', 'אגף דרומי'] },
    team: [
      { email: PEOPLE.pm.email, role: 'project_manager' },
      { email: PEOPLE.engineer.email, role: 'engineer' },
      { email: PEOPLE.electric.email, role: 'subcontractor', trade: 'electrical' },
      { email: PEOPLE.plumbing.email, role: 'subcontractor', trade: 'plumbing' },
      { email: PEOPLE.inspector.email, role: 'inspector' },
    ],
    acceptors: ['pm', 'engineer', 'electric', 'plumbing', 'inspector'].map((k) => [k, tokens[k]]),
    plan: buildingPlan(),
    assigneeIds: ids,
  });

  // Project B is owned by the PM; Dana's invitation is left open on purpose,
  // so her home screen shows a pending invitation (DASH-5).
  await seedProject({
    ownerToken: tokens.pm,
    details: {
      name: 'שיפוץ בית ספר — הדגמה',
      address: 'רחוב החינוך 3, עיר לדוגמה',
      description: 'פרויקט הדגמה: שיפוץ קטן שעוד לא התחיל.',
      plannedStart: day(7), plannedEnd: day(30),
    },
    layout: { floors: 2, zonesPerFloor: 1 },
    team: [
      { email: PEOPLE.owner.email, role: 'engineer' },
      { email: PEOPLE.electric.email, role: 'subcontractor', trade: 'electrical' },
    ],
    acceptors: [['electric', tokens.electric]],
    plan: renovationPlan(),
    assigneeIds: ids,
  });

  if (PREDICT && a) {
    let ok = 0; let failed = 0;
    for (const item of a.plan.filter((p) => p.target !== 'completed')) {
      try { await api('POST', `/tasks/${a.ids[item.key]}/predict`, tokens.owner); ok += 1; } catch { failed += 1; }
    }
    console.log(`  predictions: ${ok} stored/answered, ${failed} failed`);
  }

  console.log('\nDone. Sign in with any of:');
  for (const p of Object.values(PEOPLE)) console.log(`  ${p.email}`);
  console.log('(password: the DEMO_PASSWORD you passed)');
}

main().catch((err) => { console.error(`\nFAILED: ${err.message}`); process.exit(1); });
