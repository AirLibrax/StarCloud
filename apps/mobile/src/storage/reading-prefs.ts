/**
 * 阅读偏好（排版设置）：与 Web 端同一套档位。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const FONT_STEPS = [80, 90, 100, 110, 125, 140, 160, 180];
export const LINE_HEIGHTS = [1.4, 1.6, 1.9, 2.2];
export const MARGINS = [10, 24, 48, 80];

export type PageMode = 'paged' | 'scrolled';
export type PageAxis = 'horizontal' | 'vertical';
/** 分页式横向翻页的方向习惯：向左滑=下一页（默认）或 向右滑=下一页 */
export type SwipeDirection = 'left-next' | 'right-next';

export interface ReadingPrefs {
  fontStep: number; // FONT_STEPS 索引
  lineHeightIdx: number;
  marginIdx: number;
  pageMode: PageMode;
  pageAxis: PageAxis;
  swipeDirection: SwipeDirection;
}

const DEFAULTS: ReadingPrefs = {
  fontStep: 2,
  lineHeightIdx: 1,
  marginIdx: 1,
  pageMode: 'paged',
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
