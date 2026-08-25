import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { can, canCreateProject, ProjectAction } from '../auth/permissions';
import { Task } from '../tasks/task.entity';
import { Profession } from '../users/user.entity';
import { CreateProjectDto, UpdateProjectDto } from './dto/create-project.dto';
import { InviteByEmailDto } from './dto/invitation.dto';
import { InvitationsService } from './invitations.service';
import {
  buildLayout, expandZones, ProjectLayout, removedZoneIds, TwinZone,
} from './layout';
import { ProjectMembersService } from './project-members.service';
import { Project } from './project.entity';

/** Per-invitation outcome of wizard step 3 — see inviteInitialTeam(). */
export interface InitialTeamResult {
  email: string;
  status: 'sent' | 'failed';
  reason?: string;
}

@Injectable()
export class ProjectsService {
  private readonly log = new Logger(ProjectsService.name);

  constructor(
    @InjectRepository(Project) private repo: Repository<Project>,
    @InjectRepository(Task) private tasks: Repository<Task>,
    private members: ProjectMembersService,
    private invitations: InvitationsService,
  ) {}

  /**
   * TASK-1 — the three wizard steps, executed as one request.
   *
   * The creator becomes the project owner. Without this no project has an
   * owner, and every AUTH-5 ownership check would be unreachable.
   *
   * AUTH-2: creation cannot be a membership check — there is no project to be
   * a member of yet — so it is gated on profession, per §2 note (3).
   */
  async create(
    dto: CreateProjectDto,
    creator: { userId: string; email?: string; profession: Profession },
  ) {
    if (!canCreateProject(creator.profession)) {
      throw new ForbiddenException('פתיחת פרויקט מותרת לקבלן ראשי או למנהל פרויקט');
    }

    const layout = buildLayout(dto.layout);
    this.assertDateOrder(dto.details.plannedStart, dto.details.plannedEnd);

    const project = await this.repo.save(
      this.repo.create({
        name: dto.details.name.trim(),
        address: dto.details.address?.trim(),
        description: dto.details.description?.trim(),
        plannedStart: dto.details.plannedStart ?? null,
        plannedEnd: dto.details.plannedEnd ?? null,
        layout,
      }),
    );

    await this.members.createOwnerMembership(project.id, creator.userId);
    const team = await this.inviteInitialTeam(project, creator, dto.team ?? []);

    this.log.log(
      `project created: id=${project.id} owner=${creator.userId} `
      + `layout=${layout.floors}x${layout.zonesPerFloor} invited=${team.length}`,
    );

    return { ...project, zoneCount: layout.floors * layout.zonesPerFloor, team };
  }

  /**
   * Step 3 — "אפשר לדלג ולהזמין אחר כך" (מסמך האפיון §4.1).
   *
   * Deliberately not transactional with the project: an SMTP hiccup or one
   * mistyped address must not destroy a project the user has already
   * confirmed through two screens. Every address gets its own verdict and the
   * client shows which invitations still need attention; the project itself is
   * already saved and usable, and AUTH-4 can re-send any of them.
   */
  private async inviteInitialTeam(
    project: Project,
    creator: { userId: string; email?: string },
    team: InviteByEmailDto[],
  ): Promise<InitialTeamResult[]> {
    const results: InitialTeamResult[] = [];
    const seen = new Set<string>();

    for (const invite of team) {
      const email = invite.email.trim().toLowerCase();

      if (creator.email && email === creator.email.trim().toLowerCase()) {
        results.push({ email, status: 'failed', reason: 'יוצר הפרויקט כבר חבר בו' });
        continue;
      }
      if (seen.has(email)) {
        results.push({ email, status: 'failed', reason: 'הכתובת מופיעה פעמיים ברשימה' });
        continue;
      }
      seen.add(email);

      try {
        await this.invitations.inviteByEmail(project.id, creator.userId, { ...invite, email });
        results.push({ email, status: 'sent' });
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'שליחת ההזמנה נכשלה';
        this.log.warn(`initial invite failed: project=${project.id} email=${email} — ${reason}`);
        results.push({ email, status: 'failed', reason });
      }
    }

    return results;
  }

  /** Only live projects the user is an active member of. */
  async findAllForUser(userId: string) {
    const memberships = await this.members.listForUser(userId);
    return memberships
      .map((m) => m.project)
      .filter((p): p is Project => Boolean(p) && !p.deletedAt);
  }

  /**
   * AUTH-2: a non-member gets 404, not 403 — a 403 would confirm that a
   * project with this id exists.
   */
  async findOne(id: string, userId: string) {
    await this.requireMembership(id, userId);

    const project = await this.repo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: { tasks: true },
    });
    if (!project) throw new NotFoundException('הפרויקט לא נמצא');
    return project;
  }

  /**
   * The F×Z expansion the Digital Twin renders (TWIN-1). Derived on read, so
   * a layout edit is visible in the Twin on the next request with no
   * migration and no cached zone table to fall out of step.
   */
  async zones(id: string, userId: string): Promise<TwinZone[]> {
    const project = await this.findOne(id, userId);
    return project.layout ? expandZones(project.layout) : [];
  }

  /** Owner or PM (§2 "עריכת מבנה המבנה"). */
  async update(id: string, userId: string, dto: UpdateProjectDto) {
    const project = await this.requireLive(id, userId, ProjectAction.EDIT_LAYOUT);

    if (dto.details) {
      const merged = {
        plannedStart: dto.details.plannedStart ?? project.plannedStart,
        plannedEnd: dto.details.plannedEnd ?? project.plannedEnd,
      };
      this.assertDateOrder(merged.plannedStart, merged.plannedEnd);

      if (dto.details.name !== undefined) project.name = dto.details.name.trim();
      if (dto.details.address !== undefined) project.address = dto.details.address.trim();
      if (dto.details.description !== undefined) {
        project.description = dto.details.description.trim();
      }
      project.plannedStart = merged.plannedStart;
      project.plannedEnd = merged.plannedEnd;
    }

    if (dto.layout) {
      project.layout = await this.applyLayoutChange(project, buildLayout(dto.layout));
    }

    return this.repo.save(project);
  }

  /**
   * Growing a building is free; shrinking it is not. Activities address zones
   * by id (TASK-2), so a zone that disappears from the layout would leave
   * them pointing at nothing — and the Twin would silently stop showing work
   * that is still planned. The edit is refused and the blocking zones are
   * named, so the user can move or delete those activities first.
   */
  private async applyLayoutChange(
    project: Project,
    next: ProjectLayout,
  ): Promise<ProjectLayout> {
    const removed = removedZoneIds(project.layout, next);
    if (removed.length === 0) return next;

    const orphans = await this.tasks.find({
      where: { project: { id: project.id }, zone: In(removed) },
      select: { id: true, name: true, zone: true },
    });

    if (orphans.length > 0) {
      const listed = orphans.slice(0, 5).map((t) => `${t.name} (${t.zone})`).join(', ');
      const more = orphans.length > 5 ? ` ועוד ${orphans.length - 5}` : '';
      throw new ConflictException(
        `לא ניתן להקטין את המבנה: קיימות משימות באזורים שיימחקו — ${listed}${more}`,
      );
    }
    return next;
  }

  /**
   * Owner only (§2 "פתיחת פרויקט ומחיקתו"). Soft delete: the project stops
   * being readable but its rows survive, so activities, documents and audit
   * entries that reference it stay intact (AUTH-3, DASH-6).
   */
  async remove(id: string, userId: string) {
    const project = await this.requireLive(id, userId, ProjectAction.DELETE_PROJECT);

    project.deletedAt = new Date();
    await this.repo.save(project);
    this.log.log(`project deleted (soft): id=${id} by=${userId}`);
  }

  // ---- internal guards ---------------------------------------------------

  private async requireMembership(projectId: string, userId: string) {
    const membership = await this.members.findActiveMembership(projectId, userId);
    if (!membership) throw new NotFoundException('הפרויקט לא נמצא');
    return membership;
  }

  /** Membership + permission + "the project still exists", in that order. */
  private async requireLive(projectId: string, userId: string, action: ProjectAction) {
    const membership = await this.requireMembership(projectId, userId);
    if (!can(membership.role, action)) {
      throw new ForbiddenException('אין לך הרשאה לבצע פעולה זו בפרויקט');
    }

    const project = await this.repo.findOne({ where: { id: projectId, deletedAt: IsNull() } });
    if (!project) throw new NotFoundException('הפרויקט לא נמצא');
    return project;
  }

  private assertDateOrder(start?: string | null, end?: string | null) {
    if (start && end && new Date(end) < new Date(start)) {
      throw new BadRequestException('תאריך הסיום המתוכנן מוקדם מתאריך ההתחלה');
    }
  }
}
