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

    // 令牌优先从请求头取；iframe/下载链接等无法带自定义头的场景允许 ?access_token= 兜底
    const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    const token = bearer ?? (request.query['access_token'] as string | undefined) ?? null;

    if (!token) {
      throw new UnauthorizedException('缺少访问令牌');
    }
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
