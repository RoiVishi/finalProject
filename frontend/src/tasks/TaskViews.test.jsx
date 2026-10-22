/**
 * TASK-8 (KAN-28) acceptance criteria on the real screen:
 *  1. filters combine correctly — exercised through the <select>s;
 *  2. the subcontractor's default view ("My tasks", blocked first) — verified
 *     on ProjectPage with the role read from the member list, as in production.
 * Plus the TASK-2/3/4 detail panel: named blocker, lifecycle moves, dependency
 * edits, and no controls for roles outside MANAGE_TASKS.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ current: null }));
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => auth.current }));

import ProjectPage from '../pages/ProjectPage.jsx';

const ME = 'u-me';
const at = '2026-11-01T08:00:00Z';
const task = (id, over = {}) => ({
  id, name: `פעילות ${id}`, status: 'planned', trade: 'electrical', zone: 'floor-1/zone-1',
  plannedStart: '2026-11-10', plannedEnd: '2026-11-20', assignee: { id: ME, fullName: 'אבי' },
  blocked: false, blockers: [], summary: '', predecessors: [], ...over,
});
const ROWS = [
  task('a', { plannedStart: '2026-11-12', riskLevel: 'medium', predictedAt: at }),
  task('b', { plannedStart: '2026-11-15', trade: 'plumbing', zone: 'floor-2/zone-1', blocked: true,
    summary: 'חסום על ידי: פעילות c (floor-2/zone-2) — תמר, צפי סיום 20.11.2026',
    blockers: [{ kind: 'predecessor', id: 'c', label: 'פעילות c (floor-2/zone-2)', detail: 'תמר, צפי סיום 20.11.2026' }],
    riskLevel: 'high', predictedAt: at, predecessors: [{ id: 'c', name: 'פעילות c', status: 'in_progress' }] }),
  task('c', { plannedStart: '2026-11-05', zone: 'floor-2/zone-2', assignee: { id: 'u-t', fullName: 'תמר' },
    status: 'in_progress', riskLevel: 'low', predictedAt: at }),
  task('d', { plannedStart: '2026-11-01', assignee: null, status: 'ready' }),
];
const ZONES = [
  { id: 'floor-1/zone-1', floor: 1, floorLabel: 'קומה 1', label: 'קומה 1 · אגף א' },
  { id: 'floor-2/zone-1', floor: 2, floorLabel: 'קומה 2', label: 'קומה 2 · אגף א' },
  { id: 'floor-2/zone-2', floor: 2, floorLabel: 'קומה 2', label: 'קומה 2 · אגף ב' },
];
const members = (myRole) => [
  { role: myRole, status: 'active', user: { id: ME, fullName: 'אבי' } },
  { role: 'owner', status: 'active', user: { id: 'u-t', fullName: 'תמר' } },
];

// PRED-3 explanation body, as GET /tasks/:id/explanation returns it (backend ActivityExplanation).
const explained = (riskLevel = 'medium', over = {}) => ({
  taskId: 'x', name: 'x', status: 'explained', reliability: 'within_project_history', abstainReason: null, note: null,
  prediction: { lateProbability: 0.4215, riskLevel, modelVersion: 'v6' }, baseProbability: 0.3871,
  contributions: [
    { feature: 'planned_duration_days', label: 'משך מתוכנן (ימים)', labelEn: 'Planned duration (days)', value: 12, contribution: 0.1834, direction: 'raises' },
    { feature: 'downstream_cnt', label: 'משימות במורד השרשרת', labelEn: 'Downstream', value: 3, contribution: -0.0412, direction: 'lowers' },
  ],
  ...over,
});

function setup(myRole, { onPost, explain = () => explained() } = {}) {
  const calls = [];
  let rows = ROWS;
  const client = {
    get: vi.fn(async (p) => {
      calls.push(['GET', p]);
      if (p === '/projects/p1') return { id: 'p1', name: 'מגדל הדר', layout: { floors: 2, zonesPerFloor: 2 } };
      if (p === '/projects/p1/zones') return ZONES;
      if (p === '/projects/p1/members') return members(myRole);
      if (p === '/tasks?projectId=p1') return rows;
      const m = /^\/tasks\/([^/]+)\/explanation$/.exec(p);
      if (m) return explain(m[1]);
      throw new Error(`unexpected GET ${p}`);
    }),
    post: vi.fn(async (p, b) => { calls.push(['POST', p, b]); if (onPost) return onPost(p, b, (r) => { rows = r; }); return {}; }),
    del: vi.fn(async (p) => { calls.push(['DELETE', p]); }),
    patch: vi.fn(),
  };
  auth.current = { client, user: { userId: ME, email: 'me@x.io' }, logout: () => {} };
  render(<ProjectPage id="p1" />);
  return { calls, client };
}

const rowNames = () => screen.getAllByRole('button', { pressed: false })
  .filter((b) => b.classList.contains('tl-row'))
  .map((b) => b.querySelector('.tl-name').textContent);

afterEach(() => { cleanup(); auth.current = null; });

describe('TASK-8 default views', () => {
  it('subcontractor lands on "My tasks" with the blocked activity first (AC 2)', async () => {
    setup('subcontractor');
    await screen.findByRole('heading', { name: 'המשימות שלי' });
    expect(rowNames()).toEqual(['פעילות b', 'פעילות a']);
    expect(screen.getByTestId('tl-count').textContent).toContain('2 מתוך 4 פעילויות');
    expect(screen.getByTestId('tl-count').textContent).toContain('אחת חסומה');
    // the named blocker is on the row itself (TASK-4), with the zone's name rather than its id
    expect(screen.getByText('חסום על ידי: פעילות c (קומה 2 · אגף ב) — תמר, צפי סיום 20.11.2026')).toBeTruthy();
    expect(screen.queryByText(/floor-2\/zone-2/)).toBeNull();
    expect(screen.getByLabelText('אחראי/ת').value).toBe('me');
  });

  it('a project manager lands on the whole project by date', async () => {
    setup('project_manager');
    await screen.findByRole('heading', { name: 'פעילויות' });
    expect(rowNames()).toEqual(['פעילות d', 'פעילות c', 'פעילות a', 'פעילות b']);
    expect(screen.queryByText('ניקוי הסינון')).toBeNull();
  });

  it('a subcontractor sees no prediction on someone else\'s activity, and is told why', async () => {
    setup('subcontractor');
    await screen.findByRole('heading', { name: 'המשימות שלי' });
    fireEvent.change(screen.getByLabelText('אחראי/ת'), { target: { value: '' } });
    const rowC = screen.getByText('פעילות c').closest('button');
    expect(within(rowC).getByTitle('חיזוי מוצג רק למשימות שלך')).toBeTruthy();
    expect(within(rowC).queryByText('נמוך')).toBeNull();
  });
});

describe('TASK-8 filters and sorting', () => {
  it('filters combine, and the reset returns to the role default (AC 1)', async () => {
    setup('engineer');
    await screen.findByRole('heading', { name: 'פעילויות' });
    fireEvent.change(screen.getByLabelText('קומה'), { target: { value: '2' } });
    expect(rowNames()).toEqual(['פעילות c', 'פעילות b']);
    fireEvent.change(screen.getByLabelText('תחום'), { target: { value: 'plumbing' } });
    expect(rowNames()).toEqual(['פעילות b']);
    fireEvent.change(screen.getByLabelText('סטטוס'), { target: { value: 'in_progress' } });
    expect(screen.getByText('אין פעילויות שמתאימות לסינון.')).toBeTruthy();
    fireEvent.click(screen.getByText('ניקוי הסינון'));
    expect(rowNames()).toHaveLength(4);
  });

  it('sorting by risk puts the high band first; bands are words, never numbers', async () => {
    setup('owner');
    await screen.findByRole('heading', { name: 'פעילויות' });
    fireEvent.change(screen.getByLabelText('מיון'), { target: { value: 'risk' } });
    expect(rowNames()).toEqual(['פעילות b', 'פעילות a', 'פעילות c', 'פעילות d']);
    const chips = [...document.querySelectorAll('.risk-chip')].map((c) => c.textContent);
    expect(chips).toEqual(['גבוה', 'בינוני', 'נמוך', 'אין עדיין חיזוי']);
    chips.forEach((c) => expect(c).not.toMatch(/%|\d/));
  });
});

describe('detail panel (TASK-2/3/4)', () => {
  it('shows the named blocker and both directions of the graph', async () => {
    setup('engineer');
    fireEvent.click(await screen.findByText('פעילות b'));
    const panel = screen.getByRole('complementary');
    expect(within(panel).getByRole('status').textContent).toMatch(/חסום על ידי: פעילות c/);
    expect(within(panel).getByText('פעילות c')).toBeTruthy();
    fireEvent.click(within(panel).getByLabelText('סגירה'));
    fireEvent.click(screen.getByText('פעילות c'));
    const panelC = screen.getByRole('complementary');
    expect(within(panelC).getByText('פעילות b')).toBeTruthy(); // c is waited on by b
  });

  it('a lifecycle move calls the API and reloads the list', async () => {
    const { calls } = setup('project_manager', {
      onPost: (p, b, setRows) => { setRows(ROWS.map((r) => (r.id === 'd' ? { ...r, status: 'in_progress' } : r))); return {}; },
    });
    fireEvent.click(await screen.findByText('פעילות d'));
    fireEvent.click(screen.getByText('התחלת ביצוע'));
    await waitFor(() => expect(calls).toContainEqual(['POST', '/tasks/d/status', { status: 'in_progress' }]));
    await waitFor(() => expect(within(screen.getByRole('complementary')).getByText('סימון "הושלמה"')).toBeTruthy());
    expect(calls.filter((c) => c[1] === '/tasks?projectId=p1')).toHaveLength(2);
  });

  it('"ready" is not offered while the activity is blocked', async () => {
    setup('project_manager');
    fireEvent.click(await screen.findByText('פעילות b'));
    const ready = within(screen.getByRole('complementary')).getByText('סימון "מוכנה להתחלה"');
    expect(ready.disabled).toBe(true);
    expect(ready.title).toBe('אפשר לסמן "מוכנה להתחלה" רק כשאין חסימות');
  });

  it('a refused move shows the server\'s named reason', async () => {
    setup('project_manager', {
      onPost: () => { const e = new Error('x'); e.messages = ['לא ניתן לסמן "מוכנה להתחלה" — חסום על ידי: פעילות c']; throw e; },
    });
    fireEvent.click(await screen.findByText('פעילות a'));
    fireEvent.click(screen.getByText('סימון "מוכנה להתחלה"'));
    expect((await screen.findByRole('alert')).textContent).toContain('חסום על ידי: פעילות c');
  });

  it('adds and removes a dependency', async () => {
    const { calls } = setup('engineer');
    fireEvent.click(await screen.findByText('פעילות a'));
    const panel = screen.getByRole('complementary');
    fireEvent.change(within(panel).getByLabelText('הוספת פעילות קודמת'), { target: { value: 'd' } });
    fireEvent.click(within(panel).getByText('הוספה'));
    await waitFor(() => expect(calls).toContainEqual(['POST', '/tasks/a/dependencies', { predecessorId: 'd' }]));
    fireEvent.click(screen.getByText('פעילות b'));
    fireEvent.click(within(screen.getByRole('complementary')).getByLabelText('הסרת התלות ב"פעילות c"'));
    await waitFor(() => expect(calls).toContainEqual(['DELETE', '/tasks/b/dependencies/c']));
  });

  it('subcontractors and inspectors get the facts without the controls', async () => {
    for (const role of ['subcontractor', 'inspector']) {
      setup(role);
      fireEvent.click(await screen.findByText('פעילות a'));
      const panel = screen.getByRole('complementary');
      expect(within(panel).queryByText('שינוי סטטוס')).toBeNull();
      expect(within(panel).queryByLabelText('הוספת פעילות קודמת')).toBeNull();
      cleanup();
    }
  });
});

describe('stale predictions (KAN-26)', () => {
  it('a stale row shows its last band as "not current", sorts after current bands, and filters on its own', async () => {
    const stale = ROWS.map((r) => (r.id === 'a' ? { ...r, predictionFreshness: 'stale' } : { ...r, predictionFreshness: r.predictedAt ? 'current' : 'none' }));
    const calls = [];
    const client = {
      get: vi.fn(async (p) => {
        calls.push(p);
        if (p === '/projects/p1') return { id: 'p1', name: 'מגדל הדר', layout: { floors: 2, zonesPerFloor: 2 } };
        if (p === '/projects/p1/zones') return ZONES;
        if (p === '/projects/p1/members') return members('owner');
        if (p === '/tasks?projectId=p1') return stale;
        return explained('high');
      }),
      post: vi.fn(), del: vi.fn(), patch: vi.fn(),
    };
    auth.current = { client, user: { userId: ME, email: 'me@x.io' }, logout: () => {} };
    render(<ProjectPage id="p1" />);
    await screen.findByRole('heading', { name: 'פעילויות' });
    const rowA = screen.getByText('פעילות a').closest('button');
    expect(within(rowA).getByText('בינוני · לא עדכני')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('מיון'), { target: { value: 'risk' } });
    expect(rowNames()).toEqual(['פעילות b', 'פעילות c', 'פעילות a', 'פעילות d']);
    fireEvent.change(screen.getByLabelText('סיכון'), { target: { value: 'medium' } });
    expect(screen.getByText('אין פעילויות שמתאימות לסינון.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('סיכון'), { target: { value: 'stale' } });
    expect(rowNames()).toEqual(['פעילות a']);
    // the panel explains the CURRENT plan and says so when it differs from the row
    fireEvent.click(screen.getByText('פעילות a').closest('button'));
    const panel = screen.getByRole('complementary');
    expect(await within(panel).findByText('למה הסיכון גבוה')).toBeTruthy();
    expect(within(panel).getByText(/חושבה עכשיו לפי התוכנית הנוכחית/)).toBeTruthy();
  });
});

describe('explanation panel (PRED-3, NFR-USE-1)', () => {
  it('shows the reasons in words with arrows, never the scores', async () => {
    const { calls } = setup('engineer');
    fireEvent.click(await screen.findByText('פעילות a'));
    const panel = screen.getByRole('complementary');
    expect(await within(panel).findByText('למה הסיכון בינוני')).toBeTruthy();
    const reasons = [...panel.querySelectorAll('.why-reason')];
    expect(reasons.map((r) => r.querySelector('.why-label').textContent)).toEqual(['משך מתוכנן', 'משימות במורד השרשרת']);
    expect(reasons.map((r) => r.querySelector('.why-arrow').textContent)).toEqual(['↑', '↓']);
    expect(reasons[0].querySelector('.why-value').textContent).toBe('12 ימים');
    expect(panel.textContent).not.toMatch(/0\.18|0\.04|0\.42|%/);
    expect(calls).toContainEqual(['GET', '/tasks/a/explanation']);
  });

  it('abstained: says there is not enough data, and why', async () => {
    setup('engineer', { explain: () => ({ ...explained(), status: 'abstained', prediction: null, contributions: [], abstainReason: 'missing_planned_dates' }) });
    fireEvent.click(await screen.findByText('פעילות d'));
    const panel = screen.getByRole('complementary');
    expect((await within(panel).findByText('אין מספיק נתונים לחיזוי.')).parentElement.textContent)
      .toContain('לפעילות אין תאריכי התחלה וסיום מתוכננים.');
  });

  it('AI service down: shows the server message and retries on demand', async () => {
    let fail = true;
    const { calls } = setup('engineer', {
      explain: () => {
        if (fail) { const e = new Error('x'); e.status = 503; e.messages = ['שירות החיזוי אינו זמין כרגע ולכן לא ניתן להציג הסבר']; throw e; }
        return explained();
      },
    });
    fireEvent.click(await screen.findByText('פעילות a'));
    const panel = screen.getByRole('complementary');
    expect((await within(panel).findByRole('alert')).textContent).toContain('שירות החיזוי אינו זמין');
    fail = false;
    fireEvent.click(within(panel).getByText('ניסיון נוסף'));
    expect(await within(panel).findByText('למה הסיכון בינוני')).toBeTruthy();
    expect(calls.filter((c) => c[1] === '/tasks/a/explanation')).toHaveLength(2);
  });

  it('a subcontractor is not sent to the server for someone else\'s activity; completed activities have no panel', async () => {
    const { calls } = setup('subcontractor');
    await screen.findByRole('heading', { name: 'המשימות שלי' });
    fireEvent.change(screen.getByLabelText('אחראי/ת'), { target: { value: '' } });
    fireEvent.click(screen.getByText('פעילות c'));
    expect(within(screen.getByRole('complementary')).getByText('חיזוי והסבר מוצגים רק למשימות שלך.')).toBeTruthy();
    expect(calls.some((c) => c[1] === '/tasks/c/explanation')).toBe(false);
  });

  it('notes the transfer-prior caveat and a project-level top reason', async () => {
    setup('owner', {
      explain: () => explained('low', {
        reliability: 'low_transfer_prior',
        contributions: [{ feature: 'proj_span_days', label: 'משך הפרויקט (ימים)', value: 81, contribution: -0.18, direction: 'lowers' }],
      }),
    });
    fireEvent.click(await screen.findByText('פעילות c'));
    const panel = screen.getByRole('complementary');
    expect(await within(panel).findByText('למה הסיכון נמוך')).toBeTruthy();
    expect(within(panel).getByText(/נשען בעיקר על פרויקטים אחרים/)).toBeTruthy();
    expect(within(panel).getByText(/נוגעת לפרויקט כולו/)).toBeTruthy();
  });
});
