import type { LoginResponse } from '@starcloud/shared';

const TOKEN_KEY = 'starcloud.token';
const USER_KEY = 'starcloud.user';

/**
 * 后端地址：网页版默认同源（dev 由 Vite 代理转发，生产与后端同域部署）。
 * 移动端有独立的 API 客户端（apps/mobile/src/api/client.ts），不经过本模块。
 */
export function getServerUrl(): string {
  return (localStorage.getItem('starcloud.serverUrl') ?? '').replace(/\/+$/, '');
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): LoginResponse['user'] | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as LoginResponse['user']) : null;
}

export function storeSession(session: LoginResponse) {
  localStorage.setItem(TOKEN_KEY, session.accessToken);
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(getServerUrl() + path, { ...init, headers });

  if (res.status === 401) {
    clearSession();
    window.location.assign('/login');
    throw new ApiError(401, '登录已过期');
  }

  const data = res.headers.get('content-type')?.includes('application/json')
    ? await res.json()
    : null;

  if (!res.ok) {
    const message =
      (data as { message?: string | string[] })?.message ?? '请求失败';
    throw new ApiError(
      res.status,
      Array.isArray(message) ? message.join('；') : message,
    );
  }
  return data as T;
}
