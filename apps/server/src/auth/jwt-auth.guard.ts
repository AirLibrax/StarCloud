import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AuthService } from './auth.service';

export interface RequestUser {
  id: number;
  username: string;
  isAdmin: boolean;
}

/**
 * 登录守卫：校验 Authorization: Bearer <token>，
 * 通过后把用户信息挂到 request.user 上。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization ?? '';

    if (!header.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少访问令牌');
    }

    const token = header.slice('Bearer '.length);
    let payload: { sub: number };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('令牌无效或已过期');
    }

    const user = await this.auth.verifyPayload(payload);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('用户不存在或已被停用');
    }

    request.user = {
      id: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
    };
    return true;
  }
}
