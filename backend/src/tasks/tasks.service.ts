import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  PredictionsService,
  ProjectGraphPayload,
  ProjectPrediction,
} from '../predictions/predictions.service';
import { predictionScope } from '../auth/permissions';
import { ActivityLogService } from '../common/activity-log.service';
import { NotificationsService } from '../common/notifications.service';
import { zoneExists } from '../projects/layout';
import { ProjectRole } from '../projects/project-member.entity';
import { ProjectMembersService } from '../projects/project-members.service';
import { Project } from '../projects/project.entity';
import { Blocker, BlockingState, blockingState } from './blocking';
import { buildWaitsFor, cyclePathFor, describePath } from './dependency-graph';
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';
import { assertTransition, STATUS_LABELS } from './task-lifecycle';
import { Task, TaskStatus } from './task.entity';

/** The identity of whoever is acting, as the guard already resolved it. */
export interface TaskActor {
  userId: string;
  role: ProjectRole;
}

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private repo: Repository<Task>,
    @InjectRepository(Project) private projects: Repository<Project>,
    private predictions: PredictionsService,
    private members: ProjectMembersService,
    private activity: ActivityLogService,
    private notifications: NotificationsService,
  ) {}

  /**
   * TASK-2 — create an activity. Always PLANNED: the client cannot choose a
   * starting status, so no activity can be born "in progress" without an
   * actual start date, and none can be born "blocked" at all.
   */
  async create(dto: CreateTaskDto, actor: TaskActor) {
    const project = await this.requireProject(dto.projectId);

    this.assertZone(project, dto.zone);
    this.assertDateOrder(dto.plannedStart, dto.plannedEnd);
    const assignee = await this.resolveAssignee(project.id, dto.assigneeId);

    const task = await this.repo.save(
      this.repo.create({
        name: dto.name.trim(),
        description: dto.description?.trim() ?? null,
        trade: dto.trade,
        zone: dto.zone,
        plannedStart: dto.plannedStart,
        plannedEnd: dto.plannedEnd,
        estimatedDurationDays: dto.estimatedDurationDays ?? null,
        status: TaskStatus.PLANNED,
        project: { id: project.id } as never,
        assignee: assignee ? ({ id: assignee } as never) : null,
      }),
    );

    this.activity.record({
      projectId: project.id, actorId: actor.userId, entity: 'task',
      entityId: task.id, action: 'task.created', after: { name: task.name, zone: task.zone },
    });
    if (assignee) this.announceAssignment(task, project.id, assignee);

    return task;
  }

  /**
   * TASK-2 — edit an activity. Status is not editable here; it moves only
   * through changeStatus(), where the transition rules live.
   */
  async update(taskId: string, dto: UpdateTaskDto, actor: TaskActor) {
    const task = await this.requireTask(taskId);
    const project = await this.requireProject(task.project.id);

    this.assertZone(project, dto.zone);
    this.assertDateOrder(
      dto.plannedStart ?? task.plannedStart,
      dto.plannedEnd ?? task.plannedEnd,
    );

    const previousAssignee = task.assignee?.id ?? null;
    const planBefore = { plannedStart: task.plannedStart, plannedEnd: task.plannedEnd };

    if (dto.name !== undefined) task.name = dto.name.trim();
    if (dto.description !== undefined) task.description = dto.description.trim();
    if (dto.trade !== undefined) task.trade = dto.trade;
    if (dto.zone !== undefined) task.zone = dto.zone;
    if (dto.plannedStart !== undefined) task.plannedStart = dto.plannedStart;
    if (dto.plannedEnd !== undefined) task.plannedEnd = dto.plannedEnd;
    if (dto.estimatedDurationDays !== undefined) {
      task.estimatedDurationDays = dto.estimatedDurationDays;
    }
    if (dto.assigneeId !== undefined) {
      const assignee = await this.resolveAssignee(project.id, dto.assigneeId);
      task.assignee = assignee ? ({ id: assignee } as never) : null;
    }

    const planAfter = { plannedStart: task.plannedStart, plannedEnd: task.plannedEnd };
    const planMoved = planBefore.plannedStart !== planAfter.plannedStart
      || planBefore.plannedEnd !== planAfter.plannedEnd;

    const saved = await this.repo.save(task);

    /**
     * The audited case of TASK-2: "plan-date edits after execution start are
     * audited". Moving the plan before work starts is ordinary planning;
     * moving it after the crew is on site is how a schedule quietly absorbs a
     * delay, so that edit — and only that edit — leaves a trail with both the
     * old and the new dates.
     */
    if (planMoved && task.actualStart) {
      this.activity.record({
        projectId: project.id, actorId: actor.userId, entity: 'task', entityId: task.id,
        action: 'task.plan_dates_changed_after_start', before: planBefore, after: planAfter,
      });
    }

    if (dto.assigneeId !== undefined && dto.assigneeId !== previousAssignee && dto.assigneeId) {
      this.announceAssignment(saved, project.id, dto.assigneeId);
    }
    return saved;
  }

  /**
   * TASK-2 — the lifecycle. Illegal transitions are rejected by
   * assertTransition(); the extra rule here is that "ready" means what it says:
   * an activity cannot be declared ready while a predecessor is unfinished
   * (מסמך האפיון §5.2 — "מוכנה להתחלה (כל התלויות הושלמו)").
   */
  async changeStatus(taskId: string, next: TaskStatus, actor: TaskActor) {
    const task = await this.requireTask(taskId);
    const from = task.status;

    assertTransition(from, next);

    if (next === TaskStatus.READY) {
      const { blocked, summary } = this.blockersOf(task);
      if (blocked) {
        // TASK-4: the refusal carries the same named summary the "can I start?"
        // question gets, so the user is never told "no" without being told why.
        throw new ConflictException(`לא ניתן לסמן "מוכנה להתחלה" — ${summary}`);
      }
    }

    task.status = next;
    const today = new Date().toISOString().slice(0, 10);
    if (next === TaskStatus.IN_PROGRESS && !task.actualStart) task.actualStart = today;
    // TODO (DOC-4): completion must also be refused while a required document
    // is unapproved. The gate belongs to the documents epic; the hook is here.
    if (next === TaskStatus.COMPLETED && !task.actualEnd) task.actualEnd = today;

    const saved = await this.repo.save(task);
    this.activity.record({
      projectId: task.project.id, actorId: actor.userId, entity: 'task', entityId: task.id,
      action: 'task.status_changed',
      before: { status: STATUS_LABELS[from] }, after: { status: STATUS_LABELS[next] },
    });
    return saved;
  }

  /**
   * Deleting an activity others depend on would silently cut the dependency
   * chain, so it is refused and the dependants are named. Work that has
   * already started is not deletable either — that is history, and TASK-7's
   * archiving is the way to put a project away.
   */
  async remove(taskId: string, actor: TaskActor) {
    const task = await this.requireTask(taskId);

    if (task.status === TaskStatus.IN_PROGRESS || task.status === TaskStatus.COMPLETED) {
      throw new ConflictException(
        `לא ניתן למחוק משימה במצב "${STATUS_LABELS[task.status]}" — היא כבר חלק מהיסטוריית הביצוע`,
      );
    }

    const dependants = await this.repo.find({
      where: { predecessors: { id: taskId } },
      select: { id: true, name: true },
    });
    if (dependants.length > 0) {
      throw new ConflictException(
        `לא ניתן למחוק: משימות אחרות תלויות בה — ${dependants.map((t) => t.name).join(', ')}`,
      );
    }

    await this.repo.remove(task);
    this.activity.record({
      projectId: task.project.id, actorId: actor.userId, entity: 'task',
      entityId: taskId, action: 'task.deleted', before: { name: task.name },
    });
  }

  /**
   * TASK-3 — record that `taskId` waits for `predecessorId` to finish.
   *
   * The whole project graph is loaded first, because a cycle is a property of
   * the graph and not of the two activities in front of us: A→B and B→C are
   * both fine, and C→A is the one that closes the ring.
   */
  async addDependency(taskId: string, predecessorId: string, actor: TaskActor) {
    if (taskId === predecessorId) {
      throw new BadRequestException('משימה אינה יכולה להיות תלויה בעצמה');
    }

    const task = await this.requireTask(taskId);
    const predecessor = await this.requireTask(predecessorId);

    if (task.project.id !== predecessor.project.id) {
      throw new BadRequestException('ניתן ליצור תלות רק בין משימות באותו פרויקט');
    }
    if ((task.predecessors ?? []).some((p) => p.id === predecessorId)) {
      throw new ConflictException('התלות כבר קיימת');
    }

    const all = await this.repo.find({
      where: { project: { id: task.project.id } },
      relations: { predecessors: true },
    });
    const cycle = cyclePathFor(buildWaitsFor(all), taskId, predecessorId);
    if (cycle) {
      const names = new Map(all.map((t) => [t.id, t.name]));
      names.set(task.id, task.name);
      names.set(predecessor.id, predecessor.name);
      throw new ConflictException(
        `לא ניתן ליצור תלות מעגלית: ${describePath(cycle, names)}`,
      );
    }

    task.predecessors = [...(task.predecessors ?? []), predecessor];

    /**
     * A new open predecessor un-readies the activity. "Ready" is a claim that
     * every dependency is finished; leaving it standing while adding an
     * unfinished one would put a crew on site in front of work that has not
     * happened yet.
     */
    if (task.status === TaskStatus.READY && predecessor.status !== TaskStatus.COMPLETED) {
      task.status = TaskStatus.PLANNED;
    }

    const saved = await this.repo.save(task);
    this.activity.record({
      projectId: task.project.id, actorId: actor.userId, entity: 'task', entityId: task.id,
      action: 'task.dependency_added', after: { predecessorId, predecessor: predecessor.name },
    });
    return saved;
  }

  async removeDependency(taskId: string, predecessorId: string, actor: TaskActor) {
    const task = await this.requireTask(taskId);
    const before = task.predecessors ?? [];
    const removed = before.find((p) => p.id === predecessorId);
    if (!removed) throw new NotFoundException('התלות לא נמצאה');

    task.predecessors = before.filter((p) => p.id !== predecessorId);
    const saved = await this.repo.save(task);
    this.activity.record({
      projectId: task.project.id, actorId: actor.userId, entity: 'task', entityId: task.id,
      action: 'task.dependency_removed', before: { predecessorId, predecessor: removed.name },
    });
    return saved;
  }

  /**
   * TASK-3 acceptance criterion: "per-activity predecessor and dependent lists
   * visible". Both directions, because the question a site manager actually
   * asks is not only "what am I waiting for" but "who is waiting for me".
   */
  async dependencies(taskId: string) {
    const task = await this.requireTask(taskId);
    const dependants = await this.repo.find({
      where: { predecessors: { id: taskId } },
      select: { id: true, name: true, status: true },
    });

    return {
      predecessors: (task.predecessors ?? []).map((p) => ({
        id: p.id, name: p.name, status: p.status,
      })),
      dependants: dependants.map((d) => ({ id: d.id, name: d.name, status: d.status })),
    };
  }

  /** One activity, with its computed blocking state (never a stored status). */
  async findOne(taskId: string) {
    const task = await this.requireTask(taskId);
    return { ...task, ...this.blockersOf(task) };
  }

  /**
   * The project's activities, each carrying its own blocking verdict. The
   * board and the Twin badge both need it per row, and computing it here —
   * from data already loaded — costs one query rather than one per activity.
   */
  async findByProject(projectId: string) {
    const tasks = await this.repo.find({
      where: { project: { id: projectId } },
      relations: { predecessors: { assignee: true }, assignee: true },
    });
    return tasks.map((task) => ({ ...task, ...this.blockersOf(task) }));
  }

  /**
   * TASK-4 — the named answer to "אפשר להתחיל?". Live from the dependency
   * graph on every call: a stored blocking flag goes stale the moment a
   * predecessor is completed in another session.
   */
  async computeBlocked(taskId: string): Promise<BlockingState> {
    const task = await this.requireTask(taskId);
    return this.blockersOf(task);
  }

  // ---- internal helpers --------------------------------------------------

  private blockersOf(task: Task): BlockingState {
    return blockingState(task.predecessors ?? [], this.documentBlockers(task));
  }

  /**
   * The second half of TASK-4 — "מסמך נדרש שטרם אושר". The documents epic
   * (DOC-1..DOC-4) does not exist yet, so this returns nothing and every
   * activity is judged on its dependencies alone. DOC-4 fills it in and the
   * summary sentence gains its "ממתין לאישור: …" half with no other change:
   * blocking.ts already renders both halves and the tests already cover the
   * rendering.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private documentBlockers(_task: Task): Blocker[] {
    return [];
  }

  private async requireTask(taskId: string) {
    const task = await this.repo.findOne({
      where: { id: taskId },
      // predecessors carry their assignee: TASK-4 names who owns the blocker.
      relations: { project: true, assignee: true, predecessors: { assignee: true } },
    });
    if (!task) throw new NotFoundException('המשימה לא נמצאה');
    return task;
  }

  private async requireProject(projectId: string) {
    const project = await this.projects.findOne({
      where: { id: projectId, deletedAt: IsNull() },
    });
    if (!project) throw new NotFoundException('הפרויקט לא נמצא');
    return project;
  }

  /** TASK-1 owns the building; an activity may only sit in a zone it defines. */
  private assertZone(project: Project, zone?: string) {
    if (zone === undefined) return;
    if (!zoneExists(project.layout, zone)) {
      throw new BadRequestException('האזור אינו קיים במבנה הפרויקט');
    }
  }

  /** מסמך האפיון §5.1: "רק חברי הפרויקט מוצעים". */
  private async resolveAssignee(projectId: string, assigneeId?: string) {
    if (!assigneeId) return null;
    const membership = await this.members.findActiveMembership(projectId, assigneeId);
    if (!membership) {
      throw new BadRequestException('ניתן לשבץ רק חבר פרויקט פעיל');
    }
    return assigneeId;
  }

  private announceAssignment(task: Task, projectId: string, userId: string) {
    this.notifications.taskAssigned({
      userId, projectId, taskId: task.id, taskName: task.name,
    });
    this.activity.record({
      projectId, actorId: userId, entity: 'task', entityId: task.id,
      action: 'task.assigned', after: { assigneeId: userId },
    });
  }

  private assertDateOrder(start?: string | null, end?: string | null) {
    if (start && end && new Date(end) < new Date(start)) {
      throw new BadRequestException('תאריך הסיום המתוכנן מוקדם מתאריך ההתחלה');
    }
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
  async refreshPrediction(taskId: string, role?: ProjectRole, userId?: string) {
    const task = await this.repo.findOne({
      where: { id: taskId },
      relations: { project: true, assignee: true },
    });
    if (!task) throw new NotFoundException('Task not found');

    // AUTH-2: "subcontractors see risk predictions and explanations for own
    // tasks only". A row-level scope, so it cannot live in the matrix.
    if (role && predictionScope(role) === 'own' && task.assignee?.id !== userId) {
      throw new ForbiddenException('קבלן משנה רשאי לראות תחזיות למשימות שלו בלבד');
    }
    const { results } = await this.refreshProjectPredictions(task.project.id);
    const mine = results.find((r) => r.task_id === taskId) ?? null;
    return { task: task.name, prediction: mine?.prediction ?? null, reliability: mine?.reliability ?? null };
  }
}
