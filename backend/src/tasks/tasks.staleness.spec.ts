import { ServiceUnavailableException } from '@nestjs/common';
import { ProjectRole } from '../projects/project-member.entity';
import { predictionFreshness } from './prediction-freshness';
import { TaskStatus } from './task.entity';
import { TasksService } from './tasks.service';

/**
 * TASK-5 / KAN-26 acceptance: "a prediction is flagged stale when the
 * activity's dates, dependencies or required documents changed after
 * predictedAt", and the cache is "refreshed on schedule, dependency change
 * and on demand". Required documents do not exist yet (DOC epic).
 */
const T0 = new Date('2026-09-01T08:00:00Z');
const PM = { userId: 'u-pm', role: ProjectRole.PROJECT_MANAGER };
const SUB = { userId: 'u-sub', role: ProjectRole.SUBCONTRACTOR };

const stored = (over: Record<string, unknown> = {}) => ({
  status: TaskStatus.PLANNED,
  project: { id: 'p1' },
  predecessors: [] as unknown[],
  assignee: null as { id: string } | null,
  zone: null,
  plannedStart: '2026-11-10',
  plannedEnd: '2026-11-20',
  lateProbability: 0.7,
  riskLevel: 'high',
  modelVersion: 'v6',
  reliability: 'within_project_history',
  predictionBasis: 'cross_project_model',
  predictedAt: T0,
  lastPredictionAttemptAt: T0,
  lastPredictionOutcome: 'stored',
  predictionInputsChangedAt: null as Date | null,
  ...over,
});

describe('predictionFreshness (KAN-26)', () => {
  it('is current when nothing changed after predictedAt', () => {
    expect(predictionFreshness(stored() as never)).toBe('current');
    expect(predictionFreshness(stored({
      predictionInputsChangedAt: new Date(T0.getTime() - 1000),
    }) as never)).toBe('current');
  });

  it('is stale when an input changed after predictedAt', () => {
    expect(predictionFreshness(stored({
      predictionInputsChangedAt: new Date(T0.getTime() + 1000),
    }) as never)).toBe('stale');
  });

  it('keeps abstained and none ahead of stale', () => {
    const later = new Date(T0.getTime() + 1000);
    expect(predictionFreshness(stored({
      lastPredictionOutcome: 'abstained', predictionInputsChangedAt: later,
    }) as never)).toBe('abstained');
    expect(predictionFreshness(stored({
      predictedAt: null, lastPredictionOutcome: null, predictionInputsChangedAt: later,
    }) as never)).toBe('none');
  });
});

describe('TASK-5 — staleness and project-level predictions (KAN-26)', () => {
  let rows: Record<string, ReturnType<typeof stored> & { id: string; name: string }>;
  let repo: Record<string, jest.Mock>;
  let predictions: { predictProject: jest.Mock };
  let service: TasksService;
  const env = { ...process.env };

  const build = () => new TasksService(
    repo as never,
    { findOne: jest.fn(async () => ({ id: 'p1', layout: null })), find: jest.fn(async () => [{ id: 'p1' }]) } as never,
    predictions as never,
    { findActiveMembership: jest.fn() } as never,
    { record: jest.fn() } as never,
    { taskAssigned: jest.fn() } as never,
  );

  beforeEach(() => {
    process.env.PREDICTION_REFRESH_DELAY_MS = '-1';
    process.env.PREDICTION_REFRESH_INTERVAL_HOURS = '0';
    rows = {
      a: { id: 'a', name: 'שלד', ...stored({ assignee: { id: 'u-sub' } }) },
      b: { id: 'b', name: 'חשמל', ...stored({ lateProbability: 0.2, riskLevel: 'low' }) },
    };
    repo = {
      find: jest.fn(async () => Object.values(rows)),
      findOne: jest.fn(async ({ where }) => rows[where.id] ?? null),
      save: jest.fn(async (d) => d),
      update: jest.fn(async (id, patch) => Object.assign(rows[id], patch)),
      create: jest.fn((d) => d),
      remove: jest.fn(),
    };
    predictions = { predictProject: jest.fn() };
    service = build();
  });

  afterEach(() => {
    service.onModuleDestroy();
    process.env = { ...env };
    jest.useRealTimers();
  });

  it('marks the activity stale when its planned dates move', async () => {
    await service.update('b', { plannedEnd: '2026-11-25' } as never, PM);
    expect(predictionFreshness(rows.b as never)).toBe('stale');
  });

  it('does not mark it stale for an edit that is not a model input', async () => {
    await service.update('b', { name: 'חשמל קומה 3' } as never, PM);
    expect(rows.b.predictionInputsChangedAt).toBeNull();
    expect(predictionFreshness(rows.b as never)).toBe('current');
  });

  it('marks both ends of a new dependency stale', async () => {
    await service.addDependency('b', 'a', PM);
    expect(predictionFreshness(rows.b as never)).toBe('stale');
    expect(predictionFreshness(rows.a as never)).toBe('stale');
  });

  it('marks both ends stale when a dependency is removed', async () => {
    rows.b.predecessors = [rows.a];
    await service.removeDependency('b', 'a', PM);
    expect(predictionFreshness(rows.b as never)).toBe('stale');
    expect(predictionFreshness(rows.a as never)).toBe('stale');
  });

  it('is current again once a refresh stores a new number', async () => {
    await service.update('b', { plannedEnd: '2026-11-25' } as never, PM);
    await new Promise((r) => setTimeout(r, 5));
    predictions.predictProject.mockResolvedValue([{
      task_id: 'b', reliability: 'within_project_history', basis: 'cross_project_model',
      prediction: { late_probability: 0.4, risk_level: 'medium', model_version: 'v6' },
    }]);
    await service.refreshProjectPredictions('p1');
    expect(predictionFreshness(rows.b as never)).toBe('current');
    expect(rows.b.lateProbability).toBe(0.4);
  });

  it('GET project predictions: all activities with freshness for a manager', async () => {
    rows.b.predictionInputsChangedAt = new Date(T0.getTime() + 1000);
    const view = await service.projectPredictions('p1', PM);
    expect(view.scope).toBe('project');
    expect(view.predictions.map((p) => [p.taskId, p.freshness])).toEqual([
      ['a', 'current'], ['b', 'stale'],
    ]);
    expect(predictions.predictProject).not.toHaveBeenCalled();   // reads the cache only
  });

  it('GET project predictions: a subcontractor sees only their own activities (AUTH-2)', async () => {
    const view = await service.projectPredictions('p1', SUB);
    expect(view.scope).toBe('own');
    expect(view.predictions.map((p) => p.taskId)).toEqual(['a']);
  });

  it('refresh on demand answers 503 with the last numbers when the AI service is down', async () => {
    predictions.predictProject.mockResolvedValue(null);
    const err = await service.refreshProjectPredictionsFor('p1', PM).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    const body = err.getResponse();
    expect(body.stale).toBe(true);
    expect(body.lastKnown.predictions).toHaveLength(2);
  });

  it('coalesces a burst of edits into one recompute per project', async () => {
    jest.useFakeTimers();
    process.env.PREDICTION_REFRESH_DELAY_MS = '3000';
    service = build();
    predictions.predictProject.mockResolvedValue([]);

    await service.update('b', { plannedEnd: '2026-11-25' } as never, PM);
    await service.update('b', { plannedEnd: '2026-11-26' } as never, PM);
    await service.addDependency('b', 'a', PM);
    expect(predictions.predictProject).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(3000);
    expect(predictions.predictProject).toHaveBeenCalledTimes(1);
  });

  it('the scheduled pass refreshes every live project', async () => {
    predictions.predictProject.mockResolvedValue([]);
    await service.refreshAllProjects();
    expect(predictions.predictProject).toHaveBeenCalledTimes(1);
  });
});
