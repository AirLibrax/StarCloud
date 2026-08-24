/**
 * 离线 EPUB 阅读页生成。
 * epubjs / jszip（打包资产）内联进骨架页，WebView 加载后由 RN 分块推送
 * 书籍 base64 数据，epubjs 以 base64 编码模式直接解压（不走 XHR，无 data: URI 限制）。
 *
 * 翻页语义与 Web 端 EpubViewer 一致（消费 @starcloud/shared）：
 * - tap / swipe+horizontal：页面对指针透明（.sc-no-pointer，同 Web .no-pointer），
 *   手势桥接 JS 在宿主 document 上判定原始手势（touchstart/touchend），
 *   postMessage 回 RN，由 RN 按 shared 模型判定语义并回注 __scNav() 执行翻页；
 * - swipe+vertical：flow=scrolled + manager=continuous（与 Web 相同的映射表），
 *   整章连成一条无缝滚动、滚到底自动接下一章，引擎原生滚动，无桥接。
 * 键盘通道不需要（纯触屏）。
 */
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import type { PageMode, SwipeLayout } from '@starcloud/shared';

const vendorAssets = {
  jszip: require('../../assets/vendor/jszip.min.js.txt'),
  epub: require('../../assets/vendor/epub.min.js.txt'),
};

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
}

/**
 * 生成自包含阅读器骨架 HTML 字符串。
 * WebView 以 source={{ html }} 注入；书籍数据由 RN 在收到
 * `{ t: "need-book" }` 消息后分块注入（见 EpubPane）。
 * 手势桥接只上报原始手势（{t:'tap',x} / {t:'swipe',dx}），
 * 翻页语义判定统一在 RN 侧。
 */
export async function buildOfflineEpubHtml(
  bookKey: string,
  opts: OfflineReaderOptions,
): Promise<string> {
  void bookKey;
  const { jszip, epub } = await loadVendorScripts();

  // 注意 </script> 会截断内联脚本，转义之
  const safeJszip = jszip.replace(/<\/script>/gi, '<\\/script>');
  const safeEpub = epub.replace(/<\/script>/gi, '<\\/script>');

  // 与 Web EpubViewer 相同的映射表（冻结规格二/五）：
  // tap / swipe+horizontal → paginated + default；swipe+vertical → scrolled + continuous
  const isVerticalScroll = opts.pageMode === 'swipe' && opts.swipeLayout === 'vertical';
  // 需要手势桥接的模式（tap / swipe+horizontal）：页面对指针透明，与 Web .no-pointer 同理
  const needsBridge = !isVerticalScroll;

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
  window.ReactNativeWebView.postMessage(JSON.stringify({ t: "error", message: msg + " @" + line }));
  return false;
};
window.__initialPct = ${opts.initialPercentage};
window.__fontPct = ${opts.fontSizePct};
window.__lineHeight = ${opts.lineHeight};
window.__pageMode = "${opts.pageMode}";
window.__swipeLayout = "${opts.swipeLayout}";
function post(msg) { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }
window.__chunks = [];
window.__pushChunk = function(c) { window.__chunks.push(c); };
/* 翻页执行入口：由 RN 手势桥接消息驱动（postMessage → RN 判定 → 回注本函数） */
window.__scNav = function(d) {
  if (!window.__rendition) return;
  if (d === 'next') window.__rendition.next(); else window.__rendition.prev();
};
window.__openBook = function() {
  try {
    var b64 = window.__chunks.join('');
    var book = ePub(b64, { encoding: 'base64' });
    var isScroll = ${isVerticalScroll ? 'true' : 'false'};
    var rendition = book.renderTo('viewer', {
      width: '100%', height: '100%',
      flow: isScroll ? 'scrolled' : 'paginated',
      manager: isScroll ? 'continuous' : 'default',
      spread: 'none'
    });
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
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        post({ t: 'swipe', dx: dx });
      } else if (window.__pageMode === 'tap') {
        post({ t: 'tap', x: cx });
      }
    }, { passive: true });
    // 章节变化才报进度（防抖在 RN 侧）
    var lastIdx = -1;
    rendition.on('relocated', function(loc) {
      var total = book.spine.items.length;
      var idx = loc.start ? loc.start.index : 0;
      if (idx === lastIdx) return;
      lastIdx = idx;
      post({ t: 'progress', page: idx + 1, total: total });
    });
    book.ready.then(function() {
      var t = book.spine.items.length;
      var start = Math.min(t - 1, Math.floor(window.__initialPct / 100 * t));
      return rendition.display(start > 0 ? start : 0);
    }).then(function() {
      post({ t: 'ready' });
    }).catch(function(e) { post({ t: 'error', message: String(e && e.message || e) }); });
  } catch (err) {
    post({ t: 'error', message: String(err && err.message || err) });
  }
};
post({ t: 'need-book' });
</script></body></html>`;
}
