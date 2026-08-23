import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ProgressService } from './progress.service';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { JwtAuthGuard, RequestUser } from '../auth/jwt-auth.guard';

@Controller('api')
@UseGuards(JwtAuthGuard)
export class ProgressController {
  constructor(private progress: ProgressService) {}

  /** 上报/更新某本书的阅读进度 */
  @Post('progress')
  upsert(@Body() dto: UpdateProgressDto, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.progress.upsert(user.id, dto);
  }

  /** 我的书架：全部书籍 + 我的进度 */
  @Get('shelf')
  shelf(@Req() req: Request) {
    const user = req.user as RequestUser;
    return this.progress.getShelf(user.id);
  }
}
