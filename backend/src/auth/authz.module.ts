import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectsModule } from '../projects/projects.module';
import { Task } from '../tasks/task.entity';
import { ProjectPermissionGuard } from './project-permission.guard';

/**
 * AUTH-2 wiring. The guard needs membership resolution (ProjectsModule) and,
 * for task-scoped routes, the task→project lookup. Kept in its own module so
 * neither Projects nor Tasks has to depend on the other.
 */
@Module({
  imports: [ProjectsModule, TypeOrmModule.forFeature([Task])],
  providers: [ProjectPermissionGuard],
  exports: [ProjectPermissionGuard],
})
export class AuthzModule {}
