import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { CurrentMembership, CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectAction } from '../auth/permissions';
import { ProjectPermissionGuard, RequirePermission } from '../auth/project-permission.guard';
import { ProjectMember } from '../projects/project-member.entity';
import { ChangeTaskStatusDto, CreateTaskDto, UpdateTaskDto } from './dto/task.dto';
import { TasksService } from './tasks.service';

@Controller('tasks')
@UseGuards(JwtAuthGuard, ProjectPermissionGuard)
export class TasksController {
  constructor(private tasks: TasksService) {}

  /** Owner, PM or engineer (§2 "יצירה ועריכה של משימות ותלויות"). */
  @Post()
  @RequirePermission(ProjectAction.MANAGE_TASKS, 'body')
  create(
    @Body() dto: CreateTaskDto,
    @CurrentMembership() membership: ProjectMember,
    @CurrentUser() me: AuthenticatedUser,
  ) {
    return this.tasks.create(dto, { userId: me.userId, role: membership.role });
  }

  @Get()
  @RequirePermission(ProjectAction.VIEW_PROJECT, 'query')
  byProject(@Query('projectId') projectId: string) {
    return this.tasks.findByProject(projectId);
  }

  @Get(':id')
  @RequirePermission(ProjectAction.VIEW_PROJECT, 'task')
  findOne(@Param('id') id: string) {
    return this.tasks.findOne(id);
  }

  @Patch(':id')
  @RequirePermission(ProjectAction.MANAGE_TASKS, 'task')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentMembership() membership: ProjectMember,
    @CurrentUser() me: AuthenticatedUser,
  ) {
    return this.tasks.update(id, dto, { userId: me.userId, role: membership.role });
  }

  /**
   * The lifecycle move. Kept off PATCH so a status change can never ride along
   * with an unrelated field edit and skip the transition rules.
   * TODO (TASK-10): the assignee reports execution on their own tasks under
   * REPORT_EXECUTION; until that story lands this stays planning-side.
   */
  @Post(':id/status')
  @RequirePermission(ProjectAction.MANAGE_TASKS, 'task')
  changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeTaskStatusDto,
    @CurrentMembership() membership: ProjectMember,
    @CurrentUser() me: AuthenticatedUser,
  ) {
    return this.tasks.changeStatus(id, dto.status, {
      userId: me.userId, role: membership.role,
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(ProjectAction.MANAGE_TASKS, 'task')
  remove(
    @Param('id') id: string,
    @CurrentMembership() membership: ProjectMember,
    @CurrentUser() me: AuthenticatedUser,
  ) {
    return this.tasks.remove(id, { userId: me.userId, role: membership.role });
  }

  @Get(':id/blocked')
  @RequirePermission(ProjectAction.VIEW_PROJECT, 'task')
  blocked(@Param('id') id: string) {
    return this.tasks.computeBlocked(id);
  }

  /** Subcontractors are scoped to their own tasks — enforced in the service. */
  @Post(':id/predict')
  @RequirePermission(ProjectAction.VIEW_PREDICTIONS, 'task')
  predict(
    @Param('id') id: string,
    @CurrentMembership() membership: ProjectMember,
    @CurrentUser() me: AuthenticatedUser,
  ) {
    return this.tasks.refreshPrediction(id, membership.role, me.userId);
  }
}
