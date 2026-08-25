/**
 * 本地书库：导入的书籍元数据与阅读进度。
 * 书籍文件复制到 App 私有目录，元数据存 AsyncStorage（千本级内足够）。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BookFileType } from '@starcloud/shared';

export interface LocalBook {
  id: string; // 导入时间戳
  title: string;
  volume: number | null;
  author: string | null;
  fileType: BookFileType;
  fileSize: number;
  /** App 私有目录内的文件 URI */
  fileUri: string;
  importedAt: string;
  /** 若由云端下载而来，记录服务器书籍 id，阅读进度双写 */
  cloudBookId?: number;
  /** 本地阅读进度（与云端结构一致） */
  progress: {
    currentPage: number;
    totalPages: number;
    percentage: number;
  } | null;
}

const LIST_KEY = 'starcloud.localBooks';

const ALLOWED_EXT: Record<string, BookFileType> = {
  '.pdf': 'pdf',
  '.epub': 'epub',
  '.txt': 'txt',
};

function extOf(nameOrUri: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(nameOrUri.split('?')[0]);
  return m ? `.${m[1].toLowerCase()}` : '';
}

/** 从文件名/标题识别卷数（同服务端 splitTitleVolume 的简化版：仅阿拉伯数字） */
export function splitTitleVolume(raw: string): { title: string; volume: number | null } {
  const s = raw.replace(/\.(epub|pdf|txt)$/i, '').trim();
  const patterns: RegExp[] = [
    /\s*[(【]\s*(\d{1,4})\s*[)】\]]\s*/,
    /\s+(?:vol\.?|volume)\s*(\d{1,4})\s*/i,
    /\s*第\s*(\d{1,4})\s*[卷話话巻册]\s*/,
    /\s+[卷巻]\s*(\d{1,4})\s*/i,
    /\s+(\d{1,4})\s*$/,
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (m) {
      const vol = parseInt(m[1], 10);
      if (vol > 0) {
        const title = s.replace(re, '').trim();
        if (title) return { title, volume: vol };
      }
    }
  }
  return { title: s, volume: null };
}

export async function listLocalBooks(): Promise<LocalBook[]> {
  const raw = await AsyncStorage.getItem(LIST_KEY);
  if (!raw) return [];
  try {
    const books = JSON.parse(raw) as LocalBook[];
    return books.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  } catch {
    return [];
  }
}

/**
 * 把云端书籍下载到本地书库（已存在则直接返回）。
 * 下载完成后该书完全离线可读，进度仍同步回服务器。
 */
export async function ensureCloudBookDownloaded(cloud: {
  id: number;
  title: string;
  volume: number | null;
  author: string | null;
  fileType: string;
  fileUrl: string;
}): Promise<LocalBook> {
  const books = await listLocalBooks();
  const existing = books.find((b) => b.cloudBookId === cloud.id);
  if (existing) return existing;

  const LegacyFS = require('expo-file-system/legacy');
  const ext = cloud.fileType === 'epub' ? '.epub' : cloud.fileType === 'pdf' ? '.pdf' : '.txt';
  const dir = `${LegacyFS.documentDirectory}books/`;
  await LegacyFS.makeDirectoryAsync(dir, { intermediates: true });
  const id = `c${cloud.id}`;
  const dest = `${dir}${id}${ext}`;

  const res = await LegacyFS.downloadAsync(cloud.fileUrl, dest);
  if (res.status !== 200) {
    await LegacyFS.deleteAsync(dest, { idempotent: true });
    throw new Error(`下载失败（HTTP ${res.status}）`);
  }

  const book: LocalBook = {
    id,
    title: cloud.title,
    volume: cloud.volume,
    author: cloud.author,
    fileType: cloud.fileType as BookFileType,
    fileSize: res.headers['Content-Length'] ? Number(res.headers['Content-Length']) : 0,
    fileUri: dest,
    importedAt: new Date().toISOString(),
    cloudBookId: cloud.id,
    progress: null,
  };
  books.unshift(book);
  await saveList(books);
  return book;
}

async function saveList(books: LocalBook[]): Promise<void> {
  await AsyncStorage.setItem(LIST_KEY, JSON.stringify(books));
}

/**
 * 通过文档选择器导入一本书（SAF：无需任何存储权限）。
 * 文件被复制进 App 私有目录，选择器授权随原文件引用失效也不影响已导入副本。
 * 返回 null 表示用户取消。
 */
export async function importLocalBook(): Promise<LocalBook | null> {
  const DocumentPicker = require('expo-document-picker');
  const LegacyFS = require('expo-file-system/legacy');

  const result = await DocumentPicker.getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: true,
    type: [
      'application/pdf',
      'application/epub+zip',
      'application/octet-stream', // 部分设备对 epub/txt 的误标
      'text/plain',
    ],
  });

  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];

  const ext = extOf(asset.name || asset.uri);
  const fileType = ALLOWED_EXT[ext];
  if (!fileType) throw new Error(`不支持的文件类型：${asset.name}，仅支持 PDF / EPUB / TXT`);

  // 复制到私有目录（legacy FS API，SDK 54 稳定可用）
  const dir = `${LegacyFS.documentDirectory}books/`;
  await LegacyFS.makeDirectoryAsync(dir, { intermediates: true });
  const id = Date.now().toString(36);
  const dest = `${dir}${id}${ext}`;
  await LegacyFS.copyAsync({ from: asset.uri, to: dest });

  const { title, volume } = splitTitleVolume(asset.name);
  const book: LocalBook = {
    id,
    title,
    volume,
    author: null,
    fileType,
    fileSize: asset.size ?? 0,
    fileUri: dest,
    importedAt: new Date().toISOString(),
    progress: null,
  };

  const books = await listLocalBooks();
  books.unshift(book);
  await saveList(books);
  return book;
}

export async function deleteLocalBook(id: string): Promise<void> {
  const books = await listLocalBooks();
  const target = books.find((b) => b.id === id);
  const LegacyFS = require('expo-file-system/legacy');
  if (target?.fileUri.startsWith(LegacyFS.documentDirectory ?? '')) {
    await LegacyFS.deleteAsync(target.fileUri, { idempotent: true });
  }
  await saveList(books.filter((b) => b.id !== id));
}

/** 更新本地书阅读进度 */
export async function saveLocalProgress(
  id: string,
  currentPage: number,
  totalPages: number,
): Promise<void> {
  const books = await listLocalBooks();
  const idx = books.findIndex((b) => b.id === id);
  if (idx === -1) return;
  books[idx].progress = {
    currentPage,
    totalPages,
    percentage:
      totalPages > 0 ? Math.min(100, Math.round((currentPage / totalPages) * 1000) / 10) : 0,
  };
  await saveList(books);
}
