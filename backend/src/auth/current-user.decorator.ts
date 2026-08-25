import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: string;       // SystemRole — global. Project role lives on ProjectMember.
  profession: string; // needed by canCreateProject (§2 note 3)
}

/** Reads the user that JwtStrategy put on the request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser =>
    ctx.switchToHttp().getRequest().user,
);

/** Reads the membership that ProjectPermissionGuard resolved for this request. */
export const CurrentMembership = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest().membership,
);
