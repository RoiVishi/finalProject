import {
  BadRequestException, ConflictException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { MemberStatus, ProjectRole } from './project-member.entity';
import { ProjectMembersService } from './project-members.service';

const PROJECT = 'p1';
const OWNER = { id: 'm-owner', role: ProjectRole.OWNER, status: MemberStatus.ACTIVE };
const ENGINEER = { id: 'm-eng', role: ProjectRole.ENGINEER, status: MemberStatus.ACTIVE };

describe('AUTH-5 — project membership', () => {
  let service: ProjectMembersService;
  let repo: {
    findOne: jest.Mock; find: jest.Mock; create: jest.Mock;
    save: jest.Mock; update: jest.Mock; count: jest.Mock; delete: jest.Mock;
  };
  /** active membership per user id — what findActiveMembership resolves */
  let byUser: Record<string, unknown>;
  /** membership rows per row id — what requireMemberRow resolves */
  let byId: Record<string, unknown>;

  beforeEach(() => {
    byUser = { 'u-owner': OWNER, 'u-eng': ENGINEER };
    byId = { 'm-owner': OWNER, 'm-eng': ENGINEER };
    repo = {
      findOne: jest.fn(async ({ where }) =>
        where.id ? (byId[where.id] ?? null) : (byUser[where.user?.id] ?? null),
      ),
      find: jest.fn(async () => Object.values(byId)),
      create: jest.fn((d) => d),
      save: jest.fn(async (d) => ({ ...d, id: 'm-new' })),
      update: jest.fn(),
      count: jest.fn(async () => 1),
      delete: jest.fn(),
    };
    service = new ProjectMembersService(repo as never);
  });

  describe('findActiveMembership — the seam AUTH-2 will call', () => {
    it('asks only for ACTIVE rows, so a removed member loses access at once', async () => {
      await service.findActiveMembership(PROJECT, 'u-eng');

      expect(repo.findOne).toHaveBeenCalledWith({
        where: {
          project: { id: PROJECT },
          user: { id: 'u-eng' },
          status: MemberStatus.ACTIVE,
        },
      });
    });
  });

  describe('add', () => {
    it('refuses a member who is not the owner', async () => {
      await expect(service.add(PROJECT, 'u-eng', { userId: 'u-new', role: ProjectRole.ENGINEER }))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('refuses someone who is not in the project at all', async () => {
      await expect(service.add(PROJECT, 'u-stranger', { userId: 'u-new', role: ProjectRole.ENGINEER }))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets the owner add a member with a role and a trade', async () => {
      await service.add(PROJECT, 'u-owner', {
        userId: 'u-new', role: ProjectRole.SUBCONTRACTOR, trade: 'electrical',
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          role: ProjectRole.SUBCONTRACTOR,
          trade: 'electrical',
          status: MemberStatus.ACTIVE,
        }),
      );
    });

    it('rejects adding someone who is already an active member', async () => {
      await expect(service.add(PROJECT, 'u-owner', { userId: 'u-eng', role: ProjectRole.ENGINEER }))
        .rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('changeRole', () => {
    it('lets the owner change another member role', async () => {
      await service.changeRole(PROJECT, 'u-owner', 'm-eng', ProjectRole.PROJECT_MANAGER);
      expect(repo.update).toHaveBeenCalledWith('m-eng', { role: ProjectRole.PROJECT_MANAGER });
    });

    it('refuses to demote the only owner', async () => {
      repo.count.mockResolvedValue(1);
      await expect(service.changeRole(PROJECT, 'u-owner', 'm-owner', ProjectRole.ENGINEER))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('allows demoting an owner when another owner remains', async () => {
      repo.count.mockResolvedValue(2);
      await service.changeRole(PROJECT, 'u-owner', 'm-owner', ProjectRole.ENGINEER);
      expect(repo.update).toHaveBeenCalled();
    });

    it('404s on a member of another project', async () => {
      await expect(service.changeRole(PROJECT, 'u-owner', 'm-ghost', ProjectRole.ENGINEER))
        .rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('keeps the row and marks it removed — history is preserved', async () => {
      await service.remove(PROJECT, 'u-owner', 'm-eng');

      expect(repo.update).toHaveBeenCalledWith('m-eng', {
        status: MemberStatus.REMOVED,
        removedAt: expect.any(Date),
      });
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('refuses to remove the last owner', async () => {
      repo.count.mockResolvedValue(1);
      await expect(service.remove(PROJECT, 'u-owner', 'm-owner'))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a non-owner actor', async () => {
      await expect(service.remove(PROJECT, 'u-eng', 'm-owner'))
        .rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
