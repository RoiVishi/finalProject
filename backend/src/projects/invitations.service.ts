import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailService } from '../common/mail.service';
import { can, ProjectAction } from '../auth/permissions';
import { hashToken, newToken } from '../common/token.util';
import { UsersService } from '../users/users.service';
import {
  effectiveStatus, Invitation, InvitationStatus, InvitationType,
} from './invitation.entity';
import { ProjectRole } from './project-member.entity';
import { ProjectMembersService } from './project-members.service';

/** One message for every unusable link — never explain which way it failed. */
const UNUSABLE = 'ההזמנה אינה תקפה, פגה או בוטלה';

@Injectable()
export class InvitationsService {
  constructor(
    @InjectRepository(Invitation) private invitations: Repository<Invitation>,
    private members: ProjectMembersService,
    private users: UsersService,
    private mail: MailService,
    private cfg: ConfigService,
  ) {}

  /** NFR-DEMO-1: the 14-day window is configuration, not a constant. */
  private expiry(): Date {
    const days = Number(this.cfg.get('INVITE_TTL_DAYS', 14));
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private async requirePermission(
    projectId: string, actorId: string, action: ProjectAction,
  ) {
    const membership = await this.members.findActiveMembership(projectId, actorId);
    if (!membership) throw new NotFoundException('הפרויקט לא נמצא');
    if (!can(membership.role, action)) {
      throw new ForbiddenException('אין לך הרשאה להזמין לפרויקט זה');
    }
    return membership;
  }

  /** §2: owner or project manager, by e-mail. */
  async inviteByEmail(
    projectId: string,
    actorId: string,
    data: { email: string; role: ProjectRole; trade?: string },
  ) {
    await this.requirePermission(projectId, actorId, ProjectAction.MANAGE_MEMBERS);

    const existing = await this.users.findByEmail(data.email);
    if (existing && (await this.members.findActiveMembership(projectId, existing.id))) {
      throw new ConflictException('המשתמש כבר חבר פעיל בפרויקט');
    }

    const raw = newToken();
    const invitation = await this.invitations.save(
      this.invitations.create({
        project: { id: projectId } as never,
        type: InvitationType.EMAIL,
        invitedEmail: data.email,
        role: data.role,
        trade: data.trade,
        tokenHash: hashToken(raw),
        status: InvitationStatus.SENT,
        expiresAt: this.expiry(),
        invitedBy: { id: actorId } as never,
      }),
    );

    await this.mail.sendProjectInvitation(
      data.email, raw, invitation.project?.name ?? '',
    );
    return { id: invitation.id, status: InvitationStatus.SENT };
  }

  /**
   * §2: the shareable link is owner-only. Generating a new one revokes the
   * project's previous active link, so an old link stops working the moment
   * a replacement exists.
   */
  async createLink(
    projectId: string,
    actorId: string,
    data: { role: ProjectRole; trade?: string },
  ) {
    await this.requirePermission(projectId, actorId, ProjectAction.GENERATE_INVITE_LINK);

    await this.invitations.update(
      {
        project: { id: projectId } as never,
        type: InvitationType.LINK,
        status: InvitationStatus.SENT,
      },
      { status: InvitationStatus.REVOKED, respondedAt: new Date() },
    );

    const raw = newToken();
    await this.invitations.save(
      this.invitations.create({
        project: { id: projectId } as never,
        type: InvitationType.LINK,
        role: data.role,
        trade: data.trade,
        tokenHash: hashToken(raw),
        status: InvitationStatus.SENT,
        expiresAt: this.expiry(),
        invitedBy: { id: actorId } as never,
      }),
    );

    // The raw token is returned exactly once — it is not recoverable later.
    return { token: raw, expiresAt: this.expiry() };
  }

  async revoke(projectId: string, actorId: string, invitationId: string) {
    await this.requirePermission(projectId, actorId, ProjectAction.MANAGE_MEMBERS);
    const invitation = await this.invitations.findOne({ where: { id: invitationId } });
    if (!invitation) throw new NotFoundException('ההזמנה לא נמצאה');
    if (invitation.status !== InvitationStatus.SENT) {
      throw new BadRequestException('ניתן לבטל רק הזמנה ממתינה');
    }
    await this.invitations.update(invitationId, {
      status: InvitationStatus.REVOKED, respondedAt: new Date(),
    });
  }

  async list(projectId: string, actorId: string) {
    await this.requirePermission(projectId, actorId, ProjectAction.MANAGE_MEMBERS);
    const rows = await this.invitations.find({
      where: { project: { id: projectId } },
    });
    return rows.map((inv) => ({
      id: inv.id,
      type: inv.type,
      invitedEmail: inv.invitedEmail,
      role: inv.role,
      trade: inv.trade,
      status: effectiveStatus(inv), // expiry is derived, never stale
      expiresAt: inv.expiresAt,
    }));
  }

  /**
   * Validates a link WITHOUT consuming it. Signup-via-link calls this first,
   * so a bad link fails before an account is created rather than leaving an
   * orphan user with no membership.
   */
  async assertUsable(rawToken: string) {
    const invitation = await this.invitations.findOne({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (!invitation || effectiveStatus(invitation) !== InvitationStatus.SENT) {
      throw new BadRequestException(UNUSABLE);
    }
    return invitation;
  }

  /** Shared by the in-app accept and by signup-via-link (AUTH-1 + AUTH-4). */
  async accept(rawToken: string, userId: string) {
    const invitation = await this.invitations.findOne({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (!invitation || effectiveStatus(invitation) !== InvitationStatus.SENT) {
      throw new BadRequestException(UNUSABLE);
    }

    const projectId = invitation.project.id;
    if (await this.members.findActiveMembership(projectId, userId)) {
      throw new ConflictException('כבר יש לך חברות פעילה בפרויקט זה');
    }

    const membership = await this.members.attach(
      projectId, userId, invitation.role, invitation.trade,
    );
    await this.invitations.update(invitation.id, {
      status: InvitationStatus.ACCEPTED,
      acceptedBy: { id: userId } as never,
      respondedAt: new Date(),
    });
    return membership;
  }

  async decline(rawToken: string, userId: string) {
    const invitation = await this.invitations.findOne({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (!invitation || effectiveStatus(invitation) !== InvitationStatus.SENT) {
      throw new BadRequestException(UNUSABLE);
    }
    await this.invitations.update(invitation.id, {
      status: InvitationStatus.DECLINED,
      acceptedBy: { id: userId } as never,
      respondedAt: new Date(),
    });
  }
}
