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
  const [txtContent, setTxtContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const reportProgress = useCallback(
    async (currentPage: number, totalPages: number) => {
      if (!bookId) return;
      try {
        await api<ReadingProgress>('/api/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookId: Number(bookId),
            currentPage,
            totalPages,
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
    async function load() {
      try {
        const book = await api<Book>(`/api/books/${bookId}`);
        if (cancelled) return;
        setBook(book);

        const shelf = await api<
          { book: Book; progress: ReadingProgress | null }[]
        >('/api/shelf');
        if (cancelled) return;
        setProgress(
          shelf.find((i) => i.book.id === book.id)?.progress ?? null,
        );

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
  function scheduleReport(page: number, total: number) {
    clearTimeout(reportTimer.current);
    reportTimer.current = setTimeout(() => reportProgress(page, total), 3000);
  }

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

      {book?.fileType === 'epub' && (
        <EpubViewer
          bookId={book.id}
          initialPercentage={progress?.percentage ?? 0}
          onProgress={(page, total) => {
            const pct = Math.round((page / total) * 1000) / 10;
            setProgress((p) => ({
              id: p?.id ?? 0,
              bookId: book.id,
              currentPage: page,
              totalPages: total,
              percentage: pct,
              updatedAt: p?.updatedAt ?? '',
            }));
            scheduleReport(page, total);
          }}
        />
      )}
    </div>
  );
}
