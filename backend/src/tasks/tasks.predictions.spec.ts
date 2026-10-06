import { TaskStatus } from './task.entity';
import { TasksService } from './tasks.service';
import { predictionFreshness } from './prediction-freshness';

/**
 * TASK-5 / KAN-127: predictedAt moves only when a valid prediction is stored.
 * An abstention must never make an old number look as if it was computed now.
 */
describe('TASK-5 — cached prediction timestamps (KAN-127)', () => {
  const T0 = new Date('2026-09-01T08:00:00Z');
  let service: TasksService;
  let repo: { find: jest.Mock; save: jest.Mock };
  let predictions: { predictProject: jest.Mock };
  let row: Record<string, unknown>;

  beforeEach(() => {
    row = {
      id: 't1',
      status: TaskStatus.PLANNED,
      predecessors: [],
      lateProbability: 0.82,
      riskLevel: 'high',
      modelVersion: 'v4',
      reliability: 'within_project_history',
      predictionBasis: 'cross_project_model',
      predictedAt: T0,
      lastPredictionAttemptAt: T0,
      lastPredictionOutcome: 'stored',
    };
    repo = { find: jest.fn(async () => [row]), save: jest.fn() };
    predictions = { predictProject: jest.fn() };
    service = new TasksService(
      repo as never,
      { findOne: jest.fn() } as never,
      predictions as never,
      { findActiveMembership: jest.fn() } as never,
      { record: jest.fn() } as never,
      { taskAssigned: jest.fn() } as never,
    );
  });

  it('keeps predictedAt and the old number when the AI service abstains', async () => {
    predictions.predictProject.mockResolvedValue([{
      task_id: 't1', reliability: 'low_transfer_prior', basis: 'cross_project_model',
      prediction: null, note: 'below threshold',
    }]);

    const { updated } = await service.refreshProjectPredictions('p1');

    expect(updated).toBe(0);
    expect(row.predictedAt).toBe(T0);
    expect((row.lastPredictionAttemptAt as Date).getTime()).toBeGreaterThan(T0.getTime());
    expect(row).toMatchObject({
      lateProbability: 0.82, modelVersion: 'v4',
      reliability: 'within_project_history',   // describes the 0.82, not the abstention
      lastPredictionOutcome: 'abstained',
    });
    expect(predictionFreshness(row as never)).toBe('abstained');  // never rendered as a fresh 82%
    expect(repo.save).toHaveBeenCalledWith(row);
  });

  it('stamps predictedAt, reliability and basis when a prediction is stored', async () => {
    predictions.predictProject.mockResolvedValue([{
      task_id: 't1', reliability: 'low_transfer_prior', basis: 'cross_project_model',
      prediction: { late_probability: 0.31, risk_level: 'low', model_version: 'v5',
        is_late: false, estimated_delay_days: null, feature_schema_version: '1' },
      note: null,
    }]);

    const { updated } = await service.refreshProjectPredictions('p1');

    expect(updated).toBe(1);
    expect((row.predictedAt as Date).getTime()).toBeGreaterThan(T0.getTime());
    expect(row.predictedAt).toBe(row.lastPredictionAttemptAt);
    expect(row).toMatchObject({
      lateProbability: 0.31, riskLevel: 'low', modelVersion: 'v5',
      reliability: 'low_transfer_prior', predictionBasis: 'cross_project_model',
      lastPredictionOutcome: 'stored',
    });
    expect(predictionFreshness(row as never)).toBe('current');
  });

  it('touches nothing when the AI service is unreachable', async () => {
    predictions.predictProject.mockResolvedValue(null);

    await service.refreshProjectPredictions('p1');

    expect(row.predictedAt).toBe(T0);
    expect(row.lastPredictionAttemptAt).toBe(T0);
    expect(repo.save).not.toHaveBeenCalled();
  });
});

describe('predictionFreshness', () => {
  it('is "none" before any prediction was stored', () => {
    expect(predictionFreshness({ predictedAt: null, lastPredictionOutcome: null } as never)).toBe('none');
  });

  it('is "abstained" even when no older number exists', () => {
    expect(predictionFreshness({ predictedAt: null, lastPredictionOutcome: 'abstained' } as never))
      .toBe('abstained');
  });

  it('treats rows cached before KAN-127 (no outcome yet) as current', () => {
    expect(predictionFreshness({ predictedAt: new Date(), lastPredictionOutcome: null } as never))
      .toBe('current');
  });
});
