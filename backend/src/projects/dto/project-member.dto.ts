import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ProjectRole } from '../project-member.entity';

export class AddMemberDto {
  @IsUUID('4', { message: 'מזהה משתמש לא תקין' })
  userId: string;

  @IsEnum(ProjectRole, { message: 'יש לבחור תפקיד מהרשימה' })
  role: ProjectRole;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  trade?: string;
}

export class ChangeMemberRoleDto {
  @IsEnum(ProjectRole, { message: 'יש לבחור תפקיד מהרשימה' })
  role: ProjectRole;
}
