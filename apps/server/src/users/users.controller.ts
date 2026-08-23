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

  /** 软删除：停用账号，阅读进度保留 */
  @Delete(':id')
  @UseGuards(AdminGuard)
  deactivate(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    const requester = req.user as RequestUser;
    return this.users.deactivate(id, requester.id);
  }

  /** 任何登录用户改自己的密码 */
  @Post('change-password')
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.users.changePassword(user.id, dto.oldPassword, dto.newPassword);
  }
}
