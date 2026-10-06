import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ProjectRole } from '../projects/project-member.entity';
import { TaskStatus } from './task.entity';
import { TasksService } from './tasks.service';

/**
 * PRED-5 / NFR-REL-1 (S6, T11): when the AI service is down, POST
 * /tasks/:id/predict answers 503 with an actionable message and the last
 * known prediction marked stale - not a silent 200 with prediction: null.
 */
describe('PRED-5 — prediction refresh with the AI service down', () => {
  const T0 = new Date('2026-09-01T08:00:00Z');
  const PM = ProjectRole.PROJECT_MANAGER;
  let service: TasksService;
  let predictions: { predictProject: jest.Mock };
  let task: Record<string, unknown>;

  beforeEach(() => {
    task = {
      id: 't1', name: 'ריצוף קומה 3', status: TaskStatus.PLANNED,
      project: { id: 'p1' }, assignee: { id: 'u-sub' }, predecessors: [],
      lateProbability: 0.82, riskLevel: 'high', reliability: 'within_project_history',
      modelVersion: 'v5', predictedAt: T0,
    };
    const repo = {
      findOne: jest.fn(async () => task),
      find: jest.fn(async () => [task]),
      save: jest.fn(),
    };
    predictions = { predictProject: jest.fn(async () => null) }; // service unreachable
    service = new TasksService(
      repo as never,
      { findOne: jest.fn() } as never,
      predictions as never,
      { findActiveMembership: jest.fn() } as never,
      { record: jest.fn() } as never,
      { taskAssigned: jest.fn() } as never,
    );
  });

  const errorOf = async (p: Promise<unknown>) => {
    const e = await p.catch((err) => err);
    expect(e).toBeInstanceOf(ServiceUnavailableException);
    return (e as ServiceUnavailableException).getResponse() as Record<string, unknown>;
  };

  it('answers 503 with the last known prediction, marked stale', async () => {
    const body = await errorOf(service.refreshPrediction('t1', PM, 'u-pm'));

    expect(body).toMatchObject({
      statusCode: 503,
      stale: true,
      lastKnown: {
        lateProbability: 0.82, riskLevel: 'high', reliability: 'within_project_history',
        modelVersion: 'v5', predictedAt: T0,
      },
    });
    expect(body.message).toMatch(/אינו זמין/);
  });

  it('answers 503 with lastKnown = null when there was never a prediction', async () => {
    task.predictedAt = null;
    task.lateProbability = null;

    const body = await errorOf(service.refreshPrediction('t1', PM, 'u-pm'));

    expect(body).toMatchObject({ statusCode: 503, stale: true, lastKnown: null });
    expect(body.message).toMatch(/עדיין אין תחזית/);
  });

  it('still refuses a subcontractor someone else\'s task before asking the AI (403, not 503)', async () => {
    await expect(service.refreshPrediction('t1', ProjectRole.SUBCONTRACTOR, 'u-other'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(predictions.predictProject).not.toHaveBeenCalled();
  });

  it('gives the subcontractor their own task\'s last known prediction', async () => {
    const body = await errorOf(service.refreshPrediction('t1', ProjectRole.SUBCONTRACTOR, 'u-sub'));
    expect((body.lastKnown as Record<string, unknown>).lateProbability).toBe(0.82);
  });

  it('answers normally (no 503) when the AI service is up', async () => {
    predictions.predictProject.mockResolvedValue([{
      task_id: 't1', reliability: 'within_project_history', basis: 'cross_project_model',
      prediction: { late_probability: 0.3, risk_level: 'low', model_version: 'v5',
        is_late: false, estimated_delay_days: null, feature_schema_version: '1' },
      note: null,
    }]);

    const res = await service.refreshPrediction('t1', PM, 'u-pm');

    expect(res).toMatchObject({ task: 'ריצוף קומה 3', prediction: { late_probability: 0.3 } });
  });
});
