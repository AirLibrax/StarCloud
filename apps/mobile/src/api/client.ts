/**
 * 服务器 API 客户端。
 * 服务器地址与令牌由设置页配置（见 storage/settings.ts）。
 */
import type { Book, LoginResponse, ReadingProgress } from '@starcloud/shared';
import { getSettings } from '../storage/settings';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export async function login(serverUrl: string, username: string, password: string) {
  const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, (data as any)?.message ?? '登录失败');
  }
  return (await res.json()) as LoginResponse;
}

/** 注册配置（公开接口）：只返回是否需要注册口令的布尔开关，不包含口令本身 */
export interface RegistrationConfig {
  inviteCodeRequired: boolean;
}

export async function fetchRegistration(
  serverUrl: string,
): Promise<RegistrationConfig> {
  const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/auth/registration`);
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = data?.message;
    throw new ApiError(
      res.status,
      Array.isArray(message) ? message.join('；') : (message ?? '查询注册配置失败'),
    );
  }
  return (await res.json()) as RegistrationConfig;
}

/** 自助注册：注册即登录，返回与登录相同的会话结构 */
export async function register(
  serverUrl: string,
  username: string,
  password: string,
  confirmPassword: string,
  inviteCode?: string,
) {
  const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      confirmPassword,
      ...(inviteCode ? { inviteCode } : {}),
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = data?.message;
    throw new ApiError(
      res.status,
      Array.isArray(message) ? message.join('；') : (message ?? '注册失败'),
    );
  }
  return (await res.json()) as LoginResponse;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const { serverUrl, token } = getSettings();
  if (!serverUrl || !token) throw new ApiError(0, '未配置服务器');

  const res = await fetch(`${serverUrl.replace(/\/+$/, '')}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body && typeof init.body === 'string'
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init?.headers,
    },
  });

  if (res.status === 401) throw new ApiError(401, '令牌无效或已过期，请在设置中重新登录');
  const data = res.headers.get('content-type')?.includes('application/json')
    ? await res.json()
    : null;
  if (!res.ok) {
    const message = (data as any)?.message ?? '请求失败';
    throw new ApiError(res.status, Array.isArray(message) ? message.join('；') : message);
  }
  return data as T;
}

/** 云端书架：书籍 + 个人进度 */
export interface CloudShelfItem {
  book: Book & { readerCount?: number };
  progress: ReadingProgress | null;
}

export function fetchShelf() {
  return api<CloudShelfItem[]>('/api/shelf');
}

/** 书籍文件的带令牌访问地址（WebView / 下载用） */
export function fileUrl(bookId: number): string {
  const { serverUrl, token } = getSettings();
  if (!serverUrl) throw new ApiError(0, '未配置服务器');
  return `${serverUrl.replace(/\/+$/, '')}/api/books/${bookId}/download?access_token=${token}`;
}

/** 上报阅读进度（静默失败，不打断阅读） */
export async function reportProgress(
  bookId: number,
  currentPage: number,
  totalPages: number,
): Promise<void> {
  try {
    await api('/api/progress', {
      method: 'POST',
      body: JSON.stringify({ bookId, currentPage, totalPages }),
    });
  } catch {
    // 进度上报失败不打断阅读
  }
}
