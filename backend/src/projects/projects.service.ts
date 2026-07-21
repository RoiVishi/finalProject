import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './project.entity';

@Injectable()
export class ProjectsService {
  constructor(@InjectRepository(Project) private repo: Repository<Project>) {}

  create(data: Partial<Project>) {
    return this.repo.save(this.repo.create(data));
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
