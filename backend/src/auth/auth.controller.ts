import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  ConfirmPasswordResetDto, RequestPasswordResetDto,
} from './dto/password-reset.dto';
import { LoginDto, RegisterDto } from './dto/register.dto';
import { PasswordResetService } from './password-reset.service';

@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private reset: PasswordResetService,
  ) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  /** AUTH-7. Always 202, registered or not — no user enumeration. */
  @Post('password-reset/request')
  @HttpCode(202)
  requestReset(@Body() dto: RequestPasswordResetDto) {
    return this.reset.request(dto.email);
  }

  @Post('password-reset/confirm')
  @HttpCode(204)
  confirmReset(@Body() dto: ConfirmPasswordResetDto) {
    return this.reset.confirm(dto.token, dto.password);
  }
}
