import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MemberStatus, ProjectMember, ProjectRole } from './project-member.entity';

@Injectable()
export class ProjectMembersService {
  private readonly log = new Logger(ProjectMembersService.name);

  constructor(
    @InjectRepository(ProjectMember)
    private members: Repository<ProjectMember>,
  ) {}

  /**
   * AUTH-5 acceptance criterion: "guards resolve membership per request".
   * This is the single seam AUTH-2 will call on every protected route.
   * Returns null for a removed member — access is revoked immediately, even
   * though the row is kept for history.
   */
  findActiveMembership(projectId: string, userId: string) {
    return this.members.findOne({
      where: {
        project: { id: projectId },
        user: { id: userId },
        status: MemberStatus.ACTIVE,
      },
    });
  }

  /** Created by TASK-1 when a project is opened: the creator owns it. */
  createOwnerMembership(projectId: string, userId: string) {
    return this.members.save(
      this.members.create({
        project: { id: projectId } as never,
        user: { id: userId } as never,
        role: ProjectRole.OWNER,
        status: MemberStatus.ACTIVE,
      }),
    );
  }

  async list(projectId: string, actorId: string) {
    await this.requireMember(projectId, actorId);
    return this.members.find({ where: { project: { id: projectId } } });
  }

  async add(
    projectId: string,
    actorId: string,
    data: { userId: string; role: ProjectRole; trade?: string },
  ) {
    await this.requireOwner(projectId, actorId);

    if (await this.findActiveMembership(projectId, data.userId)) {
      throw new ConflictException('המשתמש כבר חבר פעיל בפרויקט');
    }

    const saved = await this.members.save(
      this.members.create({
        project: { id: projectId } as never,
        user: { id: data.userId } as never,
        role: data.role,
        trade: data.trade,
        status: MemberStatus.ACTIVE,
      }),
    );
    // TODO (AUTH-3): write an AuditLog row once that entity exists.
    this.log.log(`member added: project=${projectId} user=${data.userId} role=${data.role}`);
    return saved;
  }

  async changeRole(
    projectId: string, actorId: string, memberId: string, role: ProjectRole,
  ) {
    await this.requireOwner(projectId, actorId);
    const member = await this.requireMemberRow(projectId, memberId);

    if (member.role === ProjectRole.OWNER && role !== ProjectRole.OWNER) {
      await this.requireAnotherOwnerExists(projectId);
    }

    await this.members.update(member.id, { role });
    this.log.log(`role changed: member=${memberId} ${member.role} -> ${role}`);
    return { ...member, role };
  }

  /**
   * Soft removal: the row stays, status becomes REMOVED and removedAt is
   * stamped. History is preserved; access ends immediately because
   * findActiveMembership only matches ACTIVE.
   */
  async remove(projectId: string, actorId: string, memberId: string) {
    await this.requireOwner(projectId, actorId);
    const member = await this.requireMemberRow(projectId, memberId);

    if (member.role === ProjectRole.OWNER) {
      await this.requireAnotherOwnerExists(projectId);
    }

    await this.members.update(member.id, {
      status: MemberStatus.REMOVED,
      removedAt: new Date(),
    });
    this.log.log(`member removed: member=${memberId} project=${projectId}`);
  }

  // ---- internal guards -------------------------------------------------

  private async requireMember(projectId: string, userId: string) {
    const membership = await this.findActiveMembership(projectId, userId);
    if (!membership) throw new ForbiddenException('אינך חבר בפרויקט זה');
    return membership;
  }

  private async requireOwner(projectId: string, userId: string) {
    const membership = await this.requireMember(projectId, userId);
    if (membership.role !== ProjectRole.OWNER) {
      throw new ForbiddenException('הפעולה מותרת לבעלי הפרויקט בלבד');
    }
    return membership;
  }

  private async requireMemberRow(projectId: string, memberId: string) {
    const member = await this.members.findOne({
      where: { id: memberId, project: { id: projectId } },
    });
    if (!member || member.status === MemberStatus.REMOVED) {
      throw new NotFoundException('חבר הפרויקט לא נמצא');
    }
    return member;
  }

  /** A project must never be left without an owner. */
  private async requireAnotherOwnerExists(projectId: string) {
    const owners = await this.members.count({
      where: {
        project: { id: projectId },
        role: ProjectRole.OWNER,
        status: MemberStatus.ACTIVE,
      },
    });
    if (owners <= 1) {
      throw new BadRequestException('לא ניתן להשאיר פרויקט ללא בעלים');
    }
  }
}
