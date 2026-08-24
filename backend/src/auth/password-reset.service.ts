import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { MailService } from './mail.service';
import { PasswordResetToken } from './password-reset.entity';

/** Same message whatever went wrong — never reveal why a link failed. */
const INVALID_LINK = 'הקישור אינו תקין או שפג תוקפו';

export const hashToken = (raw: string) =>
  createHash('sha256').update(raw).digest('hex');

@Injectable()
export class PasswordResetService {
  constructor(
    @InjectRepository(PasswordResetToken)
    private tokens: Repository<PasswordResetToken>,
    private users: UsersService,
    private mail: MailService,
    private cfg: ConfigService,
  ) {}

  /** NFR-DEMO-1: validity window is configuration, not a constant in code. */
  private ttlMinutes(): number {
    return Number(this.cfg.get('PASSWORD_RESET_TTL_MINUTES', 60));
  }

  /**
   * AUTH-7 request. Always resolves the same way, whether or not the address
   * is registered — otherwise the endpoint becomes a user-enumeration oracle.
   */
  async request(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user) return;

    // A new request supersedes every outstanding link for this user.
    await this.tokens.update(
      { user: { id: user.id }, usedAt: IsNull() },
      { usedAt: new Date() },
    );

    const raw = randomBytes(32).toString('hex');
    await this.tokens.save(
      this.tokens.create({
        user,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + this.ttlMinutes() * 60_000),
        usedAt: null,
      }),
    );

    await this.mail.sendPasswordReset(user.email, raw);
  }

  /** AUTH-7 confirm: sets the new password and burns the link. */
  async confirm(rawToken: string, newPassword: string): Promise<void> {
    const record = await this.tokens.findOne({
      where: { tokenHash: hashToken(rawToken) },
    });

    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException(INVALID_LINK);
    }

    await this.users.updatePassword(
      record.user.id,
      await bcrypt.hash(newPassword, 10),
    );
    await this.tokens.update(record.id, { usedAt: new Date() });
  }
}
