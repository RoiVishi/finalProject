import {
  IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID,
  Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { TaskStatus, TradeCategory } from '../task.entity';

/** "floor-3/zone-2" — the id scheme TASK-1 derives from the project layout. */
const ZONE_ID = /^floor-\d+\/zone-\d+$/;

export class CreateTaskDto {
  @IsUUID() projectId: string;

  @IsString() @MinLength(2, { message: 'שם המשימה חייב להכיל לפחות 2 תווים' }) @MaxLength(160)
  name: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsEnum(TradeCategory, { message: 'יש לבחור קטגוריה מקצועית מהרשימה' })
  trade?: TradeCategory;

  @IsOptional() @Matches(ZONE_ID, { message: 'מזהה האזור אינו בפורמט תקין' })
  zone?: string;

  @IsOptional() @IsDateString({}, { message: 'תאריך התחלה מתוכנן אינו תקין' })
  plannedStart?: string;

  @IsOptional() @IsDateString({}, { message: 'תאריך סיום מתוכנן אינו תקין' })
  plannedEnd?: string;

  /** Must be an active member of the project — checked in the service. */
  @IsOptional() @IsUUID()
  assigneeId?: string;

  @IsOptional() @IsInt() @Min(1) @Max(3650)
  estimatedDurationDays?: number;

  // No `status` field, by design: an activity is always created as PLANNED and
  // moves only through POST /tasks/:id/status, where the transition rules and
  // the audit trail live.
}

export class UpdateTaskDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160)
  name?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsEnum(TradeCategory, { message: 'יש לבחור קטגוריה מקצועית מהרשימה' })
  trade?: TradeCategory;

  @IsOptional() @Matches(ZONE_ID, { message: 'מזהה האזור אינו בפורמט תקין' })
  zone?: string;

  @IsOptional() @IsDateString({}, { message: 'תאריך התחלה מתוכנן אינו תקין' })
  plannedStart?: string;

  @IsOptional() @IsDateString({}, { message: 'תאריך סיום מתוכנן אינו תקין' })
  plannedEnd?: string;

  @IsOptional() @IsUUID()
  assigneeId?: string;

  @IsOptional() @IsInt() @Min(1) @Max(3650)
  estimatedDurationDays?: number;
}

export class ChangeTaskStatusDto {
  /**
   * 'blocked' is not a member of TaskStatus, so a client that tries to set it
   * by hand fails validation here — which is the requirement, enforced at the
   * edge rather than by a comment.
   */
  @IsEnum(TaskStatus, { message: 'סטטוס לא חוקי' })
  status: TaskStatus;
}
