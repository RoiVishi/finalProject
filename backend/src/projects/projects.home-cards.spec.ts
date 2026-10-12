import { MemberStatus, ProjectRole } from './project-member.entity';
import { projectCardNumbers } from './project-card';
import { ProjectsService } from './projects.service';
import { TaskStatus } from '../tasks/task.entity';

/**
 * DASH-5 (KAN-52) home-screen cards: myRole, riskIndex (+ riskScope) and
 * blockedCount on GET /projects - each equal to what the tasks themselves say.
 */
const T0 = new Date('2026-09-01T08:00:00Z');
const done = { id: 'pre-done', name: 'שלד', status: TaskStatus.COMPLETED };
const open = { id: 'pre-open', name: 'חשמל', status: TaskStatus.IN_PROGRESS };
const predicted = (p: number) => ({ lateProbability: p, predictedAt: T0, lastPredictionOutcome: 'stored' as const });

const PM = { userId: 'u-pm', role: ProjectRole.PROJECT_MANAGER };
const SUB = { userId: 'u-sub', role: ProjectRole.SUBCONTRACTOR };

describe('projectCardNumbers', () => {
  const tasks = [
    { status: TaskStatus.PLANNED, assignee: { id: 'u-sub' }, predecessors: [open], ...predicted(0.8) },
    { status: TaskStatus.READY, assignee: { id: 'u-x' }, predecessors: [done], ...predicted(0.4) },
    { status: TaskStatus.IN_PROGRESS, assignee: { id: 'u-x' }, predecessors: [open], ...predicted(0.3) },
    // completed: neither in the index nor counted as blocked, even with an open predecessor
    { status: TaskStatus.COMPLETED, assignee: { id: 'u-x' }, predecessors: [open], ...predicted(0.99) },
  ];

  it('riskIndex is the mean over open activities with a current prediction', () => {
    expect(projectCardNumbers(tasks, PM).riskIndex).toBeCloseTo((0.8 + 0.4 + 0.3) / 3);
  });

  it('blockedCount counts open activities waiting on an unfinished predecessor', () => {
    expect(projectCardNumbers(tasks, PM).blockedCount).toBe(2);
  });

  it('leaves abstained activities out of the index (PRED-10)', () => {
    const withAbstained = [...tasks, {
      status: TaskStatus.PLANNED, predecessors: [], lateProbability: 0.0,
      predictedAt: T0, lastPredictionOutcome: 'abstained' as const,
    }];
    expect(projectCardNumbers(withAbstained, PM).riskIndex).toBeCloseTo((0.8 + 0.4 + 0.3) / 3);
  });

  it('is null when no open activity has a prediction', () => {
    const none = [{ status: TaskStatus.PLANNED, predecessors: [], lateProbability: null, predictedAt: null }];
    expect(projectCardNumbers(none, PM)).toEqual({ riskIndex: null, riskScope: 'project', blockedCount: 0 });
  });

  it('a subcontractor gets the mean over their own tasks only, scope "own"', () => {
    expect(projectCardNumbers(tasks, SUB)).toMatchObject({ riskIndex: 0.8, riskScope: 'own' });
  });

  it('a subcontractor with no own predicted task gets null, not the project mean', () => {
    expect(projectCardNumbers(tasks, { userId: 'u-nobody', role: ProjectRole.SUBCONTRACTOR }).riskIndex)
      .toBeNull();
  });
});

describe('GET /projects — card fields per project', () => {
  it('adds myRole and the card numbers computed from that project\'s own tasks', async () => {
    const members = {
      listForUser: jest.fn(async () => [
        { role: ProjectRole.OWNER, status: MemberStatus.ACTIVE, project: { id: 'p1', name: 'מגדל', deletedAt: null } },
        { role: ProjectRole.SUBCONTRACTOR, status: MemberStatus.ACTIVE, project: { id: 'p2', name: 'בית', deletedAt: null } },
      ]),
    };
    const tasks = {
      find: jest.fn(async () => [
        { project: { id: 'p1' }, status: TaskStatus.PLANNED, assignee: null, predecessors: [open], ...predicted(0.6) },
        { project: { id: 'p1' }, status: TaskStatus.PLANNED, assignee: null, predecessors: [], ...predicted(0.2) },
        { project: { id: 'p2' }, status: TaskStatus.PLANNED, assignee: { id: 'u-me' }, predecessors: [], ...predicted(0.9) },
        { project: { id: 'p2' }, status: TaskStatus.PLANNED, assignee: { id: 'u-x' }, predecessors: [open], ...predicted(0.1) },
      ]),
    };
    const service = new ProjectsService(
      { findOne: jest.fn() } as never, tasks as never, members as never, {} as never,
    );

    const cards = await service.findAllForUser('u-me');

    expect(tasks.find).toHaveBeenCalledTimes(1);       // one query for all projects
    expect(cards).toEqual([
      expect.objectContaining({ id: 'p1', myRole: ProjectRole.OWNER, riskIndex: 0.4, riskScope: 'project', blockedCount: 1 }),
      expect.objectContaining({ id: 'p2', myRole: ProjectRole.SUBCONTRACTOR, riskIndex: 0.9, riskScope: 'own', blockedCount: 1 }),
    ]);
  });

  it('runs no task query for a user with no projects', async () => {
    const tasks = { find: jest.fn() };
    const service = new ProjectsService(
      {} as never, tasks as never, { listForUser: jest.fn(async () => []) } as never, {} as never,
    );
    expect(await service.findAllForUser('u-new')).toEqual([]);
    expect(tasks.find).not.toHaveBeenCalled();
  });
});
