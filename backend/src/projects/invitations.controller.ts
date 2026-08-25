import {
  Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateInviteLinkDto, InviteByEmailDto } from './dto/invitation.dto';
import { InvitationsService } from './invitations.service';

@Controller('projects/:projectId/invitations')
@UseGuards(JwtAuthGuard)
export class ProjectInvitationsController {
  constructor(private invitations: InvitationsService) {}

  @Get()
  list(@Param('projectId') projectId: string, @CurrentUser() me: AuthenticatedUser) {
    return this.invitations.list(projectId, me.userId);
  }

  /** Owner or project manager (§2). */
  @Post('email')
  inviteByEmail(
    @Param('projectId') projectId: string,
    @CurrentUser() me: AuthenticatedUser,
    @Body() dto: InviteByEmailDto,
  ) {
    return this.invitations.inviteByEmail(projectId, me.userId, dto);
  }

  /** Owner only (§2). Returns the raw token once; it is not recoverable. */
  @Post('link')
  createLink(
    @Param('projectId') projectId: string,
    @CurrentUser() me: AuthenticatedUser,
    @Body() dto: CreateInviteLinkDto,
  ) {
    return this.invitations.createLink(projectId, me.userId, dto);
  }

  @Delete(':invitationId')
  @HttpCode(204)
  revoke(
    @Param('projectId') projectId: string,
    @Param('invitationId') invitationId: string,
    @CurrentUser() me: AuthenticatedUser,
  ) {
    return this.invitations.revoke(projectId, me.userId, invitationId);
  }
}

/** Token-addressed: the holder acts on the invitation, not on the project. */
@Controller('invitations')
@UseGuards(JwtAuthGuard)
export class InvitationsController {
  constructor(private invitations: InvitationsService) {}

  @Post(':token/accept')
  accept(@Param('token') token: string, @CurrentUser() me: AuthenticatedUser) {
    return this.invitations.accept(token, me.userId);
  }

  @Post(':token/decline')
  @HttpCode(204)
  decline(@Param('token') token: string, @CurrentUser() me: AuthenticatedUser) {
    return this.invitations.decline(token, me.userId);
  }
}
