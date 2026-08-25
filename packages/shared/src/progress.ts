import type { Book } from './book';

/** 某个用户对某本书的阅读进度 */
export interface ReadingProgress {
  id: number;
  bookId: number;
  currentPage: number;
  totalPages: number;
  percentage: number;
  /** EPUB 精确书签：epubjs CFI；TXT/PDF 无此字段时为空 */
  position?: string | null;
  updatedAt: string;
}

/** 更新进度请求 */
export interface UpdateProgressRequest {
  bookId: number;
  currentPage: number;
  totalPages: number;
  /** EPUB 精确书签：epubjs CFI；TXT/PDF 不上报时可省略 */
  position?: string | null;
  /** 可选：客户端算好的全书百分比 0-100（需 locations 生成完成后才有效）；缺省由服务端按章节粒度计算 */
  percentage?: number;
}

/** 书架条目：书籍信息 + 我的进度 */
export interface ShelfItem {
  book: Book;
  progress: ReadingProgress | null;
}
