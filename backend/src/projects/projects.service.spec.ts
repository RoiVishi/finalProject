import {
  BadRequestException, ConflictException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { Profession } from '../users/user.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { buildLayout } from './layout';
import { MemberStatus, ProjectRole } from './project-member.entity';
import { ProjectsService } from './projects.service';

const OWNER = { userId: 'u-owner', email: 'owner@example.com', profession: Profession.MAIN_CONTRACTOR };
const PROJECT = 'p1';

const wizard = (over: Partial<CreateProjectDto> = {}): CreateProjectDto => ({
  details: { name: 'מגדל הרצל' },
  layout: { floors: 3, zonesPerFloor: 4 },
  ...over,
} as CreateProjectDto);

describe('TASK-1 — project CRUD and the 3-step wizard', () => {
  let service: ProjectsService;
  let projects: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let tasks: { find: jest.Mock };
  let members: {
    createOwnerMembership: jest.Mock; findActiveMembership: jest.Mock; listForUser: jest.Mock;
  };
  let invitations: { inviteByEmail: jest.Mock };
  /** project role of the acting user, per user id */
  let roles: Record<string, ProjectRole>;
  let stored: Record<string, unknown>;

  beforeEach(() => {
    roles = {
      'u-owner': ProjectRole.OWNER,
      'u-pm': ProjectRole.PROJECT_MANAGER,
      'u-eng': ProjectRole.ENGINEER,
    };
    stored = {
      id: PROJECT,
      name: 'מגדל הרצל',
      layout: buildLayout({ floors: 2, zonesPerFloor: 2 }),
      plannedStart: null,
      plannedEnd: null,
      deletedAt: null,
    };

    projects = {
      create: jest.fn((d) => d),
      save: jest.fn(async (d) => ({ id: PROJECT, ...d })),
      findOne: jest.fn(async () => stored),
    };
    tasks = { find: jest.fn(async () => []) };
    members = {
      createOwnerMembership: jest.fn(),
      findActiveMembership: jest.fn(async (_p: string, userId: string) =>
        (roles[userId] ? { role: roles[userId], status: MemberStatus.ACTIVE } : null),
      ),
      listForUser: jest.fn(async () => []),
    };
    invitations = { inviteByEmail: jest.fn(async () => ({ status: 'sent' })) };

    service = new ProjectsService(
      projects as never, tasks as never, members as never, invitations as never,
    );
  });

  // ---- creation --------------------------------------------------------

  describe('create — who may open a project (AUTH-2, §2 note 3)', () => {
    it.each([Profession.MAIN_CONTRACTOR, Profession.PROJECT_MANAGER])(
      'lets a %s open one', async (profession) => {
        await service.create(wizard(), { ...OWNER, profession });
        expect(projects.save).toHaveBeenCalled();
      },
    );

    it.each([Profession.ENGINEER, Profession.SUBCONTRACTOR, Profession.INSPECTOR])(
      'refuses a %s and saves nothing', async (profession) => {
        await expect(service.create(wizard(), { ...OWNER, profession }))
          .rejects.toBeInstanceOf(ForbiddenException);
        expect(projects.save).not.toHaveBeenCalled();
      },
    );
  });

  describe('create — step 1: details', () => {
    it('trims the text the user typed', async () => {
      await service.create(
        wizard({ details: { name: '  מגדל הרצל  ', address: ' באר שבע ' } } as never),
        OWNER,
      );

      expect(projects.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'מגדל הרצל', address: 'באר שבע' }),
      );
    });

    it('rejects a planned finish that precedes the planned start', async () => {
      await expect(service.create(
        wizard({ details: { name: 'מגדל', plannedStart: '2026-05-01', plannedEnd: '2026-04-01' } } as never),
        OWNER,
      )).rejects.toBeInstanceOf(BadRequestException);
      expect(projects.save).not.toHaveBeenCalled();
    });
  });

  describe('create — step 2: layout, and the creator becomes the owner', () => {
    it('persists F and Z and reports F×Z zones', async () => {
      const result = await service.create(wizard(), OWNER);

      expect(projects.save).toHaveBeenCalledWith(
        expect.objectContaining({ layout: expect.objectContaining({ floors: 3, zonesPerFloor: 4 }) }),
      );
      expect(result.zoneCount).toBe(12);
    });

    it('makes the creator the project owner — nothing else can grant ownership', async () => {
      await service.create(wizard(), OWNER);

      expect(members.createOwnerMembership).toHaveBeenCalledWith(PROJECT, 'u-owner');
    });

    it('rejects an impossible layout before the project row is written', async () => {
      await expect(service.create(wizard({ layout: { floors: 0, zonesPerFloor: 4 } }), OWNER))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(projects.save).not.toHaveBeenCalled();
      expect(members.createOwnerMembership).not.toHaveBeenCalled();
    });
  });

  describe('create — step 3: initial team (skippable)', () => {
    it('creates the project with no invitations when the step is skipped', async () => {
      const result = await service.create(wizard(), OWNER);

      expect(invitations.inviteByEmail).not.toHaveBeenCalled();
      expect(result.team).toEqual([]);
    });

    it('invites every address through AUTH-4', async () => {
      const result = await service.create(wizard({
        team: [
          { email: 'pm@example.com', role: ProjectRole.PROJECT_MANAGER },
          { email: 'sub@example.com', role: ProjectRole.SUBCONTRACTOR, trade: 'electrical' },
        ],
      }), OWNER);

      expect(invitations.inviteByEmail).toHaveBeenCalledTimes(2);
      expect(invitations.inviteByEmail).toHaveBeenLastCalledWith(PROJECT, 'u-owner', {
        email: 'sub@example.com', role: ProjectRole.SUBCONTRACTOR, trade: 'electrical',
      });
      expect(result.team).toEqual([
        { email: 'pm@example.com', status: 'sent' },
        { email: 'sub@example.com', status: 'sent' },
      ]);
    });

    it('does not invite the creator, who is already the owner', async () => {
      const result = await service.create(
        wizard({ team: [{ email: 'OWNER@example.com', role: ProjectRole.ENGINEER }] }),
        OWNER,
      );

      expect(invitations.inviteByEmail).not.toHaveBeenCalled();
      expect(result.team[0]).toMatchObject({ status: 'failed' });
    });

    it('sends one invitation for an address listed twice', async () => {
      const result = await service.create(wizard({
        team: [
          { email: 'pm@example.com', role: ProjectRole.PROJECT_MANAGER },
          { email: 'PM@example.com', role: ProjectRole.ENGINEER },
        ],
      }), OWNER);

      expect(invitations.inviteByEmail).toHaveBeenCalledTimes(1);
      expect(result.team[1]).toMatchObject({ status: 'failed' });
    });

    it('keeps the project when an invitation fails, and reports which one', async () => {
      invitations.inviteByEmail
        .mockRejectedValueOnce(new Error('SMTP down'))
        .mockResolvedValueOnce({ status: 'sent' });

      const result = await service.create(wizard({
        team: [
          { email: 'a@example.com', role: ProjectRole.ENGINEER },
          { email: 'b@example.com', role: ProjectRole.ENGINEER },
        ],
      }), OWNER);

      expect(projects.save).toHaveBeenCalled();
      expect(result.team).toEqual([
        { email: 'a@example.com', status: 'failed', reason: 'SMTP down' },
        { email: 'b@example.com', status: 'sent' },
      ]);
    });
  });

  // ---- read ------------------------------------------------------------

  describe('read', () => {
    it('hides a project from a non-member behind a 404, never a 403', async () => {
      await expect(service.findOne(PROJECT, 'u-stranger'))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(projects.findOne).not.toHaveBeenCalled();
    });

    it('serves the Twin exactly F×Z zones', async () => {
      stored = { ...stored, layout: buildLayout({ floors: 5, zonesPerFloor: 3 }) };

      const zones = await service.zones(PROJECT, 'u-eng');

      expect(zones).toHaveLength(15);
      expect(zones[0].id).toBe('floor-1/zone-1');
    });

    it('serves no zones for a project whose layout was never set', async () => {
      stored = { ...stored, layout: null };

      expect(await service.zones(PROJECT, 'u-eng')).toEqual([]);
    });

    it('leaves deleted projects out of "my projects"', async () => {
      members.listForUser.mockResolvedValueOnce([
        { project: { id: 'live', deletedAt: null } },
        { project: { id: 'gone', deletedAt: new Date() } },
      ]);

      expect(await service.findAllForUser('u-owner')).toEqual([{ id: 'live', deletedAt: null }]);
    });
  });

  // ---- update ----------------------------------------------------------

  describe('update — owner and PM only (§2 "עריכת מבנה המבנה")', () => {
    it('lets the project manager edit the details', async () => {
      await service.update(PROJECT, 'u-pm', { details: { name: 'מגדל חדש' } });

      expect(projects.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'מגדל חדש' }),
      );
    });

    it('refuses an engineer', async () => {
      await expect(service.update(PROJECT, 'u-eng', { details: { name: 'x' } }))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(projects.save).not.toHaveBeenCalled();
    });

    it('refuses a non-member with a 404', async () => {
      await expect(service.update(PROJECT, 'u-stranger', { details: { name: 'x' } }))
        .rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets the building grow without touching the tasks table', async () => {
      await service.update(PROJECT, 'u-owner', { layout: { floors: 4, zonesPerFloor: 2 } });

      expect(tasks.find).not.toHaveBeenCalled();
      expect(projects.save).toHaveBeenCalledWith(
        expect.objectContaining({ layout: expect.objectContaining({ floors: 4 }) }),
      );
    });

    it('shrinks the building when the zones that disappear are empty', async () => {
      await service.update(PROJECT, 'u-owner', { layout: { floors: 1, zonesPerFloor: 2 } });

      expect(tasks.find).toHaveBeenCalled();
      expect(projects.save).toHaveBeenCalled();
    });

    it('refuses to delete a zone that activities still sit in, and names them', async () => {
      tasks.find.mockResolvedValue([
        { id: 't1', name: 'ריצוף', zone: 'floor-2/zone-1' },
      ]);

      const attempt = service.update(PROJECT, 'u-owner', { layout: { floors: 1, zonesPerFloor: 2 } });

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(/ריצוף \(floor-2\/zone-1\)/);
      expect(projects.save).not.toHaveBeenCalled();
    });

    it('validates the merged date range, not only the fields that were sent', async () => {
      stored = { ...stored, plannedStart: '2026-05-01' };

      await expect(service.update(PROJECT, 'u-owner', { details: { plannedEnd: '2026-01-01' } }))
        .rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ---- delete ----------------------------------------------------------

  describe('delete — owner only (§2 "פתיחת פרויקט ומחיקתו")', () => {
    it('refuses the project manager', async () => {
      await expect(service.remove(PROJECT, 'u-pm')).rejects.toBeInstanceOf(ForbiddenException);
      expect(projects.save).not.toHaveBeenCalled();
    });

    it('stamps deletedAt instead of dropping the row, so history survives', async () => {
      await service.remove(PROJECT, 'u-owner');

      expect(projects.save).toHaveBeenCalledWith(
        expect.objectContaining({ deletedAt: expect.any(Date) }),
      );
    });

    it('treats an already-deleted project as gone', async () => {
      projects.findOne.mockResolvedValueOnce(null);

      await expect(service.remove(PROJECT, 'u-owner')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
