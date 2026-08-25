import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Profession, SystemRole } from '../users/user.entity';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';

const VALID = {
  email: 'shira@test.com',
  password: 'Test1234',
  fullName: 'Shira Borros',
  phone: '050-1234567',
  profession: Profession.ENGINEER,
};

/** Collects the property names that failed validation. */
async function invalidFields(payload: Record<string, unknown>) {
  const errors = await validate(plainToInstance(RegisterDto, payload));
  return errors.map((e) => e.property);
}

describe('AUTH-1 — registration and login', () => {
  let service: AuthService;
  let users: { create: jest.Mock; findByEmailWithPassword: jest.Mock };
  let invitations: { assertUsable: jest.Mock; accept: jest.Mock };

  beforeEach(() => {
    users = { create: jest.fn(), findByEmailWithPassword: jest.fn() };
    invitations = { assertUsable: jest.fn(), accept: jest.fn() };
    const jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') } as unknown as JwtService;
    service = new AuthService(users as never, jwt, invitations as never);
  });

  describe('validation (AC: client + server validation)', () => {
    it('accepts a valid payload', async () => {
      expect(await invalidFields(VALID)).toEqual([]);
    });

    it('rejects a password without a digit', async () => {
      expect(await invalidFields({ ...VALID, password: 'OnlyLetters' })).toContain('password');
    });

    it('rejects a password shorter than 8 characters', async () => {
      expect(await invalidFields({ ...VALID, password: 'Ab1' })).toContain('password');
    });

    it('rejects a profession outside the fixed list', async () => {
      expect(await invalidFields({ ...VALID, profession: 'plumber' })).toContain('profession');
    });

    it('rejects a malformed phone number', async () => {
      expect(await invalidFields({ ...VALID, phone: '12345' })).toContain('phone');
    });
  });

  describe('register', () => {
    it('stores a bcrypt hash and never the raw password', async () => {
      users.create.mockImplementation(async (d) => ({ ...d, id: 'u1', role: SystemRole.USER }));

      await service.register(VALID as never);

      const saved = users.create.mock.calls[0][0];
      expect(saved.passwordHash).not.toBe(VALID.password);
      expect(await bcrypt.compare(VALID.password, saved.passwordHash)).toBe(true);
      expect(saved.phone).toBe(VALID.phone);
      expect(saved.profession).toBe(Profession.ENGINEER);
    });

    it('returns a signed token', async () => {
      users.create.mockResolvedValue({ id: 'u1', email: VALID.email, role: SystemRole.USER });
      await expect(service.register(VALID as never)).resolves.toEqual({
        access_token: 'signed.jwt.token',
      });
    });

    it('attaches a user who signed up through an invite link', async () => {
      users.create.mockResolvedValue({ id: 'u1', email: VALID.email, role: SystemRole.USER });

      await service.register({ ...VALID, inviteToken: 'raw-invite' } as never);

      expect(invitations.assertUsable).toHaveBeenCalledWith('raw-invite');
      expect(invitations.accept).toHaveBeenCalledWith('raw-invite', 'u1');
    });

    it('rejects an unusable invite link BEFORE creating the account', async () => {
      invitations.assertUsable.mockRejectedValue(new Error('unusable'));

      await expect(
        service.register({ ...VALID, inviteToken: 'dead-link' } as never),
      ).rejects.toThrow();

      expect(users.create).not.toHaveBeenCalled(); // no orphan user
    });

    it('propagates the conflict when the email is already registered', async () => {
      users.create.mockRejectedValue(new ConflictException());
      await expect(service.register(VALID as never)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login (AC: uniform "wrong credentials" error)', () => {
    it('gives the same message for an unknown email and a wrong password', async () => {
      users.findByEmailWithPassword.mockResolvedValue(null);
      const unknownEmail = await service.login('nobody@test.com', 'Test1234').catch((e) => e);

      users.findByEmailWithPassword.mockResolvedValue({
        id: 'u1',
        email: VALID.email,
        role: SystemRole.USER,
        passwordHash: await bcrypt.hash('SomethingElse9', 10),
      });
      const wrongPassword = await service.login(VALID.email, 'Test1234').catch((e) => e);

      expect(unknownEmail).toBeInstanceOf(UnauthorizedException);
      expect(wrongPassword).toBeInstanceOf(UnauthorizedException);
      expect(unknownEmail.message).toBe(wrongPassword.message);
    });

    it('returns a token for correct credentials', async () => {
      users.findByEmailWithPassword.mockResolvedValue({
        id: 'u1',
        email: VALID.email,
        role: SystemRole.USER,
        passwordHash: await bcrypt.hash(VALID.password, 10),
      });
      await expect(service.login(VALID.email, VALID.password)).resolves.toEqual({
        access_token: 'signed.jwt.token',
      });
    });
  });
});
