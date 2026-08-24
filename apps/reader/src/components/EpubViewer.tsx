import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ePub from 'epubjs';
import {
  tapZoneAction,
  FONT_STEPS,
  LINE_HEIGHTS,
  MARGINS,
  type PageMode,
  type SwipeLayout,
  type VerticalStyle,
  type SwipeDirection,
} from '@starcloud/shared';
import { getToken } from '../api/client';

interface Props {
  bookId: number;
  /** 上次阅读的百分比 0-100，用于恢复位置 */
  initialPercentage: number;
  /** 进度变化回调（章节号），父组件负责防抖上报 */
  onProgress: (currentPage: number, totalPages: number) => void;
}

/* ---------------- 偏好持久化 ---------------- */

const FONT_KEY = 'starcloud.fontStep';
const LINE_KEY = 'starcloud.lineHeight';
const MARGIN_KEY = 'starcloud.margin';
const MODE_KEY = 'starcloud.pageMode';
const LAYOUT_KEY = 'starcloud.swipeLayout';
const VSTYLE_KEY = 'starcloud.verticalStyle';
const DIR_KEY = 'starcloud.swipeDirection';
const SPREAD_KEY = 'starcloud.spreadTwoUp';

function readIdx(key: string, len: number, fallback: number): number {
  const saved = parseInt(localStorage.getItem(key) ?? '', 10);
  return Number.isInteger(saved) && saved >= 0 && saved < len ? saved : fallback;
}

function readPageMode(): PageMode {
  return localStorage.getItem(MODE_KEY) === 'swipe' ? 'swipe' : 'tap';
}

function readSwipeLayout(): SwipeLayout {
  return localStorage.getItem(LAYOUT_KEY) === 'vertical' ? 'vertical' : 'horizontal';
}

function readVerticalStyle(): VerticalStyle {
  return localStorage.getItem(VSTYLE_KEY) === 'paged' ? 'paged' : 'continuous';
}

function readDirection(): SwipeDirection {
  return localStorage.getItem(DIR_KEY) === 'right-next'
    ? 'right-next'
    : 'left-next';
}

/** 单列/双列：桌面默认双列，手机强制单列 */
function readSpreadTwoUp(): boolean {
  if (window.matchMedia('(max-width: 768px)').matches) return false;
  return localStorage.getItem(SPREAD_KEY) !== 'single';
}

const MARGIN_LABELS = ['窄', '中', '宽', '很宽'];

function modeLabel(m: PageMode): string {
  return m === 'tap' ? '点击翻页' : '滑动翻页';
}

/**
 * EPUB 渲染器。
 *
 * 翻页方式二选一（shared.PageMode）：
 * - tap:   点击翻页 —— 屏幕左右两半，含义随方向偏好；
 *          书页对指针透明（pointer-events:none），所有点击由外层容器
 *          统一做分区判定，避免与引擎内置行为双重触发。
 * - swipe: 滑动翻页 —— 引擎原生触摸滑动；
 *          swipeLayout 决定左右滑动或上下滑动，
 *          上下滑动再分无缝（continuous）与单页（paginated vertical）。
 *
 * 结构性变化通过 rebuildTick 整体重建渲染器，以章节序号衔接位置；
 * 字号/行距等非结构性变化直接热应用。
 */
export default function EpubViewer({
  bookId,
  initialPercentage,
  onProgress,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bookRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renditionRef = useRef<any>(null);

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chapter, setChapter] = useState({ current: 0, total: 0 });
  const [panelOpen, setPanelOpen] = useState(false);

  /** 是否为触屏设备：左右滑动是触屏专属交互，桌面置灰/隐藏 */
  const isTouch =
    typeof window !== 'undefined' &&
    window.matchMedia('(pointer: coarse)').matches;

  /* ---- 排版偏好状态 ---- */
  const [stepIndex, setStepIndex] = useState(() =>
    readIdx(FONT_KEY, FONT_STEPS.length, FONT_STEPS.indexOf(100)),
  );
  const [lineHeightIdx, setLineHeightIdx] = useState(() =>
    readIdx(LINE_KEY, LINE_HEIGHTS.length, 1),
  );
  const [marginIdx, setMarginIdx] = useState(() =>
    readIdx(MARGIN_KEY, MARGINS.length, 1),
  );

  /* ---- 翻页偏好状态 ---- */
  const [pageMode, setPageMode] = useState<PageMode>(readPageMode);
  const [swipeLayout, setSwipeLayout] = useState<SwipeLayout>(readSwipeLayout);
  const [verticalStyle, setVerticalStyle] = useState<VerticalStyle>(
    readVerticalStyle,
  );
  const [swipeDir, setSwipeDir] = useState<SwipeDirection>(readDirection);
  const [twoUp, setTwoUp] = useState(readSpreadTwoUp);

  /** 结构性变化时 +1：触发渲染器整体重建 */
  const [rebuildTick, setRebuildTick] = useState(0);

  /* ---- refs：一次性初始化的 effect 始终拿到最新值 ---- */
  const fontSizeRef = useRef(FONT_STEPS[stepIndex] ?? 100);
  const lineHeightRef = useRef(LINE_HEIGHTS[lineHeightIdx]);
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const lastNavAtRef = useRef(0);
  const pageModeRef = useRef<PageMode>(readPageMode());
  const swipeLayoutRef = useRef<SwipeLayout>(readSwipeLayout());
  const verticalStyleRef = useRef<VerticalStyle>(readVerticalStyle());
  const swipeDirRef = useRef<SwipeDirection>(readDirection());
  const twoUpRef = useRef(twoUp);
  const lastSpineIdxRef = useRef<number | null>(null);

  const goPrev = useCallback(() => renditionRef.current?.prev(), []);
  const goNext = useCallback(() => renditionRef.current?.next(), []);

  function navigateWithCooldown(dir: 'prev' | 'next') {
    const now = Date.now();
    if (now - lastNavAtRef.current < 400) return;
    lastNavAtRef.current = now;
    dir === 'prev' ? goPrev() : goNext();
  }
  const navigateCooldownRef = useRef(navigateWithCooldown);
  navigateCooldownRef.current = navigateWithCooldown;

  const applyFontSize = useCallback((size: number) => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    rendition.themes.fontSize(`${size}%`);
    try {
      for (const c of rendition.getContents() ?? []) {
        c.css('font-size', `${size}%`);
      }
    } catch {
      // 个别章节文档尚未就绪时忽略，翻页后重放
    }
  }, []);

  const applyLineHeight = useCallback(() => {
    const lh = lineHeightRef.current;
    try {
      for (const c of renditionRef.current?.getContents() ?? []) {
        const doc: Document | undefined = c.document ?? c.contentDocument;
        if (!doc?.head) continue;
        let style = doc.getElementById('sc-reader-style') as HTMLStyleElement | null;
        if (!style) {
          style = doc.createElement('style');
          style.id = 'sc-reader-style';
          doc.head.appendChild(style);
        }
        style.textContent = `p,div,span,li,h1,h2,h3,h4,h5,h6{line-height:${lh} !important;}`;
      }
    } catch {
      // 文档未就绪时忽略
    }
  }, []);

  const keyHandler = useCallback(
    (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // 下箭头恒为下一页，上箭头恒为上一页
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        goNext();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        goPrev();
        return;
      }
      // 左右方向键跟随方向偏好
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const isRightKey = e.key === 'ArrowRight';
        const leftMeansNext = swipeDirRef.current === 'left-next';
        const isNext = isRightKey ? !leftMeansNext : leftMeansNext;
        navigateCooldownRef.current(isNext ? 'next' : 'prev');
      }
    },
    [goPrev, goNext],
  );
  keyHandlerRef.current = keyHandler;

  /* ---- 渲染器初始化（bookId / rebuildTick 变化才重建） ---- */
  useEffect(() => {
    let cancelled = false;
    let localRendition: any = null;

    (async () => {
      try {
        const res = await fetch(`/api/books/${bookId}/download`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (!res.ok) throw new Error('书籍文件加载失败');
        const buffer = await res.arrayBuffer();
        if (cancelled) return;

        // 点击翻页 / 左右滑动模式：书页对指针事件完全透明（CSS .no-pointer），
        // 引擎收不到任何点击/触摸，交互全部由外层容器的统一判定处理；
        // 上下滑动（无缝）模式保持书页可交互以启用原生滚动
        const mode = pageModeRef.current;
        if (
          mode === 'tap' ||
          (mode === 'swipe' && swipeLayoutRef.current === 'horizontal')
        ) {
          containerRef.current!.classList.add('no-pointer');
        } else {
          containerRef.current!.classList.remove('no-pointer');
        }

        const ebook = ePub(buffer);
        bookRef.current = ebook;
        // axis 竖向翻页为 epubjs 运行时能力，官方类型声明缺失，此处断言绕过。
        // 管理器统一用 continuous：预加载相邻章节，跨章翻页即时化
        const renderOptions: any = {
          width: '100%',
          height: '100%',
          flow:
            mode === 'swipe' && swipeLayoutRef.current === 'vertical'
              ? 'scrolled'
              : 'paginated',
          manager: 'continuous',
        };
        if (mode === 'swipe' && swipeLayoutRef.current === 'vertical' && verticalStyleRef.current === 'paged') {
          renderOptions.axis = 'vertical';
        }
        localRendition = ebook.renderTo(containerRef.current!, renderOptions);
        renditionRef.current = localRendition;
        localRendition.themes.register('paper', {
          body: {
            background: '#fbf7ee',
            'line-height': `${LINE_HEIGHTS[lineHeightRef.current]} !important`,
            'user-select': 'none !important',
            '-webkit-user-select': 'none !important',
          },
          p: {
            'line-height': `${LINE_HEIGHTS[lineHeightRef.current]} !important`,
            margin: '0.25em 0 !important',
          },
        });
        localRendition.themes.select('paper');
        applyFontSize(fontSizeRef.current);

        let totalChapters = 0;

        function onRelocated(location: any) {
          const idx = location?.start?.index ?? 0;
          lastSpineIdxRef.current = idx;
          setChapter({ current: idx + 1, total: totalChapters });
          onProgress(idx + 1, totalChapters);
          applyFontSize(fontSizeRef.current);
          applyLineHeight();
          applyTapZonesRef.current();
        }

        // iframe 内按键代理
        localRendition.on('keyup', (e: KeyboardEvent) =>
          keyHandlerRef.current(e),
        );
        localRendition.on('relocated', onRelocated);

        await ebook.ready;
        if (cancelled) return;
        totalChapters = ((ebook.spine as any)?.items as any[])?.length ?? 0;

        // 优先回到本会话内上次所在章节，其次按历史百分比
        const startIdx =
          lastSpineIdxRef.current ??
          Math.min(
            totalChapters - 1,
            Math.floor((initialPercentage / 100) * totalChapters),
          );

        await localRendition.display(startIdx > 0 ? startIdx : undefined);
        if (!cancelled) setReady(true);
      } catch (err) {
        if (!cancelled)
          setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      try {
        localRendition?.destroy();
        bookRef.current?.destroy();
      } catch {
        // destroy 时 iframe 可能已 detach，忽略
      }
      renditionRef.current = null;
      bookRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, rebuildTick]);

  useEffect(() => {
    window.addEventListener('keyup', keyHandler);
    return () => window.removeEventListener('keyup', keyHandler);
  }, [keyHandler]);

  useEffect(() => {
    fontSizeRef.current = FONT_STEPS[stepIndex];
    applyFontSize(fontSizeRef.current);
    localStorage.setItem(FONT_KEY, String(stepIndex));
  }, [stepIndex, applyFontSize]);

  useEffect(() => {
    lineHeightRef.current = LINE_HEIGHTS[lineHeightIdx];
    applyLineHeight();
    localStorage.setItem(LINE_KEY, String(lineHeightIdx));
  }, [lineHeightIdx, applyLineHeight]);

  const readyRef = useRef(false);
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const px = MARGINS[marginIdx];
    el.style.paddingLeft = `${px}px`;
    el.style.paddingRight = `${px}px`;
    if (readyRef.current) renditionRef.current?.resize?.();
    localStorage.setItem(MARGIN_KEY, String(marginIdx));
  }, [marginIdx]);

  /**
   * 点击翻页模式：向章节 iframe 文档注入捕获阶段的点击监听。
   * capture 先于引擎的 bubble 监听执行，stopImmediatePropagation
   * 掐掉引擎自带点击翻页，保证倒 Y 分区是唯一判定来源。
   */
  const applyTapZones = useCallback(() => {
    if (pageModeRef.current !== 'tap') return;
    try {
      for (const c of renditionRef.current?.getContents() ?? []) {
        const doc: Document | undefined = c.document ?? c.contentDocument;
        if (!doc || (doc as any).__scTapZone) continue;
        (doc as any).__scTapZone = true;
        doc.addEventListener(
          'click',
          (e: MouseEvent) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            const dir = tapZoneAction(
              e.clientX ?? 0,
              window.innerWidth,
              swipeDirRef.current,
            );
            navigateCooldownRef.current(dir);
          },
          true,
        );
      }
    } catch {
      // 文档未就绪时忽略
    }
  }, []);
  const applyTapZonesRef = useRef(applyTapZones);
  applyTapZonesRef.current = applyTapZones;

  /** 切换单列/双列排版 */
  function toggleSpread() {
    const rendition = renditionRef.current;
    if (!rendition || !ready) return;
    const next = !twoUp;
    setTwoUp(next);
    twoUpRef.current = next;
    localStorage.setItem(SPREAD_KEY, next ? 'two-up' : 'single');

    let cfi: string | undefined;
    try {
      cfi = rendition.currentLocation()?.start?.cfi;
    } catch {
      // 尚无位置信息
    }
    rendition.spread(next ? 'always' : 'none');
    rendition.clear();
    rendition.display(cfi ?? undefined);
  }

  /** 切换翻页方式：整体重建渲染器，以章节序号衔接位置。
   *  桌面（非触屏）选滑动翻页时自动降级为上下无缝滚动（滚轮阅读），
   *  左右/上下轴向等子选项是触屏专属。 */
  function changePageMode(mode: PageMode) {
    if (mode === pageMode || !ready) return;
    setPageMode(mode);
    pageModeRef.current = mode;
    localStorage.setItem(MODE_KEY, mode);

    if (mode === 'swipe' && !isTouch) {
      swipeLayoutRef.current = 'vertical';
      setSwipeLayout('vertical');
      localStorage.setItem(LAYOUT_KEY, 'vertical');
      verticalStyleRef.current = 'continuous';
      setVerticalStyle('continuous');
      localStorage.setItem(VSTYLE_KEY, 'continuous');
    }

    setRebuildTick((t) => t + 1);
  }

  function changeSwipeLayout(layout: SwipeLayout) {
    if (layout === swipeLayout || !ready) return;
    setSwipeLayout(layout);
    swipeLayoutRef.current = layout;
    localStorage.setItem(LAYOUT_KEY, layout);
    setRebuildTick((t) => t + 1);
  }

  function changeVerticalStyle(style: VerticalStyle) {
    if (style === verticalStyle || !ready) return;
    setVerticalStyle(style);
    verticalStyleRef.current = style;
    localStorage.setItem(VSTYLE_KEY, style);
    setRebuildTick((t) => t + 1);
  }

  function changeDirection(dir: SwipeDirection) {
    setSwipeDir(dir);
    swipeDirRef.current = dir;
    localStorage.setItem(DIR_KEY, dir);
  }

  // 触摸滑动（仅滑动翻页的左右轴向；上下轴向由引擎自然处理）
  const touchStartX = useRef<number | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current =
      pageMode === 'swipe' && swipeLayout === 'horizontal'
        ? e.touches[0].clientX
        : null;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (
      touchStartX.current === null ||
      pageMode !== 'swipe' ||
      swipeLayout !== 'horizontal' ||
      !ready
    ) {
      touchStartX.current = null;
      return;
    }
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 50) {
      // 「向左下一页」= 从左向右滑（dx>0）；「向右下一页」反之
      const isNext = (dx > 0) === (swipeDir === 'left-next');
      isNext ? goNext() : goPrev();
    }
    touchStartX.current = null;
  }

  return (
    <div
      className="epub-viewer"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onClick={(e) => {
        // 点击翻页模式：书页 iframe 已对指针事件透明，
        // 所有点击落在外层容器，按左右两半分区判定
        if (pageMode !== 'tap' || !ready) return;
        const target = e.target as HTMLElement;
        if (target.closest('.epub-toolbar') || target.closest('.settings-panel')) return;
        const dir = tapZoneAction(e.clientX, window.innerWidth, swipeDir);
        navigateWithCooldown(dir);
      }}
    >
      <div className="epub-toolbar">
        <div className="toolbar-left">
          <Link to="/" className="btn">← 书架</Link>
        </div>
        <span className="reader-progress reader-center">
          {loadError ??
            (!ready
              ? '打开中…'
              : chapter.total > 0
                ? `${chapter.current}/${chapter.total} 章`
                : '')}
        </span>
        <div className="toolbar-right">
          {/* 单列/双列排版切换（窄屏自动隐藏，强制单列） */}
          <button className="btn spread-btn" onClick={toggleSpread} disabled={!ready}>
            {twoUp ? '双列' : '单列'}
          </button>
          <button
            className="btn icon-btn"
            disabled={!ready}
            title="排版设置"
            aria-label="排版设置"
            onClick={() => setPanelOpen((v) => !v)}
          >
            <svg
              viewBox="0 0 24 24"
              width="17"
              height="17"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

      {panelOpen && (
        <>
          <div className="panel-mask" onClick={() => setPanelOpen(false)} />
          <div className="settings-panel">
            <div className="setting-row">
              <div className="setting-label">
                <span>字号</span>
                <span>{FONT_STEPS[stepIndex]}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={FONT_STEPS.length - 1}
                step={1}
                value={stepIndex}
                onChange={(e) => setStepIndex(Number(e.target.value))}
                list="font-ticks"
              />
              <datalist id="font-ticks">
                {FONT_STEPS.map((_, i) => (
                  <option key={i} value={i} />
                ))}
              </datalist>
            </div>

            <div className="setting-row">
              <div className="setting-label">
                <span>行间距</span>
                <span>{LINE_HEIGHTS[lineHeightIdx].toFixed(1)} 倍</span>
              </div>
              <input
                type="range"
                min={0}
                max={LINE_HEIGHTS.length - 1}
                step={1}
                value={lineHeightIdx}
                onChange={(e) => setLineHeightIdx(Number(e.target.value))}
              />
            </div>

            <div className="setting-row">
              <div className="setting-label">
                <span>左右边距</span>
                <span>{MARGIN_LABELS[marginIdx]}</span>
              </div>
              <input
                type="range"
                min={0}
                max={MARGINS.length - 1}
                step={1}
                value={marginIdx}
                onChange={(e) => setMarginIdx(Number(e.target.value))}
              />
            </div>

            <div className="setting-row">
              <div className="setting-label">
                <span>翻页方式</span>
                <span>{modeLabel(pageMode)}</span>
              </div>
              <div className="segment-group">
                {(
                  [
                    ['tap', '点击翻页'],
                    ['swipe', '滑动翻页'],
                  ] as [PageMode, string][]
                ).map(([m, label]) => (
                  <button
                    key={m}
                    className={`segment-btn${pageMode === m ? ' active' : ''}`}
                    onClick={() => changePageMode(m)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {pageMode === 'swipe' && isTouch && (
              <div className="setting-row">
                <div className="setting-label">
                  <span>滑动方向</span>
                  <span>{swipeLayout === 'vertical' ? '上下滑动' : '左右滑动'}</span>
                </div>
                <div className="segment-group">
                  <button
                    className={`segment-btn${swipeLayout === 'horizontal' ? ' active' : ''}`}
                    onClick={() => changeSwipeLayout('horizontal')}
                  >
                    左右滑动
                  </button>
                  <button
                    className={`segment-btn${swipeLayout === 'vertical' ? ' active' : ''}`}
                    onClick={() => changeSwipeLayout('vertical')}
                  >
                    上下滑动
                  </button>
                </div>
              </div>
            )}

            {pageMode === 'swipe' && isTouch && swipeLayout === 'vertical' && (
              <div className="setting-row">
                <div className="setting-label">
                  <span>滚动样式</span>
                  <span>{verticalStyle === 'continuous' ? '无缝滚动' : '单页翻动'}</span>
                </div>
                <div className="segment-group">
                  <button
                    className={`segment-btn${verticalStyle === 'continuous' ? ' active' : ''}`}
                    onClick={() => changeVerticalStyle('continuous')}
                  >
                    无缝滚动
                  </button>
                  <button
                    className={`segment-btn${verticalStyle === 'paged' ? ' active' : ''}`}
                    onClick={() => changeVerticalStyle('paged')}
                  >
                    单页翻动
                  </button>
                </div>
              </div>
            )}

            {(pageMode === 'tap' ||
              (pageMode === 'swipe' && swipeLayout === 'horizontal')) && (
              <div className="setting-row">
                <div className="setting-label">
                  <span>方向</span>
                  <span>{swipeDir === 'left-next' ? '向左下一页' : '向右下一页'}</span>
                </div>
                <div className="segment-group">
                  <button
                    className={`segment-btn${swipeDir === 'left-next' ? ' active' : ''}`}
                    onClick={() => changeDirection('left-next')}
                  >
                    向左下一页
                  </button>
                  <button
                    className={`segment-btn${swipeDir === 'right-next' ? ' active' : ''}`}
                    onClick={() => changeDirection('right-next')}
                  >
                    向右下一页
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <div className="epub-container" ref={containerRef} />
    </div>
  );
}
