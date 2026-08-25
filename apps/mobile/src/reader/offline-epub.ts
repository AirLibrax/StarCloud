/**
 * 离线 EPUB 阅读页生成。
 * epubjs / jszip（打包资产）内联进骨架页，WebView 加载后由 RN 分块推送
 * 书籍 base64 数据，epubjs 以 base64 编码模式直接解压（不走 XHR，无 data: URI 限制）。
 *
 * 翻页语义与 Web 端 EpubViewer 一致（消费 @starcloud/shared）：
 * - tap / swipe+horizontal / swipe+vertical+paged：页面对指针透明
 *   （.sc-no-pointer，同 Web .no-pointer），手势桥接 JS 在宿主 document 上
 *   判定原始手势（touchstart/touchend），postMessage 回 RN，
 *   由 RN 按 shared 模型判定语义并回注 __scNav() 执行翻页；
 * - swipe+vertical+continuous：flow=scrolled + manager=continuous
 *   （与 Web 相同的映射表），整章连成一条无缝滚动、滚到底自动接下一章，
 *   引擎原生滚动，无桥接。
 * 键盘通道不需要（纯触屏）。
 *
 * 单列/双列（与 Web EpubViewer 同源语义）：
 * - renderOptions.spread 动态化：RN 算好的 twoUp ∩ WebView 内横屏占优
 *   → 'always'，否则 'none'；minSpreadWidth 恒为 SPREAD_MIN_WIDTH（UI 门槛与
 *   引擎 divisor=2 判定阈值一致，防 768-799px 死按钮）；
 * - 旋转/偏好变化跨过门槛时，RN 回注 __scSpread() 让 rendition.spread() 原地重排
 *   （不重建 WebView）；原地重排抛错或未生效时上报 spread-failed，RN 侧退化为
 *   重建 WebView 并按注入的 spine 索引恢复位置（restoreIndex）；
 * - swipe+vertical 轴向（含 continuous）强制单列，不参与双列。
 */
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import type { PageMode, SwipeLayout, VerticalStyle } from '@starcloud/shared';

const vendorAssets = {
  jszip: require('../../assets/vendor/jszip.min.js.txt'),
  epub: require('../../assets/vendor/epub.min.js.txt'),
};

/** 桥接 JS 的手势触发阈值（px），与 Web 端 EpubViewer 的 SWIPE_THRESHOLD 一致 */
const BRIDGE_SWIPE_THRESHOLD = 50;

/** 双列生效的视口宽度门槛（逻辑像素），与 Web 端 EpubViewer 的 SPREAD_MIN_WIDTH 一致；
 *  同时作为 epubjs 的 minSpreadWidth：引擎内部 divisor=2 判定阈值必须与 UI 门槛一致，
 *  否则横屏 768-799px 会显示「双列」却渲染单列（死按钮） */
export const SPREAD_MIN_WIDTH = 768;

let vendorCache: { jszip: string; epub: string } | null = null;

/** 读取打包的渲染引擎源码（首次加载后缓存） */
async function loadVendorScripts(): Promise<{ jszip: string; epub: string }> {
  if (vendorCache) return vendorCache;
  const out: Record<string, string> = {};
  for (const [name, moduleId] of Object.entries(vendorAssets)) {
    const asset = Asset.fromModule(moduleId as number);
    await asset.downloadAsync();
    out[name] = await FileSystem.readAsStringAsync(asset.localUri ?? asset.uri);
  }
  vendorCache = { jszip: out.jszip, epub: out.epub };
  return vendorCache;
}

export interface OfflineReaderOptions {
  /** EPUB 文件的本地 file:// URI（由 RN 侧读取 base64 推送） */
  fileUri: string;
  initialPercentage: number;
  fontSizePct: number;
  lineHeight: number;
  /** 左右页边距（px），注入 body padding（与 Web 端容器 padding 对应） */
  marginPx: number;
  /** 翻页方式（shared.PageMode） */
  pageMode: PageMode;
  /** 滑动轴向（shared.SwipeLayout；仅 pageMode==='swipe' 时有意义） */
  swipeLayout: SwipeLayout;
  /** 上下滑动滚动样式（shared.VerticalStyle；仅 swipe+vertical 时有意义） */
  verticalStyle: VerticalStyle;
  /** 双列是否生效（RN 侧已按 偏好 ∩ 横屏≥768 && width>height ∩ 非竖向滚动 计算好） */
  twoUp: boolean;
  /** 可选：重建 WebView 时恢复到的 spine 章节索引（缺省按 initialPercentage 恢复） */
  restoreIndex?: number;
  /** 可选：EPUB 精确书签（CFI），优先于 restoreIndex 恢复 */
  restoreCfi?: string;
}

/**
 * 生成自包含阅读器骨架 HTML 字符串。
 * WebView 以 source={{ html }} 注入；书籍数据由 RN 在收到
 * `{ t: "need-book" }` 消息后分块注入（见 EpubPane）。
 * 手势桥接只上报原始手势（{t:'tap',x} / {t:'swipe',dx}），
 * 翻页语义判定统一在 RN 侧。
 */
export async function buildOfflineEpubHtml(
  opts: OfflineReaderOptions,
): Promise<string> {
  const { jszip, epub } = await loadVendorScripts();

  // 注意 </script> 会截断内联脚本，转义之
  const safeJszip = jszip.replace(/<\/script>/gi, '<\\/script>');
  const safeEpub = epub.replace(/<\/script>/gi, '<\\/script>');

  // 与 Web EpubViewer 相同的映射表（冻结规格二/五）：
  // tap / swipe+horizontal → paginated + default；
  // swipe+vertical+continuous → scrolled + continuous；
  // swipe+vertical+paged → paginated + default + axis='vertical'
  const isVertical = opts.pageMode === 'swipe' && opts.swipeLayout === 'vertical';
  const isVerticalPaged = isVertical && opts.verticalStyle === 'paged';
  const isVerticalContinuous = isVertical && !isVerticalPaged;
  // 需要手势桥接的模式（tap / swipe+horizontal / swipe+vertical+paged）：
  // 页面对指针透明，与 Web .no-pointer 同理；唯一例外是 vertical+continuous（原生滚动）
  const needsBridge = opts.pageMode === 'tap' || isVerticalPaged || (opts.pageMode === 'swipe' && opts.swipeLayout === 'horizontal');

  return `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<style>
html,body{height:100%}
body{margin:0;background:#fbf7ee;padding-left:${opts.marginPx}px;padding-right:${opts.marginPx}px}
#viewer{width:100%;height:100%}
${needsBridge ? '.sc-no-pointer #viewer,.sc-no-pointer #viewer iframe{pointer-events:none !important}' : ''}
</style>
</head><body${needsBridge ? ' class="sc-no-pointer"' : ''}><div id="viewer"></div>
<script>${safeJszip}</script>
<script>${safeEpub}</script>
<script>
window.onerror = function(msg, src, line) {
  /* 就绪后的未捕获错误多为引擎内部偶发抖动，降级为 nav-error 只记日志，
     避免非致命抖动把整个阅读页替换成错误视图；未就绪时的错误才是致命的（书打不开） */
  post({ t: window.__ready ? 'nav-error' : 'error', message: msg + " @" + line });
  return false;
};
window.__initialPct = ${opts.initialPercentage};
window.__fontPct = ${opts.fontSizePct};
window.__lineHeight = ${opts.lineHeight};
window.__pageMode = "${opts.pageMode}";
window.__swipeLayout = "${opts.swipeLayout}";
window.__verticalStyle = "${opts.verticalStyle}";
window.__twoUp = ${opts.twoUp};
window.__restoreIndex = ${opts.restoreIndex ?? -1};
window.__restoreCfi = ${JSON.stringify(opts.restoreCfi ?? null).replace(/</g, '\\u003c')};
function post(msg) { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }
window.__chunks = [];
window.__pushChunk = function(c) { window.__chunks.push(c); };
/* 书完全打开（display 完成）前置 true；此前翻页指令一律忽略。
   renderTo 返回即有 __rendition，但其内部 manager 视图未就绪时调
   next()/prev() 会在引擎内抛 reading 'next' 类竞态错误 */
window.__ready = false;
/* 翻页执行入口：由 RN 手势桥接消息驱动（postMessage → RN 判定 → 回注本函数） */
window.__scNav = function(d) {
  if (!window.__rendition || !window.__ready) return;
  try {
    if (d === 'next') window.__rendition.next(); else window.__rendition.prev();
  } catch (e) {
    /* 章节切换瞬间的偶发竞态：吞掉并上报，不让 WebView 白屏 */
    post({ t: 'nav-error', message: String(e && e.message || e) });
  }
};
/* 单双列热切换入口：RN 在旋转/偏好变化时回注（injectJavaScript），
   rendition.spread() 原地重排，不重建 WebView（与 Web EpubViewer 同路径）。
   书未打开时暂存 pending，__openBook 就绪后补应用；spread 抛错或未生效时
   上报 spread-failed，RN 侧退化为重建 WebView 并按 spine 索引恢复位置。 */
window.__lastSpread = null;
window.__pendingSpread = null;
window.__scSpread = function(mode) {
  window.__twoUp = mode === 'always';
  if (window.__lastSpread === mode) return;
  if (!window.__rendition) { window.__pendingSpread = mode; return; }
  try {
    window.__rendition.spread(mode, ${SPREAD_MIN_WIDTH});
    window.__lastSpread = mode;
    window.__pendingSpread = null;
    if (window.__rendition.settings && window.__rendition.settings.spread !== mode) {
      post({ t: 'spread-failed', message: 'spread not applied' });
    }
  } catch (e) {
    window.__pendingSpread = null;
    post({ t: 'spread-failed', message: String(e && e.message || e) });
  }
};
window.__openBook = function() {
  try {
    var b64 = window.__chunks.join('');
    var book = ePub(b64, { encoding: 'base64' });
    var isScroll = ${isVerticalContinuous ? 'true' : 'false'};
    var isPaged = ${isVerticalPaged ? 'true' : 'false'};
    // 双列 = RN 算好的 twoUp ∩ WebView 内横屏占优（双保险；引擎另有 minSpreadWidth 门槛，
    // 768 以下即使 'always' 也按 divisor=1 渲染单页，杜绝首帧闪变）
    var isLandscape = window.innerWidth > window.innerHeight;
    var spreadMode = (window.__twoUp && isLandscape) ? 'always' : 'none';
    window.__lastSpread = spreadMode;
    var renderOpts = {
      width: '100%', height: '100%',
      flow: isPaged ? 'paginated' : (isScroll ? 'scrolled' : 'paginated'),
      manager: isScroll ? 'continuous' : 'default',
      spread: spreadMode,
      minSpreadWidth: ${SPREAD_MIN_WIDTH}
    };
    // axis:'vertical' 单页翻动为 epubjs default manager 运行时原生能力
    // （与 Web EpubViewer 相同的映射表：仅 paged 注入 axis）
    if (isPaged) { renderOpts.axis = 'vertical'; }
    var rendition = book.renderTo('viewer', renderOpts);
    window.__rendition = rendition;
    rendition.themes.register('paper', {
      body: {
        background: '#fbf7ee',
        'line-height': window.__lineHeight + ' !important',
        // 禁止文本选择：快速点击翻页不会被误识别为双击选中
        'user-select': 'none !important',
        '-webkit-user-select': 'none !important',
        '-webkit-touch-callout': 'none !important'
      },
      p: { 'line-height': window.__lineHeight + ' !important', margin: '0.25em 0 !important' }
    });
    rendition.themes.select('paper');
    rendition.themes.fontSize(window.__fontPct + '%');
    // 手势桥接：只上报原始手势，语义由 RN 按 shared 模型判定
    // （iframes 内事件不冒泡到宿主页；指针透明后触摸落在宿主 document 上）
    // 主轴分派：swipe 模式下 |dy|>|dx| 走纵向（恒定上推=下一页/下拉=上一页）；
    // |dx|>|dy| 走横向（RN 侧按方向偏好判定）；tap 模式仅点击，无纵向手势
    var isSwipeMode = window.__pageMode === 'swipe';
    var isVPaged = isSwipeMode && window.__swipeLayout === 'vertical' && window.__verticalStyle === 'paged';
    var tsX = null, tsY = null;
    document.addEventListener('touchstart', function(e) {
      if (e.touches.length === 1) { tsX = e.touches[0].clientX; tsY = e.touches[0].clientY; }
    }, { passive: true });
    document.addEventListener('touchend', function(e) {
      if (tsX === null) return;
      var cx = e.changedTouches[0].clientX;
      var cy = e.changedTouches[0].clientY;
      var dx = cx - tsX;
      var dy = cy - tsY;
      tsX = null; tsY = null;
      var mainVertical = Math.abs(dy) > Math.abs(dx);
      if (isSwipeMode && mainVertical && Math.abs(dy) > ${BRIDGE_SWIPE_THRESHOLD}) {
        // 纵向位移（Horizontal 的恒定纵向手势 / Vertical Paged 的主手势）
        post({ t: 'vswipe', dy: dy });
      } else if (isSwipeMode && !isVPaged && !mainVertical && Math.abs(dx) > ${BRIDGE_SWIPE_THRESHOLD}) {
        post({ t: 'swipe', dx: dx });
      } else if (window.__pageMode === 'tap' && Math.abs(dx) < ${BRIDGE_SWIPE_THRESHOLD} && Math.abs(dy) < ${BRIDGE_SWIPE_THRESHOLD}) {
        post({ t: 'tap', x: cx });
      }
    }, { passive: true });
    // 章节或 CFI 变化才报进度（防抖在 RN 侧）
    var lastIdx = -1;
    var lastCfi = null;
    var locationsStarted = false;
    rendition.on('relocated', function(loc) {
      var total = book.spine.items.length;
      var idx = loc.start ? loc.start.index : 0;
      var cfi = loc.start ? (loc.start.cfi || null) : null;
      var displayed = loc.start ? loc.start.displayed : null;
      var rawPct = loc.start ? loc.start.percentage : null;
      /* 仅接受有效正数：epubjs 未生成 locations 时 start.percentage 可能为 0，
         若照收会把真实进度覆盖成 0%（null 时后端回退章节粒度计算） */
      var pct = typeof rawPct === 'number' && rawPct > 0
        ? Math.min(100, Math.round((rawPct > 1 ? rawPct : rawPct * 100) * 10) / 10)
        : null;
      if (idx === lastIdx && cfi === lastCfi) return;
      lastIdx = idx;
      lastCfi = cfi;
      post({
        t: 'progress',
        page: idx + 1,
        total: total,
        cfi: cfi,
        percentage: pct,
        displayed: displayed && displayed.page ? { page: displayed.page, total: displayed.total } : null
      });
      if (!locationsStarted && book.locations) {
        locationsStarted = true;
        setTimeout(function() {
          try {
            book.locations.generate(1024)['catch'](function(e) {
              post({ t: 'nav-error', message: 'locations generate failed: ' + String(e && e.message || e) });
            });
          } catch (e) {
            post({ t: 'nav-error', message: 'locations generate failed: ' + String(e && e.message || e) });
          }
        }, 0);
      }
    });
    book.ready.then(function() {
      var t = book.spine.items.length;
      if (window.__restoreCfi) {
        var fallbackIdx = window.__restoreIndex >= 0
          ? Math.min(window.__restoreIndex, t - 1)
          : Math.min(t - 1, Math.floor(window.__initialPct / 100 * t));
        return rendition.display(window.__restoreCfi).then(function(loc) {
          /* 二次校准：首次 display 后主题注入/字号重排会打乱 paginated 偏移，
             视觉上停在目标位置前一屏（上一章末尾）；重放同一 CFI 修正 */
          return rendition.display(window.__restoreCfi).catch(function(e) {
            post({ t: 'nav-error', message: 'second-pass calibrate failed: ' + String(e && e.message || e) });
            return loc;
          });
        }).catch(function(e) {
          post({ t: 'nav-error', message: 'restore cfi failed: ' + String(e && e.message || e) });
          return rendition.display(fallbackIdx > 0 ? fallbackIdx : 0);
        });
      }
      var start = window.__restoreIndex >= 0
        ? Math.min(window.__restoreIndex, t - 1)
        : Math.min(t - 1, Math.floor(window.__initialPct / 100 * t));
      return rendition.display(start > 0 ? start : 0);
    }).then(function() {
      // 加载期收到的热切换请求补应用（__scSpread 内部与已生效模式去重）
      if (window.__pendingSpread) {
        var p = window.__pendingSpread;
        window.__pendingSpread = null;
        window.__scSpread(p);
      }
      window.__ready = true;
      post({ t: 'ready' });
    }).catch(function(e) { post({ t: 'error', message: String(e && e.message || e) }); });
  } catch (err) {
    post({ t: 'error', message: String(err && err.message || err) });
  }
};
post({ t: 'need-book' });
</script></body></html>`;
}
