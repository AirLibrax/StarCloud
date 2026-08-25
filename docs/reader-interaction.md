# 阅读器交互规格（最终版 · 全端冻结）

> 本文档是 apps/reader 与 apps/mobile 阅读器的**唯一行为依据**。
> 修改交互前先改本文档。技术细节以 epubjs 源码为准
> （node_modules/epubjs/src/，关键文件：rendition.js / managers/default/index.js /
> layout.js / contents.js / utils/constants.js）。

## 一、设置面板结构（所有端统一的条目顺序）

1. 字号 —— 8 档滑块（FONT_STEPS，默认 100%），热应用即时生效
2. 行间距 —— 4 档滑块（LINE_HEIGHTS：1.4/1.6/1.8/2.0）
3. 左右边距 —— 4 档滑块（窄/中/宽/很宽 = MARGINS）
4. 翻页方式 —— 二选一：**点击翻页 | 滑动翻页**（PageMode）
5. 条件子项（见下文各端规则）：滑动翻页显示「滑动轴向」；
   轴向为上下时再显示「滚动样式」（无缝滚动/单页翻动）；
   点击翻页或左右滑动显示「翻页方向」

工具栏布局：`[← 书架] ……章节进度…… [单列|双列] [⚙]`
单双列切换**只在工具栏**，设置面板内不得出现重复入口。

## 二、翻页方式行为定义

### 点击翻页（tap，默认翻页方式）

- 书页 iframe 设 pointer-events:none（CSS .no-pointer），
  所有点击落在阅读器外层容器，由 shared 的 `tapZoneAction()` 统一判定；
- 屏幕左右两半分区：左半 = 上一页，右半 = 下一页；
- **子选项「翻页方向」（SwipeDirection，默认 right-next）**：
  - right-next（默认）：向右下一页 → 右半屏点击 = 下一页；
  - left-next：向左下一页 → 左半屏点击 = 下一页（镜像）；
- 引擎收不到任何指针事件，天然无双重点击。

### 滑动翻页（swipe）

按设备能力分派：

| 设备 | 形态 |
|------|------|
| 触屏（pointer: coarse） | 子选项「滑动轴向」：左右滑动 / 上下滑动 |
| 桌面（无触屏） | 无子选项，固定为上下无缝滚动 |

- **左右滑动（swipe + horizontal）**：
  - paginated flow；书页同样 pointer-events:none，
    手势由外层容器 touchstart/touchend 判定；
  - 方向公式（与 Web/App 逐字一致）：
    `isNext = (dx > 0) === (swipeDirection === 'left-next')`，
    dx > 50px 才触发；
  - 同样带「翻页方向」子选项，语义同 tap；
  - **纵向手势（无论方向偏好恒定）**：同一手势判定中取位移主轴，
    |dy| > |dx| 且 dy < -50px（从下往上推）= 下一页；
    dy > 50px（从上往下滑）= 上一页；
- **上下滑动（swipe + vertical）**：
  - 子选项「滚动样式」（VerticalStyle）二选一：
    - **continuous 无缝滚动**：flow=scrolled 无缝连续滚动，
      整章连成一条，滚到底自动接下一章；书页保持可交互启用原生滚动；
    - **paged 单页翻动**：paginated flow + axis='vertical'
      （epubjs default manager 运行时原生能力）；
      从下往上推 = 下一页、从上往下滑 = 上一页，一页一页翻动；
      页码体系与左右滑动/点击翻页一致（同属 paginated 渲染）；
      书页 pointer-events:none，手势由外层容器纵向位移判定；
- **桌面降级规则**：非触屏设备选择滑动翻页时——
  自动切为上下无缝滚动 + **强制单列** +
  工具栏单双列按钮变为禁用状态显示「∅」（悬停提示说明原因）。

## 三、键盘（PC）

- ↓ = 下一页，↑ = 上一页（恒定，不随方向偏好）；
- ← → 跟随「翻页方向」偏好（left-next 时 ← 为下一页）；
- keydown 即触发（非 keyup），带 400ms 冷却防连击穿透；
- 双通道监听：window keydown（焦点在外层）+
  书页 iframe document 的捕获阶段 keydown（焦点在书页内）；
  两通道并存不重复（同一按键只走一条通路）。

## 四、单双列（spread）

- 视口 ≥768px 且横向占优（`min-width:768px and (orientation: landscape)`，
  SPREAD_MIN_WIDTH=768，平板横屏/桌面）才允许双列，且以用户选择为准（twoUp state）；
  原 900px 门槛对真实平板过高（1280x800@DPR1.6 横屏 CSS 视口约 800px），已下调；
- 未达门槛（手机竖屏等）强制单列并隐藏切换按钮；
- 滑动翻页模式的桌面端强制单列 + 按钮禁用 ∅（见上）;
- 监听 window resize 与 matchMedia(WIDE_SPREAD_MQ) 的 change 事件，
  容器尺寸变化时调用 rendition.resize() 重排；引擎内部 minSpreadWidth
  与 UI 门槛同值（避免 768-799px 横屏显示「双列」却渲染单列）。

## 五、App 端（apps/mobile）对应关系

- 设置存储 AsyncStorage，键名与值域和 Web localStorage 对应（见第六节）；
- 设置面板结构与 Web 一致：三条滑块 + 翻页方式二选一 +
  条件子项（swipe 显示轴向；轴向为上下时再显示滚动样式
  无缝滚动/单页翻动；tap 或 swipe/horizontal 显示翻页方向）；
  注：阅读偏好面板在 ReaderScreen 内，非 SettingsScreen；
- App 是纯触屏设备，不存在桌面降级分支；
- TXT 渲染（TxtPane）：
  tap = 左右半区 Pressable/tapZoneAction 判定；
  swipe/horizontal = PanGestureHandler，方向公式同第二节，
  含纵向手势（上推下一页/下拉上一页，恒定不镜像）；
  swipe/vertical+continuous = ScrollView 天然无缝滚动；
  swipe/vertical+paged = 纵向 PanGestureHandler 一页一页翻动；
- EPUB 渲染（offline-epub.ts 内嵌 WebView）：renderOptions 按
  pageMode/swipeLayout/verticalStyle 注入 flow/manager/axis
  （映射表同 Web EpubViewer），手势经注入 JS 判定后
  postMessage 回 RN 执行翻页；

## 六、持久化

Web localStorage 键名（App AsyncStorage 一一对应）：

| 键 | 值 |
|----|----|
| starcloud.fontStep | 字号档位序号 |
| starcloud.lineHeight | 行距档位序号 |
| starcloud.margin | 边距档位序号 |
| starcloud.pageMode | 'tap'（默认）\| 'swipe' |
| starcloud.swipeLayout | 'horizontal' \| 'vertical' |
| starcloud.verticalStyle | 'continuous' \| 'paged'（仅上下滑动时有意义） |
| starcloud.swipeDirection | 'right-next'（默认）\| 'left-next' |
| starcloud.spreadTwoUp | 'single' \| 'two-up' |

进度上报：章节变化才上报，3s 防抖；
恢复优先级 = 本会话最后位置 > 云端百分比。

## 七、事件与渲染架构约定（实现层红线）

1. 书页内容在 iframe 内，iframe 内事件**不会冒泡到外层页面**；
   监听只有两条正道：rendition.on(eventName) 代理（转发表见
   utils/constants.js DOM_EVENTS），或 applyDocHandlers 直接种进
   iframe document；
2. epubjs 引擎**没有内置触摸滑动翻页**（touchstart 仅用于内部链接处理）；
   axis:'vertical' 分页翻动是 default manager 运行时原生能力
   （官方类型缺失需 as 断言传入 renderTo options）；
3. paginated flow 下书页 pe:none 后引擎收不到任何点击/触摸——
   这是 tap 与 swipe/horizontal 模式的既定架构，不是 bug；
4. 结构性变化（pageMode/swipeLayout/spread 切换）通过 rebuildTick
   整体重建渲染器并以章节序号衔接位置；refs 必须与 state 严格同步；
5. 不使用 React StrictMode（epubjs 在 double-effect 下销毁不彻底会白屏）。

## 八、已删除项（不得复活）

- 三角区/倒 Y 三区点击分区（现为左右两半）
- 设置面板内的单双列入口（只在工具栏）
- 注：VerticalStyle paged（单页翻动）曾于早期版本删除，后于 2026-08-25
  恢复为上下滑动模式的子选项，定义见第二节，非删除项
