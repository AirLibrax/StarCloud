/**
 * 云端书籍文件的读取缓存。
 * 在线阅读时先将文件拉取到缓存目录（不进入本地书库），
 * 之后完全离线渲染。缓存可随时清理。
 */
import { fileUrl } from './client';

const LegacyFS = require('expo-file-system/legacy');

/** 确保某本云端书的文件已缓存在本地，返回 file:// URI */
export async function ensureCachedFile(
  bookId: number,
  fileType: string,
): Promise<string> {
  const ext =
    fileType === 'epub' ? '.epub' : fileType === 'pdf' ? '.pdf' : '.txt';
  const dir = `${LegacyFS.cacheDirectory}books-online/`;
  await LegacyFS.makeDirectoryAsync(dir, { intermediates: true });
  const dest = `${dir}${bookId}${ext}`;

  const info = await LegacyFS.getInfoAsync(dest);
  if (info.exists) return dest;

  const res = await LegacyFS.downloadAsync(fileUrl(bookId), dest);
  if (res.status !== 200) {
    await LegacyFS.deleteAsync(dest, { idempotent: true });
    throw new Error(`书籍文件下载失败（HTTP ${res.status}）`);
  }
  return dest;
}
