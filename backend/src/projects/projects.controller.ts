import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { AuthenticatedUser, CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Profession } from '../users/user.entity';
import { ProjectsService } from './projects.service';

class CreateProjectDto {
  @IsString() name: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsInt() @Min(1) floors?: number;
}

/**
 * AUTH-2 note: these routes enforce membership through ProjectsService rather
 * than through ProjectPermissionGuard. The guard lives in AuthzModule, which
 * imports ProjectsModule to resolve membership — so ProjectsModule cannot
 * import it back without a circular dependency. Flagged for review.
 */
@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private projects: ProjectsService) {}

  @Post()
  create(@Body() dto: CreateProjectDto, @CurrentUser() me: AuthenticatedUser) {
    return this.projects.create(
      {
        name: dto.name,
        address: dto.address,
        layout: dto.floors
          ? { floors: dto.floors, zonesPerFloor: ['north', 'south', 'east', 'west'] }
          : null,
      },
      { userId: me.userId, profession: me.profession as Profession },
    );
  }

  @Get()
  findAll(@CurrentUser() me: AuthenticatedUser) {
    return this.projects.findAllForUser(me.userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() me: AuthenticatedUser) {
    return this.projects.findOne(id, me.userId);
  }
}
