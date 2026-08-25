import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hashToken } from '../common/token.util';
import { effectiveStatus, InvitationStatus, InvitationType } from './invitation.entity';
import { InvitationsService } from './invitations.service';
import { MemberStatus, ProjectRole } from './project-member.entity';

const PROJECT = 'p1';
const DAY = 24 * 60 * 60 * 1000;
const owner = { role: ProjectRole.OWNER, status: MemberStatus.ACTIVE };
const pm = { role: ProjectRole.PROJECT_MANAGER, status: MemberStatus.ACTIVE };
const engineer = { role: ProjectRole.ENGINEER, status: MemberStatus.ACTIVE };

describe('AUTH-4 — project invitations', () => {
  let service: InvitationsService;
  let repo: { findOne: jest.Mock; find: jest.Mock; create: jest.Mock; save: jest.Mock; update: jest.Mock };
  let members: { findActiveMembership: jest.Mock; attach: jest.Mock };
  let users: { findByEmail: jest.Mock };
  let mail: { sendProjectInvitation: jest.Mock };

  const liveInvite = (over = {}) => ({
    id: 'i1',
    project: { id: PROJECT, name: 'מגדל הרצל' },
    type: InvitationType.LINK,
    role: ProjectRole.SUBCONTRACTOR,
    trade: 'electrical',
    tokenHash: hashToken('raw'),
    status: InvitationStatus.SENT,
    expiresAt: new Date(Date.now() + 7 * DAY),
    ...over,
  });

  beforeEach(() => {
    repo = {
      findOne: jest.fn(),
      find: jest.fn(async () => []),
      create: jest.fn((d) => d),
      save: jest.fn(async (d) => ({ ...d, id: 'i-new' })),
      update: jest.fn(),
    };
    members = { findActiveMembership: jest.fn(), attach: jest.fn(async () => ({ id: 'm-new' })) };
    users = { findByEmail: jest.fn() };
    mail = { sendProjectInvitation: jest.fn() };
    const cfg = { get: (_k: string, d: unknown) => d } as unknown as ConfigService;
    service = new InvitationsService(
      repo as never, members as never, users as never, mail as never, cfg,
    );
  });

  describe('invite by e-mail (owner or PM, §2)', () => {
    it('404s a non-member rather than confirming the project exists', async () => {
      members.findActiveMembership.mockResolvedValue(null);
      await expect(
        service.inviteByEmail(PROJECT, 'u-stranger', { email: 'a@b.com', role: ProjectRole.ENGINEER }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses an engineer', async () => {
      members.findActiveMembership.mockResolvedValue(engineer);
      await expect(
        service.inviteByEmail(PROJECT, 'u-eng', { email: 'a@b.com', role: ProjectRole.ENGINEER }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('allows a project manager', async () => {
      members.findActiveMembership.mockResolvedValueOnce(pm).mockResolvedValueOnce(null);
      users.findByEmail.mockResolvedValue(null);

      const res = await service.inviteByEmail(PROJECT, 'u-pm', {
        email: 'new@site.com', role: ProjectRole.SUBCONTRACTOR, trade: 'electrical',
      });

      expect(res.status).toBe(InvitationStatus.SENT);
      expect(mail.sendProjectInvitation).toHaveBeenCalled();
    });

    it('rejects inviting someone who is already an active member', async () => {
      members.findActiveMembership.mockResolvedValueOnce(owner).mockResolvedValueOnce({ id: 'm1' });
      users.findByEmail.mockResolvedValue({ id: 'u-existing' });

      await expect(
        service.inviteByEmail(PROJECT, 'u-owner', { email: 'in@site.com', role: ProjectRole.ENGINEER }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('stores only the hash — the token exists solely in the e-mailed link', async () => {
      members.findActiveMembership.mockResolvedValueOnce(owner).mockResolvedValueOnce(null);
      users.findByEmail.mockResolvedValue(null);

      await service.inviteByEmail(PROJECT, 'u-owner', { email: 'new@site.com', role: ProjectRole.ENGINEER });

      const rawSent = mail.sendProjectInvitation.mock.calls[0][1];
      const stored = repo.save.mock.calls[0][0];
      expect(stored.tokenHash).toBe(hashToken(rawSent));
      expect(stored.tokenHash).not.toBe(rawSent);
    });
  });

  describe('shareable link (owner only, §2)', () => {
    it('refuses a project manager', async () => {
      members.findActiveMembership.mockResolvedValue(pm);
      await expect(
        service.createLink(PROJECT, 'u-pm', { role: ProjectRole.SUBCONTRACTOR }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('revokes the previous active link before issuing a new one', async () => {
      members.findActiveMembership.mockResolvedValue(owner);

      const res = await service.createLink(PROJECT, 'u-owner', {
        role: ProjectRole.SUBCONTRACTOR, trade: 'plumbing',
      });

      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ type: InvitationType.LINK, status: InvitationStatus.SENT }),
        expect.objectContaining({ status: InvitationStatus.REVOKED }),
      );
      expect(res.token).toEqual(expect.any(String));
      expect(repo.save.mock.calls[0][0].tokenHash).toBe(hashToken(res.token));
    });

    it('expires the link 14 days out by default', async () => {
      members.findActiveMembership.mockResolvedValue(owner);
      await service.createLink(PROJECT, 'u-owner', { role: ProjectRole.ENGINEER });

      const days = (repo.save.mock.calls[0][0].expiresAt.getTime() - Date.now()) / DAY;
      expect(days).toBeGreaterThan(13.9);
      expect(days).toBeLessThanOrEqual(14);
    });
  });

  describe('accept', () => {
    it('creates the membership with the invited role and trade', async () => {
      repo.findOne.mockResolvedValue(liveInvite());
      members.findActiveMembership.mockResolvedValue(null);

      await service.accept('raw', 'u-new');

      expect(members.attach).toHaveBeenCalledWith(
        PROJECT, 'u-new', ProjectRole.SUBCONTRACTOR, 'electrical',
      );
      expect(repo.update).toHaveBeenCalledWith('i1', expect.objectContaining({
        status: InvitationStatus.ACCEPTED,
      }));
    });

    it('refuses an expired link and creates no membership', async () => {
      repo.findOne.mockResolvedValue(liveInvite({ expiresAt: new Date(Date.now() - DAY) }));

      await expect(service.accept('raw', 'u-new')).rejects.toBeInstanceOf(BadRequestException);
      expect(members.attach).not.toHaveBeenCalled();
    });

    it('refuses a revoked link and creates no membership', async () => {
      repo.findOne.mockResolvedValue(liveInvite({ status: InvitationStatus.REVOKED }));

      await expect(service.accept('raw', 'u-new')).rejects.toBeInstanceOf(BadRequestException);
      expect(members.attach).not.toHaveBeenCalled();
    });

    it('gives an unknown token the same message as an expired one', async () => {
      repo.findOne.mockResolvedValue(null);
      const unknown = await service.accept('nope', 'u-new').catch((e) => e);

      repo.findOne.mockResolvedValue(liveInvite({ expiresAt: new Date(Date.now() - DAY) }));
      const expired = await service.accept('raw', 'u-new').catch((e) => e);

      expect(unknown.message).toBe(expired.message);
    });

    it('rejects someone who is already a member', async () => {
      repo.findOne.mockResolvedValue(liveInvite());
      members.findActiveMembership.mockResolvedValue({ id: 'm1' });

      await expect(service.accept('raw', 'u-in')).rejects.toBeInstanceOf(ConflictException);
      expect(members.attach).not.toHaveBeenCalled();
    });
  });

  describe('decline', () => {
    it('marks the invitation declined without creating a membership', async () => {
      repo.findOne.mockResolvedValue(liveInvite());

      await service.decline('raw', 'u-new');

      expect(repo.update).toHaveBeenCalledWith('i1', expect.objectContaining({
        status: InvitationStatus.DECLINED,
      }));
      expect(members.attach).not.toHaveBeenCalled();
    });
  });

  describe('expiry is derived, never stale', () => {
    it('reports a past-dated SENT invitation as EXPIRED without a scheduled job', () => {
      const past = liveInvite({ expiresAt: new Date(Date.now() - DAY) }) as never;
      expect(effectiveStatus(past)).toBe(InvitationStatus.EXPIRED);
      expect(effectiveStatus(liveInvite() as never)).toBe(InvitationStatus.SENT);
    });
  });
});
