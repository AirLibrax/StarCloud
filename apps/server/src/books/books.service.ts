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

/** 浏览器常把 .epub/.pdf 标成通用二进制流，此时按扩展名兕底 */
const EXT_FALLBACK: Record<string, BookFileType> = {
  '.pdf': 'pdf',
  '.epub': 'epub',
  '.txt': 'txt',
};

function resolveFileType(
  mimetype: string,
  filename: string,
): BookFileType | null {
  const byMime = ALLOWED_TYPES[mimetype];
  if (byMime) return byMime;

  if (mimetype === 'application/octet-stream' || mimetype === '') {
    return EXT_FALLBACK[extname(filename).toLowerCase()] ?? null;
  }
  return null;
}

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

    // mimetype 白名单优先；通用二进制流时按扩展名兕底。
    // 此时 multer 已把文件写入 uploads，拒绝时必须清理，否则留下孤儿文件
    const fileType = resolveFileType(file.mimetype, file.originalname);
    if (!fileType) {
      unlinkSync(file.path);
      throw new BadRequestException(
        `不支持的文件类型: ${file.mimetype || '未知'}（文件名 ${file.originalname}），仅支持 PDF / EPUB / TXT`,
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
  async remove(id: number) {
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
