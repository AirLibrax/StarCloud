import type { Book } from './book';

/** 某个用户对某本书的阅读进度 */
export interface ReadingProgress {
  id: number;
  bookId: number;
  currentPage: number;
  totalPages: number;
  percentage: number;
  updatedAt: string;
}

/** 更新进度请求 */
export interface UpdateProgressRequest {
  bookId: number;
  currentPage: number;
  totalPages: number;
}

/** 书架条目：书籍信息 + 我的进度 */
export interface ShelfItem {
  book: Book;
  progress: ReadingProgress | null;
}
