import {
  Body, Controller, Get, Param, Post, Query, UseGuards,
} from '@nestjs/common';
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';
import { CurrentMembership, CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectAction } from '../auth/permissions';
import { ProjectPermissionGuard, RequirePermission } from '../auth/project-permission.guard';
import { ProjectMember } from '../projects/project-member.entity';
import { TasksService } from './tasks.service';

class CreateTaskDto {
  @IsString() name: string;
  @IsUUID() projectId: string;
  @IsOptional() @IsString() zone?: string;
  @IsOptional() @IsDateString() plannedStart?: string;
  @IsOptional() @IsDateString() plannedEnd?: string;
}

@Controller('tasks')
@UseGuards(JwtAuthGuard, ProjectPermissionGuard)
export class TasksController {
  constructor(private tasks: TasksService) {}

  @Post()
  @RequirePermission(ProjectAction.MANAGE_TASKS, 'body')
  create(@Body() dto: CreateTaskDto) {
    return this.tasks.create({
      name: dto.name,
      zone: dto.zone,
      plannedStart: dto.plannedStart,
      plannedEnd: dto.plannedEnd,
      project: { id: dto.projectId } as never,
    });
  }

  @Get()
  @RequirePermission(ProjectAction.VIEW_PROJECT, 'query')
  byProject(@Query('projectId') projectId: string) {
    return this.tasks.findByProject(projectId);
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
