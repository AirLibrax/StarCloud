import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { isInviteCodeRequired } from './invite-gate';
import { JwtAuthGuard, RequestUser } from './jwt-auth.guard';

@Controller('api/auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.username, dto.password);
  }

  /** 自助注册（公开接口）：注册即登录，成功返回与 login 相同的结构 */
  @Post('register')
  @HttpCode(200)
  register(@Body() dto: RegisterDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('两次输入的密码不一致');
    }
    return this.auth.register(dto.username, dto.password, dto.inviteCode);
  }

  /** 注册配置（公开）：只告知是否需要注册口令，绝不返回口令本身 */
  @Get('registration')
  registrationConfig() {
    return { inviteCodeRequired: isInviteCodeRequired() };
  }

  /** 用有效令牌换取自己的最新信息（App 启动时校验会话用） */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: Request): RequestUser {
    return req.user!;
  }
}
