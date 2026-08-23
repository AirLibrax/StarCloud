import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { existsSync, unlinkSync } from 'fs';
import { extname, resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import type { BookFileType } from '@starcloud/shared';

const ALLOWED_TYPES: Record<string, BookFileType> = {
  'application/pdf': 'pdf',
  'application/epub+zip': 'epub',
  'text/plain': 'txt',
};

const CONTENT_TYPE: Record<BookFileType, string> = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  txt: 'text/plain; charset=utf-8',
};

@Injectable()
export class BooksService {
  constructor(private prisma: PrismaService) {}

  /** 书籍列表（含每本的统计信息） */
  async list() {
    const books = await this.prisma.book.findMany({
      orderBy: { uploadedAt: 'desc' },
      include: { _count: { select: { progress: true } } },
    });
    return books.map(({ _count, ...book }) => ({
      ...book,
      uploadedAt: book.uploadedAt.toISOString(),
      readerCount: _count.progress,
    }));
  }

  async getOne(id: number) {
    return this.mustGetBook(id);
  }

  /** 管理员上传新书 */
  async create(
    file: Express.Multer.File | undefined,
    dto: { title: string; author?: string; description?: string },
    uploaderId: number,
  ) {
    if (!file) {
      throw new BadRequestException('缺少书籍文件');
    }

    // 用文件真实内容类型做白名单校验，不信任客户端声称的类型
    const fileType = ALLOWED_TYPES[file.mimetype];
    if (!fileType) {
      throw new BadRequestException(
        `不支持的文件类型: ${file.mimetype}，仅支持 PDF / EPUB / TXT`,
      );
    }

    const book = await this.prisma.book.create({
      data: {
        title: dto.title,
        author: dto.author ?? null,
        description: dto.description ?? null,
        filePath: file.path,
        fileType,
        fileSize: file.size,
        uploaderId,
      },
    });

    return { ...book, uploadedAt: book.uploadedAt.toISOString() };
  }

  /** 管理员删除：同时清掉磁盘上的文件 */
  async remove(id: number, requester: RequestUserLike) {
    const book = await this.mustGetBook(id);
    await this.prisma.book.delete({ where: { id } });
    if (existsSync(book.filePath)) {
      unlinkSync(book.filePath);
    }
    return { deleted: book.id };
  }

  /** 返回可读的文件流信息，交给控制器 res.download */
  async getFile(id: number) {
    const book = await this.mustGetBook(id);
    if (!existsSync(book.filePath)) {
      throw new NotFoundException('书籍文件已丢失');
    }
    return {
      path: resolve(book.filePath),
      filename: `${book.title}${extname(book.filePath)}`,
      contentType: CONTENT_TYPE[book.fileType as BookFileType] ?? 'application/octet-stream',
    };
  }

  private async mustGetBook(id: number) {
    const book = await this.prisma.book.findUnique({ where: { id } });
    if (!book) throw new NotFoundException('书籍不存在');
    return book;
  }
}

interface RequestUserLike {
  id: number;
  isAdmin: boolean;
}
