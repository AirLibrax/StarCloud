import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ePub from 'epubjs';
import { getToken } from '../api/client';

interface Props {
  bookId: number;
  /** 上次阅读的百分比 0-100，用于恢复位置 */
  initialPercentage: number;
  /** 进度变化回调（章节号），父组件负责防抖上报 */
  onProgress: (currentPage: number, totalPages: number) => void;
}

/**
 * 字号档位（仿 Apple Books）：离散档位而不是任意缩放，
 * 配合强制相对行高，保证任何档位都不会出现文字被分页边缘裁切。
 */
const FONT_STEPS = [80, 90, 100, 110, 125, 140, 160, 180];

/** 排版模式：单列 / 双列 二选一 */
const SPREAD_MODES = ['none', 'always'] as const;
type SpreadMode = (typeof SPREAD_MODES)[number];
const MODE_LABEL: Record<SpreadMode, string> = {
  none: '单列',
  always: '双列',
};

/**
 * EPUB 渲染器：epubjs 封装。
 * - 文件经 fetch ArrayBuffer 加载，令牌不落 URL
 * - 进度锚定章节序号（spine index），与后端 currentPage/totalPages 模型对齐
 * - 翻页三通道：键盘（window + iframe 代理）、触屏滑动、工具栏按钮
 *
 * epubjs 自带的类型声明不完整，以下用局部宽松类型处理其运行时 API。
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
  const [stepIndex, setStepIndex] = useState(() => {
    const saved = parseInt(localStorage.getItem('starcloud.fontStep') ?? '', 10);
    return Number.isInteger(saved) && saved >= 0 && saved < FONT_STEPS.length
      ? saved
      : FONT_STEPS.indexOf(100); // 默认 100%
  });
  const [chapter, setChapter] = useState({ current: 0, total: 0 });

  /** 排版模式偏好持久化到 localStorage（旧值 auto 归入单列） */
  const savedSpread = localStorage.getItem('starcloud.spread') as SpreadMode | null;
  const initialSpread: SpreadMode =
    savedSpread === 'always' ? 'always' : 'none';
  const spreadRef = useRef<SpreadMode>(initialSpread);
  const [spreadLabel, setSpreadLabel] = useState(MODE_LABEL[initialSpread]);

  /** 字号与键盘处理器的 ref：初始化 effect 只跑一次，
   *  通过 ref 让回调始终拿到最新值，而不触发渲染器重建 */
  const fontSizeRef = useRef(FONT_STEPS[stepIndex] ?? 100);
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});

  const goPrev = useCallback(() => renditionRef.current?.prev(), []);
  const goNext = useCallback(() => renditionRef.current?.next(), []);

  /**
   * 应用字号。themes.fontSize 注入的样式可能被书籍自带 CSS 压住，
   * 所以再通过 contents API 直接写每个 iframe 文档的 font-size。
   */
  const applyFontSize = useCallback((size: number) => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    rendition.themes.fontSize(`${size}%`);
    try {
      const contents = rendition.getContents() ?? [];
      for (const c of contents) {
        c.css('font-size', `${size}%`);
      }
    } catch {
      // 个别章节文档尚未就绪时忽略，翻页后会重放
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

  // 初始化渲染器（bookId 变化才重建）
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
          spread: spreadRef.current, // auto 随屏宽单/双列；可手动覆写
        });
        renditionRef.current = localRendition;
        localRendition.themes.register('paper', {
          // 强制相对行高：书籍自带的固定像素行高在放大字号后
          // 会导致行框超过分页高度而被裁切
          body: {
            background: '#fbf7ee',
            'line-height': '1.6 !important',
          },
          p: {
            'line-height': '1.6 !important',
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
          // 新章节的 iframe 需要重新套用字号
          applyFontSize(fontSizeRef.current);
        });
        // 书页 iframe 内的按键不会冒泡到父页面，由 epubjs 代理出来
        localRendition.on('keyup', (e: KeyboardEvent) =>
          keyHandlerRef.current(e),
        );

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
    localStorage.setItem('starcloud.fontStep', String(stepIndex));
  }, [stepIndex, applyFontSize]);

  /** 切换单/双列：记住当前位置，切换排版后回到原处 */
  function switchSpread() {
    const rendition = renditionRef.current;
    if (!rendition || !ready) return;
    const currentMode = spreadRef.current;
    const next =
      SPREAD_MODES[(SPREAD_MODES.indexOf(currentMode) + 1) % SPREAD_MODES.length];
    spreadRef.current = next;
    setSpreadLabel(MODE_LABEL[next]);
    localStorage.setItem('starcloud.spread', next);

    let cfi: string | undefined;
    try {
      cfi = rendition.currentLocation()?.start?.cfi;
    } catch {
      // 尚无位置信息
    }
    rendition.spread(next);
    rendition.clear();
    rendition.display(cfi ?? undefined);
  }

  // 触摸滑动翻页
  const touchStartX = useRef<number | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx > 50) goPrev();
    else if (dx < -50) goNext();
    touchStartX.current = null;
  }

  return (
    <div className="epub-viewer" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="epub-toolbar">
        <div className="toolbar-left">
          <Link to="/" className="btn">← 书架</Link>
          <button className="btn" onClick={() => switchSpread()} disabled={!ready}>
            {spreadLabel}
          </button>
        </div>
        <span className="reader-progress reader-center">
          {loadError ??
            (!ready
              ? '打开中…'
              : chapter.total > 0
                ? `${chapter.current}/${chapter.total} 章 · 第${stepIndex + 1}档`
                : '')}
        </span>
        <div className="toolbar-right">
          <button
            className="btn"
            disabled={!ready || stepIndex === 0}
            onClick={() => setStepIndex(Math.max(0, stepIndex - 1))}
          >
            A-
          </button>
          <button
            className="btn"
            disabled={!ready || stepIndex === FONT_STEPS.length - 1}
            onClick={() => setStepIndex(Math.min(FONT_STEPS.length - 1, stepIndex + 1))}
          >
            A+
          </button>
        </div>
      </div>
      <div className="epub-container" ref={containerRef} />
    </div>
  );
}
