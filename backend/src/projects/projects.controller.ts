import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.entity';
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
  @Roles(UserRole.ADMIN, UserRole.PROJECT_MANAGER)
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
