import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { RequestUser } from './jwt-auth.guard';

/** 管理员守卫：必须跟在 JwtAuthGuard 之后使用 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as RequestUser | undefined;

    if (!user?.isAdmin) {
      throw new ForbiddenException('需要管理员权限');
    }
    return true;
  }
}
