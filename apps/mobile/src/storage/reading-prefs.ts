/**
 * 阅读偏好（排版与翻页设置）。
 * 档位常量与翻页模式类型的唯一权威定义在 @starcloud/shared。
 *
 * 持久化键名与 Web 端 localStorage 的 starcloud.* 系列一一对应
 * （冻结交互规格 docs/reader-interaction.md 第六节）。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  FONT_STEPS,
  LINE_HEIGHTS,
  MARGINS,
  type PageMode,
  type SwipeLayout,
  type SwipeDirection,
} from '@starcloud/shared';

// 转出口供 App 内使用
export { FONT_STEPS, LINE_HEIGHTS, MARGINS };
export type { PageMode, SwipeLayout, SwipeDirection };

export type SpreadTwoUp = 'single' | 'two-up';

export interface ReadingPrefs {
  fontStep: number; // FONT_STEPS 索引
  lineHeightIdx: number; // LINE_HEIGHTS 索引
  marginIdx: number; // MARGINS 索引
  pageMode: PageMode;
  swipeLayout: SwipeLayout; // 滑动翻页轴向（仅 pageMode==='swipe'）
  swipeDirection: SwipeDirection;
  spreadTwoUp: SpreadTwoUp; // App 暂未实现双列渲染，仅与 Web 键对应持久化
}

const DEFAULTS: ReadingPrefs = {
  fontStep: FONT_STEPS.indexOf(100),
  lineHeightIdx: 1,
  marginIdx: 1,
  pageMode: 'tap',
  swipeLayout: 'horizontal',
  swipeDirection: 'left-next',
  spreadTwoUp: 'two-up',
};

/** 与 Web localStorage 一一对应的 AsyncStorage 键 */
const KEYS: Record<keyof ReadingPrefs, string> = {
  fontStep: 'starcloud.fontStep',
  lineHeightIdx: 'starcloud.lineHeight',
  marginIdx: 'starcloud.margin',
  pageMode: 'starcloud.pageMode',
  swipeLayout: 'starcloud.swipeLayout',
  swipeDirection: 'starcloud.swipeDirection',
  spreadTwoUp: 'starcloud.spreadTwoUp',
};

/** 旧版聚合存储键（单键 JSON），加载时迁移后删除 */
const LEGACY_KEY = 'starcloud.readingPrefs';

const MODES: PageMode[] = ['tap', 'swipe'];
const LAYOUTS: SwipeLayout[] = ['horizontal', 'vertical'];
const DIRECTIONS: SwipeDirection[] = ['left-next', 'right-next'];
const SPREADS: SpreadTwoUp[] = ['single', 'two-up'];

let cache: ReadingPrefs = { ...DEFAULTS };

function validIdx(v: unknown, len: number, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < len
    ? v
    : fallback;
}

function normalize(raw: Partial<ReadingPrefs>): ReadingPrefs {
  const base = { ...DEFAULTS, ...raw };
  return {
    fontStep: validIdx(base.fontStep, FONT_STEPS.length, DEFAULTS.fontStep),
    lineHeightIdx: validIdx(
      base.lineHeightIdx,
      LINE_HEIGHTS.length,
      DEFAULTS.lineHeightIdx,
    ),
    marginIdx: validIdx(base.marginIdx, MARGINS.length, DEFAULTS.marginIdx),
    pageMode: MODES.includes(base.pageMode) ? base.pageMode : DEFAULTS.pageMode,
    swipeLayout: LAYOUTS.includes(base.swipeLayout)
      ? base.swipeLayout
      : DEFAULTS.swipeLayout,
    swipeDirection: DIRECTIONS.includes(base.swipeDirection)
      ? base.swipeDirection
      : DEFAULTS.swipeDirection,
    spreadTwoUp: SPREADS.includes(base.spreadTwoUp)
      ? base.spreadTwoUp
      : DEFAULTS.spreadTwoUp,
  };
}

function parseField(
  field: keyof ReadingPrefs,
  value: string,
  current: ReadingPrefs,
): ReadingPrefs {
  switch (field) {
    case 'fontStep':
    case 'lineHeightIdx':
    case 'marginIdx': {
      const n = parseInt(value, 10);
      const len =
        field === 'fontStep'
          ? FONT_STEPS.length
          : field === 'lineHeightIdx'
            ? LINE_HEIGHTS.length
            : MARGINS.length;
      return validIdx(n, len, current[field]) === n
        ? { ...current, [field]: n }
        : current;
    }
    case 'pageMode':
      return MODES.includes(value as PageMode)
        ? { ...current, pageMode: value as PageMode }
        : current;
    case 'swipeLayout':
      return LAYOUTS.includes(value as SwipeLayout)
        ? { ...current, swipeLayout: value as SwipeLayout }
        : current;
    case 'swipeDirection':
      return DIRECTIONS.includes(value as SwipeDirection)
        ? { ...current, swipeDirection: value as SwipeDirection }
        : current;
    case 'spreadTwoUp':
      return SPREADS.includes(value as SpreadTwoUp)
        ? { ...current, spreadTwoUp: value as SpreadTwoUp }
        : current;
    default:
      return current;
  }
}

export async function loadReadingPrefs(): Promise<ReadingPrefs> {
  let merged: ReadingPrefs = { ...DEFAULTS };

  // 旧版单键 JSON：读一次并迁移到逐键存储
  try {
    const legacy = await AsyncStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as Partial<ReadingPrefs>;
      merged = normalize({ ...merged, ...parsed });
      await AsyncStorage.removeItem(LEGACY_KEY);
    }
  } catch {
    // 旧键损坏则忽略
  }

  const entries = await AsyncStorage.multiGet(Object.values(KEYS));
  for (const [key, value] of entries) {
    if (value == null) continue;
    const field = (Object.keys(KEYS) as (keyof ReadingPrefs)[]).find(
      (f) => KEYS[f] === key,
    );
    if (!field) continue;
    merged = parseField(field, value, merged);
  }

  cache = normalize(merged);
  return cache;
}

export function getReadingPrefs(): ReadingPrefs {
  return cache;
}

export async function updateReadingPrefs(
  patch: Partial<ReadingPrefs>,
): Promise<void> {
  cache = normalize({ ...cache, ...patch });
  await AsyncStorage.multiSet(
    (Object.entries(patch) as [keyof ReadingPrefs, ReadingPrefs[keyof ReadingPrefs]][]).map(
      ([field, value]) => [KEYS[field], String(value)],
    ),
  );
}