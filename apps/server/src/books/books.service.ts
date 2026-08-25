import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { extname, resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import type { BookFileType } from '@starcloud/shared';
import { parseEpubMeta, splitTitleVolume } from './epub-meta';

const COVER_DIR = resolve(__dirname, '..', '..', 'uploads', 'covers');

const ALLOWED_TYPES: Record<string, BookFileType> = {
  'application/pdf': 'pdf',
  'application/epub+zip': 'epub',
  'text/plain': 'txt',
};

/** 浏览器常把 .epub/.pdf 标成通用二进制流，此时按扩展名兜底 */
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

  /** 管理员上传新书。书名/卷数/封面/作者可从 EPUB 自动识别 */
  async create(
    file: Express.Multer.File | undefined,
    dto: { title?: string; author?: string; description?: string },
    uploaderId: number,
  ) {
    if (!file) {
      throw new BadRequestException('缺少书籍文件');
    }

    // mimetype 白名单优先；通用二进制流时按扩展名兜底。
    // 此时 multer 已把文件写入 uploads，拒绝时必须清理，否则留下孤儿文件
    const fileType = resolveFileType(file.mimetype, file.originalname);
    if (!fileType) {
      unlinkSync(file.path);
      throw new BadRequestException(
        `不支持的文件类型: ${file.mimetype || '未知'}（文件名 ${file.originalname}），仅支持 PDF / EPUB / TXT`,
      );
    }

    // 元数据识别：EPUB 内嵌信息 > 文件名启发式 > 用户输入兜底
    let title = dto.title?.trim() ?? '';
    let author = dto.author?.trim() ?? '';
    let volume: number | null = null;
    let coverUrl: string | null = null;

    const fromFilename = splitTitleVolume(file.originalname);
    if (!title && fromFilename.title) title = fromFilename.title;
    volume = fromFilename.volume;

    if (fileType === 'epub') {
      try {
        const meta = parseEpubMeta(readFileSync(file.path));
        if (!title && meta.title) title = meta.title;
        if (!author && meta.author) author = meta.author;

        if (meta.coverBinary) {
          mkdirSync(COVER_DIR, { recursive: true });
          const unique =
            Date.now().toString(36) + Math.round(Math.random() * 1e9).toString(36);
          const coverName = `${unique}${meta.coverExt}`;
          writeFileSync(resolve(COVER_DIR, coverName), meta.coverBinary);
          coverUrl = `/uploads/covers/${coverName}`;
        }
      } catch {
        // 解析失败不阻断上传，只是少了自动填充
      }
    }

    // 标题确定后，再从标题里提取卷号（如「沉默魔女的秘密 01」「第3卷」）
    if (volume === null && title) {
      const fromTitle = splitTitleVolume(title);
      if (fromTitle.volume !== null) {
        title = fromTitle.title;
        volume = fromTitle.volume;
      }
    }

    if (!title) {
      unlinkSync(file.path);
      throw new BadRequestException(
        '无法确定书名：请填写书名，或使用包含书名的文件名',
      );
    }

    const book = await this.prisma.book.create({
      data: {
        title,
        volume,
        author: author || null,
        description: dto.description ?? null,
        coverImage: coverUrl,
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
