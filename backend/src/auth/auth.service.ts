import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { InvitationsService } from '../projects/invitations.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';

/** Same message for every failed login — never reveal whether the email exists. */
const INVALID_CREDENTIALS = 'שם משתמש או סיסמה שגויים';

@Injectable()
export class AuthService {
  constructor(
    private users: UsersService,
    private jwt: JwtService,
    private invitations: InvitationsService,
  ) {}

  async register(dto: RegisterDto) {
    // AUTH-4: check the link BEFORE creating the account, so an expired or
    // revoked link fails cleanly instead of leaving an orphan user.
    if (dto.inviteToken) await this.invitations.assertUsable(dto.inviteToken);

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.users.create({
      email: dto.email,
      passwordHash,
      fullName: dto.fullName,
      phone: dto.phone,
      profession: dto.profession,
    });

    if (dto.inviteToken) await this.invitations.accept(dto.inviteToken, user.id);

    return this.sign(user.id, user.email, user.role, user.profession);
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmailWithPassword(email);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    return this.sign(user.id, user.email, user.role, user.profession);
  }

  /** AUTH-1: 12h token. Expiry is configured in AuthModule. */
  private sign(sub: string, email: string, role: string, profession: string) {
    return { access_token: this.jwt.sign({ sub, email, role, profession }) };
  }
}
