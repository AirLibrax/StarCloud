import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Dimensions, StatusBar } from 'react-native';
import Slider from '@react-native-community/slider';
import { WebView } from 'react-native-webview';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../App';
import { colors } from '../theme';
import { fileUrl, reportProgress } from '../api/client';
import { ensureCachedFile } from '../api/file-cache';
import { saveLocalProgress, listLocalBooks } from '../storage/local-books';
import {
  getReadingPrefs,
  updateReadingPrefs,
  FONT_STEPS,
  LINE_HEIGHTS,
  MARGINS,
  type ReadingPrefs,
} from '../storage/reading-prefs';

import { buildOfflineEpubHtml, updateOfflineEpubStyle } from '../reader/offline-epub';

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
              marginTop: 10,
              backgroundColor: colors.card,
              borderRadius: 8,
              borderWidth: 0.5,
              borderColor: colors.border,
              padding: 14,
              gap: 16,
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
              label="行距"
              value={`${LINE_HEIGHTS[prefs.lineHeightIdx]} 倍`}
              max={LINE_HEIGHTS.length - 1}
              valueIdx={prefs.lineHeightIdx}
              onChange={(v) => patchPrefs({ lineHeightIdx: v })}
            />
            <SettingSlider
              label="边距"
              value={`${MARGINS[prefs.marginIdx]}px`}
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
                  label="分页式"
                  active={prefs.pageMode === 'paged'}
                  onPress={() => patchPrefs({ pageMode: 'paged' })}
                />
                <SegmentBtn
                  label="滚动式"
                  active={prefs.pageMode === 'scrolled'}
                  onPress={() => patchPrefs({ pageMode: 'scrolled' })}
                />
              </View>
            </View>

            {prefs.pageMode === 'paged' && fileType !== 'epub' && (
              <View>
                <Text style={{ color: colors.textLight, fontSize: 13, marginBottom: 6 }}>
                  翻页轴向
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <SegmentBtn
                    label="左右翻页"
                    active={prefs.pageAxis === 'horizontal'}
                    onPress={() => patchPrefs({ pageAxis: 'horizontal' })}
                  />
                  <SegmentBtn
                    label="上下翻页"
                    active={prefs.pageAxis === 'vertical'}
                    onPress={() => patchPrefs({ pageAxis: 'vertical' })}
                  />
                </View>
                {prefs.pageAxis === 'horizontal' && (
                  <View style={{ marginTop: 10 }}>
                    <Text style={{ color: colors.textLight, fontSize: 13, marginBottom: 6 }}>
                      滑动方向
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <SegmentBtn
                        label="向左滑下一页"
                        active={prefs.swipeDirection === 'left-next'}
                        onPress={() => patchPrefs({ swipeDirection: 'left-next' })}
                      />
                      <SegmentBtn
                        label="向右滑下一页"
                        active={prefs.swipeDirection === 'right-next'}
                        onPress={() => patchPrefs({ swipeDirection: 'right-next' })}
                      />
                    </View>
                  </View>
                )}
              </View>
            )}

            {fileType === 'epub' && (
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                EPUB 由渲染引擎处理滑动与点击翻页。
              </Text>
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
      prefs={{ fontStep: prefs.fontStep, lineHeightIdx: prefs.lineHeightIdx }}
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
  prefs: { fontStep: number; lineHeightIdx: number };
  onProgress: (page: number, total: number) => void;
}) {
  const [htmlUri, setHtmlUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // 组装自包含阅读页 HTML
  useEffect(() => {
    let cancelled = false;
    setHtmlUri(null);
    (async () => {
      try {
        const uri = await buildOfflineEpubHtml(bookKey, {
          fileUri,
          initialPercentage,
          fontSizePct: FONT_STEPS[prefs.fontStep],
          lineHeight: LINE_HEIGHTS[prefs.lineHeightIdx],
        });
        if (!cancelled) setHtmlUri(uri);
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

  // 排版变化：更新样式并重载 WebView
  const styleKey = `${prefs.fontStep}-${prefs.lineHeightIdx}`;
  const firstStyle = useRef(true);
  useEffect(() => {
    if (firstStyle.current) {
      firstStyle.current = false;
      return;
    }
    updateOfflineEpubStyle(
      bookKey,
      FONT_STEPS[prefs.fontStep],
      LINE_HEIGHTS[prefs.lineHeightIdx],
    )
      .then(() => setReloadTick((t) => t + 1))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleKey]);

  function onMessage(e: any) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.t === 'progress') onProgress(msg.page, msg.total);
      if (msg.t === 'error') setError(msg.message);
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

  if (!htmlUri)
    return (
      <View style={{ flex: 1, alignItems: 'center', paddingTop: 60 }}>
        <Text style={{ color: '#6b6158' }}>正在准备渲染引擎…</Text>
      </View>
    );

  return (
    <WebView
      key={reloadTick}
      source={{ uri: htmlUri }}
      onMessage={onMessage}
      originWhitelist={['*']}
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
