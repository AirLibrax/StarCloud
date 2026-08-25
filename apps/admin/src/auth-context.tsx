import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import type { LoginResponse, UserPublic } from '@starcloud/shared';
import { clearSession, getStoredUser, storeSession } from './api/client';

/**
 * 认证上下文：登录状态放这里，
 * 页面只消费 useAuth()，不直接碰 localStorage。
 */
const AuthContext = createContext<{
  user: UserPublic | null;
  /** 登录成功后必须调用：写会话并同步更新 context，否则本帧内 user 仍为 null */
  login: (session: LoginResponse) => void;
  logout: () => void;
}>({ user: null, login: () => {}, logout: () => {} });

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(getStoredUser());
  const navigate = useNavigate();

  // 多标签页场景：另一处退出登录时本页同步失效
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === 'starcloud.token' && !e.newValue) setUser(null);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const login = useCallback((session: LoginResponse) => {
    storeSession(session);
    setUser(session.user);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
