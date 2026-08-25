import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { extname, resolve } from 'path';
import type { Prisma, Book, Tag } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { BookFileType } from '@starcloud/shared';
import { parseEpubMeta, splitTitleVolume } from './epub-meta';
import { UpdateBookDto } from './dto/update-book.dto';

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

/** 逗号分隔字符串 → 去重、去空、限长后的标签名列表 */
function parseTagNames(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return [
    ...new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .slice(0, 20),
    ),
  ];
}

export interface ListQuery {
  q?: string;
  category?: string;
}

@Injectable()
export class BooksService {
  constructor(private prisma: PrismaService) {}

  /** 书籍列表（支持 q 模糊搜索与 category 精确过滤，含每本统计与标签） */
  async list(query: ListQuery = {}) {
    const where: Prisma.BookWhereInput = {};
    const q = query.q?.trim();
    if (q) {
      where.OR = [{ title: { contains: q } }, { author: { contains: q } }];
    }
    if (query.category) {
      where.category = query.category;
    }

    const books = await this.prisma.book.findMany({
      where,
      orderBy: { uploadedAt: 'desc' },
      include: {
        tags: true,
        _count: { select: { progress: true } },
      },
    });
    return books.map(({ _count, ...book }) => ({
      ...this.serialize(book),
      readerCount: _count.progress,
    }));
  }

  async getOne(id: number) {
    const book = await this.prisma.book.findUnique({
      where: { id },
      include: { tags: true },
    });
    if (!book) throw new NotFoundException('书籍不存在');
    return this.serialize(book);
  }

  /** 管理员上传新书。书名/卷数/封面/作者可从 EPUB 自动识别 */
  async create(
    file: Express.Multer.File | undefined,
    dto: {
      title?: string;
      author?: string;
      description?: string;
      category?: string;
      tags?: string;
    },
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

    const category = dto.category?.trim() || null;
    const tagNames = parseTagNames(dto.tags);

    const book = await this.prisma.book.create({
      data: {
        title,
        volume,
        author: author || null,
        description: dto.description ?? null,
        category,
        coverImage: coverUrl,
        filePath: file.path,
        fileType,
        fileSize: file.size,
        uploaderId,
        ...(tagNames.length > 0
          ? {
              tags: {
                connectOrCreate: tagNames.map((name) => ({
                  where: { name },
                  create: { name },
                })),
              },
            }
          : {}),
      },
      include: { tags: true },
    });

    return this.serialize(book);
  }

  /** 管理员编辑元数据（含分类与标签整体替换）；不存在 404 */
  async update(id: number, dto: UpdateBookDto) {
    const book = await this.mustGetBook(id);
    const tagNames = dto.tags !== undefined ? parseTagNames(dto.tags) : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      // 整体替换标签：先把名字落库（存在则取，不存在则建），再 set 关联
      const tagIds: number[] = [];
      if (tagNames !== null) {
        for (const name of tagNames) {
          const t = await tx.tag.upsert({
            where: { name },
            create: { name },
            update: {},
          });
          tagIds.push(t.id);
        }
      }

      return tx.book.update({
        where: { id: book.id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.volume !== undefined ? { volume: dto.volume } : {}),
          ...(dto.author !== undefined
            ? { author: dto.author.trim() || null }
            : {}),
          ...(dto.description !== undefined
            ? { description: dto.description.trim() || null }
            : {}),
          ...(dto.category !== undefined
            ? { category: dto.category ? dto.category.trim() : null }
            : {}),
          ...(tagNames !== null ? { tags: { set: tagIds.map((v) => ({ id: v })) } } : {}),
        },
        include: { tags: true },
      });
    });

    return this.serialize(updated);
  }

  /** 管理员删除：同时清掉磁盘上的文件（书籍文件 + 封面） */
  async remove(id: number) {
    const book = await this.mustGetBook(id);
    await this.prisma.book.delete({ where: { id } });
    if (existsSync(book.filePath)) {
      unlinkSync(book.filePath);
    }
    if (book.coverImage) {
      const cover = this.coverFilePath(book.coverImage);
      if (cover && existsSync(cover)) unlinkSync(cover);
    }
    return { deleted: book.id };
  }

  /** 批量硬删除：事务内逐个删除（进度/标签级联清理），不存在的 id 跳过并报告 */
  async batchDelete(ids: number[]) {
    const unique = [...new Set(ids)];
    let deleted = 0;
    const skipped: number[] = [];
    const filesToRemove: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const id of unique) {
        const book = await tx.book.findUnique({ where: { id } });
        if (!book) {
          skipped.push(id);
          continue;
        }
        await tx.book.delete({ where: { id } });
        deleted += 1;
        filesToRemove.push(book.filePath);
        if (book.coverImage) {
          const cover = this.coverFilePath(book.coverImage);
          if (cover) filesToRemove.push(cover);
        }
      }
    });

    // 磁盘清理放事务外：文件系统操作不参与数据库事务
    for (const p of filesToRemove) {
      if (existsSync(p)) unlinkSync(p);
    }
    return { deleted, skipped };
  }

  /** 管理员上传/替换封面；旧封面文件同步删除，不留孤儿 */
  async setCover(id: number, file: Express.Multer.File | undefined) {
    if (!file) {
      throw new BadRequestException('缺少封面文件');
    }

    const book = await this.prisma.book.findUnique({ where: { id } });
    if (!book) {
      // 书不存在时 multipart 文件已落盘，删掉避免孤儿
      unlinkSync(file.path);
      throw new NotFoundException('书籍不存在');
    }

    const coverUrl = `/uploads/covers/${file.filename}`;
    const updated = await this.prisma.book.update({
      where: { id },
      data: { coverImage: coverUrl },
      include: { tags: true },
    });

    if (book.coverImage) {
      const old = this.coverFilePath(book.coverImage);
      if (old && existsSync(old) && old !== resolve(file.path)) {
        unlinkSync(old);
      }
    }
    return this.serialize(updated);
  }

  /** 管理员移除封面：coverImage 置 null 并删除对应文件 */
  async removeCover(id: number) {
    const book = await this.mustGetBook(id);

    if (book.coverImage) {
      const old = this.coverFilePath(book.coverImage);
      if (old && existsSync(old)) unlinkSync(old);
    }

    const updated = await this.prisma.book.update({
      where: { id },
      data: { coverImage: null },
      include: { tags: true },
    });
    return this.serialize(updated);
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

  /** 封面 URL（/uploads/covers/xxx）→ 磁盘绝对路径；防御非本目录的路径 */
  private coverFilePath(coverUrl: string): string | null {
    const PREFIX = '/uploads/covers/';
    if (!coverUrl.startsWith(PREFIX)) return null;
    return resolve(COVER_DIR, coverUrl.slice(PREFIX.length));
  }

  /** 统一输出结构：tags 序列化成名字数组，日期转 ISO */
  private serialize(book: Book & { tags: Tag[] }) {
    return {
      id: book.id,
      title: book.title,
      volume: book.volume,
      author: book.author,
      description: book.description,
      category: book.category,
      tags: book.tags.map((t) => t.name),
      coverImage: book.coverImage,
      fileType: book.fileType,
      fileSize: book.fileSize,
      uploadedAt: book.uploadedAt.toISOString(),
      uploaderId: book.uploaderId,
    };
  }
}