import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { UuidPipe } from '../common/uuid';
import { CurrentMembership, CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectAction } from '../auth/permissions';
import { ProjectPermissionGuard, RequirePermission } from '../auth/project-permission.guard';
import { ProjectMember } from '../projects/project-member.entity';
import { TasksService } from './tasks.service';

/**
 * TASK-5 / KAN-26 - project-level predictions.
 *
 * Lives in TasksModule rather than ProjectsController: the permission guard
 * cannot be used there (see the AUTH-2 note in projects.controller.ts), and
 * predictions are computed from the project's activities anyway.
 * Subcontractors are scoped to their own activities in the service (AUTH-2).
 */
@Controller('projects/:projectId/predictions')
@UseGuards(JwtAuthGuard, ProjectPermissionGuard)
export class ProjectPredictionsController {
  constructor(private tasks: TasksService) {}

  /** The cached latest risk per activity, with freshness. No AI call. */
  @Get()
  @RequirePermission(ProjectAction.VIEW_PREDICTIONS, 'param')
  list(
    @Param('projectId', UuidPipe) projectId: string,
    @CurrentMembership() membership: ProjectMember,
    @CurrentUser() me: AuthenticatedUser,
  ) {
    return this.tasks.projectPredictions(projectId, { userId: me.userId, role: membership.role });
  }

  /** Recompute the whole project now; 503 + last known numbers if the AI is down. */
  @Post('refresh')
  @HttpCode(200)
  @RequirePermission(ProjectAction.VIEW_PREDICTIONS, 'param')
  refresh(
    @Param('projectId', UuidPipe) projectId: string,
    @CurrentMembership() membership: ProjectMember,
    @CurrentUser() me: AuthenticatedUser,
  ) {
    return this.tasks.refreshProjectPredictionsFor(projectId, {
      userId: me.userId, role: membership.role,
    });
  }
}
