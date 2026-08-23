import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { CreateUserDto, UpdateUserDto } from './dto/users.dto';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
  ) {}

  async list() {
    const users = await this.prisma.user.findMany({
      orderBy: { id: 'asc' },
    });
    return users.map((u) => this.auth.toPublic(u));
  }

  async create(dto: CreateUserDto) {
    const exists = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (exists) {
      throw new BadRequestException('用户名已存在');
    }

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash: await bcrypt.hash(dto.password, 10),
        isAdmin: dto.isAdmin ?? false,
      },
    });
    return this.auth.toPublic(user);
  }

  async update(id: number, dto: UpdateUserDto, requesterId: number) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('用户不存在');

    // 不允许把自己降权或停用，防止管理员把自己锁在系统外
    if (id === requesterId && dto.isAdmin === false) {
      throw new ForbiddenException('不能移除自己的管理员权限');
    }
    if (id === requesterId && dto.isActive === false) {
      throw new ForbiddenException('不能停用自己的账号');
    }

    if (dto.username && dto.username !== target.username) {
      const clash = await this.prisma.user.findUnique({
        where: { username: dto.username },
      });
      if (clash) throw new BadRequestException('用户名已存在');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.username !== undefined ? { username: dto.username } : {}),
        ...(dto.isAdmin !== undefined ? { isAdmin: dto.isAdmin } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    return this.auth.toPublic(updated);
  }

  /** 软删除：账号停用但记录保留，进度不丢 */
  async deactivate(id: number, requesterId: number) {
    await this.update(id, { isActive: false }, requesterId);
    return { deactivated: id };
  }

  /** 自己修改自己的密码 */
  async changePassword(userId: number, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    const ok = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!ok) throw new ForbiddenException('原密码错误');

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });
    return { changed: true };
  }
}
