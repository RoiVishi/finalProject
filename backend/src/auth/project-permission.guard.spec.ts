import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MemberStatus, ProjectRole } from '../projects/project-member.entity';
import { ProjectAction } from './permissions';
import { ProjectPermissionGuard } from './project-permission.guard';

const P1 = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const T1 = '0b9a8c7d-6e5f-4a3b-9c2d-1e0f2a3b4c5d';
const GHOST = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const ctxFor = (req: Record<string, unknown>) =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as never;

describe('AUTH-2 — ProjectPermissionGuard', () => {
  let guard: ProjectPermissionGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let members: { findActiveMembership: jest.Mock };
  let tasks: { findOne: jest.Mock };

  const engineer = { role: ProjectRole.ENGINEER, status: MemberStatus.ACTIVE };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    members = { findActiveMembership: jest.fn() };
    tasks = { findOne: jest.fn() };
    guard = new ProjectPermissionGuard(
      reflector as never, members as never, tasks as never,
    );
  });

  it('lets a route without a declared permission through', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(guard.canActivate(ctxFor({}))).resolves.toBe(true);
    expect(members.findActiveMembership).not.toHaveBeenCalled();
  });

  it('gives a non-member 404, not 403, so project existence is not leaked', async () => {
    reflector.getAllAndOverride.mockReturnValue({
      action: ProjectAction.VIEW_PROJECT, source: 'param',
    });
    members.findActiveMembership.mockResolvedValue(null);

    const ctx = ctxFor({ params: { projectId: P1 }, user: { userId: 'u-stranger' } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('gives a member without the permission 403', async () => {
    reflector.getAllAndOverride.mockReturnValue({
      action: ProjectAction.APPROVE_DOCUMENT, source: 'param',
    });
    members.findActiveMembership.mockResolvedValue(engineer);

    const ctx = ctxFor({ params: { projectId: P1 }, user: { userId: 'u-eng' } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('admits an allowed member and hands the membership downstream', async () => {
    reflector.getAllAndOverride.mockReturnValue({
      action: ProjectAction.MANAGE_TASKS, source: 'param',
    });
    members.findActiveMembership.mockResolvedValue(engineer);

    const req: Record<string, unknown> = {
      params: { projectId: P1 }, user: { userId: 'u-eng' },
    };
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(req.membership).toBe(engineer);
  });

  it('resolves the project from the task on task-scoped routes', async () => {
    reflector.getAllAndOverride.mockReturnValue({
      action: ProjectAction.VIEW_PREDICTIONS, source: 'task',
    });
    tasks.findOne.mockResolvedValue({ id: T1, project: { id: 'p-from-task' } });
    members.findActiveMembership.mockResolvedValue(engineer);

    const ctx = ctxFor({ params: { id: T1 }, user: { userId: 'u-eng' } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(members.findActiveMembership).toHaveBeenCalledWith('p-from-task', 'u-eng');
  });

  it('404s when the task does not exist', async () => {
    reflector.getAllAndOverride.mockReturnValue({
      action: ProjectAction.VIEW_PREDICTIONS, source: 'task',
    });
    tasks.findOne.mockResolvedValue(null);

    const ctx = ctxFor({ params: { id: GHOST }, user: { userId: 'u-eng' } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('malformed ids are 400 before any database query', () => {
    const viewBy = (source: string) =>
      reflector.getAllAndOverride.mockReturnValue({ action: ProjectAction.VIEW_PROJECT, source });

    it('a non-uuid project id in the path', async () => {
      viewBy('param');
      const ctx = ctxFor({ params: { id: 'not-a-uuid' }, user: { userId: 'u-eng' } });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(BadRequestException);
      expect(members.findActiveMembership).not.toHaveBeenCalled();
    });

    it('a repeated ?projectId= (arrives as an array)', async () => {
      viewBy('query');
      const ctx = ctxFor({ query: { projectId: [P1, P1] }, user: { userId: 'u-eng' } });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(BadRequestException);
      expect(members.findActiveMembership).not.toHaveBeenCalled();
    });

    it('a non-uuid projectId in the body', async () => {
      viewBy('body');
      const ctx = ctxFor({ body: { projectId: 42 }, user: { userId: 'u-eng' } });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('a non-uuid task id on task-scoped routes', async () => {
      viewBy('task');
      const ctx = ctxFor({ params: { id: 'abc' }, user: { userId: 'u-eng' } });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(BadRequestException);
      expect(tasks.findOne).not.toHaveBeenCalled();
    });

    it('a missing project id stays 404, as before', async () => {
      viewBy('query');
      const ctx = ctxFor({ query: {}, user: { userId: 'u-eng' } });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
