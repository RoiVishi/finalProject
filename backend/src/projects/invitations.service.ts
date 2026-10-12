import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Raw, Repository } from 'typeorm';
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
    // The permission above is for projectId, so the invitation must belong to
    // it: an id from another project is "not found", never revocable.
    const invitation = await this.invitations.findOne({
      where: { id: invitationId, project: { id: projectId } },
    });
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
    return this.applyAccept(await this.usableByToken(rawToken), userId);
  }

  async decline(rawToken: string, userId: string) {
    return this.applyDecline(await this.usableByToken(rawToken), userId);
  }

  // ---- addressed to me: home screen (DASH-5, KAN-52) ----------------------

  /**
   * E-mail invitations waiting for the signed-in user: addressed to their
   * e-mail (case-insensitive), still sent and not expired. The token is never
   * returned - it lives only in the e-mailed link.
   */
  async mine(userId: string) {
    const email = await this.emailOf(userId);
    if (!email) return [];
    const rows = await this.invitations.find({
      where: {
        type: InvitationType.EMAIL,
        status: InvitationStatus.SENT,
        invitedEmail: Raw((col) => `LOWER(${col}) = LOWER(:email)`, { email }),
      },
      order: { expiresAt: 'ASC' },
    });
    return rows
      .filter((inv) => effectiveStatus(inv) === InvitationStatus.SENT)
      .map((inv) => ({
        id: inv.id,
        project: { id: inv.project.id, name: inv.project.name },
        role: inv.role,
        trade: inv.trade ?? null,
        invitedBy: inv.invitedBy ? { fullName: inv.invitedBy.fullName } : null,
        expiresAt: inv.expiresAt,
      }));
  }

  /** Accept by id from the home screen; same effect as accepting the link. */
  async acceptById(invitationId: string, userId: string) {
    return this.applyAccept(await this.usableById(invitationId, userId), userId);
  }

  async declineById(invitationId: string, userId: string) {
    return this.applyDecline(await this.usableById(invitationId, userId), userId);
  }

  // ---- internals ------------------------------------------------------------

  private async usableByToken(rawToken: string) {
    const invitation = await this.invitations.findOne({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (!invitation || effectiveStatus(invitation) !== InvitationStatus.SENT) {
      throw new BadRequestException(UNUSABLE);
    }
    return invitation;
  }

  /**
   * By id, the invitation must be an e-mail invitation addressed to this
   * user, still sent and not expired. Every other case is 404, never 403:
   * a 403 would confirm that an invitation with this id exists.
   */
  private async usableById(invitationId: string, userId: string) {
    const [invitation, email] = await Promise.all([
      this.invitations.findOne({ where: { id: invitationId, type: InvitationType.EMAIL } }),
      this.emailOf(userId),
    ]);
    const mineAndOpen = invitation && email
      && invitation.invitedEmail?.toLowerCase() === email.toLowerCase()
      && effectiveStatus(invitation) === InvitationStatus.SENT;
    if (!mineAndOpen) throw new NotFoundException('ההזמנה לא נמצאה');
    return invitation;
  }

  /** From the database, not the JWT: the token keeps the e-mail it was issued with. */
  private async emailOf(userId: string): Promise<string | null> {
    return (await this.users.findById(userId))?.email ?? null;
  }

  private async applyAccept(invitation: Invitation, userId: string) {
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

  private async applyDecline(invitation: Invitation, userId: string) {
    await this.invitations.update(invitation.id, {
      status: InvitationStatus.DECLINED,
      acceptedBy: { id: userId } as never,
      respondedAt: new Date(),
    });
  }
}
