import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDateString, IsInt, IsOptional, IsString,
  MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { MAX_FLOORS, MAX_ZONES_PER_FLOOR } from '../layout';
import { InviteByEmailDto } from './invitation.dto';

/** Step 1 — project details. */
export class ProjectDetailsDto {
  @IsString()
  @MinLength(2, { message: 'שם הפרויקט חייב להכיל לפחות 2 תווים' })
  @MaxLength(120)
  name: string;

  @IsOptional() @IsString() @MaxLength(200)
  address?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsDateString({}, { message: 'תאריך התחלה מתוכנן אינו תקין' })
  plannedStart?: string;

  @IsOptional()
  @IsDateString({}, { message: 'תאריך סיום מתוכנן אינו תקין' })
  plannedEnd?: string;
}

/** Step 2 — schematic layout: floors × zones. */
export class ProjectLayoutDto {
  @IsInt() @Min(1)
  floors: number;

  @IsInt() @Min(1)
  zonesPerFloor: number;

  /** Optional display names; defaults are filled in by buildLayout(). */
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(MAX_ZONES_PER_FLOOR)
  zoneNames?: string[];

  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(MAX_FLOORS)
  floorNames?: string[];
}

/**
 * The wizard is three screens for the user and one request for the server:
 * a project that exists with no owner, or with a layout the user never
 * confirmed, is not a state worth being able to reach. Step 3 is optional —
 * "אפשר לדלג ולהזמין אחר כך" (מסמך האפיון §4.1).
 */
export class CreateProjectDto {
  @ValidateNested() @Type(() => ProjectDetailsDto)
  details: ProjectDetailsDto;

  @ValidateNested() @Type(() => ProjectLayoutDto)
  layout: ProjectLayoutDto;

  @IsOptional()
  @IsArray() @ArrayMaxSize(50)
  @ValidateNested({ each: true }) @Type(() => InviteByEmailDto)
  team?: InviteByEmailDto[];
}

/** Step 1 again, in edit mode: every field is optional and merges into the row. */
export class UpdateProjectDetailsDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  name?: string;

  @IsOptional() @IsString() @MaxLength(200)
  address?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsDateString({}, { message: 'תאריך התחלה מתוכנן אינו תקין' })
  plannedStart?: string;

  @IsOptional() @IsDateString({}, { message: 'תאריך סיום מתוכנן אינו תקין' })
  plannedEnd?: string;
}

/**
 * Everything is optional: the client sends only the step it edited. A layout
 * sent here replaces the previous one, and the service refuses the edit if it
 * would delete a zone that activities already sit in.
 */
export class UpdateProjectDto {
  @IsOptional() @ValidateNested() @Type(() => UpdateProjectDetailsDto)
  details?: UpdateProjectDetailsDto;

  @IsOptional() @ValidateNested() @Type(() => ProjectLayoutDto)
  layout?: ProjectLayoutDto;
}
