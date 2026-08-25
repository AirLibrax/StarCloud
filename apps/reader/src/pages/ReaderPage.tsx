import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Book, ReadingProgress, UpdateProgressRequest } from '@starcloud/shared';
import { api, getToken } from '../api/client';
import EpubViewer from '../components/EpubViewer';

/**
 * 阅读器：按格式分流渲染。
 * - TXT:  取全文，滚动式阅读；滚动位置换算页码并防抖上报进度
 * - PDF:  浏览器原生渲染（iframe + query token）
 * - EPUB: EpubViewer（epubjs 渲染），章节级进度定位与完整交互体系
 */

/** 每页字符数（TXT 按此估算总页数） */
const CHARS_PER_PAGE = 1200;

export default function ReaderPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const [book, setBook] = useState<Book | null>(null);
  const [progress, setProgress] = useState<ReadingProgress | null>(null);
  /* 书架进度是否已拉回：EPUB 恢复依赖 initialCfi，
     必须等 progress 就位后再挂载 EpubViewer，否则组件会在 cfi=undefined 时
     初始化并打开第一章，后续到达的 cfi 无法生效（竞态） */
  const [shelfLoaded, setShelfLoaded] = useState(false);
  const [txtContent, setTxtContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const reportProgress = useCallback(
    async (currentPage: number, totalPages: number, position?: string | null, percentage?: number) => {
      if (!bookId) return;
      try {
        await api<ReadingProgress>('/api/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookId: Number(bookId),
            currentPage,
            totalPages,
            position,
            percentage,
          } satisfies UpdateProgressRequest),
        });
      } catch {
        // 进度上报失败不打断阅读
      }
    },
    [bookId],
  );

  useEffect(() => {
    let cancelled = false;
    setShelfLoaded(false);
    async function load() {
      try {
        const book = await api<Book>(`/api/books/${bookId}`);
        if (cancelled) return;
        setBook(book);

        let foundProgress: ReadingProgress | null = null;
        try {
          const shelf = await api<
            { book: Book; progress: ReadingProgress | null }[]
          >('/api/shelf');
          if (cancelled) return;
          foundProgress = shelf.find((i) => i.book.id === book.id)?.progress ?? null;
        } catch (shelfErr) {
          console.warn('shelf 拉取失败，按无进度打开', shelfErr);
        }
        if (cancelled) return;
        setProgress(foundProgress);
        setShelfLoaded(true);

        if (book.fileType === 'txt') {
          const res = await fetch(
            `/api/books/${book.id}/download`,
            { headers: { Authorization: `Bearer ${getToken()}` } },
          );
          const text = await res.text();
          if (!cancelled) setTxtContent(text);
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : '加载失败');
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  /** TXT 滚动 → 进度换算（防抖由 scheduleReport 控制） */
  const lastTxtPageRef = useRef(-1);
  function handleScroll() {
    const el = contentRef.current;
    if (!el || !txtContent || !book) return;
    const max = el.scrollHeight - el.clientHeight;
    const ratio = max > 0 ? el.scrollTop / max : 1;
    const totalPages = Math.max(1, Math.ceil(txtContent.length / CHARS_PER_PAGE));
    const currentPage = Math.max(1, Math.ceil(totalPages * ratio));
    const percentage = Math.round(ratio * 1000) / 10;
    setProgress((p) => ({
      id: p?.id ?? 0,
      bookId: book.id,
      currentPage,
      totalPages,
      percentage,
      updatedAt: p?.updatedAt ?? '',
    }));
    // 页变化才上报（与 App 端 TxtPane 一致；显示更新不受影响）
    if (currentPage === lastTxtPageRef.current) return;
    lastTxtPageRef.current = currentPage;
    scheduleReport(currentPage, totalPages);
  }

  const reportTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** 最新待上报进度；防抖窗口内退出/关页时由 flush 立即发出 */
  const latestReport = useRef<{ page: number; total: number; position?: string | null; percentage?: number } | null>(null);
  function doReport() {
    if (reportTimer.current) {
      clearTimeout(reportTimer.current);
      reportTimer.current = undefined;
    }
    const lp = latestReport.current;
    if (!lp || !bookId) return;
    latestReport.current = null;
    reportProgress(lp.page, lp.total, lp.position, lp.percentage);
  }
  function scheduleReport(page: number, total: number, position?: string | null, percentage?: number) {
    latestReport.current = { page, total, position, percentage };
    clearTimeout(reportTimer.current);
    reportTimer.current = setTimeout(doReport, 3000);
  }
  // 退出阅读器（路由切走）或关闭标签页时立即上报最后位置；
  // 关页场景用 keepalive fetch 保证请求不被浏览器随页面终止而取消
  useEffect(() => {
    const flush = () => {
      const lp = latestReport.current;
      if (!lp || !bookId) return;
      latestReport.current = null;
      fetch('/api/progress', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ bookId: Number(bookId), currentPage: lp.page, totalPages: lp.total, position: lp.position, percentage: lp.percentage } satisfies UpdateProgressRequest),
      }).catch(() => {});
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
        if (reportTimer.current) {
          clearTimeout(reportTimer.current);
          reportTimer.current = undefined;
        }
      flush();
    };
  }, [bookId]);

  /** TXT 恢复到上次阅读位置 */
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !txtContent || !progress?.totalPages) return;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = max * (progress.currentPage / progress.totalPages);
    // 仅首次进入时恢复一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txtContent]);

  if (error) {
    return (
      <div className="reader-topbar">
        <Link to="/" className="btn">
          ← 返回书架
        </Link>
        <div className="error-box" style={{ marginTop: '1rem' }}>
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="reader-page">
      {/* EPUB 由渲染器自带完整顶栏，其余格式用通用顶栏 */}
      {book?.fileType !== 'epub' && (
        <header className="reader-topbar">
          <Link to="/" className="btn">
            ← 书架
          </Link>
          <div className="reader-title">{book?.title ?? '…'}</div>
          <div className="reader-progress">
            {progress ? `${progress.percentage}%` : ''}
          </div>
        </header>
      )}

      {!book && <p className="hint">加载中…</p>}

      {book?.fileType === 'txt' && txtContent !== null && (
        <div className="txt-content" ref={contentRef} onScroll={handleScroll}>
          {txtContent}
        </div>
      )}

      {book?.fileType === 'pdf' && (
        <iframe
          title={book.title}
          className="pdf-frame"
          src={`/api/books/${book.id}/download?access_token=${getToken()}`}
        />
      )}

      {book?.fileType === 'epub' && shelfLoaded && (
        <EpubViewer
          bookId={book.id}
          initialPercentage={progress?.percentage ?? 0}
          initialCfi={progress?.position ?? undefined}
          onProgress={(page, total, position, percentage) => {
            const pct = percentage ?? Math.round((page / total) * 1000) / 10;
            setProgress((p) => ({
              id: p?.id ?? 0,
              bookId: book.id,
              currentPage: page,
              totalPages: total,
              percentage: pct,
              position: position ?? null,
              updatedAt: p?.updatedAt ?? '',
            }));
            scheduleReport(page, total, position, pct);
          }}
        />
      )}
    </div>
  );
}
