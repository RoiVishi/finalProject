import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';

/** Same message for every failed login — never reveal whether the email exists. */
const INVALID_CREDENTIALS = 'שם משתמש או סיסמה שגויים';

@Injectable()
export class AuthService {
  constructor(
    private users: UsersService,
    private jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.users.create({
      email: dto.email,
      passwordHash,
      fullName: dto.fullName,
      phone: dto.phone,
      profession: dto.profession,
    });
    return this.sign(user.id, user.email, user.role);
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmailWithPassword(email);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    return this.sign(user.id, user.email, user.role);
  }

  /** AUTH-1: 12h token. Expiry is configured in AuthModule. */
  private sign(sub: string, email: string, role: string) {
    return { access_token: this.jwt.sign({ sub, email, role }) };
  }
}
