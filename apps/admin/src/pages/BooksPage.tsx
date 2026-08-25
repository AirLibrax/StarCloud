import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { Book } from '@starcloud/shared';
import { api } from '../api/client';
import { useAuth } from '../auth-context';

interface BookRow extends Book {
  readerCount: number;
}

interface UploadResult {
  name: string;
  ok: boolean;
  message: string;
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
  const [upCategory, setUpCategory] = useState('');
  const [upTags, setUpTags] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);

  // 搜索 / 分类筛选
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<string[]>([]);

  // 行内编辑状态
  const [editId, setEditId] = useState<number | null>(null);
  const [edTitle, setEdTitle] = useState('');
  const [edVolume, setEdVolume] = useState('');
  const [edAuthor, setEdAuthor] = useState('');
  const [edDescription, setEdDescription] = useState('');
  const [edCategory, setEdCategory] = useState('');
  const [edTags, setEdTags] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  // 多选与批量删除
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (category) params.set('category', category);
      const qs = params.toString();
      setBooks(await api<BookRow[]>(`/api/books${qs ? `?${qs}` : ''}`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, [q, category]);

  useEffect(() => {
    load();
  }, [load]);

  // 分类下拉选项：从现有数据 distinct 而来（一次全量拉取）
  useEffect(() => {
    api<BookRow[]>('/api/books')
      .then((all) => {
        setCategories(
          [...new Set(all.map((b) => b.category).filter((c): c is string => !!c))].sort(
            (a, b) => a.localeCompare(b, 'zh-CN'),
          ),
        );
      })
      .catch(() => {
        /* 选项加载失败不阻断页面 */
      });
  }, []);

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      const allIds = (books ?? []).map((b) => b.id);
      const allChecked = allIds.length > 0 && allIds.every((id) => next.has(id));
      for (const id of allIds) {
        if (allChecked) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const files = Array.from(fileRef.current?.files ?? []);
    if (files.length === 0) {
      setError('请选择书籍文件');
      return;
    }
    setUploading(true);
    setError(null);
    setUploadResults([]);
    try {
      const results: UploadResult[] = [];
      for (const file of files) {
        try {
          const form = new FormData();
          // 多文件时书名自动识别（同一标题不适用于多个文件）；其余字段应用到每个
          if (files.length === 1 && title.trim()) {
            form.append('title', title.trim());
          }
          if (author.trim()) form.append('author', author.trim());
          if (upCategory.trim()) form.append('category', upCategory.trim());
          if (upTags.trim()) form.append('tags', upTags.trim());
          form.append('file', file);
          await api<BookRow>('/api/books', { method: 'POST', body: form });
          results.push({ name: file.name, ok: true, message: '上传成功' });
        } catch (err) {
          results.push({
            name: file.name,
            ok: false,
            message: err instanceof Error ? err.message : '上传失败',
          });
        }
      }
      const okCount = results.filter((r) => r.ok).length;
      setUploadResults(results);
      setNotice(
        `共 ${files.length} 个文件，成功 ${okCount} 个${okCount < files.length ? `，失败 ${files.length - okCount} 个` : ''}`,
      );
      setTitle('');
      setAuthor('');
      setUpCategory('');
      setUpTags('');
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } finally {
      setUploading(false);
    }
  }

  function startEdit(b: BookRow) {
    setEditId(b.id);
    setEdTitle(b.title);
    setEdVolume(b.volume != null ? String(b.volume) : '');
    setEdAuthor(b.author ?? '');
    setEdDescription(b.description ?? '');
    setEdCategory(b.category ?? '');
    setEdTags(b.tags.join(','));
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (editId == null) return;
    setEditBusy(true);
    setError(null);
    try {
      const volume = edVolume.trim();
      await api<BookRow>(`/api/books/${editId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: edTitle.trim(),
          volume:
            volume === '' || Number.isNaN(Number(volume))
              ? null
              : Number(volume),
          author: edAuthor,
          description: edDescription,
          category: edCategory.trim() === '' ? null : edCategory.trim(),
          tags: edTags,
        }),
      });
      setNotice('已保存修改');
      setEditId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setEditBusy(false);
    }
  }

  async function handleDelete(book: BookRow) {
    if (!confirm(`确定删除《${book.title}》？文件将一并移除。`)) return;
    try {
      await api(`/api/books/${book.id}`, { method: 'DELETE' });
      setNotice(`已删除《${book.title}》`);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(book.id);
        return next;
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  }

  async function handleBatchDelete() {
    if (selected.size === 0) return;
    if (!confirm(`确定删除选中的 ${selected.size} 本书？文件将一并移除。`)) return;
    setBatchBusy(true);
    setError(null);
    try {
      const r = await api<{ deleted: number; skipped: number[] }>(
        '/api/books/batch-delete',
        {
          method: 'POST',
          body: JSON.stringify({ ids: [...selected] }),
        },
      );
      setNotice(
        `已删除 ${r.deleted} 本${r.skipped.length > 0 ? `，跳过不存在的 ${r.skipped.length} 本` : ''}`,
      );
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量删除失败');
    } finally {
      setBatchBusy(false);
    }
  }

  async function handleCoverUpload(
    b: BookRow,
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许再次选择同一文件
    if (!file) return;
    try {
      const form = new FormData();
      form.append('file', file);
      await api<BookRow>(`/api/books/${b.id}/cover`, {
        method: 'POST',
        body: form,
      });
      setNotice(`《${b.title}》封面已更新`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '封面上传失败');
    }
  }

  async function handleCoverRemove(b: BookRow) {
    if (!confirm(`确定移除《${b.title}》的封面？`)) return;
    try {
      await api(`/api/books/${b.id}/cover`, { method: 'DELETE' });
      setNotice(`已移除《${b.title}》的封面`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '移除封面失败');
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <nav className="tabs">
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? 'tab active' : 'tab')}
          >
            书籍管理
          </NavLink>
          {user?.isAdmin && (
            <NavLink
              to="/users"
              className={({ isActive }) => (isActive ? 'tab active' : 'tab')}
            >
              用户管理
            </NavLink>
          )}
        </nav>
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
        <h3>上传新书（可多选）</h3>
        <form className="upload-form" onSubmit={handleUpload}>
          <input
            placeholder="书名（留空自动识别，多选时忽略）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
          <input
            placeholder="作者（可选）"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
          />
          <input
            placeholder="分类（可选）"
            value={upCategory}
            onChange={(e) => setUpCategory(e.target.value)}
            list="category-options"
            maxLength={50}
          />
          <input
            placeholder="标签，逗号分隔（可选）"
            value={upTags}
            onChange={(e) => setUpTags(e.target.value)}
            maxLength={500}
          />
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.epub,.txt"
            multiple
            required
          />
          <button className="btn primary" disabled={uploading}>
            {uploading ? '上传中…' : '上传'}
          </button>
        </form>
        <datalist id="category-options">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <p className="hint">支持 PDF / EPUB / TXT，单文件上限 100MB，可一次选择多个文件</p>
        {uploadResults.length > 0 && (
          <ul className="upload-results">
            {uploadResults.map((r) => (
              <li key={r.name} className={r.ok ? 'ok' : 'fail'}>
                {r.ok ? '✓' : '✗'} {r.name} — {r.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h3>筛选与搜索</h3>
        <form
          className="upload-form"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <input
            placeholder="搜索书名 / 作者"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">全部分类</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button className="btn primary" type="submit">
            搜索
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              setQ('');
              setCategory('');
            }}
          >
            重置
          </button>
        </form>
      </section>

      <section className="card">
        <h3>
          馆藏列表{books ? `（${books.length}）` : ''}
          {selected.size > 0 && (
            <button
              className="btn danger"
              disabled={batchBusy}
              onClick={handleBatchDelete}
              style={{ marginLeft: '0.8rem' }}
            >
              {batchBusy
                ? '删除中…'
                : `删除所选（${selected.size}）`}
            </button>
          )}
        </h3>
        {!books ? (
          <p className="hint">加载中…</p>
        ) : books.length === 0 ? (
          <p className="hint">没有匹配的藏书。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    onChange={toggleSelectAll}
                    checked={
                      books.length > 0 && books.every((b) => selected.has(b.id))
                    }
                  />
                </th>
                <th>书名</th>
                <th>作者</th>
                <th>分类</th>
                <th>标签</th>
                <th>格式</th>
                <th>大小</th>
                <th>上传时间</th>
                <th>读者数</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {books.map((b) =>
                editId === b.id ? (
                  <tr key={b.id}>
                    <td colSpan={10}>
                      <form className="edit-form" onSubmit={handleSaveEdit}>
                        <input
                          placeholder="书名"
                          value={edTitle}
                          onChange={(e) => setEdTitle(e.target.value)}
                          maxLength={200}
                          required
                        />
                        <input
                          type="number"
                          placeholder="卷数（留空清除）"
                          value={edVolume}
                          onChange={(e) => setEdVolume(e.target.value)}
                          min={1}
                        />
                        <input
                          placeholder="作者"
                          value={edAuthor}
                          onChange={(e) => setEdAuthor(e.target.value)}
                        />
                        <input
                          placeholder="分类"
                          value={edCategory}
                          onChange={(e) => setEdCategory(e.target.value)}
                          list="category-options"
                          maxLength={50}
                        />
                        <input
                          placeholder="标签，逗号分隔（整体替换）"
                          value={edTags}
                          onChange={(e) => setEdTags(e.target.value)}
                          maxLength={500}
                          className="edit-wide"
                        />
                        <input
                          placeholder="简介"
                          value={edDescription}
                          onChange={(e) => setEdDescription(e.target.value)}
                          maxLength={2000}
                          className="edit-wide"
                        />
                        <div className="row-actions">
                          <button
                            className="btn primary"
                            disabled={editBusy}
                            type="submit"
                          >
                            保存
                          </button>
                          <button
                            className="btn"
                            type="button"
                            onClick={() => setEditId(null)}
                          >
                            取消
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={b.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(b.id)}
                        onChange={() => toggleSelect(b.id)}
                      />
                    </td>
                    <td>
                      <div className="title-cell">
                        {b.coverImage && (
                          <img src={b.coverImage} alt="" className="cover-thumb" />
                        )}
                        <span>
                          {b.title}
                          {b.volume != null && (
                            <span className="vol-badge">第{b.volume}卷</span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td>{b.author || '-'}</td>
                    <td>{b.category || '-'}</td>
                    <td>
                      {b.tags.length === 0
                        ? '-'
                        : b.tags.map((t) => (
                            <span key={t} className="tag tag-chip">
                              {t}
                            </span>
                          ))}
                    </td>
                    <td>
                      <span className={`tag tag-${b.fileType}`}>
                        {b.fileType.toUpperCase()}
                      </span>
                    </td>
                    <td>{formatSize(b.fileSize)}</td>
                    <td>{new Date(b.uploadedAt).toLocaleString('zh-CN')}</td>
                    <td>{b.readerCount}</td>
                    <td>
                      <div className="row-actions">
                        <label className="btn btn-file">
                          改封面
                          <input
                            type="file"
                            hidden
                            accept="image/png,image/jpeg,image/webp"
                            onChange={(e) => handleCoverUpload(b, e)}
                          />
                        </label>
                        {b.coverImage && (
                          <button
                            className="btn"
                            onClick={() => handleCoverRemove(b)}
                          >
                            去封面
                          </button>
                        )}
                        <button className="btn" onClick={() => startEdit(b)}>
                          编辑
                        </button>
                        <button
                          className="btn danger"
                          onClick={() => handleDelete(b)}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}