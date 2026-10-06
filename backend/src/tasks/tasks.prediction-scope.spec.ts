import { ProjectRole } from '../projects/project-member.entity';
import { PREDICTION_FIELDS, scopeTaskForViewer } from './prediction-scope';
import { TaskStatus } from './task.entity';
import { TasksService } from './tasks.service';

/**
 * AUTH-2 / KAN-128: "subcontractors see risk predictions and explanations for
 * own tasks only" — on every route that returns tasks, not only on predict.
 */
describe('AUTH-2 — prediction fields scoped on task reads (KAN-128)', () => {
  const SUB = { userId: 'u-sub', role: ProjectRole.SUBCONTRACTOR };
  const PM = { userId: 'u-pm', role: ProjectRole.PROJECT_MANAGER };
  const PREDICTION = {
    lateProbability: 0.82, riskLevel: 'high', reliability: 'within_project_history',
    modelVersion: 'v5', predictedAt: new Date('2026-09-01T08:00:00Z'),
  };

  let service: TasksService;
  let rows: Record<string, Record<string, unknown>>;
  let repo: { find: jest.Mock; findOne: jest.Mock };

  beforeEach(() => {
    // A is the subcontractor's task; B belongs to someone else and A waits for B.
    const B = { id: 'B', name: 'חשמל', status: TaskStatus.IN_PROGRESS,
      assignee: { id: 'u-elec' }, predecessors: [], ...PREDICTION };
    const A = { id: 'A', name: 'ריצוף', status: TaskStatus.PLANNED,
      assignee: { id: 'u-sub' }, predecessors: [B], ...PREDICTION };
    rows = { A, B };
    repo = {
      find: jest.fn(async () => [A, B]),
      findOne: jest.fn(async ({ where }: { where: { id: string } }) => rows[where.id] ?? null),
    };
    service = new TasksService(
      repo as never,
      { findOne: jest.fn() } as never,
      { predictProject: jest.fn() } as never,
      { findActiveMembership: jest.fn() } as never,
      { record: jest.fn() } as never,
      { taskAssigned: jest.fn() } as never,
    );
  });

  const hasNoPrediction = (t: Record<string, unknown>) =>
    PREDICTION_FIELDS.every((f) => !(f in t));

  it('GET /tasks — a subcontractor sees the prediction of their own task only', async () => {
    const list = await service.findByProject('p1', SUB);
    const a = list.find((t) => t.id === 'A') as Record<string, unknown>;
    const b = list.find((t) => t.id === 'B') as Record<string, unknown>;

    expect(a).toMatchObject({ lateProbability: 0.82, riskLevel: 'high' });
    expect(hasNoPrediction(b)).toBe(true);
    expect(b).toMatchObject({ id: 'B', name: 'חשמל' });   // the task itself stays visible
  });

  it('GET /tasks — B does not leak through A\'s embedded predecessors either', async () => {
    const list = await service.findByProject('p1', SUB);
    const a = list.find((t) => t.id === 'A') as unknown as { predecessors: Record<string, unknown>[] };

    expect(a.predecessors).toHaveLength(1);
    expect(hasNoPrediction(a.predecessors[0])).toBe(true);
  });

  it('GET /tasks/:id — someone else\'s task comes back without prediction fields (not 403)', async () => {
    const b = await service.findOne('B', SUB) as Record<string, unknown>;

    expect(b).toMatchObject({ id: 'B', blocked: false });
    expect(hasNoPrediction(b)).toBe(true);
  });

  it('a project manager sees both predictions', async () => {
    const list = await service.findByProject('p1', PM) as Record<string, unknown>[];

    expect(list.map((t) => t.lateProbability)).toEqual([0.82, 0.82]);
    expect((await service.findOne('B', PM) as Record<string, unknown>).lateProbability).toBe(0.82);
  });

  it('never mutates the entity it scopes', async () => {
    await service.findByProject('p1', SUB);
    expect(rows.B.lateProbability).toBe(0.82);
  });
});

describe('scopeTaskForViewer', () => {
  const SUB = { userId: 'u-sub', role: ProjectRole.SUBCONTRACTOR };

  it('fails closed when the assignee was not loaded', () => {
    const scoped = scopeTaskForViewer({ id: 'X', lateProbability: 0.5 } as never, SUB);
    expect(scoped).not.toHaveProperty('lateProbability');
  });

  it('withholds from a subcontractor a task with no assignee', () => {
    const scoped = scopeTaskForViewer({ id: 'X', assignee: null, riskLevel: 'low' } as never, SUB);
    expect(scoped).not.toHaveProperty('riskLevel');
  });

  it('leaves every other role untouched', () => {
    for (const role of [ProjectRole.OWNER, ProjectRole.ENGINEER, ProjectRole.INSPECTOR]) {
      const scoped = scopeTaskForViewer(
        { id: 'X', assignee: { id: 'someone' }, lateProbability: 0.4 } as never,
        { userId: 'u', role },
      ) as Record<string, unknown>;
      expect(scoped.lateProbability).toBe(0.4);
    }
  });
});
