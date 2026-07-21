import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PredictionsService } from '../predictions/predictions.service';
import { Task, TaskStatus } from './task.entity';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private repo: Repository<Task>,
    private predictions: PredictionsService,
  ) {}

  async create(data: Partial<Task>) {
    return this.repo.save(this.repo.create(data));
  }

  findByProject(projectId: string) {
    return this.repo.find({
      where: { project: { id: projectId } },
      relations: { predecessors: true, assignee: true },
    });
  }

  /**
   * Core business rule: a task is BLOCKED if any predecessor is not completed.
   * (e.g. "Cannot start electrical works — structural works not completed")
   */
  async computeBlocked(taskId: string): Promise<{ blocked: boolean; blockingTasks: string[] }> {
    const task = await this.repo.findOne({ where: { id: taskId }, relations: { predecessors: true } });
    if (!task) throw new NotFoundException('Task not found');
    const blocking = (task.predecessors ?? []).filter((p) => p.status !== TaskStatus.COMPLETED);
    return { blocked: blocking.length > 0, blockingTasks: blocking.map((t) => t.name) };
  }

  /** Refresh AI risk prediction for a task and cache it on the row. */
  async refreshPrediction(taskId: string) {
    const task = await this.repo.findOne({ where: { id: taskId }, relations: { predecessors: true } });
    if (!task) throw new NotFoundException('Task not found');

    const planned =
      task.plannedStart && task.plannedEnd
        ? (new Date(task.plannedEnd).getTime() - new Date(task.plannedStart).getTime()) / 86_400_000
        : undefined;

    const prediction = await this.predictions.predict({
      planned_duration_days: planned,
      n_pred: task.predecessors?.length ?? 0,
      task_type: 'TT_Task',
    });
    if (prediction) {
      task.lateProbability = prediction.late_probability;
      task.riskLevel = prediction.risk_level;
      await this.repo.save(task);
    }
    return { task: task.name, prediction };
  }
}
