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

function setup(myRole, { onPost } = {}) {
  const calls = [];
  let rows = ROWS;
  const client = {
    get: vi.fn(async (p) => {
      calls.push(['GET', p]);
      if (p === '/projects/p1') return { id: 'p1', name: 'מגדל הדר', layout: { floors: 2, zonesPerFloor: 2 } };
      if (p === '/projects/p1/zones') return ZONES;
      if (p === '/projects/p1/members') return members(myRole);
      if (p === '/tasks?projectId=p1') return rows;
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
