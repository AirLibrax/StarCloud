import { useCallback, useEffect, useRef, useState } from 'react';
import ePub, { type Book as EpubBook, type Rendition } from 'epubjs';
import { getToken } from '../api/client';

/**
 * 字号档位（仿 Apple Books）：离散档位而不是任意缩放，
 * 配合强制相对行高，保证任何档位都不会出现文字被分页边缘裁切
 */
const FONT_STEPS = [80, 90, 100, 110, 125, 140, 160, 180];

interface Props {
  bookId: number;
  /** 上次阅读的百分比 0-100，用于恢复位置 */
  initialPercentage: number;
  /** 进度变化回调（章节号），父组件负责防抖上报 */
  onProgress: (currentPage: number, totalPages: number) => void;
}

/**
 * EPUB 渲染器：epubjs 封装。
 * - 文件经 fetch ArrayBuffer 加载，令牌不落 URL
 * - 进度锚定章节序号（spine index），与后端 currentPage/totalPages 模型对齐
 * - 翻页三通道：键盘（window + iframe 代理）、触屏滑动、后续可加点击热区
 */
export default function EpubViewer({ bookId, initialPercentage, onProgress }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(100);
  const stepIndex = Math.max(
    0,
    FONT_STEPS.indexOf(FONT_STEPS.reduce((best, s) => (Math.abs(s - fontSize) < Math.abs(best - fontSize) ? s : best))),
  );
  const [chapter, setChapter] = useState({ current: 0, total: 0 });

  // 字号与键盘处理器的 ref：初始化 effect 只跑一次，
  // 通过 ref 让回调始终拿到最新值，而不触发渲染器重建
  const fontSizeRef = useRef(fontSize);
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
      rendition.getContents().forEach((c: any) =>
        c.css('font-size', `${size}%`),
      );
    } catch {
      // 个别章节文档尚未就绪时忽略，relocated 后会重放
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
    let localRendition: Rendition | null = null;

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
          spread: 'auto', // 宽屏自动双列，窄屏单列（iPad 式）
          allowScripted: false,
        });
        renditionRef.current = localRendition;
        localRendition.themes.register('paper', {
          // 强制相对行高与边距：书籍自带的固定像素行高在放大字号后会
          // 导致行框超过分页高度而被裁切，这里统一覆盖为相对值
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
          const idx = location.start.index as number;
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
        totalChapters = ebook.spine.items.length;

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
      localRendition?.destroy();
      bookRef.current?.destroy();
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

  // 字号变化立即应用
  useEffect(() => {
    fontSizeRef.current = fontSize;
    applyFontSize(fontSize);
  }, [fontSize, applyFontSize]);

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
        <button
          className="btn"
          disabled={stepIndex === 0}
          onClick={() => setFontSize(FONT_STEPS[Math.max(0, stepIndex - 1)])}
        >
          A-
        </button>
        <span className="reader-progress">
          {loadError
            ? loadError
            : ready && chapter.total > 0
              ? `${chapter.current}/${chapter.total} 章 · ${stepIndex + 1}/${FONT_STEPS.length} 档`
              : '打开中…'}
        </span>
        <button
          className="btn"
          disabled={stepIndex === FONT_STEPS.length - 1}
          onClick={() => setFontSize(FONT_STEPS[Math.min(FONT_STEPS.length - 1, stepIndex + 1)])}
        >
          A+
        </button>
      </div>
      <div className="epub-container" ref={containerRef} />
    </div>
  );
}
