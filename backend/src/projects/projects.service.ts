import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
   */
  async create(data: Partial<Project>, creatorUserId: string) {
    const project = await this.repo.save(this.repo.create(data));
    await this.members.createOwnerMembership(project.id, creatorUserId);
    return project;
  }

  findAll() {
    return this.repo.find();
  }

  async findOne(id: string) {
    const p = await this.repo.findOne({ where: { id }, relations: { tasks: true } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }
}
