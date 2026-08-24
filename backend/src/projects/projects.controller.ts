import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { RolesGuard } from '../auth/roles.guard';
import { ProjectsService } from './projects.service';

class CreateProjectDto {
  @IsString() name: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsInt() @Min(1) floors?: number;
}

@Controller('projects')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ProjectsController {
  constructor(private projects: ProjectsService) {}

  @Post()
  // TODO (AUTH-2 + AUTH-5): site-role authorization moves to a per-project
  // guard backed by ProjectMember. Until then the route is authenticated only.
  create(@Body() dto: CreateProjectDto) {
    return this.projects.create({
      name: dto.name,
      address: dto.address,
      layout: dto.floors ? { floors: dto.floors, zonesPerFloor: ['north', 'south', 'east', 'west'] } : null,
    });
  }

  @Get()
  findAll() {
    return this.projects.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.projects.findOne(id);
  }
}
