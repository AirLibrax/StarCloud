/**
 * EPUB 元数据解析：从 zip 包中提取封面图、书名、作者，
 * 以及从文件名/标题识别卷数。
 */
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';

export interface EpubMeta {
  title: string | null;
  author: string | null;
  coverBinary: Buffer | null;
  coverExt: string | null; // 如 '.jpg' / '.png'
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

/** 判定 href 是否为浏览器可直接显示的图片 */
function isImageHref(href: string): boolean {
  return /\.(jpe?g|png|gif|webp|svg)$/i.test(href);
}

/** 从 OPF manifest/meta 定位封面资源的 href（仅限图片） */
function findCoverHref(opfContent: string): string | null {
  const opf = xmlParser.parse(opfContent);
  const pkg = opf?.package;
  if (!pkg) return null;

  const manifest = pkg.manifest;
  const items: any[] = normalize(manifest?.item);

  // 路径1: properties 含 cover-image（EPUB3 标准写法）。
  // 有些书指向包装页（xhtml）而非图片本身，此时继续往下找真正的图片
  const byProps = items.find(
    (it) =>
      String(it?.['@_properties'] ?? '')
        .split(/\s+/)
        .includes('cover-image') && isImageHref(String(it?.['@_href'] ?? '')),
  );
  if (byProps) return byProps['@_href'];

  // 路径2: meta name="cover" content=<manifest id>（EPUB2 常见写法）
  const metas: any[] = normalize(pkg.meta);
  const coverMeta = metas.find((m) => m?.['@_name'] === 'cover');
  if (coverMeta) {
    const byId = items.find(
      (it) => it?.['@_id'] === coverMeta['@_content'] && isImageHref(String(it?.['@_href'] ?? '')),
    );
    if (byId) return byId['@_href'];
  }

  // 路径3: 兜底，找文件名带 cover 的图片
  const byName = items.find(
    (it) => isImageHref(String(it?.['@_href'] ?? '')) && /cover/i.test(String(it?.['@_href'] ?? '')),
  );
  if (byName) return byName['@_href'];

  // 路径4: 最后兜底，取 manifest 里第一张图片（通常就是封面）
  const anyImage = items.find((it) => isImageHref(String(it?.['@_href'] ?? '')));
  return anyImage ? anyImage['@_href'] : null;
}

function normalize(v: any): any[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export function parseEpubMeta(zipBuffer: Buffer): EpubMeta {
  const result: EpubMeta = { title: null, author: null, coverBinary: null, coverExt: null };

  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    return result; // 不是合法 zip，交给上层报错
  }

  // container.xml 指向 OPF 的位置
  const containerEntry = zip.getEntry('META-INF/container.xml');
  if (!containerEntry) return result;

  let opfPath: string | null = null;
  try {
    const container = xmlParser.parse(containerEntry.getData().toString('utf8'));
    const rootfiles = normalize(
      container?.container?.rootfiles?.rootfile,
    );
    opfPath =
      rootfiles.find((r) => r?.['@_media-type'] === 'application/oebps-package+xml')
        ?.['@_full-path'] ??
      rootfiles[0]?.['@_full-path'] ??
      null;
  } catch {
    return result;
  }
  if (!opfPath) return result;

  const opfEntry = zip.getEntry(opfPath);
  if (!opfEntry) return result;

  const opfContent = opfEntry.getData().toString('utf8');

  // 内嵌书名与作者
  try {
    const opf = xmlParser.parse(opfContent);
    const titles = normalize(opf?.package?.metadata?.['dc:title']);
    const creators = normalize(opf?.package?.metadata?.['dc:creator']);
    const firstText = (arr: any[]) =>
      typeof arr[0] === 'object' ? (arr[0]?.['#text'] ?? null) : (arr[0] ?? null);
    result.title = firstText(titles);
    result.author = firstText(creators);
  } catch {
    // 元数据缺失不致命
  }

  // 封面图
  const coverHref = findCoverHref(opfContent);
  if (coverHref) {
    // OPF 内的 href 是相对 OPF 所在目录的路径
    const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const fullHref = decodeURIComponent(baseDir + coverHref);
    const entry =
      zip.getEntry(fullHref) ??
      zip.getEntry(fullHref.replace(/^\//, '')) ??
      zip
        .getEntries()
        .find((e) => e.entryName.toLowerCase().endsWith(fullHref.toLowerCase()));
    if (entry) {
      result.coverBinary = entry.getData();
      const m = /\.([a-z0-9]+)$/i.exec(entry.entryName);
      result.coverExt = m ? `.${m[1].toLowerCase()}` : '.jpg';
    }
  }

  return result;
}

const NUMERAL_MAP: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 中文数字转数值，支持「十」「十二」「二十」等简单组合 */
function cnToNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (/^[一二三四五六七八九十]+$/.test(s)) {
    if (s === '十') return 10;
    const tenIdx = s.indexOf('十');
    if (tenIdx === -1) return NUMERAL_MAP[s] ?? null;
    const tens = tenIdx > 0 ? NUMERAL_MAP[s[0]] : 1;
    const ones = tenIdx < s.length - 1 ? NUMERAL_MAP[s[s.length - 1]] : 0;
    return tens * 10 + ones;
  }
  return null;
}

/**
 * 从文件名或标题解析「标题 + 卷数」。
 * 支持常见命名：「XX 第01卷」「XX 卷2」「XX 03」「XX Vol.2」「XX (3)」「第X巻」等。
 */
export function splitTitleVolume(raw: string): { title: string; volume: number | null } {
  const s = raw.replace(/\.(epub|pdf|txt)$/i, '').trim();

  const patterns: RegExp[] = [
    /\s*[(【]\s*(?:vol\.?|volume)?\s*(\d+(?:\.\d+)?|[一二三四五六七八九十]+)\s*[)】\]]\s*/i,
    /\s+(?:vol\.?|volume)\s*(\d+(?:\.\d+)?)\s*/i,
    /\s*第\s*(\d+(?:\.\d+)?|[一二三四五六七八九十]+)\s*[卷話话巻册]\s*/,
    /\s+[卷巻]\s*(\d+(?:\.\d+)?)\s*/i,
    /\s+(\d{1,4}(?:\.\d+)?)\s*$/, // 结尾裸数字
  ];

  for (const re of patterns) {
    const m = re.exec(s);
    if (m) {
      const vol = cnToNumber(m[1]);
      if (vol !== null && vol > 0) {
        const title = s.replace(re, '').trim();
        if (title) return { title, volume: vol };
      }
    }
  }
  return { title: s, volume: null };
}
