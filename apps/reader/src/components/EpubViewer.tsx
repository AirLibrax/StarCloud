import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ePub from 'epubjs';
import {
  tapZoneAction,
  FONT_STEPS,
  LINE_HEIGHTS,
  MARGINS,
  type PageMode,
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
const SPREAD_KEY = 'starcloud.spreadTwoUp';

function readIdx(key: string, len: number, fallback: number): number {
  const saved = parseInt(localStorage.getItem(key) ?? '', 10);
  return Number.isInteger(saved) && saved >= 0 && saved < len ? saved : fallback;
}

function readPageMode(): PageMode {
  const saved = localStorage.getItem(MODE_KEY);
  return saved === 'scroll-vertical' || saved === 'scroll-horizontal'
    ? saved
    : 'tap';
}

/** 单列/双列：桌面默认双列，手机强制单列 */
function readSpreadTwoUp(): boolean {
  if (window.matchMedia('(max-width: 768px)').matches) return false;
  return localStorage.getItem(SPREAD_KEY) !== 'single';
}

const MARGIN_LABELS = ['窄', '中', '宽', '很宽'];

function modeLabel(m: PageMode): string {
  return m === 'tap'
    ? '点击翻页'
    : m === 'scroll-vertical'
      ? '上下滚动'
      : '左右滚动';
}

/**
 * EPUB 渲染器：epubjs 封装。
 *
 * - 排版与翻页方式的档位/类型全部来自 @starcloud/shared
 * - 翻页方式切换通过整体重建渲染器实现（epubjs 动态切 flow 不可靠），
 *   重建前后以章节序号衔接阅读位置
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

  /** 是否为触屏设备：左右滚动是触屏专属交互，桌面置灰 */
  const isTouch =
    typeof window !== 'undefined' &&
    window.matchMedia('(pointer: coarse)').matches;

  const [stepIndex, setStepIndex] = useState(() =>
    readIdx(FONT_KEY, FONT_STEPS.length, FONT_STEPS.indexOf(100)),
  );
  const [lineHeightIdx, setLineHeightIdx] = useState(() =>
    readIdx(LINE_KEY, LINE_HEIGHTS.length, 1),
  );
  const [marginIdx, setMarginIdx] = useState(() =>
    readIdx(MARGIN_KEY, MARGINS.length, 1),
  );
  const [pageMode, setPageMode] = useState<PageMode>(readPageMode);
  const [swipeDir, setSwipeDir] = useState<SwipeDirection>(
    localStorage.getItem(DIR_KEY_PLACEHOLDER) === 'right-next'
      ? 'right-next'
      : 'left-next',
  );
  const [twoUp, setTwoUp] = useState(() => readSpreadTwoUp());

  /** 重建计数：翻页方式等结构性变化时 +1，触发渲染器整体重建 */
  const [rebuildTick, setRebuildTick] = useState(0);

  // 各类 ref：让一次性初始化的 effect 始终拿到最新值
  const fontSizeRef = useRef(FONT_STEPS[stepIndex] ?? 100);
  const lineHeightRef = useRef(LINE_HEIGHTS[lineHeightIdx]);
  const marginRef = useRef(MARGINS[marginIdx]);
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const lastNavAtRef = useRef(0);
  const swipeDirRef = useRef<SwipeDirection>(
    localStorage.getItem(DIR_KEY_PLACEHOLDER) === 'right-next'
      ? 'right-next'
      : 'left-next',
  );
  const pageModeRef = useRef<PageMode>(readPageMode());
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
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      }
    },
    [goPrev, goNext],
  );
  keyHandlerRef.current = keyHandler;

  /** 向章节 iframe 注入触摸滑动手势（tap / 左右滚动模式） */
  const applyGestures = useCallback(() => {
    if (pageModeRef.current === 'scroll-vertical') return;
    try {
      for (const c of renditionRef.current?.getContents() ?? []) {
        const doc: Document | undefined = c.document ?? c.contentDocument;
        if (!doc || (doc as any).__scGestures) continue;
        (doc as any).__scGestures = true;
        let tsX: number | null = null;
        let tsY: number | null = null;
        doc.addEventListener(
          'touchstart',
          (e: TouchEvent) => {
            if (e.touches.length === 1) {
              tsX = e.touches[0].clientX;
              tsY = e.touches[0].clientY;
            }
          },
          { passive: true },
        );
        doc.addEventListener(
          'touchend',
          (e: TouchEvent) => {
            if (tsX === null || tsY === null) return;
            const dx = e.changedTouches[0].clientX - tsX;
            const dy = e.changedTouches[0].clientY - tsY;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
              const isNext = dx < 0 === (swipeDirRef.current === 'left-next');
              navigateWithCooldown(isNext ? 'next' : 'prev');
            }
            tsX = null;
          },
          { passive: true },
        );
      }
    } catch {
      // 文档未就绪时忽略，翻页后重放
    }
  }, [navigateWithCooldown]);
  const applyGesturesRef = useRef(applyGestures);
  applyGesturesRef.current = applyGestures;

  // swipeDir 状态变化时同步 ref（供注入的手势读取最新方向）
  useEffect(() => {
    swipeDirRef.current = swipeDir;
  }, [swipeDir]);

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

        const ebook = ePub(buffer);
        bookRef.current = ebook;

        const flow =
          pageModeRef.current === 'scroll-vertical' ? 'scrolled' : 'paginated';
        localRendition = ebook.renderTo(containerRef.current!, {
          width: '100%',
          height: '100%',
          flow,
          spread: twoUpRef.current ? 'always' : 'none',
        });
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
        localRendition.themes.fontSize(`${fontSizeRef.current}%`);

        let totalChapters = 0;

        localRendition.on('keyup', (e: KeyboardEvent) =>
          keyHandlerRef.current(e),
        );

        localRendition.on('relocated', (location: any) => {
          const idx = location?.start?.index ?? 0;
          lastSpineIdxRef.current = idx;
          setChapter({ current: idx + 1, total: totalChapters });
          onProgress(idx + 1, totalChapters);
          applyFontSize(fontSizeRef.current);
          applyLineHeight();
          applyGesturesRef.current();
        });

        // iframe 内按键代理
        localRendition.on('keyup', (e: KeyboardEvent) =>
          keyHandlerRef.current(e),
        );

        // 点击翻页模式：倒 Y 分区（坐标由引擎从 iframe 转发），
        // 方向偏好生效：right-next 时点击分区含义镜像
        localRendition.on('click', (e: any) => {
          if (pageModeRef.current !== 'tap') return;
          const w = window.innerWidth;
          const h = window.innerHeight;
          let dir = tapZoneAction(e.clientX ?? 0, e.clientY ?? 0, w, h);
          if (swipeDirRef.current === 'right-next') {
            dir = dir === 'next' ? 'prev' : 'next';
          }
          navigateWithCooldown(dir);
        });

        // 触摸滑动翻页（tap / 左右滚动模式）：手势必须注入到 iframe 文档内，
        // 手指在书页上的触摸不会冒泡到外层容器；新章节渲染后重放
        localRendition.on('relocated', (location: any) => {
          applyGesturesRef.current();
          const idx = location?.start?.index ?? 0;
          lastSpineIdxRef.current = idx;
          setChapter({ current: idx + 1, total: totalChapters });
          onProgress(idx + 1, totalChapters);
          applyFontSize(fontSizeRef.current);
          applyLineHeight();
        });

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

  useEffect(() => {
    marginRef.current = MARGINS[marginIdx];
    const el = containerRef.current;
    if (!el) return;
    const px = MARGINS[marginIdx];
    el.style.paddingLeft = `${px}px`;
    el.style.paddingRight = `${px}px`;
    if (readyRefFn()) renditionRef.current?.resize?.();
    localStorage.setItem(MARGIN_KEY, String(marginIdx));

    function readyRefFn() {
      return ready;
    }
  }, [marginIdx, ready]);

  /** 切换单列/双列：轻量操作，直接改 spread 并回到原位 */
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

  /** 切换翻页方式：整体重建渲染器，以章节序号衔接位置 */
  function changePageMode(mode: PageMode) {
    if (mode === pageMode || !ready) return;
    setPageMode(mode);
    pageModeRef.current = mode;
    localStorage.setItem(MODE_KEY, mode);
    setRebuildTick((t) => t + 1);
  }

  function changeDirection(dir: SwipeDirection) {
    setSwipeDir(dir);
    swipeDirRef.current = dir;
    localStorage.setItem(DIR_KEY_PLACEHOLDER, dir);
  }

  // 触摸滑动翻页（tap / 左右滚动模式下生效）
  const touchStartX = useRef<number | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (
      touchStartX.current === null ||
      pageMode === 'scroll-vertical' ||
      !ready
    ) {
      touchStartX.current = null;
      return;
    }
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 50) {
      const physicalNextIsLeft = swipeDir === 'left-next';
      const isNext = (dx < 0) === physicalNextIsLeft;
      isNext ? goNext() : goPrev();
    }
    touchStartX.current = null;
  }

  return (
    <div className="epub-viewer" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
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
                    ['scroll-vertical', '上下滚动'],
                    ['scroll-horizontal', '左右滚动'],
                  ] as [PageMode, string][]
                ).map(([m, label]) => {
                  const disabled = m === 'scroll-horizontal' && !isTouch;
                  return (
                    <button
                      key={m}
                      className={`segment-btn${pageMode === m ? ' active' : ''}`}
                      disabled={disabled}
                      title={disabled ? '左右滚动需要触屏设备' : undefined}
                      onClick={() => changePageMode(m)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {(pageMode === 'tap' || pageMode === 'scroll-horizontal') && (
              <div className="setting-row">
                <div className="setting-label">
                  <span>方向</span>
                  <span>{swipeDir === 'left-next' ? '向左滑下一页' : '向右滑下一页'}</span>
                </div>
                <div className="segment-group">
                  <button
                    className={`segment-btn${swipeDir === 'left-next' ? ' active' : ''}`}
                    onClick={() => changeDirection('left-next')}
                  >
                    向左滑下一页
                  </button>
                  <button
                    className={`segment-btn${swipeDir === 'right-next' ? ' active' : ''}`}
                    onClick={() => changeDirection('right-next')}
                  >
                    向右滑下一页
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

// DIR_KEY 占位：实际存储键在下方常量区定义前被引用会报错，
// 故此处统一使用字符串字面量，保持与 storage 其他模块一致的命名风格。
const DIR_KEY_PLACEHOLDER = 'starcloud.swipeDirection';
