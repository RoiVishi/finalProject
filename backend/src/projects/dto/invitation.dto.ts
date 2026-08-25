import { IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ProjectRole } from '../project-member.entity';

export class InviteByEmailDto {
  @IsEmail({}, { message: 'כתובת דוא"ל לא תקינה' })
  email: string;

  @IsEnum(ProjectRole, { message: 'יש לבחור תפקיד מהרשימה' })
  role: ProjectRole;

  @IsOptional() @IsString() @MaxLength(60)
  trade?: string;
}

export class CreateInviteLinkDto {
  @IsEnum(ProjectRole, { message: 'יש לבחור תפקיד מהרשימה' })
  role: ProjectRole;

  @IsOptional() @IsString() @MaxLength(60)
  trade?: string;
}
