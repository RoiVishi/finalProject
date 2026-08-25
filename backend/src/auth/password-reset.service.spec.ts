import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { MailService } from '../common/mail.service';
import { hashToken } from '../common/token.util';
import { PasswordResetService } from './password-reset.service';

const USER = { id: 'u1', email: 'shira@test.com' };
const MINUTE = 60_000;

describe('AUTH-7 — password reset via one-time link', () => {
  let service: PasswordResetService;
  let tokens: { create: jest.Mock; save: jest.Mock; update: jest.Mock; findOne: jest.Mock };
  let users: { findByEmail: jest.Mock; updatePassword: jest.Mock };
  let mail: { sendPasswordReset: jest.Mock };

  beforeEach(() => {
    tokens = {
      create: jest.fn((d) => d),
      save: jest.fn(async (d) => ({ ...d, id: 't1' })),
      update: jest.fn(),
      findOne: jest.fn(),
    };
    users = { findByEmail: jest.fn(), updatePassword: jest.fn() };
    mail = { sendPasswordReset: jest.fn() };
    const cfg = { get: (_k: string, d: unknown) => d } as unknown as ConfigService;
    service = new PasswordResetService(
      tokens as never, users as never, mail as unknown as MailService, cfg,
    );
  });

  describe('request', () => {
    it('does nothing and reveals nothing for an unregistered address', async () => {
      users.findByEmail.mockResolvedValue(null);

      await expect(service.request('nobody@test.com')).resolves.toBeUndefined();

      expect(tokens.save).not.toHaveBeenCalled();
      expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('stores only the hash — never the token that was e-mailed', async () => {
      users.findByEmail.mockResolvedValue(USER);

      await service.request(USER.email);

      const rawSent = mail.sendPasswordReset.mock.calls[0][1];
      const stored = tokens.save.mock.calls[0][0];
      expect(stored.tokenHash).not.toBe(rawSent);
      expect(stored.tokenHash).toBe(hashToken(rawSent));
    });

    it('expires the link one hour out by default', async () => {
      users.findByEmail.mockResolvedValue(USER);

      await service.request(USER.email);

      const { expiresAt } = tokens.save.mock.calls[0][0];
      const minutes = (expiresAt.getTime() - Date.now()) / MINUTE;
      expect(minutes).toBeGreaterThan(59);
      expect(minutes).toBeLessThanOrEqual(60);
    });

    it('supersedes every outstanding link for that user', async () => {
      users.findByEmail.mockResolvedValue(USER);

      await service.request(USER.email);

      expect(tokens.update).toHaveBeenCalledWith(
        expect.objectContaining({ user: { id: USER.id } }),
        expect.objectContaining({ usedAt: expect.any(Date) }),
      );
    });
  });

  describe('confirm', () => {
    const valid = () => ({
      id: 't1',
      user: USER,
      tokenHash: hashToken('raw-token'),
      expiresAt: new Date(Date.now() + 30 * MINUTE),
      usedAt: null,
    });

    it('sets a new bcrypt hash and burns the link', async () => {
      tokens.findOne.mockResolvedValue(valid());

      await service.confirm('raw-token', 'NewPass123');

      const [userId, hash] = users.updatePassword.mock.calls[0];
      expect(userId).toBe(USER.id);
      expect(await bcrypt.compare('NewPass123', hash)).toBe(true);
      expect(tokens.update).toHaveBeenCalledWith('t1', { usedAt: expect.any(Date) });
    });

    it('rejects an expired link', async () => {
      tokens.findOne.mockResolvedValue({
        ...valid(), expiresAt: new Date(Date.now() - MINUTE),
      });

      await expect(service.confirm('raw-token', 'NewPass123'))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(users.updatePassword).not.toHaveBeenCalled();
    });

    it('rejects a link that was already used', async () => {
      tokens.findOne.mockResolvedValue({ ...valid(), usedAt: new Date() });

      await expect(service.confirm('raw-token', 'NewPass123'))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(users.updatePassword).not.toHaveBeenCalled();
    });

    it('gives an unknown token the same message as an expired one', async () => {
      tokens.findOne.mockResolvedValue(null);
      const unknown = await service.confirm('nope', 'NewPass123').catch((e) => e);

      tokens.findOne.mockResolvedValue({
        ...valid(), expiresAt: new Date(Date.now() - MINUTE),
      });
      const expired = await service.confirm('raw-token', 'NewPass123').catch((e) => e);

      expect(unknown.message).toBe(expired.message);
    });
  });
});
