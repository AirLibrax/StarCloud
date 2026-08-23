import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard, RequestUser } from './jwt-auth.guard';

@Controller('api/auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.username, dto.password);
  }

  /** 用有效令牌换取自己的最新信息（App 启动时校验会话用） */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: Request): RequestUser {
    return req.user!;
  }
}
