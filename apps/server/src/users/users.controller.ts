import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { UsersService } from './users.service';
import {
  ChangePasswordDto,
  CreateUserDto,
  ResetPasswordDto,
  UpdateUserDto,
} from './dto/users.dto';
import { JwtAuthGuard, RequestUser } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('api/users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  @UseGuards(AdminGuard)
  list() {
    return this.users.list();
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
    @Req() req: Request,
  ) {
    const requester = req.user as RequestUser;
    return this.users.update(id, dto, requester.id);
  }

  /** 硬删除：物理删除账号，阅读进度级联清理，不可恢复 */
  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    const requester = req.user as RequestUser;
    return this.users.remove(id, requester.id);
  }

  /** 任何登录用户改自己的密码 */
  @Post('change-password')
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.users.changePassword(
      user.id,
      dto.oldPassword,
      dto.newPassword,
      dto.confirmPassword,
    );
  }

  /** 管理员直接重置某用户密码，不校验旧密码 */
  @Post(':id/reset-password')
  @UseGuards(AdminGuard)
  resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.users.resetPassword(id, dto.newPassword);
  }
}
