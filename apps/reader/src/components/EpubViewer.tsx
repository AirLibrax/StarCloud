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

/* ---------------- 偏好持久化（键名与冻结规格第六节一致） ---------------- */

const FONT_KEY = 'starcloud.fontStep';
const LINE_KEY = 'starcloud.lineHeight';
const MARGIN_KEY = 'starcloud.margin';
const MODE_KEY = 'starcloud.pageMode';
const LAYOUT_KEY = 'starcloud.swipeLayout';
const VSTYLE_KEY = 'starcloud.verticalStyle';
const DIR_KEY = 'starcloud.swipeDirection';
const SPREAD_KEY = 'starcloud.spreadTwoUp';
/** 双列排版生效的最小视口宽度：仅平板横屏/桌面（>900px）允许双列 */
const SPREAD_MIN_WIDTH = 900;
/** 滑动手势触发阈值（px），与 App 端一致 */
const SWIPE_THRESHOLD = 50;

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

/** 上下滑动滚动样式：无缝滚动（默认）/ 单页翻动（仅竖向轴向有意义） */
function readVerticalStyle(): VerticalStyle {
  return localStorage.getItem(VSTYLE_KEY) === 'paged' ? 'paged' : 'continuous';
}

function readDirection(): SwipeDirection {
  return localStorage.getItem(DIR_KEY) === 'right-next'
    ? 'right-next'
    : 'left-next';
}

/** 单列/双列偏好（是否实际生效还受视口宽度与设备能力约束，见 twoUp） */
function readSpreadTwoUpPref(): boolean {
  return localStorage.getItem(SPREAD_KEY) !== 'single';
}

/** 是否为触屏设备 */
function detectTouch(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

const MARGIN_LABELS = ['窄', '中', '宽', '很宽'];

function modeLabel(m: PageMode): string {
  return m === 'tap' ? '点击翻页' : '滑动翻页';
}

/** 取当前渲染器的位置 CFI（default manager 同步返回；取不到回退章节序号） */
function currentCfi(rendition: any, fallbackIdx: number | null): string | undefined {
  try {
    const loc = rendition.currentLocation();
    const cfi = loc?.start?.cfi;
    if (typeof cfi === 'string' && cfi.length > 0) return cfi;
  } catch {
    // 尚无位置信息
  }
  // 无 CFI 时回退到会话内章节序号，避免 display(undefined) 跳回书首
  return fallbackIdx != null ? String(fallbackIdx) : undefined;
}

/**
 * EPUB 渲染器（实现 docs/reader-interaction.md 冻结规格）。
 *
 * 翻页方式二选一（shared.PageMode）：
 * - tap:   点击翻页 —— 书页 iframe 对指针透明（.no-pointer），
 *          所有点击落在外层 .epub-viewer 容器，由 shared.tapZoneAction()
 *          按「翻页方向」偏好做左右两半分区判定；
 * - swipe: 滑动翻页 ——
 *   · 触屏 + horizontal：书页 pe:none，外层容器 touchstart/touchend
 *     判定，取位移主轴：|dy|>|dx| 时纵向手势恒定（上推=下一页/下拉=上一页），
 *     否则横向公式 isNext = (dx>0)===(方向为 left-next)；
 *   · 触屏 + vertical + continuous：flow=scrolled + manager=continuous，
 *     整章连成一条无缝滚动、滚到底自动接下一章（引擎原生滚动）；
 *   · 触屏 + vertical + paged：flow=paginated + manager=default +
 *     axis='vertical'，书页 pe:none，外层容器纵向位移判定（上推/下拉翻页）；
 *   · 桌面（非触屏）：固定上下无缝滚动（同一连续渲染），强制单列，
 *     工具栏单/双列按钮禁用显示 ∅（滚动样式固定 continuous，无子选项）。
 * 单列/双列：视口 >900px（平板横屏/桌面）且用户开启双列偏好且非
 * 桌面滑动模式时 spread='always'，其余一律 'none'；
 * 视口跨过门槛自动重排防截断，窄屏隐藏切换按钮。
 *
 * 结构性变化（pageMode/swipeLayout/spread）通过 rebuildTick 整体重建
 * 渲染器，以章节序号衔接位置；refs 在渲染期与 state 严格同步。
 * 键盘双通道均挂 keydown：window（焦点在外层）+ iframe document 捕获
 * 阶段（焦点在书页内，applyDocHandlers 注入，relocated 后对新 iframe 重放）。
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
  const [swipeLayout, setSwipeLayout] = useState<SwipeLayout>(() => {
    // 桌面（无触屏）选滑动翻页：固定上下无缝滚动，无轴向子选项
    const stored = readSwipeLayout();
    return readPageMode() === 'swipe' && !isTouch ? 'vertical' : stored;
  });
  const [verticalStyle, setVerticalStyle] = useState<VerticalStyle>(() => {
    // 桌面（无触屏）滑动翻页固定 continuous 无缝滚动，不显示滚动样式子选项
    const stored = readVerticalStyle();
    return readPageMode() === 'swipe' && !isTouch ? 'continuous' : stored;
  });
  const [swipeDir, setSwipeDir] = useState<SwipeDirection>(readDirection);
  const [twoUpPref, setTwoUpPref] = useState(readSpreadTwoUpPref);
  /** 视口宽度是否达到双列门槛（>900px：平板横屏/桌面） */
  const [isWide, setIsWide] = useState(() => window.innerWidth > SPREAD_MIN_WIDTH);

  /** 结构性变化时 +1：触发渲染器整体重建 */
  const [rebuildTick, setRebuildTick] = useState(0);

  /** 桌面滑动翻页：固定上下无缝滚动 + 强制单列（规格二/四） */
  const desktopSwipe = pageMode === 'swipe' && !isTouch;
  /** 实际生效的单列/双列 = 用户偏好 ∩ 视口宽度 ∩ 非桌面滑动 ∩ 非上下轴向
   *  （上下滑动连续/单页翻动均为纵向排版，不使用横向双列） */
  const twoUp = twoUpPref && isWide && !desktopSwipe && swipeLayout !== 'vertical';

  /* ---- refs：渲染期与 state 严格同步（规格七.4），
     —— 一次性初始化的 effect / 事件处理一律读 ref，保证重建拿到最新配置 ---- */
  const fontSizeRef = useRef(FONT_STEPS[stepIndex] ?? 100);
  const lineHeightRef = useRef(LINE_HEIGHTS[lineHeightIdx]);
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const lastNavAtRef = useRef(0);
  const pageModeRef = useRef<PageMode>(pageMode);
  const swipeLayoutRef = useRef<SwipeLayout>(swipeLayout);
  const verticalStyleRef = useRef<VerticalStyle>(verticalStyle);
  const swipeDirRef = useRef<SwipeDirection>(swipeDir);
  const twoUpRef = useRef(twoUp);
  pageModeRef.current = pageMode;
  swipeLayoutRef.current = swipeLayout;
  verticalStyleRef.current = verticalStyle;
  swipeDirRef.current = swipeDir;
  twoUpRef.current = twoUp;
  const lastSpineIdxRef = useRef<number | null>(null);
  /** 进度上报守卫：章节变化才报（防抖在父组件） */
  const lastReportedIdxRef = useRef<number | null>(null);
  /** 会话位置所属的书（换书时重置 lastSpineIdxRef/lastReportedIdxRef） */
  const sessionBookRef = useRef<number | null>(null);

  const goPrev = useCallback(() => renditionRef.current?.prev(), []);
  const goNext = useCallback(() => renditionRef.current?.next(), []);

  /** 键盘翻页冷却（规格三：400ms 防连击穿透；仅键盘路径使用） */
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
      // 下箭头恒为下一页，上箭头恒为上一页（规格三）
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateCooldownRef.current('next');
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateCooldownRef.current('prev');
        return;
      }
      // 左右箭头跟随方向偏好（规格三：left-next 时 → 为下一页）：
      // 与滑动/点击同一镜像模型 —— (按的是右箭头) === (方向为 left-next) 即下一页
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const isNext =
          (e.key === 'ArrowRight') === (swipeDirRef.current === 'left-next');
        navigateCooldownRef.current(isNext ? 'next' : 'prev');
      }
    },
    [goPrev, goNext],
  );
  keyHandlerRef.current = keyHandler;

  /* ---- 渲染器初始化（bookId / rebuildTick 变化才整体重建） ---- */
  useEffect(() => {
    let cancelled = false;
    let localRendition: any = null;

    // 换书（bookId 变化）时清空本会话位置，防止用上一本书的章节序号
    // 在新书上 display 越界（spine.get 无此章节会报 No Section Found）
    if (sessionBookRef.current !== bookId) {
      sessionBookRef.current = bookId;
      lastSpineIdxRef.current = null;
      lastReportedIdxRef.current = null;
    }

    const container = containerRef.current;
    const mode = pageModeRef.current;
    const layout = swipeLayoutRef.current;
    const vstyle = verticalStyleRef.current;
    /** 上下滑动：连续渲染跨章无缝（touch）或单页翻动（axis vertical） */
    const isVerticalScroll = mode === 'swipe' && layout === 'vertical';
    const isVerticalContinuous = isVerticalScroll && vstyle === 'continuous';
    const isVerticalPaged = isVerticalScroll && vstyle === 'paged';
    /** 页面对指针透明：tap / swipe+horizontal / swipe+vertical+paged（规格二/七.3） */
    const needsNoPointer =
      mode === 'tap' ||
      (mode === 'swipe' && layout === 'horizontal') ||
      isVerticalPaged;

    // 重建开始即重置状态，并在取回文件前就把 no-pointer 类切到新模式
    setReady(false);
    setLoadError(null);
    container?.classList.toggle('no-pointer', needsNoPointer);

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

        localRendition = ebook.renderTo(container!, {
          width: '100%',
          height: '100%',
          flow: isVerticalScroll ? (isVerticalPaged ? 'paginated' : 'scrolled') : 'paginated',
          manager: isVerticalScroll ? (isVerticalContinuous ? 'continuous' : 'default') : 'default',
          // axis:'vertical' 单页翻动为 epubjs default manager 运行时原生能力，
          // 官方类型声明缺失，此处按规格断言注入
          ...(isVerticalPaged ? ({ axis: 'vertical' } as any) : {}),
          spread: isVerticalScroll ? 'none' : twoUpRef.current ? 'always' : 'none',
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
          // 章节变化才报进度（连续滚动模式下 relocated 高频触发，避免上报风暴）
          if (lastReportedIdxRef.current !== idx) {
            lastReportedIdxRef.current = idx;
            onProgress(idx + 1, totalChapters);
          }
          applyFontSize(fontSizeRef.current);
          applyLineHeight();
          // 新渲染的章节 iframe 也要种上捕获阶段 keydown（continuous 会追加 iframe）
          applyDocHandlersRef.current();
        }

        localRendition.on('relocated', onRelocated);

        await ebook.ready;
        if (cancelled) return;
        totalChapters = ((ebook.spine as any)?.items as any[])?.length ?? 0;

        // 优先回到本会话内上次所在章节，其次按历史百分比（规格六）；
        // 章节序号一律钳制在有效范围内，防止换书后越界
        const startIdx =
          lastSpineIdxRef.current != null
            ? Math.min(lastSpineIdxRef.current, totalChapters - 1)
            : Math.min(
                totalChapters - 1,
                Math.floor((initialPercentage / 100) * totalChapters),
              );

        await localRendition.display(startIdx > 0 ? startIdx : undefined);
        if (cancelled) return;
        applyDocHandlersRef.current();
        setReady(true);
      } catch (err) {
        if (!cancelled)
          setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      // 整体重建：旧 rendition 与 book 彻底销毁（规格七.4）
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
    window.addEventListener('keydown', keyHandler);
    return () => window.removeEventListener('keydown', keyHandler);
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

  /* ---- 视口宽度跟踪：双列门槛与容器重排（规格四） ---- */

  // 窗口 resize / 横竖屏切换时刷新「视口是否够宽」
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const updateWide = () => setIsWide(window.innerWidth > SPREAD_MIN_WIDTH);
    updateWide();
    window.addEventListener('resize', updateWide);
    mq.addEventListener('change', updateWide);
    return () => {
      window.removeEventListener('resize', updateWide);
      mq.removeEventListener('change', updateWide);
    };
  }, []);

  /** 视口跨过双列门槛：切换 spread 并按当前位置重排（防截断） */
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!readyRef.current || !rendition) return;
    // twoUpRef 已含全部规则（偏好 ∩ 视口宽度 ∩ 桌面滑动强制单列）
    const nextSpread = twoUpRef.current ? 'always' : 'none';
    if (rendition.settings?.spread === nextSpread) return;
    const cfi = currentCfi(rendition, lastSpineIdxRef.current);
    rendition.spread(nextSpread);
    rendition.clear();
    rendition.display(cfi ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWide]);

  /** 容器尺寸变化 → rendition.resize() 重排（引擎自带 window resize 监听，此处兜底容器级变化） */
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (readyRef.current) renditionRef.current?.resize?.();
      });
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  /**
   * 向章节 iframe 文档注入捕获阶段的按键监听（规格三/七.1 通道二）。
   * 焦点在书页内时，按键按下瞬间即触发翻页（keydown，非 keyup）。
   * relocated 后对新 iframe 重放；__scKeydown 标记防止重复注入。
   */
  const applyDocHandlers = useCallback(() => {
    try {
      for (const c of renditionRef.current?.getContents() ?? []) {
        const doc: Document | undefined = c.document ?? c.contentDocument;
        if (!doc || (doc as any).__scKeydown) continue;
        (doc as any).__scKeydown = true;
        doc.addEventListener(
          'keydown',
          (e: KeyboardEvent) => keyHandlerRef.current(e),
          true,
        );
      }
    } catch {
      // 文档未就绪时忽略，relocated 后重放
    }
  }, []);
  const applyDocHandlersRef = useRef(applyDocHandlers);
  applyDocHandlersRef.current = applyDocHandlers;

  /** 切换单列/双列偏好；窄屏（未达双列门槛）只改偏好，不应用 */
  function toggleSpread() {
    if (!ready || desktopSwipe) return;
    const next = !twoUpPref;
    setTwoUpPref(next);
    localStorage.setItem(SPREAD_KEY, next ? 'two-up' : 'single');
    if (!isWide) return;

    const rendition = renditionRef.current;
    if (!rendition) return;
    const cfi = currentCfi(rendition, lastSpineIdxRef.current);
    rendition.spread(next ? 'always' : 'none');
    rendition.clear();
    rendition.display(cfi ?? undefined);
  }

  /** 切换翻页方式：整体重建渲染器，以章节序号衔接位置。
   *  桌面（非触屏）选滑动翻页时自动降级为上下无缝滚动（滚轮阅读），
   *  滚动样式固定 continuous（规格二桌面降级规则）。
   *  （refs 由渲染期同步自动跟随 state，无需手工赋值） */
  function changePageMode(mode: PageMode) {
    if (mode === pageMode || !ready) return;
    setPageMode(mode);
    localStorage.setItem(MODE_KEY, mode);

    if (mode === 'swipe' && !isTouch) {
      setSwipeLayout('vertical');
      setVerticalStyle('continuous');
      localStorage.setItem(LAYOUT_KEY, 'vertical');
      localStorage.setItem(VSTYLE_KEY, 'continuous');
    }

    setRebuildTick((t) => t + 1);
  }

  /** 切换滑动轴向（仅触屏）：整体重建渲染器 */
  function changeSwipeLayout(layout: SwipeLayout) {
    if (layout === swipeLayout || !ready) return;
    setSwipeLayout(layout);
    localStorage.setItem(LAYOUT_KEY, layout);
    setRebuildTick((t) => t + 1);
  }

  /** 切换上下滑动滚动样式（仅触屏 + 竖向轴向）：整体重建渲染器 */
  function changeVerticalStyle(style: VerticalStyle) {
    if (style === verticalStyle || !ready) return;
    setVerticalStyle(style);
    localStorage.setItem(VSTYLE_KEY, style);
    setRebuildTick((t) => t + 1);
  }

  function changeDirection(dir: SwipeDirection) {
    if (dir === swipeDir) return;
    setSwipeDir(dir);
    localStorage.setItem(DIR_KEY, dir);
  }

  /* ---- 点击分区（tap 模式）：事件落在 .epub-viewer，
     —— 因为 no-pointer 时容器与 iframe 对指针透明，命中测试穿透到外层。
     —— 仅当 e.target === e.currentTarget 才判定，工具栏/面板点击不受影响 ---- */
  function handleReadingClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    if (pageModeRef.current !== 'tap' || !readyRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const action = tapZoneAction(
      e.clientX - rect.left,
      rect.width,
      swipeDirRef.current,
    );
    action === 'next' ? goNext() : goPrev();
  }

  /* ---- 滑动翻页手势（swipe+horizontal / swipe+vertical+paged）：
     —— 外层容器 touchstart/touchend 判定，取位移主轴分派 ----
     —— horizontal：|dy|>|dx| 时纵向手势恒定（上推=下一页/下拉=上一页），
        否则横向公式 isNext=(dx>0)===(方向为 left-next)；
     —— vertical+paged：纵向位移为主手势，判定同上纵向分支 ---- */
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) {
      touchStart.current = null;
      return;
    }
    const layout = swipeLayoutRef.current;
    const active =
      pageModeRef.current === 'swipe' &&
      (layout === 'horizontal' ||
        (layout === 'vertical' && verticalStyleRef.current === 'paged'));
    if (!active) {
      touchStart.current = null;
      return;
    }
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }
  function handleTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    if (pageModeRef.current !== 'swipe' || !readyRef.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const mainVertical = Math.abs(dy) > Math.abs(dx);

    if (swipeLayoutRef.current === 'horizontal') {
      if (mainVertical) {
        // 纵向手势恒定，不随方向偏好镜像（规格二）
        if (Math.abs(dy) > SWIPE_THRESHOLD) (dy < 0 ? goNext() : goPrev());
      } else if (Math.abs(dx) > SWIPE_THRESHOLD) {
        // 规格二：isNext = (dx > 0) === (方向为 left-next)
        const isNext = (dx > 0) === (swipeDirRef.current === 'left-next');
        isNext ? goNext() : goPrev();
      }
      return;
    }

    if (
      swipeLayoutRef.current === 'vertical' &&
      verticalStyleRef.current === 'paged'
    ) {
      // 单页翻动主手势：纵向位移判定（主轴），横向位移忽略
      if (mainVertical && Math.abs(dy) > SWIPE_THRESHOLD) {
        (dy < 0 ? goNext() : goPrev());
      }
    }
    // vertical + continuous：引擎原生滚动，无手势处理
  }

  const showDirectionRow =
    pageMode === 'tap' ||
    (pageMode === 'swipe' && isTouch && swipeLayout === 'horizontal');
  /** 滚动样式行：仅触屏 + swipe + 竖向轴向（桌面降级固定 continuous 不显示） */
  const showVerticalStyleRow =
    pageMode === 'swipe' && isTouch && swipeLayout === 'vertical';

  return (
    <div
      className="epub-viewer"
      onClick={handleReadingClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
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
          {/* 单列/双列排版切换：仅视口 >900px 显示；桌面滑动模式禁用显示 ∅ */}
          {isWide && (
            <button
              className="btn spread-btn"
              onClick={toggleSpread}
              disabled={!ready || desktopSwipe}
              title={desktopSwipe ? '桌面滑动翻页固定为上下连续滚动，强制单列' : '单列/双列排版'}
            >
              {desktopSwipe ? '∅' : twoUp ? '双列' : '单列'}
            </button>
          )}
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
                  <span>滑动轴向</span>
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

            {showVerticalStyleRow && (
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

            {showDirectionRow && (
              <div className="setting-row">
                <div className="setting-label">
                  <span>翻页方向</span>
                  <span>{swipeDir === 'left-next' ? '向左下一页' : '向右下一页'}</span>
                </div>
                <div className="segment-group">
                  {(
                    [
                      ['left-next', '向左下一页'],
                      ['right-next', '向右下一页'],
                    ] as [SwipeDirection, string][]
                  ).map(([d, label]) => (
                    <button
                      key={d}
                      className={`segment-btn${swipeDir === d ? ' active' : ''}`}
                      onClick={() => changeDirection(d)}
                    >
                      {label}
                    </button>
                  ))}
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