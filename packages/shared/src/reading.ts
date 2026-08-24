/**
 * 阅读交互模型 —— 全项目唯一权威定义。
 * Web 端与 App 端的翻页交互都必须引用本文件，
 * 禁止在各自的界面代码里另行硬编码档位或区域规则。
 */

/* ---------------- 排版档位 ---------------- */

/** 字号档位（百分比） */
export const FONT_STEPS = [80, 90, 100, 110, 125, 140, 160, 180];

/** 行距档位（倍数） */
export const LINE_HEIGHTS = [1.4, 1.6, 1.9, 2.2];

/** 左右页边距档位（px） */
export const MARGINS = [10, 24, 48, 80];

/* ---------------- 翻页方式 ---------------- */

/**
 * 三种翻页方式（二无反顾，三选一）：
 * - tap：              点击翻页（倒 Y 分区，见 tapZoneAction）
 * - scroll-vertical:   上下滚动（无缝纵向）
 * - scroll-horizontal: 左右滚动（无缝横向）
 */
export type PageMode = 'tap' | 'scroll-vertical' | 'scroll-horizontal';

/**
 * 滑动/点击方向偏好（仅 tap 与 scroll-horizontal 模式下有意义）：
 * - left-next: 向左滑（或点左侧）为下一页 —— 默认
 * - right-next: 向右滑（或点右侧）为下一页
 */
export type SwipeDirection = 'left-next' | 'right-next';

export interface ReadingInteractionPrefs {
  pageMode: PageMode;
  swipeDirection: SwipeDirection;
}

/* ---------------- 倒 Y 点击分区 ---------------- */

/** 底部三角区高度：屏幕中线处距底部约 2cm（按 96dpi 约 76px） */
const TRIANGLE_HEIGHT_PX = 76;

/**
 * 判定一次点击落在哪个翻页区。
 *
 * 屏幕划分为倒 Y 字型三区：
 * - 底部三角区（左下角、中线距底 2cm 点、右下角三点围成）：下一页
 * - 其余部分以中垂线分界：左半 = 上一页，右半 = 下一页
 *
 * @returns 'prev' | 'next'
 */
export function tapZoneAction(
  x: number,
  y: number,
  width: number,
  height: number,
): 'prev' | 'next' {
  const mx = width / 2;
  const my = height - TRIANGLE_HEIGHT_PX;

  // 底部三角区：位于中线高度以下，且在两条斜边之内
  if (y >= my) {
    const leftEdgeY = height + ((my - height) * x) / mx;
    const rightEdgeY = height + ((my - height) * (width - x)) / mx;
    if (y >= leftEdgeY && y >= rightEdgeY) return 'next';
  }

  // 其余区域按中垂线分界
  return x < width / 2 ? 'prev' : 'next';
}
