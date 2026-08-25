import { ForbiddenException } from '@nestjs/common';
import { ProjectRole } from '../projects/project-member.entity';
import { TasksService } from './tasks.service';

/**
 * AUTH-2 acceptance criterion: "subcontractors see risk predictions and
 * explanations for own tasks only". The matrix cannot express a row-level
 * scope, so it is enforced here — and tested here.
 */
describe('AUTH-2 — subcontractor prediction scoping', () => {
  let service: TasksService;
  let repo: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock; create: jest.Mock };
  let predictions: { predictProject: jest.Mock };

  const task = (assigneeId: string | null) => ({
    id: 't1',
    name: 'ריצוף קומה 3',
    project: { id: 'p1' },
    assignee: assigneeId ? { id: assigneeId } : null,
  });

  beforeEach(() => {
    repo = {
      findOne: jest.fn(),
      find: jest.fn(async () => []), // empty project → refresh returns early
      save: jest.fn(),
      create: jest.fn(),
    };
    predictions = { predictProject: jest.fn() };
    service = new TasksService(repo as never, predictions as never);
  });

  it('refuses a subcontractor the prediction of a task assigned to someone else', async () => {
    repo.findOne.mockResolvedValue(task('u-other'));

    await expect(
      service.refreshPrediction('t1', ProjectRole.SUBCONTRACTOR, 'u-sub'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(predictions.predictProject).not.toHaveBeenCalled();
  });

  it('refuses a subcontractor a task with no assignee at all', async () => {
    repo.findOne.mockResolvedValue(task(null));

    await expect(
      service.refreshPrediction('t1', ProjectRole.SUBCONTRACTOR, 'u-sub'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a subcontractor the prediction of their own task', async () => {
    repo.findOne.mockResolvedValue(task('u-sub'));

    await expect(
      service.refreshPrediction('t1', ProjectRole.SUBCONTRACTOR, 'u-sub'),
    ).resolves.toEqual(expect.objectContaining({ task: 'ריצוף קומה 3' }));
  });

  it('does not scope an engineer to own tasks', async () => {
    repo.findOne.mockResolvedValue(task('u-other'));

    await expect(
      service.refreshPrediction('t1', ProjectRole.ENGINEER, 'u-eng'),
    ).resolves.toEqual(expect.objectContaining({ task: 'ריצוף קומה 3' }));
  });
});
