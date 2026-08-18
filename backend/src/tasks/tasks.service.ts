import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PredictionsService,
  ProjectGraphPayload,
  ProjectPrediction,
} from '../predictions/predictions.service';
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

  /**
   * Refresh AI predictions for a WHOLE project via the PRED-9 contract:
   * the backend ships raw entities (tasks, dependencies, dates) to
   * POST /predict/project and never computes a feature itself. Dependency
   * features (upstream/downstream reach) require the full graph, which is
   * why prediction is a project-level operation.
   *
   * completed_share is reliability METADATA (not a model feature): it drives
   * the AI service's cold-start gate — young projects come back flagged
   * low_transfer_prior (or withheld, per service policy).
   */
  async refreshProjectPredictions(projectId: string) {
    const tasks = await this.repo.find({
      where: { project: { id: projectId } },
      relations: { predecessors: true },
    });
    if (tasks.length === 0) return { updated: 0, results: [] as ProjectPrediction[] };

    const completed = tasks.filter((t) => t.status === TaskStatus.COMPLETED).length;
    const payload: ProjectGraphPayload = {
      project: { completed_share: completed / tasks.length },
      tasks: tasks.map((t) => ({
        id: t.id,
        planned_start: t.plannedStart ?? null,
        planned_finish: t.plannedEnd ?? null,
        type: 'task',
      })),
      dependencies: tasks.flatMap((t) =>
        (t.predecessors ?? []).map((p) => ({ predecessor_id: p.id, successor_id: t.id })),
      ),
    };

    const results = await this.predictions.predictProject(payload);
    if (!results) return { updated: 0, results: [] as ProjectPrediction[] }; // NFR-REL-1: degrade quietly

    const byId = new Map(tasks.map((t) => [t.id, t]));
    const now = new Date();
    let updated = 0;
    for (const r of results) {
      const task = byId.get(r.task_id);
      if (!task) continue;
      task.reliability = r.reliability;
      task.predictedAt = now;
      if (r.prediction) {
        // TASK-5 traceability: every displayed number is attributable to a model version
        task.lateProbability = r.prediction.late_probability;
        task.riskLevel = r.prediction.risk_level;
        task.modelVersion = r.prediction.model_version;
        updated += 1;
      }
      await this.repo.save(task);
    }
    return { updated, results };
  }

  /**
   * Single-task refresh keeps its route (POST /tasks/:id/predict) but refreshes
   * the whole project — dependency features make prediction inherently
   * project-scoped — and returns this task's entry.
   */
  async refreshPrediction(taskId: string) {
    const task = await this.repo.findOne({ where: { id: taskId }, relations: { project: true } });
    if (!task) throw new NotFoundException('Task not found');
    const { results } = await this.refreshProjectPredictions(task.project.id);
    const mine = results.find((r) => r.task_id === taskId) ?? null;
    return { task: task.name, prediction: mine?.prediction ?? null, reliability: mine?.reliability ?? null };
  }
}
