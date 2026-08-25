import { IsEmail, IsString, Matches, MinLength } from 'class-validator';
import { PASSWORD_RULE } from './register.dto';

export class RequestPasswordResetDto {
  @IsEmail({}, { message: 'כתובת דוא"ל לא תקינה' })
  email: string;
}

export class ConfirmPasswordResetDto {
  @IsString()
  @MinLength(1, { message: 'חסר טוקן' })
  token: string;

  @Matches(PASSWORD_RULE, {
    message: 'הסיסמה חייבת לכלול לפחות 8 תווים, אות אחת וספרה אחת',
  })
  password: string;
}
