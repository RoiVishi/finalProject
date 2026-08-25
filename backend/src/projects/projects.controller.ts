import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Profession } from '../users/user.entity';
import { CreateProjectDto, UpdateProjectDto } from './dto/create-project.dto';
import { ProjectsService } from './projects.service';

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

  /** TASK-1 — the three wizard steps arrive as one payload. */
  @Post()
  create(@Body() dto: CreateProjectDto, @CurrentUser() me: AuthenticatedUser) {
    return this.projects.create(dto, {
      userId: me.userId,
      email: me.email,
      profession: me.profession as Profession,
    });
  }

  @Get()
  findAll(@CurrentUser() me: AuthenticatedUser) {
    return this.projects.findAllForUser(me.userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() me: AuthenticatedUser) {
    return this.projects.findOne(id, me.userId);
  }

  /** The F×Z zone list the Digital Twin renders (TWIN-1). */
  @Get(':id/zones')
  zones(@Param('id') id: string, @CurrentUser() me: AuthenticatedUser) {
    return this.projects.zones(id, me.userId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() me: AuthenticatedUser,
  ) {
    return this.projects.update(id, me.userId, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() me: AuthenticatedUser) {
    return this.projects.remove(id, me.userId);
  }
}
