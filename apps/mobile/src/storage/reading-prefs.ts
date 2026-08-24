/**
 * 阅读偏好（排版与翻页设置）。
 * 档位常量与翻页模式类型的唯一权威定义在 @starcloud/shared。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  FONT_STEPS,
  LINE_HEIGHTS,
  MARGINS,
  type PageMode,
  type SwipeDirection,
} from '@starcloud/shared';

// 转出口供 App 内使用
export { FONT_STEPS, LINE_HEIGHTS, MARGINS };
export type { PageMode, SwipeDirection };

export type PageAxis = 'horizontal' | 'vertical';

export interface ReadingPrefs {
  fontStep: number; // FONT_STEPS 索引
  lineHeightIdx: number; // LINE_HEIGHTS 索引
  marginIdx: number; // MARGINS 索引
  pageMode: PageMode;
  pageAxis: PageAxis; // 仅 TXT 分页式有意义
  swipeDirection: SwipeDirection;
}

const DEFAULTS: ReadingPrefs = {
  fontStep: FONT_STEPS.indexOf(100),
  lineHeightIdx: 1,
  marginIdx: 1,
  pageMode: 'tap',
  pageAxis: 'horizontal',
  swipeDirection: 'left-next',
};

const KEY = 'starcloud.readingPrefs';

let cache: ReadingPrefs = { ...DEFAULTS };

export async function loadReadingPrefs(): Promise<ReadingPrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) cache = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ReadingPrefs>) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function getReadingPrefs(): ReadingPrefs {
  return cache;
}

export async function updateReadingPrefs(patch: Partial<ReadingPrefs>): Promise<void> {
  cache = { ...cache, ...patch };
  await AsyncStorage.setItem(KEY, JSON.stringify(cache));
}
