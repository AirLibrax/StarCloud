import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProgressDto } from './dto/update-progress.dto';

@Injectable()
export class ProgressService {
  constructor(private prisma: PrismaService) {}

  /**
   * 上报进度。同一用户对同一本书只有一条记录，
   * 存在则更新，不存在则创建（数据库层有唯一约束兜底）。
   */
  async upsert(userId: number, dto: UpdateProgressDto) {
    const book = await this.prisma.book.findUnique({
      where: { id: dto.bookId },
    });
    if (!book) {
      throw new NotFoundException('书籍不存在');
    }

    const percentage =
      dto.totalPages > 0
        ? Math.min(100, Math.round((dto.currentPage / dto.totalPages) * 1000) / 10)
        : 0;

    if (dto.currentPage > dto.totalPages) {
      throw new BadRequestException('当前页不能大于总页数');
    }

    const progress = await this.prisma.readingProgress.upsert({
      where: { userId_bookId: { userId, bookId: dto.bookId } },
      create: {
        userId,
        bookId: dto.bookId,
        currentPage: dto.currentPage,
        totalPages: dto.totalPages,
        percentage,
      },
      update: {
        currentPage: dto.currentPage,
        totalPages: dto.totalPages,
        percentage,
      },
    });

    return {
      id: progress.id,
      bookId: progress.bookId,
      currentPage: progress.currentPage,
      totalPages: progress.totalPages,
      percentage: progress.percentage,
      updatedAt: progress.updatedAt.toISOString(),
    };
  }

  /** 我的书架：全部书籍，附带各自的阅读进度 */
  async getShelf(userId: number) {
    const books = await this.prisma.book.findMany({
      orderBy: { uploadedAt: 'desc' },
      include: { progress: { where: { userId } } },
    });

    return books.map(({ progress, ...book }) => {
      const p = progress[0];
      return {
        book: { ...book, uploadedAt: book.uploadedAt.toISOString() },
        progress: p
          ? {
              id: p.id,
              bookId: p.bookId,
              currentPage: p.currentPage,
              totalPages: p.totalPages,
              percentage: p.percentage,
              updatedAt: p.updatedAt.toISOString(),
            }
          : null,
      };
    });
  }
}
