import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import type { UserPublic } from '@starcloud/shared';
import { clearSession, getStoredUser } from './api/client';

const AuthContext = createContext<{
  user: UserPublic | null;
  logout: () => void;
}>({ user: null, logout: () => {} });

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user] = useState<UserPublic | null>(getStoredUser());
  const navigate = useNavigate();

  const logout = useCallback(() => {
    clearSession();
    navigate('/login', { replace: true });
  }, [navigate]);

  return (
    <AuthContext.Provider value={{ user, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
