import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvitationStatus, InvitationType } from './invitation.entity';
import { InvitationsService } from './invitations.service';
import { ProjectRole } from './project-member.entity';

/**
 * DASH-5 (KAN-52) home screen: pending e-mail invitations addressed to me,
 * and accept / decline by id. Anything not mine-and-open is 404, never 403.
 */
const DAY = 24 * 60 * 60 * 1000;
const ME = { id: 'u-me', email: 'Shira@Example.com' };

describe('AUTH-4 — invitations addressed to me (KAN-52)', () => {
  let service: InvitationsService;
  let repo: { find: jest.Mock; findOne: jest.Mock; update: jest.Mock };
  let members: { findActiveMembership: jest.Mock; attach: jest.Mock };

  const invite = (over: Record<string, unknown> = {}) => ({
    id: 'i1',
    type: InvitationType.EMAIL,
    project: { id: 'p1', name: 'מגדל הרצל', layout: {} },
    invitedEmail: 'shira@example.com',
    role: ProjectRole.ENGINEER,
    trade: null,
    tokenHash: 'secret-hash',
    status: InvitationStatus.SENT,
    expiresAt: new Date(Date.now() + 7 * DAY),
    invitedBy: { id: 'u-owner', fullName: 'רועי וישנגרד', passwordHash: 'x' },
    ...over,
  });

  beforeEach(() => {
    repo = { find: jest.fn(async () => []), findOne: jest.fn(), update: jest.fn() };
    members = {
      findActiveMembership: jest.fn(async () => null),
      attach: jest.fn(async () => ({ id: 'm-new' })),
    };
    const users = { findById: jest.fn(async (id: string) => (id === ME.id ? ME : null)) };
    const cfg = { get: (_k: string, d: unknown) => d } as unknown as ConfigService;
    service = new InvitationsService(
      repo as never, members as never, users as never, {} as never, cfg,
    );
  });

  describe('GET /invitations/mine', () => {
    it('asks only for sent e-mail invitations to my address, case-insensitively', async () => {
      await service.mine(ME.id);

      const { where } = repo.find.mock.calls[0][0];
      expect(where).toMatchObject({ type: InvitationType.EMAIL, status: InvitationStatus.SENT });
      expect(where.invitedEmail.getSql('email_col')).toBe('LOWER(email_col) = LOWER(:email)');
      expect(where.invitedEmail.objectLiteralParameters).toEqual({ email: ME.email });
    });

    it('returns exactly the agreed shape - no token, no internal fields', async () => {
      repo.find.mockResolvedValue([invite()]);

      expect(await service.mine(ME.id)).toEqual([{
        id: 'i1',
        project: { id: 'p1', name: 'מגדל הרצל' },
        role: ProjectRole.ENGINEER,
        trade: null,
        invitedBy: { fullName: 'רועי וישנגרד' },
        expiresAt: expect.any(Date),
      }]);
    });

    it('leaves out an invitation that expired while still "sent"', async () => {
      repo.find.mockResolvedValue([invite({ expiresAt: new Date(Date.now() - DAY) })]);
      expect(await service.mine(ME.id)).toEqual([]);
    });
  });

  describe('POST /invitations/by-id/:id/accept and /decline', () => {
    it('accepts my invitation even when the e-mail differs only in case', async () => {
      repo.findOne.mockResolvedValue(invite({ invitedEmail: 'SHIRA@example.COM' }));

      await service.acceptById('i1', ME.id);

      expect(members.attach).toHaveBeenCalledWith('p1', ME.id, ProjectRole.ENGINEER, null);
      expect(repo.update).toHaveBeenCalledWith('i1', expect.objectContaining({
        status: InvitationStatus.ACCEPTED,
      }));
    });

    it('404s an invitation sent to someone else\'s e-mail, and changes nothing', async () => {
      repo.findOne.mockResolvedValue(invite({ invitedEmail: 'roi@example.com' }));

      await expect(service.acceptById('i1', ME.id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.declineById('i1', ME.id)).rejects.toBeInstanceOf(NotFoundException);
      expect(members.attach).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it.each([
      ['expired', { expiresAt: new Date(Date.now() - DAY) }],
      ['revoked', { status: InvitationStatus.REVOKED }],
      ['already accepted', { status: InvitationStatus.ACCEPTED }],
    ])('404s an %s invitation', async (_label, over) => {
      repo.findOne.mockResolvedValue(invite(over));
      await expect(service.acceptById('i1', ME.id)).rejects.toBeInstanceOf(NotFoundException);
      expect(members.attach).not.toHaveBeenCalled();
    });

    it('404s an unknown id or a shareable-link invitation (only e-mail ones by id)', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.acceptById('nope', ME.id)).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'nope', type: InvitationType.EMAIL } });
    });

    it('declines my invitation', async () => {
      repo.findOne.mockResolvedValue(invite());

      await service.declineById('i1', ME.id);

      expect(repo.update).toHaveBeenCalledWith('i1', expect.objectContaining({
        status: InvitationStatus.DECLINED,
      }));
      expect(members.attach).not.toHaveBeenCalled();
    });
  });
});
