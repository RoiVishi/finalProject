import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AddMemberDto, ChangeMemberRoleDto } from './dto/project-member.dto';
import { ProjectMembersService } from './project-members.service';

/** AUTH-5: project membership. Authorization is per project, resolved by
 *  ProjectMembersService — not by the global system role. */
@Controller('projects/:projectId/members')
@UseGuards(JwtAuthGuard)
export class ProjectMembersController {
  constructor(private members: ProjectMembersService) {}

  @Get()
  list(@Param('projectId') projectId: string, @CurrentUser() me: AuthenticatedUser) {
    return this.members.list(projectId, me.userId);
  }

  @Post()
  add(
    @Param('projectId') projectId: string,
    @CurrentUser() me: AuthenticatedUser,
    @Body() dto: AddMemberDto,
  ) {
    return this.members.add(projectId, me.userId, dto);
  }

  @Patch(':memberId')
  changeRole(
    @Param('projectId') projectId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() me: AuthenticatedUser,
    @Body() dto: ChangeMemberRoleDto,
  ) {
    return this.members.changeRole(projectId, me.userId, memberId, dto.role);
  }

  @Delete(':memberId')
  @HttpCode(204)
  remove(
    @Param('projectId') projectId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() me: AuthenticatedUser,
  ) {
    return this.members.remove(projectId, me.userId, memberId);
  }
}
