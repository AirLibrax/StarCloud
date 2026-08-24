/**
 * 应用设置：服务器地址 + 访问令牌（规格 F3，仅此两项）。
 * 内存缓存供 API 层同步读取；启动与保存时刷新。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Settings {
  serverUrl: string;
  token: string;
  username: string | null;
}

const KEY = 'starcloud.settings';

let cache: Settings = { serverUrl: '', token: '', username: null };

/** 启动时调用一次，把持久化设置载入内存缓存 */
export async function loadSettingsCache(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      cache = JSON.parse(raw) as Settings;
      return;
    }
  } catch {
    // 损坏则回退默认
  }
  cache = { serverUrl: '', token: '', username: null };
}

/** 同步读取当前设置（须先调用过 loadSettingsCache） */
export function getSettings(): Settings {
  return cache;
}

export async function saveSettings(s: Settings): Promise<void> {
  cache = s;
  await AsyncStorage.setItem(KEY, JSON.stringify(s));
}
