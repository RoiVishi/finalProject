import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ProjectRole } from '../projects/project-member.entity';
import { TaskStatus } from './task.entity';
import { TasksService } from './tasks.service';

/**
 * PRED-3 through the platform (KAN-40, sprint 8 T25): GET /tasks/:id/explanation.
 * The backend sends the raw project graph (PRED-9) and maps the answer into
 * domain language; a subcontractor sees explanations for own tasks only (AUTH-2).
 */
describe('KAN-40 — activity explanation through the backend', () => {
  const PM = ProjectRole.PROJECT_MANAGER;
  let service: TasksService;
  let predictions: { explainProject: jest.Mock; predictProject: jest.Mock };
  let a: Record<string, unknown>;
  let b: Record<string, unknown>;

  const explained = {
    task_id: 'b', reliability: 'within_project_history', basis: 'cross_project_model',
    risk_level: 'high', abstain_reason: null, note: 'model v6',
    explanation: {
      prediction: { late_probability: 0.71, is_late: true, risk_level: 'high',
        estimated_delay_days: null, model_version: 'v6', feature_schema_version: '1' },
      base_probability: 0.4,
      contribution_space: 'calibrated_probability',
      note: '',
      top_contributions: [
        { feature: 'planned_duration_days', label_en: 'Planned duration (days)',
          label_he: 'משך מתוכנן (ימים)', value: 21, contribution: 0.25 },
        { feature: 'n_pred', label_en: 'Direct predecessors',
          label_he: 'משימות קדם ישירות', value: 1, contribution: -0.04 },
      ],
    },
  };

  beforeEach(() => {
    a = { id: 'a', name: 'יציקת יסודות', status: TaskStatus.COMPLETED, project: { id: 'p1' },
      plannedStart: '2026-01-01', plannedEnd: '2026-01-10', assignee: { id: 'u-other' }, predecessors: [] };
    b = { id: 'b', name: 'ריצוף קומה 3', status: TaskStatus.PLANNED, project: { id: 'p1' },
      plannedStart: '2026-01-11', plannedEnd: '2026-02-01', assignee: { id: 'u-sub' }, predecessors: [a] };
    const repo = {
      findOne: jest.fn(async ({ where }: { where: { id: string } }) => (where.id === 'a' ? a : b)),
      find: jest.fn(async () => [a, b]),
      save: jest.fn(),
    };
    predictions = { explainProject: jest.fn(async () => [explained]), predictProject: jest.fn() };
    service = new TasksService(
      repo as never,
      { findOne: jest.fn() } as never,
      predictions as never,
      { findActiveMembership: jest.fn() } as never,
      { record: jest.fn() } as never,
      { taskAssigned: jest.fn() } as never,
    );
  });

  it('sends the raw graph of the whole project, never a feature (PRED-9)', async () => {
    await service.explain('b', { userId: 'u-pm', role: PM });

    const [payload, ids, topK] = predictions.explainProject.mock.calls[0];
    expect(ids).toEqual(['b']);
    expect(topK).toBe(5);
    expect(payload).toEqual({
      project: { completed_share: 0.5 },
      tasks: [
        { id: 'a', planned_start: '2026-01-01', planned_finish: '2026-01-10', type: 'task' },
        { id: 'b', planned_start: '2026-01-11', planned_finish: '2026-02-01', type: 'task' },
      ],
      dependencies: [{ predecessor_id: 'a', successor_id: 'b' }],
    });
  });

  it('returns signed contributions in domain language, never a bare score (PRED-3)', async () => {
    const res = await service.explain('b', { userId: 'u-pm', role: PM });

    expect(res).toMatchObject({
      taskId: 'b', name: 'ריצוף קומה 3', status: 'explained',
      prediction: { lateProbability: 0.71, riskLevel: 'high', modelVersion: 'v6' },
      baseProbability: 0.4,
    });
    expect(res.contributions).toEqual([
      { feature: 'planned_duration_days', label: 'משך מתוכנן (ימים)',
        labelEn: 'Planned duration (days)', value: 21, contribution: 0.25, direction: 'raises' },
      { feature: 'n_pred', label: 'משימות קדם ישירות',
        labelEn: 'Direct predecessors', value: 1, contribution: -0.04, direction: 'lowers' },
    ]);
  });

  it('says "abstained" with the reason when the AI service withholds the prediction', async () => {
    predictions.explainProject.mockResolvedValue([{
      task_id: 'b', reliability: 'low_transfer_prior', explanation: null, risk_level: 'unknown',
      abstain_reason: 'low_project_history', note: 'too little project history',
    }]);

    const res = await service.explain('b', { userId: 'u-pm', role: PM });

    expect(res).toMatchObject({
      status: 'abstained', prediction: null, contributions: [],
      abstainReason: 'low_project_history', reliability: 'low_transfer_prior',
    });
  });

  it('gives a subcontractor the explanation of their own task', async () => {
    const res = await service.explain('b', { userId: 'u-sub', role: ProjectRole.SUBCONTRACTOR });
    expect(res.status).toBe('explained');
  });

  it("refuses a subcontractor someone else's task, before asking the AI (AUTH-2)", async () => {
    await expect(service.explain('a', { userId: 'u-sub', role: ProjectRole.SUBCONTRACTOR }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(predictions.explainProject).not.toHaveBeenCalled();
  });

  it('answers 503 when the AI service is down (NFR-REL-1)', async () => {
    predictions.explainProject.mockResolvedValue(null);
    await expect(service.explain('b', { userId: 'u-pm', role: PM }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
