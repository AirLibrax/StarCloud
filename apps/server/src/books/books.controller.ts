import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { diskStorage } from 'multer';
import { extname, resolve } from 'path';
import { BooksService } from './books.service';
import { CreateBookDto } from './dto/create-book.dto';
import { JwtAuthGuard, RequestUser } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

// 锚定编译产物位置：dist/books -> 上两级 = apps/server，避免受启动时工作目录影响
const UPLOAD_DIR = resolve(__dirname, '..', '..', 'uploads');

@Controller('api/books')
@UseGuards(JwtAuthGuard) // 整个模块都要求登录
export class BooksController {
  constructor(private books: BooksService) {}

  @Get()
  list() {
    return this.books.list();
  }

  @Get(':id')
  getOne(@Param('id', ParseIntPipe) id: number) {
    return this.books.getOne(id);
  }

  @Get(':id/download')
  async download(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const file = await this.books.getFile(id);
    res.setHeader('Content-Type', file.contentType);
    // res.download 内部会按 RFC 5987 自动处理非 ASCII 文件名，不要再手动编码
    res.download(file.path, file.filename);
  }

  /** 仅管理员可上传。multipart 里文件字段名固定为 "file" */
  @Post()
  @UseGuards(AdminGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const unique =
            Date.now().toString(36) + Math.round(Math.random() * 1e9).toString(36);
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 100 * 1024 * 1024 }, // 单文件上限 100MB
    }),
  )
  create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateBookDto,
    @Req() req: Request,
  ) {
    const user = req.user as RequestUser;
    return this.books.create(file, dto, user.id);
  }

  /** 仅管理员可删除 */
  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.books.remove(id);
  }
}
