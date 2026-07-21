import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.entity';
import { TasksService } from './tasks.service';

class CreateTaskDto {
  @IsString() name: string;
  @IsUUID() projectId: string;
  @IsOptional() @IsString() zone?: string;
  @IsOptional() @IsDateString() plannedStart?: string;
  @IsOptional() @IsDateString() plannedEnd?: string;
}

@Controller('tasks')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class TasksController {
  constructor(private tasks: TasksService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.PROJECT_MANAGER, UserRole.ENGINEER)
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
  byProject(@Query('projectId') projectId: string) {
    return this.tasks.findByProject(projectId);
  }

  @Get(':id/blocked')
  blocked(@Param('id') id: string) {
    return this.tasks.computeBlocked(id);
  }

  @Post(':id/predict')
  predict(@Param('id') id: string) {
    return this.tasks.refreshPrediction(id);
  }
}
