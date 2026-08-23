import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import type { UserPublic } from '@starcloud/shared';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
    });

    // 用户不存在与密码错误返回同一句提示，不向攻击者泄露账号是否存在
    if (!user || !user.isActive) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const payload = { sub: user.id, username: user.username };
    const accessToken = await this.jwt.signAsync(payload);

    return {
      accessToken,
      user: this.toPublic(user),
    };
  }

  /** 由 JWT payload 反查用户，供守卫使用 */
  async verifyPayload(payload: { sub: number }) {
    return this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
  }

  toPublic(user: {
    id: number;
    username: string;
    isAdmin: boolean;
    createdAt: Date;
  }): UserPublic {
    return {
      id: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
