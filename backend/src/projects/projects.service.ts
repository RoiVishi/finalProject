import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { canCreateProject } from '../auth/permissions';
import { Profession } from '../users/user.entity';
import { ProjectMembersService } from './project-members.service';
import { Project } from './project.entity';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project) private repo: Repository<Project>,
    private members: ProjectMembersService,
  ) {}

  /**
   * The creator becomes the project owner (TASK-1). Without this no project
   * has an owner, and every AUTH-5 ownership check would be unreachable.
   *
   * AUTH-2: creation cannot be a membership check — there is no project to be
   * a member of yet — so it is gated on profession, per §2 note (3).
   */
  async create(data: Partial<Project>, creator: { userId: string; profession: Profession }) {
    if (!canCreateProject(creator.profession)) {
      throw new ForbiddenException('פתיחת פרויקט מותרת לקבלן ראשי או למנהל פרויקט');
    }
    const project = await this.repo.save(this.repo.create(data));
    await this.members.createOwnerMembership(project.id, creator.userId);
    return project;
  }

  /** Only projects the user is an active member of. */
  async findAllForUser(userId: string) {
    const memberships = await this.members.listForUser(userId);
    return memberships.map((m) => m.project);
  }

  /**
   * AUTH-2: a non-member gets 404, not 403 — a 403 would confirm that a
   * project with this id exists.
   */
  async findOne(id: string, userId: string) {
    const membership = await this.members.findActiveMembership(id, userId);
    if (!membership) throw new NotFoundException('הפרויקט לא נמצא');

    const p = await this.repo.findOne({ where: { id }, relations: { tasks: true } });
    if (!p) throw new NotFoundException('הפרויקט לא נמצא');
    return p;
  }
}
