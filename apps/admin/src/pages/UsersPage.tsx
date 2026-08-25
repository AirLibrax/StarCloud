import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { UserPublic } from '@starcloud/shared';
import { api } from '../api/client';
import { useAuth } from '../auth-context';

interface EditState {
  id: number;
  username: string;
  isAdmin: boolean;
  isActive: boolean;
}

export default function UsersPage() {
  const { user, logout } = useAuth();
  const [users, setUsers] = useState<UserPublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 创建用户表单
  const [cUsername, setCUsername] = useState('');
  const [cPassword, setCPassword] = useState('');
  const [cIsAdmin, setCIsAdmin] = useState(false);
  const [creating, setCreating] = useState(false);

  // 行内编辑状态
  const [editRow, setEditRow] = useState<EditState | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  // 行内修改密码状态
  const [resetRowId, setResetRowId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  const [deleting, setDeleting] = useState<number | null>(null);

  // 表单挂载后让焦点落在新密码输入框（不依赖 autoFocus，避免焦点闪烁/失焦问题）
  useEffect(() => {
    if (resetRowId != null) {
      passwordInputRef.current?.focus();
    }
  }, [resetRowId]);

  const load = useCallback(async () => {
    try {
      setUsers(await api<UserPublic[]>('/api/users'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await api<UserPublic>('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          username: cUsername.trim(),
          password: cPassword,
          isAdmin: cIsAdmin,
        }),
      });
      setNotice(`已创建用户 ${cUsername.trim()}`);
      setCUsername('');
      setCPassword('');
      setCIsAdmin(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveEdit() {
    if (!editRow) return;
    setEditBusy(true);
    setError(null);
    try {
      await api<UserPublic>(`/api/users/${editRow.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          username: editRow.username.trim(),
          isAdmin: editRow.isAdmin,
          isActive: editRow.isActive,
        }),
      });
      setNotice('已保存修改');
      setEditRow(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setEditBusy(false);
    }
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault();
    if (resetRowId == null) return;
    setResetBusy(true);
    setError(null);
    try {
      await api(`/api/users/${resetRowId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword: resetPassword }),
      });
      setNotice('密码已修改');
      setResetRowId(null);
      setResetPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改失败');
    } finally {
      setResetBusy(false);
    }
  }

  async function handleDelete(row: UserPublic) {
    if (
      !confirm(
        `确定删除用户 ${row.username}？账号与阅读进度将被彻底删除，不可恢复。`,
      )
    ) {
      return;
    }
    setDeleting(row.id);
    setError(null);
    try {
      await api(`/api/users/${row.id}`, { method: 'DELETE' });
      setNotice(`已删除用户 ${row.username}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(null);
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
        <h3>创建用户</h3>
        <form className="upload-form" onSubmit={handleCreate}>
          <input
            placeholder="用户名"
            value={cUsername}
            onChange={(e) => setCUsername(e.target.value)}
            maxLength={50}
            required
          />
          <input
            type="password"
            placeholder="初始密码（至少 4 位）"
            value={cPassword}
            onChange={(e) => setCPassword(e.target.value)}
            minLength={4}
            required
          />
          <label className="check-label">
            <input
              type="checkbox"
              checked={cIsAdmin}
              onChange={(e) => setCIsAdmin(e.target.checked)}
            />
            设为管理员
          </label>
          <button className="btn primary" disabled={creating}>
            {creating ? '创建中…' : '创建'}
          </button>
        </form>
      </section>

      <section className="card">
        <h3>用户列表{users ? `（${users.length}）` : ''}</h3>
        {!users ? (
          <p className="hint">加载中…</p>
        ) : users.length === 0 ? (
          <p className="hint">还没有用户。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>用户名</th>
                <th>角色</th>
                <th>状态</th>
                <th>创建时间</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((row) => {
                const isMe = row.id === user?.id;
                const editing = editRow?.id === row.id;
                return (
                  <tr key={row.id}>
                    {editing ? (
                      <>
                        <td>
                          <input
                            value={editRow.username}
                            onChange={(e) =>
                              setEditRow({
                                ...editRow,
                                username: e.target.value,
                              })
                            }
                            maxLength={50}
                          />
                        </td>
                        <td>
                          <label className="check-label">
                            <input
                              type="checkbox"
                              checked={editRow.isAdmin}
                              disabled={isMe}
                              onChange={(e) =>
                                setEditRow({
                                  ...editRow,
                                  isAdmin: e.target.checked,
                                })
                              }
                            />
                            管理员
                          </label>
                        </td>
                        <td>
                          <label className="check-label">
                            <input
                              type="checkbox"
                              checked={editRow.isActive}
                              disabled={isMe}
                              onChange={(e) =>
                                setEditRow({
                                  ...editRow,
                                  isActive: e.target.checked,
                                })
                              }
                            />
                            启用
                          </label>
                        </td>
                        <td>{new Date(row.createdAt).toLocaleString('zh-CN')}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="btn primary"
                              disabled={editBusy}
                              onClick={handleSaveEdit}
                            >
                              保存
                            </button>
                            <button
                              className="btn"
                              onClick={() => setEditRow(null)}
                            >
                              取消
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>
                          {row.username}
                          {isMe && <span className="vol-badge">我</span>}
                        </td>
                        <td>
                          {row.isAdmin ? (
                            <span className="tag tag-admin">管理员</span>
                          ) : (
                            <span className="tag tag-user">普通用户</span>
                          )}
                        </td>
                        <td>
                          {row.isActive ? (
                            <span className="tag tag-active">启用</span>
                          ) : (
                            <span className="tag tag-inactive">停用</span>
                          )}
                        </td>
                        <td>{new Date(row.createdAt).toLocaleString('zh-CN')}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="btn"
                              onClick={() =>
                                setEditRow({
                                  id: row.id,
                                  username: row.username,
                                  isAdmin: row.isAdmin,
                                  isActive: row.isActive,
                                })
                              }
                            >
                              编辑
                            </button>
                            {resetRowId === row.id ? null : (
                              <button
                                className="btn"
                                onClick={() => {
                                  setResetRowId(row.id);
                                  setResetPassword('');
                                }}
                              >
                                修改密码
                              </button>
                            )}
                            <button
                              className="btn danger"
                              disabled={isMe || deleting === row.id}
                              onClick={() => handleDelete(row)}
                            >
                              {deleting === row.id ? '删除中…' : '删除'}
                            </button>
                          </div>
                          {resetRowId === row.id && (
                            <form
                              className="reset-form"
                              onSubmit={handleResetPassword}
                            >
                              <input
                                ref={passwordInputRef}
                                type="password"
                                name="newPassword"
                                autoComplete="new-password"
                                placeholder="新密码（至少 4 位）"
                                value={resetPassword}
                                onChange={(e) => setResetPassword(e.target.value)}
                                minLength={4}
                                required
                              />
                              <button
                                className="btn primary"
                                disabled={resetBusy}
                              >
                                确认
                              </button>
                              <button
                                type="button"
                                className="btn"
                                onClick={() => setResetRowId(null)}
                              >
                                取消
                              </button>
                            </form>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}