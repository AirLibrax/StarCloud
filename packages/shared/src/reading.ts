/**
 * 阅读交互模型 —— 全项目唯一权威定义。
 * Web 端与 App 端的翻页交互都必须引用本文件，
 * 禁止在各自的界面代码里另行硬编码档位或区域规则。
 */

/* ---------------- 排版档位 ---------------- */

/** 字号档位（百分比） */
export const FONT_STEPS = [80, 90, 100, 110, 125, 140, 160, 180];

/** 行距档位（倍数）—— 与冻结交互规格 docs/reader-interaction.md 完全一致 */
export const LINE_HEIGHTS = [1.4, 1.6, 1.8, 2.0];

/** 左右页边距档位（px） */
export const MARGINS = [10, 24, 48, 80];

/* ---------------- 翻页方式 ---------------- */

/**
 * 两大翻页方式：
 * - tap:   点击翻页（屏幕左右分区，含义随方向偏好）
 * - swipe: 滑动翻页（配合 swipeLayout 细分左右/上下）
 */
export type PageMode = 'tap' | 'swipe';

/**
 * 滑动翻页的轴向（仅 pageMode === 'swipe' 时有意义）：
 * - horizontal: 左右滑动
 * - vertical:   上下滑动
 */
export type SwipeLayout = 'horizontal' | 'vertical';

/**
 * 上下滑动的翻页样式（仅 swipeLayout === 'vertical' 时有意义）：
 * - continuous: 无缝滑动，整章内容连成一条
 * - paged:      单页滑动，手指上推一页一页切
 */
export type VerticalStyle = 'continuous' | 'paged';

/**
 * 方向偏好（点击翻页 / 左右滑动时生效）：
 * - left-next:  向左下一页（日式漫画方向）
 * - right-next: 向右下一页（常规中文书方向）
 */
export type SwipeDirection = 'left-next' | 'right-next';

export interface ReadingInteractionPrefs {
  pageMode: PageMode;
  swipeLayout: SwipeLayout;
  verticalStyle: VerticalStyle;
  swipeDirection: SwipeDirection;
}

/* ---------------- 点击分区 ---------------- */

/**
 * 判定一次点击落在哪个翻页区（点击翻页模式专用）。
 *
 * 屏幕按中垂线分为两半，含义随方向偏好决定：
 * - 「向左下一页」→ 点左半为下一页，右半为上一页；
 * - 「向右下一页」→ 点右半为下一页，左半为上一页。
 */
export function tapZoneAction(
  x: number,
  width: number,
  direction: SwipeDirection,
): 'prev' | 'next' {
  const onLeft = x < width / 2;
  if (direction === 'left-next') return onLeft ? 'next' : 'prev';
  return onLeft ? 'prev' : 'next';
}
