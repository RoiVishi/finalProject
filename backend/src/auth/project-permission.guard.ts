import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable,
  NotFoundException, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectMembersService } from '../projects/project-members.service';
import { Task } from '../tasks/task.entity';
import { can, ProjectAction } from './permissions';

/** Where the guard should look for the project this request concerns. */
export type ProjectSource = 'param' | 'query' | 'body' | 'task';

export const PERMISSION_KEY = 'project_permission';

export const RequirePermission = (
  action: ProjectAction,
  source: ProjectSource = 'param',
) => SetMetadata(PERMISSION_KEY, { action, source });

@Injectable()
export class ProjectPermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private members: ProjectMembersService,
    @InjectRepository(Task) private tasks: Repository<Task>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<{
      action: ProjectAction; source: ProjectSource;
    }>(PERMISSION_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!meta) return true;

    const req = ctx.switchToHttp().getRequest();
    const projectId = await this.resolveProjectId(req, meta.source);
    if (!projectId) throw new NotFoundException('הפרויקט לא נמצא');

    const membership = await this.members.findActiveMembership(
      projectId, req.user?.userId,
    );

    // A non-member gets 404, not 403: a 403 would confirm that a project with
    // this id exists. AUTH-2 accepts either; we choose not to leak existence.
    if (!membership) throw new NotFoundException('הפרויקט לא נמצא');

    if (!can(membership.role, meta.action)) {
      throw new ForbiddenException('אין לך הרשאה לבצע פעולה זו בפרויקט');
    }

    // Downstream handlers read the resolved membership instead of re-querying.
    req.membership = membership;
    return true;
  }

  private async resolveProjectId(req: any, source: ProjectSource) {
    if (source === 'param') return req.params?.projectId ?? req.params?.id;
    if (source === 'query') return req.query?.projectId;
    if (source === 'body') return req.body?.projectId;
    // 'task': the route identifies a task; its project decides the permission.
    const task = await this.tasks.findOne({
      where: { id: req.params?.id },
      relations: { project: true },
    });
    return task?.project?.id;
  }
}
