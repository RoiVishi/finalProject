import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthzModule } from '../auth/authz.module';
import { EventsModule } from '../common/events.module';
import { PredictionsModule } from '../predictions/predictions.module';
import { Project } from '../projects/project.entity';
import { ProjectsModule } from '../projects/projects.module';
import { Task } from './task.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

/**
 * Project is registered for its repository only: TASK-2 validates an
 * activity's zone against the layout TASK-1 stored, and refuses to attach
 * activities to a deleted project. ProjectsModule is imported for membership
 * resolution (an assignee must be an active member) — the dependency runs one
 * way, Tasks → Projects, so there is no cycle.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Task, Project]),
    PredictionsModule,
    AuthzModule,
    ProjectsModule,
    EventsModule,
  ],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
