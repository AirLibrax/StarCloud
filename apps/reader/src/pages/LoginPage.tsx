import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LoginResponse } from '@starcloud/shared';
import { api, storeSession } from '../api/client';

type Mode = 'login' | 'register';

export default function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 注册口令门禁状态：null = 加载中（先不渲染输入框，避免闪烁），true/false = 结果
  const [inviteRequired, setInviteRequired] = useState<boolean | null>(null);

  useEffect(() => {
    // 查询注册是否需要口令；接口不可达时按「不需要」处理（功能关闭等同语义）
    api<{ inviteCodeRequired: boolean }>('/api/auth/registration')
      .then((r) => setInviteRequired(!!r.inviteCodeRequired))
      .catch(() => setInviteRequired(false));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api<LoginResponse>(
        mode === 'login' ? '/api/auth/login' : '/api/auth/register',
        {
          method: 'POST',
          body: JSON.stringify(
            mode === 'login'
              ? { username, password }
              : { username, password, confirmPassword, inviteCode },
          ),
        },
      );
      storeSession(session);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPassword('');
    setConfirmPassword('');
    setInviteCode('');
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>星辰云图书馆</h1>
        <p className="login-sub">
          {mode === 'login' ? '登录后开始阅读' : '注册新账号'}
        </p>
        <label>
          用户名
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
          />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {mode === 'register' && (
          <label>
            确认密码
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </label>
        )}
        {mode === 'register' && inviteRequired === true && (
          <label>
            注册口令
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              autoComplete="one-time-code"
              required
            />
          </label>
        )}
        {error && <div className="error-box">{error}</div>}
        <button className="btn primary" disabled={busy}>
          {busy
            ? mode === 'login'
              ? '登录中…'
              : '注册中…'
            : mode === 'login'
              ? '登录'
              : '注册并登录'}
        </button>
        {mode === 'login' ? (
          <button type="button" className="btn" onClick={() => switchMode('register')}>
            注册
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => switchMode('login')}>
            ← 返回登录
          </button>
        )}
      </form>
    </div>
  );
}