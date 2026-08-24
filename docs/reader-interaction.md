# 阅读器交互规格（实现依据）

> 本文档描述 apps/reader 与 apps/mobile 阅读器的已实现行为。
> 修改交互前先改本文档。技术细节以 epubjs 源码为准
> （node_modules/epubjs/src/，关键文件：rendition.js / managers/default/index.js /
> layout.js / contents.js / utils/constants.js）。

## 翻页方式（二选一，PageMode）

### tap 点击翻页

- 屏幕左右两半分区，含义随「翻页方向」偏好镜像；
- 实现：书页容器加 `.no-pointer`（iframe pointer-events:none），
  所有点击落在阅读器外层容器，由 `tapZoneAction()` 统一判定
  （shared/reading.ts）；点击同时把焦点拉回外层，
  保证后续按键走外层 keydown 通道；
- epubjs 本身没有内置的点击分区翻页（0.3.93 源码核实：
  click/touch 监听仅用于内容链接与标注），指针透明后更不存在双重触发。

### swipe 滑动翻页

子选项按设备能力显示：

| 设备 | 可用形态 |
|------|----------|
| 触屏（pointer: coarse） | 左右滑动 / 上下滑动 |
| 鼠标桌面 | 固定为上下无缝滚动（滚轮阅读），无子选项 |

- 左右滑动：paginated flow，触摸滑动方向随「翻页方向」偏好镜像；
- 上下滑动：flow=scrolled + manager=default（Web 与 App 当前实现一致），
  章内连续滚动；章末即止，跨章需翻章动作（Web 键盘 ↓/→ 等；
  App 纯触屏暂无跨章手势，EPUB 竖滑到章末即停）；
  跨章自动衔接需 manager=continuous（早期实现曾用，后回退为 default，
  见 git 历史 ec05a55b / fd361c7d）；
  paged 单页翻动（flow=paginated + axis=vertical，epubjs 运行时能力，
  官方类型缺失需断言）为规格预留，当前两端均未接入。

## 键盘（PC）

- 下箭头 = 下一页，上箭头 = 上一页（恒定，不随方向偏好）；
- 左右箭头含义随「翻页方向」偏好；
- 监听通道有两条（都挂 keydown）：
  1. window keydown —— 焦点在外层页面时生效；
  2. 书页 iframe document 上的 keydown（经 applyDocHandlers 注入）——
     焦点在书页内时生效。
  注意：epubjs 对 keydown/keyup 均有转发（utils/constants.js DOM_EVENTS），
  不要轻信「只转发某一种」的说法；两条通道并存互不重复
  （同一按键只会在一条通路上触发）。

## 手势与事件的架构约定

书页内容渲染在 iframe 内部，**iframe 内产生的事件不会冒泡到外层页面**。
因此所有交互监听只有两种正确做法：

1. 通过 `rendition.on(eventName)` 由 epubjs 代理（其转发表见
   utils/constants.js 的 DOM_EVENTS：keydown / keyup / click /
   touchstart / touchend 等）；
2. 通过 `applyDocHandlers` 直接在 iframe 的 document 上 addEventListener
   （handler 运行于父页面作用域，可直接调用组件方法）。

禁止把 touch/click 监听挂在外层容器元素上指望收到书页内的事件——
那是无效通道（tap 模式下书页 pe:none 时除外，此时事件本来就落在外层）。

## 持久化规则

### 阅读偏好（三端一致，档位常量同源 shared）

Web 端逐项存 `localStorage`，App 端聚合存 AsyncStorage 单键 JSON，
字段含义与默认值两侧一致（默认：100% 字号 / 1.6 行距 / 中边距 /
tap / horizontal / continuous / left-next）。

| Web localStorage 键 | 值 | App readingPrefs 字段 | 默认 |
|---------------------|-----|------------------------|------|
| `starcloud.fontStep` | FONT_STEPS 索引 | `fontStep` | 2（100%） |
| `starcloud.lineHeight` | LINE_HEIGHTS 索引 | `lineHeightIdx` | 1（1.6） |
| `starcloud.margin` | MARGINS 索引 | `marginIdx` | 1（中） |
| `starcloud.pageMode` | `'tap' \| 'swipe'` | `pageMode` | `'tap'` |
| `starcloud.swipeLayout` | `'horizontal' \| 'vertical'` | `swipeLayout` | `'horizontal'` |
| `starcloud.verticalStyle` | `'continuous' \| 'paged'` | `verticalStyle` | `'continuous'` |
| `starcloud.swipeDirection` | `'left-next' \| 'right-next'` | `swipeDirection` | `'left-next'` |
| `starcloud.spreadTwoUp` | `'two-up' \| 'single'` | （App 无，暂无双列） | 双列（视口 >900px 生效） |

App 端其余 AsyncStorage 键：`starcloud.settings`（服务器地址/令牌/用户名）、
`starcloud.localBooks`（本地书库与本地进度）。

### 阅读进度

- 上报触发：**章节变化才报** —— EPUB 以 spine index 变化为准
  （连续滚动模式下 relocated 高频触发，按章节去重）；
  TXT 以估算页码变化为准；
- 防抖 **3s**（两端一致），失败静默不打断阅读；
- Web：仅上报服务器 `POST /api/progress`，无本地进度存储；
- App：云端书上报服务器；本地书写入 `starcloud.localBooks` 内联 progress；
  云端下载书（cloudBookId）本地与服务器双写。

## 单列 / 双列（spread）

- 双列仅在「视口宽度 >900px（平板横屏 / 桌面）且用户开启双列偏好」时
  spread='always'，其余一律 'none'（手机窄屏强制单列）；
- 窗口/设备方向跨过 900px 门槛时自动切换 spread，并按当前章节 CFI
  重排防截断；容器尺寸变化调用 rendition.resize()（引擎自带 50ms 节流的
  window resize 监听，容器级变化由 ResizeObserver 兜底）；
- 单/双列切换按钮仅在视口 >900px 时显示（≤900px 无按钮）；
- 偏好持久化：`starcloud.spreadTwoUp`（'two-up' | 'single'），
  默认双列；App 端暂无单列/双列排版（mobile-spec F4 待办）。

## 三端一致

- 交互语义（翻页方式 / 轴向 / 方向 / 点击分区）统一消费
  @starcloud/shared 的 reading.ts，三端不得另行硬编码档位或区域规则；
- App 端 EPUB 为 WebView 内嵌 epubjs 离线渲染（offline-epub.ts），
  渲染参数映射表与 Web EpubViewer 相同：
  tap / swipe+horizontal → flow=paginated + manager=default；
  swipe+vertical → flow=scrolled + manager=default；
  手势桥接 JS 只上报原始手势（tap 坐标 / 横滑 dx），语义判定在 RN 侧，
  翻页经 __scNav 回注页面执行；键盘通道仅 Web 有（App 纯触屏）；
- App 端 TXT 原生渲染（ReaderScreen TxtPane）：
  tap 点击分区用 shared.tapZoneAction；swipe+horizontal 用
  PanGestureHandler 判定 |dx|>50 且 (dx>0)===(方向为 left-next)；
  swipe+vertical 为 ScrollView 无缝滚动；方向公式与 Web 逐字一致。

## 性能

- manager=default 单章管理，跨章首次翻页有数百毫秒加载延迟（固有行为）；
- relocated 回调中的 setState 已尽量精简；字号/行距热应用通过
  getContents() 直写文档样式，不触发 React 重渲染。
