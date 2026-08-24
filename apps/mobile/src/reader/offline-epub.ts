/**
 * 离线 EPUB 阅读页生成。
 * 把 epubjs / jszip（打包资产）与书籍 base64 组装成一个自包含 HTML，
 * WebView 以 file:// 加载，全程零网络依赖。
 */
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

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
  /** EPUB 文件的本地 file:// URI */
  fileUri: string;
  initialPercentage: number;
  fontSizePct: number;
  lineHeight: number;
}

/**
 * 生成自包含阅读器 HTML 并写入缓存目录，返回可交给 WebView 的 file:// 地址。
 * 每本书一个稳定文件名，排版参数变化时重写。
 */
export async function buildOfflineEpubHtml(
  bookId: string,
  opts: OfflineReaderOptions,
): Promise<string> {
  const [{ jszip, epub }, base64] = await Promise.all([
    loadVendorScripts(),
    FileSystem.readAsStringAsync(opts.fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    }),
  ]);

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
window.__bookDataUri = "data:application/epub+zip;base64,${base64}";
window.__initialPct = ${opts.initialPercentage};
window.__fontPct = ${opts.fontSizePct};
window.__lineHeight = ${opts.lineHeight};
</script>
<script>(function(){
try {
  var book = ePub(window.__bookDataUri);
  var rendition = book.renderTo("viewer", { width: "100%", height: "100%", spread: "none" });
  rendition.themes.register("paper", {
    body: { background: "#fbf7ee", "line-height": window.__lineHeight + " !important" },
    p: { "line-height": window.__lineHeight + " !important", margin: "0.25em 0 !important" }
  });
  rendition.themes.select("paper");
  rendition.themes.fontSize(window.__fontPct + "%");
  var reportedLast = -1;
  rendition.on("relocated", function(loc) {
    var total = book.spine.items.length;
    var idx = loc.start ? loc.start.index : 0;
    if (idx === reportedLast) return;
    reportedLast = idx;
    var pct = total > 0 ? Math.round(((idx + 1) / total) * 1000) / 10 : 0;
    window.ReactNativeWebView.postMessage(JSON.stringify({ t: "progress", page: idx + 1, total: total, pct: pct }));
  });
  book.ready.then(function() {
    var t = book.spine.items.length;
    var start = Math.min(t - 1, Math.floor(window.__initialPct / 100 * t));
    return rendition.display(start > 0 ? start : 0);
  }).then(function() {
    window.ReactNativeWebView.postMessage(JSON.stringify({ t: "ready" }));
  });
  document.addEventListener("keydown", function(e) {
    if (e.key === "ArrowLeft") rendition.prev();
    if (e.key === "ArrowRight") rendition.next();
  });
} catch (err) {
  window.ReactNativeWebView.postMessage(JSON.stringify({ t: "error", message: String(err && err.message || err) }));
}
})();</script></body></html>`;
}

/** 排版变化时返回新的完整阅读页（WebView 重新加载生效） */
export async function buildOfflineEpubHtmlRestyled(
  bookKey: string,
  opts: OfflineReaderOptions,
): Promise<string> {
  return buildOfflineEpubHtml(bookKey, opts);
}
