import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { buildLayout } from '../projects/layout';
import { ProjectRole } from '../projects/project-member.entity';
import { TasksService } from './tasks.service';
import { TaskStatus, TradeCategory } from './task.entity';

const ACTOR = { userId: 'u-pm', role: ProjectRole.PROJECT_MANAGER };
const PROJECT = 'p1';

describe('TASK-2 — activity CRUD', () => {
  let service: TasksService;
  let repo: { create: jest.Mock; save: jest.Mock; find: jest.Mock; findOne: jest.Mock; remove: jest.Mock };
  let projects: { findOne: jest.Mock };
  let members: { findActiveMembership: jest.Mock };
  let activity: { record: jest.Mock };
  let notifications: { taskAssigned: jest.Mock };
  /** the row requireTask() resolves */
  let stored: Record<string, unknown>;

  const dto = (over: Record<string, unknown> = {}) => ({
    projectId: PROJECT, name: 'ריצוף קומה 3', ...over,
  }) as never;

  beforeEach(() => {
    stored = {
      id: 't1',
      name: 'ריצוף קומה 3',
      status: TaskStatus.PLANNED,
      project: { id: PROJECT },
      assignee: null,
      predecessors: [],
      plannedStart: '2026-09-01',
      plannedEnd: '2026-09-10',
      actualStart: null,
      actualEnd: null,
    };

    repo = {
      create: jest.fn((d) => d),
      save: jest.fn(async (d) => ({ id: 't1', ...d })),
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => stored),
      remove: jest.fn(),
    };
    projects = {
      findOne: jest.fn(async () => ({
        id: PROJECT, deletedAt: null, layout: buildLayout({ floors: 3, zonesPerFloor: 2 }),
      })),
    };
    members = { findActiveMembership: jest.fn(async () => ({ role: ProjectRole.SUBCONTRACTOR })) };
    activity = { record: jest.fn() };
    notifications = { taskAssigned: jest.fn() };

    service = new TasksService(
      repo as never, projects as never, { predictProject: jest.fn() } as never,
      members as never, activity as never, notifications as never,
    );
  });

  describe('create', () => {
    it('stores the planning fields and starts the activity as PLANNED', async () => {
      await service.create(dto({
        description: ' יציקה ', trade: TradeCategory.FINISHING,
        zone: 'floor-3/zone-2', estimatedDurationDays: 4,
      }), ACTOR);

      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({
        name: 'ריצוף קומה 3',
        description: 'יציקה',
        trade: TradeCategory.FINISHING,
        zone: 'floor-3/zone-2',
        estimatedDurationDays: 4,
        status: TaskStatus.PLANNED,
      }));
    });

    it('refuses a zone the building does not have (TASK-1 owns the layout)', async () => {
      await expect(service.create(dto({ zone: 'floor-9/zone-1' }), ACTOR))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('refuses to attach an activity to a deleted project', async () => {
      projects.findOne.mockResolvedValueOnce(null);

      await expect(service.create(dto(), ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a planned finish before the planned start', async () => {
      await expect(service.create(
        dto({ plannedStart: '2026-09-10', plannedEnd: '2026-09-01' }), ACTOR,
      )).rejects.toBeInstanceOf(BadRequestException);
    });

    it('assigns only project members, and notifies the one it assigns', async () => {
      await service.create(dto({ assigneeId: 'u-sub' }), ACTOR);

      expect(members.findActiveMembership).toHaveBeenCalledWith(PROJECT, 'u-sub');
      expect(notifications.taskAssigned).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-sub', taskName: 'ריצוף קומה 3' }),
      );
    });

    it('refuses an assignee who is not an active member', async () => {
      members.findActiveMembership.mockResolvedValueOnce(null);

      await expect(service.create(dto({ assigneeId: 'u-stranger' }), ACTOR))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('notifies nobody when the activity is created unassigned', async () => {
      await service.create(dto(), ACTOR);

      expect(notifications.taskAssigned).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('edits planning fields without touching the status', async () => {
      await service.update('t1', { name: 'ריצוף מעודכן' } as never, ACTOR);

      const saved = repo.save.mock.calls[0][0];
      expect(saved.name).toBe('ריצוף מעודכן');
      expect(saved.status).toBe(TaskStatus.PLANNED);
    });

    it('does not audit a plan change made before work started', async () => {
      await service.update('t1', { plannedEnd: '2026-09-20' } as never, ACTOR);

      expect(activity.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'task.plan_dates_changed_after_start' }),
      );
    });

    it('audits a plan change made after execution started, with both dates', async () => {
      stored.actualStart = '2026-09-02';
      stored.status = TaskStatus.IN_PROGRESS;

      await service.update('t1', { plannedEnd: '2026-09-25' } as never, ACTOR);

      expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'task.plan_dates_changed_after_start',
        actorId: 'u-pm',
        before: { plannedStart: '2026-09-01', plannedEnd: '2026-09-10' },
        after: { plannedStart: '2026-09-01', plannedEnd: '2026-09-25' },
      }));
    });

    it('notifies a newly assigned member, and only on a real change', async () => {
      stored.assignee = { id: 'u-sub' };

      await service.update('t1', { assigneeId: 'u-sub' } as never, ACTOR);
      expect(notifications.taskAssigned).not.toHaveBeenCalled();

      await service.update('t1', { assigneeId: 'u-other' } as never, ACTOR);
      expect(notifications.taskAssigned).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-other' }),
      );
    });
  });

  describe('changeStatus', () => {
    it('marks an activity ready when every predecessor is completed', async () => {
      stored.predecessors = [{ id: 'p', name: 'חשמל', status: TaskStatus.COMPLETED }];

      const saved = await service.changeStatus('t1', TaskStatus.READY, ACTOR);

      expect(saved.status).toBe(TaskStatus.READY);
    });

    it('refuses "ready" while a predecessor is unfinished, and names it', async () => {
      stored.predecessors = [{ id: 'p', name: 'שלד קומה 3', status: TaskStatus.IN_PROGRESS }];

      const attempt = service.changeStatus('t1', TaskStatus.READY, ACTOR);

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(/שלד קומה 3/);
    });

    it('rejects an illegal jump straight to completed', async () => {
      await expect(service.changeStatus('t1', TaskStatus.COMPLETED, ACTOR))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('stamps the actual start when work begins', async () => {
      stored.status = TaskStatus.READY;

      const saved = await service.changeStatus('t1', TaskStatus.IN_PROGRESS, ACTOR);

      expect(saved.actualStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('keeps an actual start the assignee already reported', async () => {
      stored.status = TaskStatus.READY;
      stored.actualStart = '2026-09-02';

      const saved = await service.changeStatus('t1', TaskStatus.IN_PROGRESS, ACTOR);

      expect(saved.actualStart).toBe('2026-09-02');
    });

    it('stamps the actual finish on completion and records the move', async () => {
      stored.status = TaskStatus.IN_PROGRESS;

      const saved = await service.changeStatus('t1', TaskStatus.COMPLETED, ACTOR);

      expect(saved.actualEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(activity.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'task.status_changed' }),
      );
    });
  });

  describe('read — blocking is computed, never stored', () => {
    it('reports the unfinished predecessors of an activity', async () => {
      stored.predecessors = [
        { id: 'a', name: 'שלד', status: TaskStatus.COMPLETED },
        { id: 'b', name: 'חשמל', status: TaskStatus.PLANNED },
      ];

      const task = await service.findOne('t1');

      expect(task).toMatchObject({ blocked: true, blockingTasks: ['חשמל'] });
    });

    it('reports an activity with no open predecessors as free to start', async () => {
      expect(await service.findOne('t1')).toMatchObject({ blocked: false, blockingTasks: [] });
    });

    it('404s on an activity that does not exist', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      await expect(service.findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('delete', () => {
    it('deletes an activity nobody depends on', async () => {
      await service.remove('t1', ACTOR);

      expect(repo.remove).toHaveBeenCalled();
    });

    it('refuses to delete one that others depend on, and names them', async () => {
      repo.find.mockResolvedValueOnce([{ id: 't2', name: 'ריצוף' }]);

      const attempt = service.remove('t1', ACTOR);

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(/ריצוף/);
    });

    it.each([TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED])(
      'refuses to delete an activity that is %s — that is execution history',
      async (status) => {
        stored.status = status;

        await expect(service.remove('t1', ACTOR)).rejects.toBeInstanceOf(ConflictException);
        expect(repo.remove).not.toHaveBeenCalled();
      },
    );
  });
});
