import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Dimensions, Pressable } from 'react-native';
import Slider from '@react-native-community/slider';
import { WebView } from 'react-native-webview';
import { PanGestureHandler, State, type PanGestureHandlerStateChangeEvent } from 'react-native-gesture-handler';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../App';
import { colors } from '../theme';
import { fileUrl, reportProgress } from '../api/client';
import { ensureCachedFile } from '../api/file-cache';
import { saveLocalProgress, listLocalBooks } from '../storage/local-books';
import { tapZoneAction } from '@starcloud/shared';
import {
  getReadingPrefs,
  updateReadingPrefs,
  FONT_STEPS,
  LINE_HEIGHTS,
  MARGINS,
  type ReadingPrefs,
} from '../storage/reading-prefs';

import { buildOfflineEpubHtml } from '../reader/offline-epub';

 type Route = RouteProp<RootStackParamList, 'Reader'>;

/** 边距档位名称（与 Web 阅读端一致） */
const MARGIN_LABELS = ['窄', '中', '宽', '很宽'];

/**
 * 阅读器（规格 F4/F5）：
 * - EPUB: WebView 内嵌 epubjs，与 Web 端同一套渲染逻辑
 * - PDF:  WebView 直载云端文件
 * - TXT:  原生渲染；点击翻页（左右分区）或滑动翻页（左右手势/上下无缝）
 *
 * 排版偏好（字号/行距/边距）与翻页方式均持久化，
 * 翻页语义与 Web 端 EpubViewer 一致（消费 @starcloud/shared）。
 */
export default function ReaderScreen() {
  const navigation = useNavigation();
  const route = useRoute<Route>();
  const { title, fileType, source, bookId, localId, initialPercentage } =
    route.params;
  const [prefs, setPrefs] = useState(getReadingPrefs());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pageInfo, setPageInfo] = useState<{ page: number; total: number } | null>(null);

  function patchPrefs(patch: Parameters<typeof updateReadingPrefs>[0]) {
    updateReadingPrefs(patch).then(() => setPrefs(getReadingPrefs()));
  }

  // 进度上报（防抖 3s，章节/页变化才报，静默失败），本地书与云端书共用
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onProgress = useCallback(
    (currentPage: number, totalPages: number) => {
      setPageInfo({ page: currentPage, total: totalPages });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (source === 'cloud' && bookId != null) {
          reportProgress(bookId, currentPage, totalPages);
        } else if (source === 'local' && localId != null) {
          saveLocalProgress(localId, currentPage, totalPages);
        }
      }, 3000);
    },
    [source, bookId, localId],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.sheet }}>
      {/* 顶栏：返回 | 书名 | 设置齿轮 */}
      <View
        style={{
          paddingTop: 46,
          backgroundColor: colors.card,
          paddingHorizontal: 12,
          paddingBottom: 8,
          borderBottomWidth: 0.5,
          borderBottomColor: colors.border,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ width: 70 }}>
            <Text style={{ color: colors.accent, fontSize: 15 }}>← 书架</Text>
          </TouchableOpacity>
          <Text
            numberOfLines={1}
            style={{ color: colors.textLight, fontSize: 14, flex: 1, textAlign: 'center' }}
          >
            {title}
          </Text>
          <TouchableOpacity
            onPress={() => setSettingsOpen((v) => !v)}
            style={{ width: 40, alignItems: 'flex-end' }}
          >
            <Text style={{ color: colors.accent, fontSize: 16 }}>⚙</Text>
          </TouchableOpacity>
        </View>

        {settingsOpen && (
          <View
            style={{
              position: 'absolute',
              top: 96,
              left: 12,
              right: 12,
              zIndex: 20,
              backgroundColor: colors.card,
              borderRadius: 8,
              borderWidth: 0.5,
              borderColor: colors.border,
              padding: 14,
              gap: 16,
              elevation: 6,
            }}
          >
            <SettingSlider
              label="字号"
              value={`${FONT_STEPS[prefs.fontStep]}%`}
              max={FONT_STEPS.length - 1}
              valueIdx={prefs.fontStep}
              onChange={(v) => patchPrefs({ fontStep: v })}
            />
            <SettingSlider
              label="行间距"
              value={`${LINE_HEIGHTS[prefs.lineHeightIdx]} 倍`}
              max={LINE_HEIGHTS.length - 1}
              valueIdx={prefs.lineHeightIdx}
              onChange={(v) => patchPrefs({ lineHeightIdx: v })}
            />
            <SettingSlider
              label="左右边距"
              value={MARGIN_LABELS[prefs.marginIdx]}
              max={MARGINS.length - 1}
              valueIdx={prefs.marginIdx}
              onChange={(v) => patchPrefs({ marginIdx: v })}
            />

            <View>
              <Text style={{ color: colors.textLight, fontSize: 13, marginBottom: 6 }}>
                翻页方式
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <SegmentBtn
                  label="点击翻页"
                  active={prefs.pageMode === 'tap'}
                  onPress={() => patchPrefs({ pageMode: 'tap' })}
                />
                <SegmentBtn
                  label="滑动翻页"
                  active={prefs.pageMode === 'swipe'}
                  onPress={() => patchPrefs({ pageMode: 'swipe' })}
                />
              </View>
            </View>

            {prefs.pageMode === 'tap' && (
              <View>
                <Text style={{ color: colors.textLight, fontSize: 13, marginBottom: 6 }}>
                  翻页方向
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <SegmentBtn
                    label="向左下一页"
                    active={prefs.swipeDirection === 'left-next'}
                    onPress={() => patchPrefs({ swipeDirection: 'left-next' })}
                  />
                  <SegmentBtn
                    label="向右下一页"
                    active={prefs.swipeDirection === 'right-next'}
                    onPress={() => patchPrefs({ swipeDirection: 'right-next' })}
                  />
                </View>
              </View>
            )}

            {prefs.pageMode === 'swipe' && (
              <View>
                <Text style={{ color: colors.textLight, fontSize: 13, marginBottom: 6 }}>
                  滑动轴向
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <SegmentBtn
                    label="左右滑动"
                    active={prefs.swipeLayout === 'horizontal'}
                    onPress={() => patchPrefs({ swipeLayout: 'horizontal' })}
                  />
                  <SegmentBtn
                    label="上下滑动"
                    active={prefs.swipeLayout === 'vertical'}
                    onPress={() => patchPrefs({ swipeLayout: 'vertical' })}
                  />
                </View>
              </View>
            )}

            {/* 冻结规格五：swipe/horizontal 同样显示「翻页方向」 */}
            {prefs.pageMode === 'swipe' && prefs.swipeLayout === 'horizontal' && (
              <View>
                <Text style={{ color: colors.textLight, fontSize: 13, marginBottom: 6 }}>
                  翻页方向
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <SegmentBtn
                    label="向左下一页"
                    active={prefs.swipeDirection === 'left-next'}
                    onPress={() => patchPrefs({ swipeDirection: 'left-next' })}
                  />
                  <SegmentBtn
                    label="向右下一页"
                    active={prefs.swipeDirection === 'right-next'}
                    onPress={() => patchPrefs({ swipeDirection: 'right-next' })}
                  />
                </View>
              </View>
            )}
          </View>
        )}
      </View>

      {!fileType && null}

      {fileType === 'epub' && (
        <EpubLoader
          source={source}
          bookId={bookId}
          localId={localId}
          initialPercentage={initialPercentage}
          prefs={prefs}
          onProgress={onProgress}
        />
      )}

      {/* 底部页码标注 */}
      {pageInfo && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: 14,
            left: 0,
            right: 0,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: colors.textMuted, fontSize: 12, backgroundColor: 'rgba(251,247,238,0.85)', paddingHorizontal: 10, paddingVertical: 2, borderRadius: 10 }}>
            {pageInfo.page}/{pageInfo.total} 页
          </Text>
        </View>
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

function SettingSlider({
  label,
  value,
  max,
  valueIdx,
  onChange,
}: {
  label: string;
  value: string;
  max: number;
  valueIdx: number;
  onChange: (idx: number) => void;
}) {
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
        <Text style={{ color: colors.textLight, fontSize: 13 }}>{label}</Text>
        <Text style={{ color: colors.accentDark, fontSize: 13 }}>
          {value}
        </Text>
      </View>
      <Slider
        minimumValue={0}
        maximumValue={max}
        step={1}
        value={valueIdx}
        onSlidingComplete={(v: number) => onChange(v)}
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.accent}
      />
    </View>
  );
}

function SegmentBtn({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flex: 1,
        paddingVertical: 6,
        alignItems: 'center',
        borderRadius: 5,
        backgroundColor: active ? colors.accent : colors.card,
        borderWidth: 0.5,
        borderColor: active ? colors.accent : colors.border,
      }}
    >
      <Text style={{ color: active ? '#fffdf7' : colors.textLight, fontSize: 13 }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/* ---------------- EPUB（离线渲染管线） ---------------- */

/**
 * 确定文件来源：本地书直接用私有目录文件；
 * 云端书先静默缓存到临时目录（可随时清理，不影响书库），再统一走离线渲染。
 */
function EpubLoader({
  source,
  bookId,
  localId,
  initialPercentage,
  prefs,
  onProgress,
}: {
  source: 'cloud' | 'local';
  bookId?: number;
  localId?: string;
  initialPercentage: number;
  prefs: ReadingPrefs;
  onProgress: (page: number, total: number) => void;
}) {
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const uri =
          source === 'local' && localId
            ? (await listLocalBooks()).find((b) => b.id === localId)?.fileUri ?? null
            : await ensureCachedFile(bookId!, 'epub');
        if (!uri) throw new Error('找不到书籍文件');
        if (!cancelled) setFileUri(uri);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, bookId, localId]);

  if (error)
    return (
      <View style={{ flex: 1, padding: 24 }}>
        <Text style={{ color: '#8b2c1f', fontSize: 14 }}>{error}</Text>
      </View>
    );
  if (!fileUri)
    return (
      <View style={{ flex: 1, alignItems: 'center', paddingTop: 60 }}>
        <Text style={{ color: '#6b6158' }}>正在获取书籍…</Text>
      </View>
    );

  return (
    <EpubPane
      fileUri={fileUri}
      bookKey={`b${bookId ?? localId}`}
      initialPercentage={initialPercentage}
      prefs={prefs}
      onProgress={onProgress}
    />
  );
}

function EpubPane({
  fileUri,
  bookKey,
  initialPercentage,
  prefs,
  onProgress,
}: {
  fileUri: string;
  bookKey: string;
  initialPercentage: number;
  prefs: ReadingPrefs;
  onProgress: (page: number, total: number) => void;
}) {
  const webRef = useRef<WebView>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('正在准备渲染引擎…');

  // 组装自包含阅读页 HTML（引擎内联；书数据由 RN 分块推送）
  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    (async () => {
      try {
        const h = await buildOfflineEpubHtml(bookKey, {
          fileUri,
          initialPercentage,
          fontSizePct: FONT_STEPS[prefs.fontStep],
          lineHeight: LINE_HEIGHTS[prefs.lineHeightIdx],
          marginPx: MARGINS[prefs.marginIdx],
          pageMode: prefs.pageMode,
          swipeLayout: prefs.swipeLayout,
        });
        if (!cancelled) setHtml(h);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, fileUri]);

  // 排版/翻页模式变化：重建阅读页（渲染参数随 HTML 一起注入）
  const styleKey = `${prefs.fontStep}-${prefs.lineHeightIdx}-${prefs.marginIdx}-${prefs.pageMode}-${prefs.swipeLayout}`;
  const firstStyle = useRef(true);
  useEffect(() => {
    if (firstStyle.current || !html) {
      firstStyle.current = false;
      return;
    }
    buildOfflineEpubHtml(bookKey, {
      fileUri,
      initialPercentage,
      fontSizePct: FONT_STEPS[prefs.fontStep],
      lineHeight: LINE_HEIGHTS[prefs.lineHeightIdx],
      marginPx: MARGINS[prefs.marginIdx],
      pageMode: prefs.pageMode,
      swipeLayout: prefs.swipeLayout,
    }).then((h) => {
      if (!cancelledRef.current) setHtml(h);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleKey]);

  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, [bookKey]);

  async function pushBookData() {
    const LegacyFS = require('expo-file-system/legacy');
    if (!webRef.current || !fileUri) return;
    const b64 = await LegacyFS.readAsStringAsync(fileUri, {
      encoding: LegacyFS.EncodingType.Base64,
    });
    setStatus('正在解压书籍…');
    const CHUNK = 512 * 1024;
    for (let i = 0; i < b64.length; i += CHUNK) {
      const piece = JSON.stringify(b64.slice(i, i + CHUNK));
      webRef.current.injectJavaScript(`window.__pushChunk(${piece});true;`);
    }
    webRef.current.injectJavaScript(`window.__openBook();true;`);
  }

  /** 执行翻页（手势桥接消息 → shared 模型判定 → 回注页面 __scNav） */
  function navTo(dir: 'next' | 'prev') {
    webRef.current?.injectJavaScript(
      `window.__scNav && window.__scNav('${dir}');true;`,
    );
  }

  function onMessage(e: any) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.t === 'need-book') {
        pushBookData();
        return;
      }
      if (msg.t === 'progress') onProgress(msg.page, msg.total);
      if (msg.t === 'error') setError(msg.message);
      // 手势桥接：桥接 JS 只报原始手势，语义判定统一在 RN 侧（消费 shared 模型）
      if (msg.t === 'tap') {
        const action = tapZoneAction(
          msg.x,
          Dimensions.get('window').width,
          prefs.swipeDirection,
        );
        navTo(action === 'next' ? 'next' : 'prev');
      }
      if (msg.t === 'swipe') {
        // 与 Web EpubViewer 逐字一致：(dx > 0) === (方向为 left-next) 即下一页
        const isNext = (msg.dx > 0) === (prefs.swipeDirection === 'left-next');
        navTo(isNext ? 'next' : 'prev');
      }
    } catch {
      // 非 JSON 忽略
    }
  }

  if (error)
    return (
      <View style={{ flex: 1, padding: 24 }}>
        <Text style={{ color: '#8b2c1f', fontSize: 14 }}>{error}</Text>
      </View>
    );

  if (!html)
    return (
      <View style={{ flex: 1, alignItems: 'center', paddingTop: 60 }}>
        <Text style={{ color: '#6b6158' }}>{status}</Text>
      </View>
    );

  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={webRef}
        source={{ html }}
        onMessage={onMessage}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowUniversalAccessFromFileURLs
        style={{ flex: 1, backgroundColor: '#fbf7ee' }}
      />
    </View>
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
  /** 上下滚动式“页变化才报”守卫 */
  const lastTxtPageRef = useRef(-1);

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

  /** 按字符块切页（tap 与 swipe+horizontal 共用，页序恒为自然顺序） */
  const pages: string[] = [];
  if (content !== null) {
    for (let i = 0; i < content.length; i += CHARS_PER_PAGE) {
      pages.push(content.slice(i, i + CHARS_PER_PAGE));
    }
  }

  // 恢复上次位置（仅上下无缝滚动式；分页式通过初始页码处理）
  const scrollRefCb = useCallback(
    (node: ScrollView | null) => {
      scrollRef.current = node;
      if (
        node &&
        content !== null &&
        prefs.pageMode === 'swipe' &&
        prefs.swipeLayout === 'vertical' &&
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

  if (prefs.pageMode === 'swipe' && prefs.swipeLayout === 'vertical') {
    // 上下无缝滚动：整章连成一条，滚到底自动接下一章
    return (
      <ScrollView
        ref={scrollRefCb}
        scrollEventThrottle={120}
        onScroll={(e: any) => {
          const el = e.nativeEvent;
          const max = el.contentSize.height - el.layoutMeasurement.height;
          if (max <= 0) return;
          const ratio = el.contentOffset.y / max;
          const page = Math.max(1, Math.ceil(totalPages * ratio));
          if (page !== lastTxtPageRef.current) {
            lastTxtPageRef.current = page;
            onProgress(page, totalPages);
          }
        }}
        contentContainerStyle={{ padding: margin }}
      >
        <Text style={[textStyle, { maxWidth: 720, width: '100%' }]}>
          {content}
        </Text>
      </ScrollView>
    );
  }

  // 分页式：tap = 点击左右分区；swipe+horizontal = 横滑手势（公式与 Web 一致）
  const initialPage =
    pages.length > 0
      ? Math.min(pages.length - 1, Math.floor((initialPercentage / 100) * pages.length))
      : 0;
  return (
    <PagedPane
      pages={pages}
      initialPage={initialPage}
      margin={margin}
      textStyle={textStyle}
      prefs={prefs}
      onProgress={onProgress}
    />
  );
}

/** 分页式 TXT：单页渲染 + 点击分区 / 横滑手势翻页 */
function PagedPane({
  pages,
  initialPage,
  margin,
  textStyle,
  prefs,
  onProgress,
}: {
  pages: string[];
  initialPage: number;
  margin: number;
  textStyle: { fontSize: number; lineHeight: number; color: string };
  prefs: ReadingPrefs;
  onProgress: (page: number, total: number) => void;
}) {
  const [idx, setIdx] = useState(initialPage);
  const [width, setWidth] = useState(0);
  const lastReportedRef = useRef(initialPage);

  // 页变化才报进度（防抖在父组件）
  useEffect(() => {
    if (idx !== lastReportedRef.current) {
      lastReportedRef.current = idx;
      onProgress(idx + 1, pages.length);
    }
  }, [idx, pages.length, onProgress]);

  const navigate = useCallback(
    (dir: 'prev' | 'next') => {
      setIdx((i) =>
        dir === 'next' ? Math.min(pages.length - 1, i + 1) : Math.max(0, i - 1),
      );
    },
    [pages.length],
  );

  /** 横滑判定：与 Web EpubViewer 逐字一致 —— (dx > 0) === (方向为 left-next) 即下一页 */
  function onSwipeEnd(e: PanGestureHandlerStateChangeEvent) {
    if (e.nativeEvent.state !== State.END) return;
    const dx = e.nativeEvent.translationX;
    if (Math.abs(dx) > 50) {
      const isNext = (dx > 0) === (prefs.swipeDirection === 'left-next');
      navigate(isNext ? 'next' : 'prev');
    }
  }

  return (
    <View style={{ flex: 1 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {prefs.pageMode === 'tap' ? (
        // 点击翻页：整页可点，左右半区由 shared.tapZoneAction 统一判定
        <Pressable
          style={{ flex: 1, padding: margin }}
          onPress={(e) => {
            if (width <= 0) return;
            const action = tapZoneAction(
              e.nativeEvent.locationX,
              width,
              prefs.swipeDirection,
            );
            navigate(action);
          }}
        >
          <Text style={[textStyle, { maxWidth: 720, width: '100%' }]}>
            {pages[idx]}
          </Text>
          <Text
            style={{
              position: 'absolute',
              bottom: 12,
              right: 18,
              color: '#8a8072',
              fontSize: 11,
            }}
          >
            {idx + 1}/{pages.length}
          </Text>
        </Pressable>
      ) : (
        // 左右滑动：PanGestureHandler 判定 dx>50（横滑优先，竖滑不拦截）
        <PanGestureHandler
          onHandlerStateChange={onSwipeEnd}
          activeOffsetX={[-12, 12]}
          failOffsetY={[-16, 16]}
        >
          <View style={{ flex: 1, padding: margin }}>
            <Text style={[textStyle, { maxWidth: 720, width: '100%' }]}>
              {pages[idx]}
            </Text>
            <Text
              style={{
                position: 'absolute',
                bottom: 12,
                right: 18,
                color: '#8a8072',
                fontSize: 11,
              }}
            >
              {idx + 1}/{pages.length}
            </Text>
          </View>
        </PanGestureHandler>
      )}
    </View>
  );
}

// 上下滚动式的“页变化才报”守卫已并入 TxtPane 组件内 ref（lastTxtPageRef）
