import {
  IsEmail, IsEnum, IsOptional, IsString, Matches, MinLength,
} from 'class-validator';
import { Profession } from '../../users/user.entity';

/** AUTH-1: at least 8 chars, containing at least one letter and one digit. */
export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

/** Israeli phone: 0XX-XXXXXXX / 0XXXXXXXXX, hyphen optional. */
export const PHONE_RULE = /^0\d{1,2}-?\d{7}$/;

export class RegisterDto {
  @IsEmail({}, { message: 'כתובת דוא"ל לא תקינה' })
  email: string;

  @Matches(PASSWORD_RULE, {
    message: 'הסיסמה חייבת לכלול לפחות 8 תווים, אות אחת וספרה אחת',
  })
  password: string;

  @IsString()
  @MinLength(2, { message: 'יש להזין שם מלא' })
  fullName: string;

  @Matches(PHONE_RULE, { message: 'מספר טלפון לא תקין' })
  phone: string;

  @IsEnum(Profession, { message: 'יש לבחור מקצוע מהרשימה' })
  profession: Profession;

  /** AUTH-4: signing up through a shareable link attaches the new user
   *  to the project automatically. */
  @IsOptional()
  @IsString()
  inviteToken?: string;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}
