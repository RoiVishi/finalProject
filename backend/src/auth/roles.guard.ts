import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemRole } from '../users/user.entity';

export const ROLES_KEY = 'roles';

/**
 * Guards GLOBAL system roles only (e.g. admin-only screens — AUTH-3).
 * Per-project authorization ("is this user the PM of THIS project?") is AUTH-2
 * and will be enforced by a separate guard once ProjectMember exists (AUTH-5).
 * Usage: @Roles(SystemRole.ADMIN)
 */
export const Roles = (...roles: SystemRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<SystemRole[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;
    const { user } = ctx.switchToHttp().getRequest();
    return required.includes(user?.role);
  }
}
