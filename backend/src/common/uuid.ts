import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';
import { isUUID } from 'class-validator';

/**
 * Every entity id in the system is a Postgres uuid. A value that is not one
 * used to reach the database and fail there, which surfaced as a 500
 * ("invalid input syntax for type uuid"). It is a bad request, so it is
 * rejected as 400 before any query runs.
 */
export const INVALID_ID_MESSAGE = 'מזהה לא תקין';

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && isUUID(value);

/** For guards and services: throws 400 unless the value is a single uuid string. */
export function requireUuid(value: unknown): string {
  if (!isUuid(value)) throw new BadRequestException(INVALID_ID_MESSAGE);
  return value;
}

/** For route parameters and query values: @Param('id', UuidPipe). */
export const UuidPipe = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException(INVALID_ID_MESSAGE),
});
