/**
 * 离线 EPUB 阅读页生成。
 * epubjs / jszip（打包资产）内联进骨架页，WebView 加载后由 RN 分块推送
 * 书籍 base64 数据，epubjs 以 base64 编码模式直接解压（不走 XHR，无 data: URI 限制）。
 */
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import type { PageMode } from '@starcloud/shared';

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
  /** 翻页方式（shared.PageMode） */
  pageMode: PageMode;
  /** 方向偏好 */
  direction: 'left-next' | 'right-next';
}

/**
 * 生成自包含阅读器骨架 HTML 字符串。
 * WebView 以 source={{ html }} 注入；书籍数据由 RN 在收到
 * `{ t: "need-book" }` 消息后分块注入（见 EpubPane）。
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

  return `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<style>body{margin:0;background:#fbf7ee}#viewer{width:100vw;height:100vh}</style>
</head><body><div id="viewer"></div>
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
window.__dirLeftNext = ${opts.direction === 'left-next'};
function post(msg) { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }
window.__chunks = [];
window.__pushChunk = function(c) { window.__chunks.push(c); };
window.__openBook = function() {
  try {
    var b64 = window.__chunks.join('');
    var book = ePub(b64, { encoding: 'base64' });
    var isScroll = window.__pageMode === 'scroll-vertical';
    var rendition = book.renderTo('viewer', {
      width: '100%', height: '100%',
      flow: isScroll ? 'scrolled' : 'paginated',
      manager: isScroll ? 'continuous' : 'default',
      spread: 'none'
    });
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
    // 滑动翻页（方向可由 RN 侧动态修改 __swipeLeftNext）
    var tsX = null, tsY = null;
    document.addEventListener('touchstart', function(e) {
      if (e.touches.length === 1) { tsX = e.touches[0].clientX; tsY = e.touches[0].clientY; }
    }, { passive: true });
    document.addEventListener('touchend', function(e) {
      if (tsX === null) return;
      var dx = e.changedTouches[0].clientX - tsX;
      var dy = e.changedTouches[0].clientY - tsY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        // 「向左下一页」= 手指从左向右滑为下一页；「向右下一页」反之
        var isNext = (dx > 0) === window.__dirLeftNext;
        if (isNext) rendition.next(); else rendition.prev();
      }
      tsX = null;
    }, { passive: true });
    rendition.on('relocated', function(loc) {
      var total = book.spine.items.length;
      var idx = loc.start ? loc.start.index : 0;
      var pct = total > 0 ? Math.round(((idx + 1) / total) * 1000) / 10 : 0;
      post({ t: 'progress', page: idx + 1, total: total, pct: pct });
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
