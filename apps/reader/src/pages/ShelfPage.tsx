import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ShelfItem } from '@starcloud/shared';
import { api } from '../api/client';
import { useAuth } from '../auth-context';

export default function ShelfPage() {
  const { user, logout } = useAuth();
  const [shelf, setShelf] = useState<ShelfItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ShelfItem[]>('/api/shelf')
      .then(setShelf)
      .catch((err) =>
        setError(err instanceof Error ? err.message : '加载失败'),
      );
  }, []);

  return (
    <div className="page">
      <header className="topbar">
        <h2>我的书架</h2>
        <button className="btn" onClick={logout}>
          退出
        </button>
      </header>

      {error && <div className="error-box">{error}</div>}
      {!shelf && !error && <p className="hint">加载中…</p>}
      {shelf?.length === 0 && (
        <p className="hint">书架还是空的，去管理后台上传一本书吧。</p>
      )}

      <div className="shelf-grid">
        {shelf?.map(({ book, progress }) => (
          <Link to={`/read/${book.id}`} key={book.id} className="book-card">
            <div className={`book-cover cover-${book.fileType}`}>
              {book.fileType.toUpperCase()}
            </div>
            <div className="book-meta">
              <div className="book-title">{book.title}</div>
              <div className="book-author">{book.author || '未知作者'}</div>
              {progress ? (
                <>
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{ width: `${progress.percentage}%` }}
                    />
                  </div>
                  <div className="progress-text">
                    {progress.percentage}% · 第 {progress.currentPage}/
                    {progress.totalPages} 页
                  </div>
                </>
              ) : (
                <div className="progress-text">未读</div>
              )}
            </div>
          </Link>
        ))}
      </div>

      <footer className="foot">
        {user?.username} · 星辰云图书馆
      </footer>
    </div>
  );
}
