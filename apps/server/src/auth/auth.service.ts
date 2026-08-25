import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import type { UserPublic } from '@starcloud/shared';
import { assertInviteCode } from './invite-gate';

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

  /** 自助注册：注册即登录，返回与 login 完全相同的结构 */
  async register(username: string, password: string, inviteCode?: string) {
    // 入口集中一处做邀请码门禁校验（开关语义见 invite-gate.ts：未启用时直接放行）
    assertInviteCode(inviteCode);

    const exists = await this.prisma.user.findUnique({ where: { username } });
    if (exists) {
      throw new BadRequestException('用户名已存在');
    }

    // isAdmin 强制 false：注册通道不接受任何角色字段，普通用户一律非管理员
    const user = await this.prisma.user.create({
      data: {
        username,
        passwordHash: await bcrypt.hash(password, 10),
        isAdmin: false,
      },
    });

    const payload = { sub: user.id, username: user.username };
    const accessToken = await this.jwt.signAsync(payload);

    return {
      accessToken,
      user: this.toPublic(user),
    };
  }

  /** 由 JWT payload 反查用户，供守卫使用。只取必要字段，不碰凭证 */
  async verifyPayload(payload: { sub: number }) {
    return this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, isAdmin: true, isActive: true },
    });
  }

  toPublic(user: {
    id: number;
    username: string;
    isAdmin: boolean;
    isActive: boolean;
    createdAt: Date;
  }): UserPublic {
    return {
      id: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
