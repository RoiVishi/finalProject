import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PredictionsModule } from '../predictions/predictions.module';
import { Task } from './task.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [TypeOrmModule.forFeature([Task]), PredictionsModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
