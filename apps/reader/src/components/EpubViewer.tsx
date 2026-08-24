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

/** 是否为触屏设备 */
function detectTouch(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

const MARGIN_LABELS = ['窄', '中', '宽', '很宽'];

/**
 * EPUB 渲染器。
 *
 * 翻页方式二选一（shared.PageMode）：
 * - tap:   点击翻页 —— 屏幕左右两半，含义随方向偏好；
 *          书页对指针透明（pointer-events:none），所有点击由外层容器
 *          统一做分区判定，避免与引擎内置行为双重触发。
 * - swipe: 滑动翻页 —— 引擎原生触摸滑动；
 *          触屏上横滑与纵滑均可翻页（按位移主轴判定），
 *          桌面端固定为上下无缝滚动（滚轮阅读）且强制单列。
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

  const isTouch = detectTouch();

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

  /* ---- 渲染器初始化 ---- */
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

        localRendition = ebook.renderTo(containerRef.current!, {
          width: '100%',
          height: '100%',
          flow: pageModeRef.current === 'swipe' ? 'scrolled' : 'paginated',
          manager:
            pageModeRef.current === 'swipe' ? 'continuous' : 'default',
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
        applyFontSize(fontSizeRef.current);

        let totalChapters = 0;

        function onRelocated(location: any) {
          const idx = location?.start?.index ?? 0;
          lastSpineIdxRef.current = idx;
          setChapter({ current: idx + 1, total: totalChapters });
          onProgress(idx + 1, totalChapters);
          applyFontSize(fontSizeRef.current);
          applyLineHeight();
        }

        // iframe 内按键代理
        localRendition.on('keyup', (e: KeyboardEvent) =>
          keyHandlerRef.current(e),
        );

        // 点击翻页模式：书页对指针事件透明（CSS .no-pointer），
        // 引擎收不到任何点击，倒 Y 分区在外层容器统一判定
        if (pageModeRef.current === 'tap') {
          containerRef.current!.classList.add('no-pointer');
        }

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

  // 触摸滑动（滑动翻页模式）：横滑与纵滑都判定，取位移主轴
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    if (pageMode !== 'swipe') return;
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (pageMode !== 'swipe' || !ready || !start) return;

    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;

    // 「向左下一页」= 从左向右滑；「向右下一页」反之
    const isHorizontal = Math.abs(dx) > Math.abs(dy);
    if (isHorizontal && Math.abs(dx) > 50) {
      const isNext = (dx > 0) === (swipeDir === 'left-next');
      isNext ? goNext() : goPrev();
    } else if (!isHorizontal && Math.abs(dy) > 50) {
      // 上推（dy<0）= 下一页；下拉 = 上一页
      dy < 0 ? goNext() : goPrev();
    }
  }

  return (
    <div className="epub-viewer">
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
                <span>单双列</span>
                <span>{twoUp ? '双列' : '单列'}</span>
              </div>
              <div className="segment-group">
                <button
                  className={`segment-btn${!twoUp ? ' active' : ''}`}
                  onClick={() => {
                    if (twoUp) toggleSpread();
                  }}
                  disabled={!twoUp}
                >
                  单列
                </button>
                <button
                  className={`segment-btn${twoUp ? ' active' : ''}`}
                  onClick={() => {
                    if (!twoUp) toggleSpread();
                  }}
                  disabled={twoUp}
                >
                  双列
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="epub-container" ref={containerRef} />
    </div>
  );
}
