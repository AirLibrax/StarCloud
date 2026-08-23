import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book } from '@starcloud/shared';
import { api } from '../api/client';
import { useAuth } from '../auth-context';

interface BookRow extends Book {
  readerCount: number;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '-';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function BooksPage() {
  const { user, logout } = useAuth();
  const [books, setBooks] = useState<BookRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 上传表单状态
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      setBooks(await api<BookRow[]>('/api/books'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('请选择书籍文件');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('title', title.trim());
      form.append('author', author.trim());
      form.append('file', file);
      await api<BookRow>('/api/books', { method: 'POST', body: form });
      setTitle('');
      setAuthor('');
      if (fileRef.current) fileRef.current.value = '';
      setNotice(`《${title.trim()}》上传成功`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(book: BookRow) {
    if (!confirm(`确定删除《${book.title}》？文件将一并移除。`)) return;
    try {
      await api(`/api/books/${book.id}`, { method: 'DELETE' });
      setNotice(`已删除《${book.title}》`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <h2>书籍管理</h2>
        <div className="topbar-right">
          <span>{user?.username}</span>
          <button className="btn" onClick={logout}>
            退出
          </button>
        </div>
      </header>

      {error && <div className="error-box">{error}</div>}
      {notice && <div className="notice-box">{notice}</div>}

      <section className="card">
        <h3>上传新书</h3>
        <form className="upload-form" onSubmit={handleUpload}>
          <input
            placeholder="书名"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
          />
          <input
            placeholder="作者（可选）"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
          />
          <input ref={fileRef} type="file" accept=".pdf,.epub,.txt" required />
          <button className="btn primary" disabled={uploading}>
            {uploading ? '上传中…' : '上传'}
          </button>
        </form>
        <p className="hint">支持 PDF / EPUB / TXT，单文件上限 100MB</p>
      </section>

      <section className="card">
        <h3>馆藏列表{books ? `（${books.length}）` : ''}</h3>
        {!books ? (
          <p className="hint">加载中…</p>
        ) : books.length === 0 ? (
          <p className="hint">还没有藏书，从上面传第一本吧。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>书名</th>
                <th>作者</th>
                <th>格式</th>
                <th>大小</th>
                <th>上传时间</th>
                <th>读者数</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {books.map((b) => (
                <tr key={b.id}>
                  <td>{b.title}</td>
                  <td>{b.author || '-'}</td>
                  <td>
                    <span className={`tag tag-${b.fileType}`}>{b.fileType.toUpperCase()}</span>
                  </td>
                  <td>{formatSize(b.fileSize)}</td>
                  <td>{new Date(b.uploadedAt).toLocaleString('zh-CN')}</td>
                  <td>{b.readerCount}</td>
                  <td>
                    <button className="btn danger" onClick={() => handleDelete(b)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
