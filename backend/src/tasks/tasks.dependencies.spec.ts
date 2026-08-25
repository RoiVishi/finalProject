import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ProjectRole } from '../projects/project-member.entity';
import { TasksService } from './tasks.service';
import { TaskStatus } from './task.entity';

const ACTOR = { userId: 'u-pm', role: ProjectRole.PROJECT_MANAGER };
const PROJECT = 'p1';

/** A tiny project: שלד → חשמל → ריצוף, each waiting for the one before it. */
const row = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  status: TaskStatus.PLANNED,
  project: { id: PROJECT },
  predecessors: [] as unknown[],
  zone: null as string | null,
  plannedEnd: null as string | null,
  assignee: null as { fullName: string } | null,
  ...over,
});

describe('TASK-3 — dependencies between activities', () => {
  let service: TasksService;
  let repo: { find: jest.Mock; findOne: jest.Mock; save: jest.Mock; create: jest.Mock; remove: jest.Mock };
  let activity: { record: jest.Mock };
  let rows: Record<string, ReturnType<typeof row>>;

  beforeEach(() => {
    rows = {
      structure: row('structure', 'שלד קומה 3'),
      electrical: row('electrical', 'חשמל קומה 3'),
      flooring: row('flooring', 'ריצוף קומה 3'),
    };

    repo = {
      find: jest.fn(async () => Object.values(rows)),
      findOne: jest.fn(async ({ where }) => rows[where.id] ?? null),
      save: jest.fn(async (d) => d),
      create: jest.fn((d) => d),
      remove: jest.fn(),
    };
    activity = { record: jest.fn() };

    service = new TasksService(
      repo as never,
      { findOne: jest.fn() } as never,
      { predictProject: jest.fn() } as never,
      { findActiveMembership: jest.fn() } as never,
      activity as never,
      { taskAssigned: jest.fn() } as never,
    );
  });

  describe('add', () => {
    it('records that flooring waits for electrical', async () => {
      const saved = await service.addDependency('flooring', 'electrical', ACTOR);

      expect(saved.predecessors.map((p) => p.id)).toEqual(['electrical']);
      expect(activity.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'task.dependency_added' }),
      );
    });

    it('refuses an activity that waits for itself', async () => {
      await expect(service.addDependency('flooring', 'flooring', ACTOR))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('refuses a dependency across two different projects', async () => {
      rows.electrical.project = { id: 'p2' };

      await expect(service.addDependency('flooring', 'electrical', ACTOR))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a dependency that already exists', async () => {
      rows.flooring.predecessors = [rows.electrical];

      await expect(service.addDependency('flooring', 'electrical', ACTOR))
        .rejects.toBeInstanceOf(ConflictException);
    });

    it('404s when the predecessor does not exist', async () => {
      await expect(service.addDependency('flooring', 'ghost', ACTOR))
        .rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects the direct ring and shows the path in names', async () => {
      rows.electrical.predecessors = [rows.flooring];

      const attempt = service.addDependency('flooring', 'electrical', ACTOR);

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow('ריצוף קומה 3 ← חשמל קומה 3 ← ריצוף קומה 3');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rejects a ring that closes only through a longer chain', async () => {
      rows.electrical.predecessors = [rows.structure];
      rows.flooring.predecessors = [rows.electrical];

      const attempt = service.addDependency('structure', 'flooring', ACTOR);

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(/שלד קומה 3 ← ריצוף קומה 3 ← חשמל קומה 3 ← שלד קומה 3/);
    });

    it('un-readies an activity when an unfinished predecessor is added', async () => {
      rows.flooring.status = TaskStatus.READY;

      const saved = await service.addDependency('flooring', 'electrical', ACTOR);

      expect(saved.status).toBe(TaskStatus.PLANNED);
    });

    it('leaves a ready activity alone when the new predecessor is already done', async () => {
      rows.flooring.status = TaskStatus.READY;
      rows.electrical.status = TaskStatus.COMPLETED;

      const saved = await service.addDependency('flooring', 'electrical', ACTOR);

      expect(saved.status).toBe(TaskStatus.READY);
    });
  });

  describe('remove', () => {
    it('drops the edge and records it', async () => {
      rows.flooring.predecessors = [rows.electrical];

      const saved = await service.removeDependency('flooring', 'electrical', ACTOR);

      expect(saved.predecessors).toEqual([]);
      expect(activity.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'task.dependency_removed' }),
      );
    });

    it('404s on an edge that is not there', async () => {
      await expect(service.removeDependency('flooring', 'electrical', ACTOR))
        .rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('TASK-4 — the named answer to "אפשר להתחיל?"', () => {
    beforeEach(() => {
      rows.structure.plannedEnd = '2026-09-12';
      rows.structure.assignee = { fullName: 'א.ב. בנייה' };
      rows.structure.zone = 'floor-3/zone-1';
      rows.flooring.predecessors = [rows.structure];
    });

    it('names the blocker, its owner and when it is expected to finish', async () => {
      const state = await service.computeBlocked('flooring');

      expect(state.blocked).toBe(true);
      expect(state.summary).toBe(
        'חסום על ידי: שלד קומה 3 (floor-3/zone-1) — א.ב. בנייה, צפי סיום 12.09.2026',
      );
    });

    it('clears the moment the blocker is completed — nothing is stored', async () => {
      rows.structure.status = TaskStatus.COMPLETED;

      expect(await service.computeBlocked('flooring')).toMatchObject({
        blocked: false, summary: '',
      });
    });

    it('refuses "ready" with the same sentence rather than a bare no', async () => {
      await expect(service.changeStatus('flooring', TaskStatus.READY, ACTOR))
        .rejects.toThrow(/חסום על ידי: שלד קומה 3 .*א\.ב\. בנייה/);
    });

    it('carries a verdict on every row of the project list', async () => {
      const list = await service.findByProject(PROJECT);

      expect(list.find((t) => t.id === 'flooring')).toMatchObject({ blocked: true });
      expect(list.find((t) => t.id === 'structure')).toMatchObject({ blocked: false });
    });
  });

  describe('read — both directions', () => {
    it('lists what an activity waits for and who waits for it', async () => {
      rows.electrical.predecessors = [rows.structure];
      repo.find.mockResolvedValueOnce([rows.flooring]); // dependants of electrical

      const result = await service.dependencies('electrical');

      expect(result.predecessors).toEqual([
        { id: 'structure', name: 'שלד קומה 3', status: TaskStatus.PLANNED },
      ]);
      expect(result.dependants).toEqual([
        { id: 'flooring', name: 'ריצוף קומה 3', status: TaskStatus.PLANNED },
      ]);
    });

    it('returns two empty lists for an activity standing on its own', async () => {
      repo.find.mockResolvedValueOnce([]);

      expect(await service.dependencies('structure')).toEqual({
        predecessors: [], dependants: [],
      });
    });
  });
});
