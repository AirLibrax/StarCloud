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
- 引擎自带的点击翻页因此天然失效（它收不到任何指针事件），
  不存在双重触发。

### swipe 滑动翻页

子选项按设备能力显示：

| 设备 | 可用形态 |
|------|----------|
| 触屏（pointer: coarse） | 左右滑动 / 上下滑动 |
| 鼠标桌面 | 固定为上下无缝滚动（滚轮阅读），无子选项 |

- 左右滑动：paginated flow，触摸滑动方向随「翻页方向」偏好镜像；
- 上下滑动再分两种滚动样式（VerticalStyle）：
  - continuous 无缝滚动：flow=scrolled + manager=continuous，
    整章连成一条，滚到底自动接下一章；
  - paged 单页翻动：flow=paginated + manager=default +
    axis=vertical（epubjs 运行时能力，官方类型缺失需断言），
    手指上推一页一页切。

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

## 性能

- manager=continuous 会预加载相邻章节，跨章翻页即时；
  manager=default 单章管理跨章首次翻页有数百毫秒加载延迟（固有行为）；
- relocated 回调中的 setState 已尽量精简；字号/行距热应用通过
  getContents() 直写文档样式，不触发 React 重渲染。
