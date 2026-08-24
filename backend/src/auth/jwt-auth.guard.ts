import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Authentication only: "is this a logged-in user?".
 *  Authorization ("may THIS user do this in THIS project?") is AUTH-2. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
