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

/** 阅读交互偏好（localStorage 持久化，键值与档位定义均来自 @starcloud/shared） */
const FONT_KEY = 'starcloud.fontStep';
const LINE_KEY = 'starcloud.lineHeight';
const MARGIN_KEY = 'starcloud.margin';
const MODE_KEY = 'starcloud.pageMode';
const DIR_KEY = 'starcloud.swipeDirection';

function readIdx(key: string, len: number, fallback: number): number {
  const saved = parseInt(localStorage.getItem(key) ?? '', 10);
  return Number.isInteger(saved) && saved >= 0 && saved < len ? saved : fallback;
}

function readMode(): PageMode {
  const saved = localStorage.getItem(MODE_KEY);
  return saved === 'scroll-vertical' || saved === 'scroll-horizontal'
    ? saved
    : 'tap';
}

function readDirection(): SwipeDirection {
  return localStorage.getItem(DIR_KEY) === 'right-next'
    ? 'right-next'
    : 'left-next';
}

/**
 * EPUB 渲染器：epubjs 封装。
 * - 文件经 fetch ArrayBuffer 加载，令牌不落 URL
 * - 进度锚定章节序号（spine index），与后端 currentPage/totalPages 模型对齐
 * - 翻页方式三选一：点击翻页（倒 Y 分区）/ 上下滚动 / 左右滚动（规格 F5）
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

  const [stepIndex, setStepIndex] = useState(() =>
    readIdx(FONT_KEY, FONT_STEPS.length, FONT_STEPS.indexOf(100)),
  );
  const [lineHeightIdx, setLineHeightIdx] = useState(() =>
    readIdx(LINE_KEY, LINE_HEIGHTS.length, 1),
  );
  const [marginIdx, setMarginIdx] = useState(() =>
    readIdx(MARGIN_KEY, MARGINS.length, 1),
  );
  const [pageMode, setPageMode] = useState<PageMode>(readMode);
  const [swipeDir, setSwipeDir] = useState<SwipeDirection>(readDirection);

  const [panelOpen, setPanelOpen] = useState(false);
  const [chapter, setChapter] = useState({ current: 0, total: 0 });

  const fontSizeRef = useRef(FONT_STEPS[stepIndex] ?? 100);
  const lineHeightRef = useRef(LINE_HEIGHTS[lineHeightIdx]);
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const lastNavAtRef = useRef(0);

  const goPrev = useCallback(() => renditionRef.current?.prev(), []);
  const goNext = useCallback(() => renditionRef.current?.next(), []);

  /** 应用字号。themes 注入可能被书籍 CSS 压住，再直写每个 iframe 文档兜底 */
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

  /** 向每个章节 iframe 文档注入行距（带 !important 压过书籍自带样式） */
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
      // 文档未就绪时忽略，翻页后重放
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

  /** 点击导航（400ms 冷却：防止引擎内置行为与自定义处理叠加连翻） */
  function navigateWithCooldown(dir: 'prev' | 'next') {
    const now = Date.now();
    if (now - lastNavAtRef.current < 400) return;
    lastNavAtRef.current = now;
    dir === 'prev' ? goPrev() : goNext();
  }

  // 初始化渲染器（bookId 变化才重建；flow 由 pageMode 决定）
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

        const flow = pageMode === 'tap' ? 'paginated' : pageMode === 'scroll-horizontal' ? 'paginated' : 'scrolled';

        localRendition = ebook.renderTo(containerRef.current!, {
          width: '100%',
          height: '100%',
          flow,
          spread: spreadPref(),
        });
        renditionRef.current = localRendition;
        localRendition.themes.register('paper', {
          body: {
            background: '#fbf7ee',
            'line-height': `${LINE_HEIGHTS[lineHeightIdx]} !important`,
            'user-select': 'none !important',
            '-webkit-user-select': 'none !important',
          },
          p: {
            'line-height': `${LINE_HEIGHTS[lineHeightIdx]} !important`,
            margin: '0.25em 0 !important',
          },
        });
        localRendition.themes.select('paper');
        applyFontSize(fontSizeRef.current);

        let totalChapters = 0;

        localRendition.on('relocated', (location: any) => {
          const idx = location?.start?.index ?? 0;
          setChapter({ current: idx + 1, total: totalChapters });
          onProgress(idx + 1, totalChapters);
          applyFontSize(fontSizeRef.current);
          applyLineHeight();
        });

        // 书页 iframe 内的按键不会冒泡到父页面，由 epubjs 代理出来
        localRendition.on('keyup', (e: KeyboardEvent) => keyHandlerRef.current(e));

        // 点击翻页模式：倒 Y 分区判定（坐标经 epubjs 从 iframe 转发）
        if (pageMode === 'tap') {
          localRendition.on('click', (e: any) => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            const dir = tapZoneAction(e.clientX ?? 0, e.clientY ?? 0, w, h);
            navigateWithCooldown(dir);
          });
        }

        // spine 是懒加载的：先等 ready 才能读章节数与定位
        await ebook.ready;
        if (cancelled) return;
        totalChapters =
          ((ebook.spine as any)?.items as any[])?.length ?? 0;

        // 章节级恢复上次位置
        const startIndex = Math.min(
          totalChapters - 1,
          Math.floor((initialPercentage / 100) * totalChapters),
        );

        await localRendition.display(startIndex > 0 ? startIndex : undefined);
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
  }, [bookId]);

  // 外层页面的键盘监听（焦点不在书页 iframe 内时生效）
  useEffect(() => {
    window.addEventListener('keyup', keyHandler);
    return () => window.removeEventListener('keyup', keyHandler);
  }, [keyHandler]);

  // 字号变化立即应用并记住档位
  useEffect(() => {
    fontSizeRef.current = FONT_STEPS[stepIndex];
    applyFontSize(fontSizeRef.current);
    localStorage.setItem(FONT_KEY, String(stepIndex));
  }, [stepIndex, applyFontSize]);

  // 行距变化：注入新行距并记住
  useEffect(() => {
    lineHeightRef.current = LINE_HEIGHTS[lineHeightIdx];
    applyLineHeight();
    localStorage.setItem(LINE_KEY, String(lineHeightIdx));
  }, [lineHeightIdx, applyLineHeight]);

  // 页边距变化：收缩容器宽度，让分页引擎按新尺寸重排
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

  // 翻页方式变化：切换 flow 并回到原位置
  function switchFlow(mode: PageMode) {
    const rendition = renditionRef.current;
    if (!rendition || !ready || mode === pageMode) return;
    setPageMode(mode);
    localStorage.setItem(MODE_KEY, mode);
    let cfi: string | undefined;
    try {
      cfi = rendition.currentLocation()?.start?.cfi;
    } catch {
      // 尚无位置信息
    }
    rendition.flow(mode === 'tap' ? 'paginated' : mode === 'scroll-horizontal' ? 'paginated' : 'scrolled');
    rendition.clear();
    rendition.display(cfi ?? undefined);
  }

  function switchDirection(dir: SwipeDirection) {
    setSwipeDir(dir);
    localStorage.setItem(DIR_KEY, dir);
  }

  // 触摸滑动翻页（tap 与 scroll-horizontal 模式下生效）
  const touchStartX = useRef<number | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null || pageMode === 'scroll-vertical') {
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
        {/* 单双列切换在窄屏（手机）下隐藏 */}
        <div className="toolbar-right">
          <button className="btn spread-btn" onClick={() => switchFlow(pageMode)} disabled={!ready}>
            {pageMode === 'tap' ? '点击翻页' : pageMode === 'scroll-horizontal' ? '左右滚动' : '上下滚动'}
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
                ).map(([m, label]) => (
                  <button
                    key={m}
                    className={`segment-btn${pageMode === m ? ' active' : ''}`}
                    onClick={() => switchFlow(m)}
                  >
                    {label}
                  </button>
                ))}
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
                    onClick={() => switchDirection('left-next')}
                  >
                    向左滑下一页
                  </button>
                  <button
                    className={`segment-btn${swipeDir === 'right-next' ? ' active' : ''}`}
                    onClick={() => switchDirection('right-next')}
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

const MARGIN_LABELS = ['窄', '中', '宽', '很宽'];

function modeLabel(m: PageMode): string {
  return m === 'tap' ? '点击翻页' : m === 'scroll-vertical' ? '上下滚动' : '左右滚动';
}

/** 单双列偏好：桌面默认双列并排，手机强制单列（窄屏下按钮隐藏） */
function spreadPref(): string {
  return window.matchMedia('(max-width: 768px)').matches ? 'none' : 'always';
}
