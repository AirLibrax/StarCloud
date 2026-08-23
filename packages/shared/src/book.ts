/** 书籍支持的文件类型 */
export type BookFileType = 'pdf' | 'epub' | 'txt';

/** 书籍信息 */
export interface Book {
  id: number;
  title: string;
  /** 卷数（如「第3卷」的 3），无法识别时为 null */
  volume: number | null;
  author: string | null;
  description: string | null;
  coverImage: string | null;
  fileType: BookFileType;
  fileSize: number | null;
  uploadedAt: string;
  uploaderId: number | null;
}

/** 上传书籍时提交的元数据（文件本体走 multipart） */
export interface CreateBookRequest {
  title: string;
  author?: string;
  description?: string;
}
