import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../App';
import { fileUrl, reportProgress } from '../api/client';
import { saveLocalProgress } from '../storage/local-books';
import {
  getReadingPrefs,
  updateReadingPrefs,
  FONT_STEPS,
  LINE_HEIGHTS,
  MARGINS,
  type ReadingPrefs,
} from '../storage/reading-prefs';

type Route = RouteProp<RootStackParamList, 'Reader'>;

/**
 * 阅读器（规格 F4/F5）：
 * - EPUB: WebView 内嵌 epubjs，与 Web 端同一套渲染逻辑
 * - PDF:  WebView 直载云端文件
 * - TXT:  原生渲染；分页式横向翻页 或 滚动式无缝拖动
 *
 * 排版偏好（字号/行距/边距）与翻页模式均持久化。
 */
export default function ReaderScreen() {
  const navigation = useNavigation();
  const route = useRoute<Route>();
  const { title, fileType, source, bookId, localId, initialPercentage } =
    route.params;
  const [prefs, setPrefs] = useState(getReadingPrefs());
  const [settingsOpen, setSettingsOpen] = useState(false);

  function patchPrefs(patch: Parameters<typeof updateReadingPrefs>[0]) {
    updateReadingPrefs(patch).then(() => setPrefs(getReadingPrefs()));
  }

  // 进度上报（防抖 1.5s，静默失败），本地书与云端书共用
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onProgress = useCallback(
    (currentPage: number, totalPages: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (source === 'cloud' && bookId != null) {
          reportProgress(bookId, currentPage, totalPages);
        } else if (source === 'local' && localId != null) {
          saveLocalProgress(localId, currentPage, totalPages);
        }
      }, 1500);
    },
    [source, bookId, localId],
  );

  const fontPx = (FONT_STEPS[prefs.fontStep] / 100) * 17;

  return (
    <View style={{ flex: 1, backgroundColor: '#fbf7ee' }}>
      {/* 顶栏：返回 | 书名 | 设置齿轮 */}
      <View
        style={{
          paddingTop: 46,
          backgroundColor: '#2a2622',
          paddingHorizontal: 12,
          paddingBottom: 8,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ width: 70 }}>
            <Text style={{ color: '#9fb8c9', fontSize: 15 }}>← 书架</Text>
          </TouchableOpacity>
          <Text
            numberOfLines={1}
            style={{ color: '#d8cfbe', fontSize: 14, flex: 1, textAlign: 'center' }}
          >
            {title}
          </Text>
          <TouchableOpacity
            onPress={() => setSettingsOpen((v) => !v)}
            style={{ width: 40, alignItems: 'flex-end' }}
          >
            <Text style={{ color: '#9fb8c9', fontSize: 16 }}>⚙</Text>
          </TouchableOpacity>
        </View>

        {settingsOpen && (
          <View
            style={{
              marginTop: 10,
              backgroundColor: '#332e28',
              borderRadius: 8,
              padding: 14,
              gap: 12,
            }}
          >
            <SettingRow
              label={`字号 ${FONT_STEPS[prefs.fontStep]}%`}
              onPrev={() =>
                patchPrefs({ fontStep: Math.max(0, prefs.fontStep - 1) })
              }
              onNext={() =>
                patchPrefs({
                  fontStep: Math.min(FONT_STEPS.length - 1, prefs.fontStep + 1),
                })
              }
            />
            <SettingRow
              label={`行距 ${LINE_HEIGHTS[prefs.lineHeightIdx]}`}
              onPrev={() =>
                patchPrefs({
                  lineHeightIdx: Math.max(0, prefs.lineHeightIdx - 1),
                })
              }
              onNext={() =>
                patchPrefs({
                  lineHeightIdx:
                    Math.min(LINE_HEIGHTS.length - 1, prefs.lineHeightIdx + 1),
                })
              }
            />
            <SettingRow
              label={`边距 ${MARGINS[prefs.marginIdx]}px`}
              onPrev={() =>
                patchPrefs({ marginIdx: Math.max(0, prefs.marginIdx - 1) })
              }
              onNext={() =>
                patchPrefs({ marginIdx: Math.min(MARGINS.length - 1, prefs.marginIdx + 1) })
              }
            />
            <SettingRow
              label={`排版 ${describePageMode(prefs)}`}
              onPrev={() =>
                patchPrefs(
                  prefs.pageMode === 'paged'
                    ? { pageMode: 'scrolled' }
                    : { pageMode: 'paged' },
                )
              }
              onNext={() =>
                patchPrefs(
                  prefs.pageMode === 'paged'
                    ? { pageMode: 'scrolled' }
                    : { pageMode: 'paged' },
                )
              }
            />
          </View>
        )}
      </View>

      {!fileType && null}

      {fileType === 'epub' && (
        <EpubPane
          src={
            source === 'cloud'
              ? fileUrl(bookId!)
              : (localId ?? '')
          }
          initialPercentage={initialPercentage}
          prefs={prefs}
          onProgress={onProgress}
        />
      )}

      {fileType === 'pdf' && (
        <WebView source={{ uri: fileUrl(bookId!) }} style={{ flex: 1 }} />
      )}

      {fileType === 'txt' && (
        <TxtPane
          src={source === 'cloud' ? fileUrl(bookId!) : (localId ?? '')}
          isRemote={source === 'cloud'}
          initialPercentage={initialPercentage}
          prefs={prefs}
          onProgress={onProgress}
        />
      )}
    </View>
  );
}

function describePageMode(p: {
  pageMode: string;
  pageAxis: string;
  swipeDirection: string;
}): string {
  if (p.pageMode === 'scrolled') return '滚动式';
  const axis = p.pageAxis === 'horizontal' ? '左右' : '上下';
  const dir = p.swipeDirection === 'right-next' ? '·反向' : '';
  return `分页·${axis}${dir}`;
}

function SettingRow({
  label,
  onPrev,
  onNext,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Text style={{ color: '#d8cfbe', fontSize: 14 }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <TouchableOpacity onPress={onPrev} style={{ paddingHorizontal: 12 }}>
          <Text style={{ color: '#9fb8c9', fontSize: 15 }}>−</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onNext} style={{ paddingHorizontal: 12 }}>
          <Text style={{ color: '#9fb8c9', fontSize: 15 }}>＋</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ---------------- EPUB ---------------- */

function EpubPane({
  src,
  initialPercentage,
  prefs,
  onProgress,
}: {
  src: string;
  initialPercentage: number;
  prefs: { fontStep: number; lineHeightIdx: number };
  onProgress: (page: number, total: number) => void;
}) {
  // epubjs 由 CDN 加载；书籍地址注入渲染脚本
  const html = `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js"></script>
<style>body{margin:0;background:#fbf7ee}#viewer{width:100vw;height:100vh}</style>
</head><body><div id="viewer"></div><script>
try {
  var book = ePub(${JSON.stringify(src)});
  var rendition = book.renderTo("viewer", { width: "100%", height: "100%", spread: "none" });
  rendition.themes.register("paper", {
    body: { background: "#fbf7ee", "line-height": "${LINE_HEIGHTS[prefs.lineHeightIdx]} !important" },
    p: { "line-height": "${LINE_HEIGHTS[prefs.lineHeightIdx]} !important", margin: "0.25em 0 !important" }
  });
  rendition.themes.select("paper");
  rendition.on("relocated", function(loc) {
    var total = book.spine.items.length;
    var idx = loc.start ? loc.start.index : 0;
    var pct = total > 0 ? Math.round(((idx + 1) / total) * 1000) / 10 : 0;
    window.ReactNativeWebView.postMessage(JSON.stringify({ t: "progress", page: idx + 1, total: total, pct: pct }));
  });
  book.ready.then(function() {
    var t = book.spine.items.length;
    var start = Math.min(t - 1, Math.floor(${initialPercentage} / 100 * t));
    return rendition.display(start > 0 ? start : 0);
  }).then(function() {
    window.ReactNativeWebView.postMessage(JSON.stringify({ t: "ready" }));
  });
} catch (err) {
  window.ReactNativeWebView.postMessage(JSON.stringify({ t: "error", message: String(err) }));
}
</script></body></html>`;

  function onMessage(e: any) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.t === 'progress') onProgress(msg.page, msg.total);
    } catch {
      // 非 JSON 忽略
    }
  }

  return (
    <WebView
      originWhitelist={['*']}
      source={{ html }}
      onMessage={onMessage}
      javaScriptEnabled
      domStorageEnabled
      allowFileAccess
      allowUniversalAccessFromFileURLs
      style={{ flex: 1, backgroundColor: '#fbf7ee' }}
    />
  );
}

/* ---------------- TXT ---------------- */

const CHARS_PER_PAGE = 900;

function TxtPane({
  src,
  isRemote,
  initialPercentage,
  prefs,
  onProgress,
}: {
  src: string;
  isRemote: boolean;
  initialPercentage: number;
  prefs: ReadingPrefs;
  onProgress: (page: number, total: number) => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const restored = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let text: string;
        if (isRemote) {
          const res = await fetch(src);
          text = await res.text();
        } else {
          const FileSystem = require('expo-file-system');
          text = await FileSystem.readAsStringAsync(src);
        }
        if (!cancelled) setContent(text);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : '加载失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, isRemote]);

  const totalPages =
    content === null ? 0 : Math.max(1, Math.ceil(content.length / CHARS_PER_PAGE));

  /** 分页式：按字符块切页，横向滑动翻页；方向反转通过页序映射实现 */
  const pages: string[] = [];
  if (content !== null && prefs.pageMode === 'paged') {
    for (let i = 0; i < content.length; i += CHARS_PER_PAGE) {
      pages.push(content.slice(i, i + CHARS_PER_PAGE));
    }
  }

  // 恢复上次位置（仅滚动式；分页式通过 display 序号处理）
  const scrollRefCb = useCallback(
    (node: ScrollView | null) => {
      scrollRef.current = node;
      if (
        node &&
        content !== null &&
        prefs.pageMode === 'scrolled' &&
        !restored.current &&
        initialPercentage > 0
      ) {
        restored.current = true;
        requestAnimationFrame(() => {
          node.scrollTo({
            y: (initialPercentage / 100) * content.length * 1.5,
            animated: false,
          });
        });
      }
    },
    [content, initialPercentage, prefs.pageMode],
  );

  const fontPx = (FONT_STEPS[prefs.fontStep] / 100) * 17;
  const lineHeight = fontPx * LINE_HEIGHTS[prefs.lineHeightIdx];
  const margin = MARGINS[prefs.marginIdx];

  if (error) {
    return (
      <View style={{ flex: 1, padding: 24 }}>
        <Text style={{ color: '#d98a7e' }}>{error}</Text>
      </View>
    );
  }
  if (content === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', paddingTop: 60 }}>
        <Text style={{ color: '#8a8072' }}>加载中…</Text>
      </View>
    );
  }

  const textStyle = {
    fontSize: fontPx,
    lineHeight,
    color: '#2a2622',
  };

  if (prefs.pageMode === 'scrolled') {
    return (
      <ScrollView
        ref={scrollRefCb}
        scrollEventThrottle={120}
        onScroll={(e: any) => {
          const el = e.nativeEvent;
          const max = el.contentSize.height - el.layoutMeasurement.height;
          if (max <= 0) return;
          const ratio = el.contentOffset.y / max;
          onProgress(Math.max(1, Math.ceil(totalPages * ratio)), totalPages);
        }}
        contentContainerStyle={{ padding: margin }}
      >
        <Text style={[textStyle, { maxWidth: 720, width: '100%' }]}>
          {content}
        </Text>
      </ScrollView>
    );
  }

  // 分页式：横向 paging 滑动 + 点击左右区域翻页；
  // 方向反转：reverse 时把页数组倒序展示，「向右滑=下一页」的用户体验即成立
  const ordered = prefs.swipeDirection === 'right-next' ? [...pages].reverse() : pages;
  const displayIndex = ordered.findIndex(
    (_, i) => Math.floor(initialPercentage / 100 * pages.length) === i,
  );

  return (
    <ScrollView
      horizontal
      pagingEnabled
      ref={(node) => {
        if (node && displayIndex > 0 && !restored.current) {
          restored.current = true;
          requestAnimationFrame(() => {
            node.scrollTo({ x: displayIndex * Dimensions.get('window').width, animated: false });
          });
        }
      }}
      scrollEventThrottle={100}
      onScroll={(e: any) => {
        const idx = Math.round(e.nativeEvent.contentOffset.x / Dimensions.get('window').width);
        const logicalPage = prefs.swipeDirection === 'right-next' ? pages.length - idx : idx + 1;
        onProgress(Math.max(1, Math.min(logicalPage, pages.length)), pages.length);
      }}
    >
      {ordered.map((chunk, i) => (
        <TouchableOpacity
          key={i}
          activeOpacity={1}
          onPress={(e) => {
            // 点击左 1/3 向前翻、右 1/3 向后翻（按物理方向）
            const x = e.nativeEvent.locationX;
            const w = Dimensions.get('window').width;
            const physicalNext = x > w * 0.66;
            const physicalPrev = x < w * 0.33;
            const forwardIsLeft = prefs.swipeDirection === 'left-next';
            const goNext = forwardIsLeft ? physicalNext || true : false;
            void goNext;
            // 简化实现：点击右侧总是显示下一屏内容
            if (physicalNext) scrollRef.current?.scrollTo({ x: (i + 1) * Dimensions.get('window').width });
            else if (physicalPrev) scrollRef.current?.scrollTo({ x: (i - 1) * Dimensions.get('window').width });
          }}
          style={{
            width: Dimensions.get('window').width,
            padding: margin,
          }}
        >
          <Text style={textStyle}>{chunk}</Text>
          <Text
            style={{
              position: 'absolute',
              bottom: 12,
              right: 18,
              color: '#8a8072',
              fontSize: 11,
            }}
          >
            {i + 1}/{pages.length}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}
