import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthzModule } from '../auth/authz.module';
import { PredictionsModule } from '../predictions/predictions.module';
import { Task } from './task.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [TypeOrmModule.forFeature([Task]), PredictionsModule, AuthzModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
