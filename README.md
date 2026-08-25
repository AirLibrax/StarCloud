# 星辰云图书馆 StarCloud

个人云端图书馆：在服务器上存放书籍，在任何设备的浏览器或手机 App 中阅读，阅读进度跨设备同步。

![阅读器效果预览](docs/reader-preview.jpg)

## 功能特性

- **三端阅读**：Web 阅读端（TXT / PDF / EPUB）+ 安卓 App + 管理后台，共享同一套阅读交互模型
- **跨设备进度同步**：EPUB 进度精确到**章内位置**（CFI 书签），打开书直接落回你离开的那一页；TXT/PDF 按滚动比例/页数恢复
- **页级进度显示**：阅读器显示「第 x/y 章 · 本章 a/b 页」，App 与 Web 一致
- **全书百分比**：EPUB 惰性生成 locations，给出跨章节的真实阅读百分比（不打断阅读，后台算）
- **自托管**：数据全在自己服务器（SQLite 单文件 + 书籍文件），可选邀请码注册门禁
- **离线阅读**（App）：本地导入 EPUB/TXT 并离线阅读；云端书籍可下载到本地
- **多格式**：EPUB / PDF / TXT 通吃，上传时自动解析 EPUB 封面、书名、作者、卷数
- **轻部署**：Docker + Caddy 一条命令起整套服务（含自动 HTTPS）

## 项目状态

| 模块 | 状态 | 说明 |
|------|------|------|
| `apps/server` 后端 API | ✅ 完成 | 认证 / 书籍 / 进度 / 用户管理，SQLite 单文件存储 |
| `apps/admin` 管理后台 | ✅ 完成 | 登录、用户管理、书籍上传与编辑、分类/标签/搜索、封面管理、批量操作 |
| `apps/reader` Web 阅读端 | ✅ 完成 | TXT / PDF / EPUB 三格式；交互体系按冻结规格实现（见 [docs/reader-interaction.md](docs/reader-interaction.md)） |
| `apps/mobile` 安卓 App | ✅ 完成 | Expo + RN；本地导入 + 云端书架 + 离线 EPUB/TXT + 平板横屏双列；待办：PDF 离线 |
| `deploy/` 生产部署 | ✅ 完成 | Docker + Caddy 一键部署、自动 HTTPS、备份脚本（见 [docs/deploy.md](docs/deploy.md)） |

## 快速开始

要求：Node.js ≥ 20。

```bash
npm install                      # 安装全部工作区依赖

# 首次初始化数据库与管理员
cd apps/server
cp .env.example .env             # 创建配置文件（Windows 用 copy）
#   ↓ 编辑 .env：至少把 JWT_SECRET 换成自己的随机串
npx prisma migrate dev           # 创建数据库表
cp prisma/admins.example.json prisma/admins.json
#   ↓ 编辑 admins.json：写入初始管理员的用户名与密码（支持多个，JSON 数组）
npm run seed                     # 按 admins.json 创建初始管理员（幂等可重复执行）
cd ../..
```

> `seed` 只认 `prisma/admins.json`（已 gitignore）。文件缺失、JSON 损坏或条目缺字段时
> 会报错拒跑并提示复制模板，代码内不含任何默认账号。

启动后端（端口 3000）：

```bash
npm run dev:server
```

另开终端启动前端（开发模式下 `/api` 与 `/uploads` 请求由 Vite 代理转发至后端）：

```bash
npm run dev:admin                # 管理后台 http://localhost:5173
npm run dev:reader               # 阅读端   http://localhost:5174
```

安卓 App（开发模式，手机安装 Expo Go 后扫码或输入局域网地址即可加载）：

```bash
npm run dev:mobile               # expo start --lan
```

App 在「设置」页填入服务器地址并登录即可连接云端书架；不配置服务器也能
纯本地导入并阅读图书。设置页与重新登录页均提供「注册」入口，逻辑与 Web 端一致。

## 架构

npm workspaces 单体仓（monorepo），TypeScript 全栈，四端共享一份类型定义与交互模型：

```
StarCloud/
├── apps/
│   ├── server/                      后端 API（NestJS 11 + Prisma 6 + SQLite）
│   │   ├── src/
│   │   │   ├── main.ts              Nest 启动入口：全局校验管道、上传目录、静态托管
│   │   │   ├── app.module.ts        根模块：装配各业务模块 + 静态文件托管（uploads / admin/dist）
│   │   │   ├── auth/                登录、自助注册（可选邀请码门禁）、JWT 签发
│   │   │   │   ├── auth.controller.ts   /api/auth/* 路由
│   │   │   │   ├── auth.service.ts      账号校验、JWT 签发、注册逻辑
│   │   │   │   ├── invite-gate.ts       邀请码门禁开关（读 INVITE_CODE 环境变量）
│   │   │   │   ├── jwt-auth.guard.ts    「已登录」守卫（Bearer / ?access_token= 双通道）
│   │   │   │   ├── admin.guard.ts       「管理员」守卫
│   │   │   │   └── dto/                 登录 / 注册请求校验
│   │   │   ├── books/                书籍 CRUD、上传、封面、分类标签、批量删除
│   │   │   │   ├── books.controller.ts  /api/books/* 路由
│   │   │   │   ├── books.service.ts     核心业务：上传落盘、元数据编辑、搜索、批量删除
│   │   │   │   ├── epub-meta.ts         EPUB zip 解析（封面 / 书名 / 作者 / 卷数启发式）
│   │   │   │   └── dto/                 上传 / 编辑 / 批量删除请求校验
│   │   │   ├── progress/             阅读进度
│   │   │   │   ├── progress.controller.ts  POST /api/progress、GET /api/shelf
│   │   │   │   └── dto/                  进度上报校验（currentPage/totalPages/position CFI/percentage）
│   │   │   ├── users/                用户管理（管理员）与自助改密
│   │   │   ├── prisma/               Prisma 客户端单例（全局模块，供各业务模块注入）
│   │   │   └── types/                Express 请求类型扩充（req.user 等）
│   │   └── prisma/
│   │       ├── schema.prisma         数据模型：User / Book / Tag / ReadingProgress
│   │       ├── seed.ts               初始管理员播种（读取 admins.json，路径兼容 prisma/ 与 dist/）
│   │       ├── admins.example.json   管理员凭据模板（复制为 admins.json 后使用）
│   │       └── migrations/           全部数据库迁移（含 add_progress_position 等 5 个）
│   │
│   ├── admin/                        管理后台（Vite 7 + React 19 + TypeScript）
│   │   ├── src/
│   │   │   ├── main.tsx              入口
│   │   │   ├── App.tsx               路由（登录 / 书籍 / 用户）
│   │   │   ├── auth-context.tsx      登录态管理（JWT 存取、路由守卫）
│   │   │   ├── api/client.ts         后端请求封装（带 token、错误统一处理）
│   │   │   ├── pages/
│   │   │   │   ├── LoginPage.tsx     管理员登录
│   │   │   │   ├── BooksPage.tsx     书籍管理：上传、编辑、封面、分类标签、批量删除、搜索
│   │   │   │   └── UsersPage.tsx     用户管理：创建/编辑/停用/删除/重置密码
│   │   │   └── styles.css            全局样式
│   │   └── vite.config.ts            dev 代理（/api、/uploads → :3000）
│   │   └── 生产构建产物由后端托管，部署后与 API 同域
│   │
│   ├── reader/                       Web 阅读端（Vite 7 + React 19 + epubjs）
│   │   ├── src/
│   │   │   ├── main.tsx              入口
│   │   │   ├── App.tsx               路由（登录 / 书架 / 阅读器）
│   │   │   ├── auth-context.tsx      登录态管理
│   │   │   ├── api/client.ts         后端请求封装
│   │   │   ├── components/
│   │   │   │   └── EpubViewer.tsx    EPUB 渲染器：epubjs 封装，翻页/双列/设置/进度上报/CFI 恢复
│   │   │   ├── pages/
│   │   │   │   ├── LoginPage.tsx     登录/注册（自动探测邀请码门禁）
│   │   │   │   ├── ShelfPage.tsx     书架：书籍列表、搜索、分类筛选、进度显示
│   │   │   │   └── ReaderPage.tsx    阅读器：按格式分流（EPUB 渲染器 / PDF iframe / TXT 滚动）
│   │   │   └── styles.css            全局样式
│   │   └── vite.config.ts            dev 代理
│   │
│   └── mobile/                       安卓 App（Expo 57 + React Native 0.86）
│       ├── app.json                 Expo 配置：图标、自适应图标、启动屏（expo-splash-screen 插件）、
│       │                            包名、版本号、cleartext 放行
│       ├── eas.json                 EAS 构建配置（preview=APK / production=AAB）
│       ├── index.tsx                 入口
│       ├── metro.config.js          Metro 配置（vendor 资源处理）
│       ├── assets/
│       │   ├── images/               icon / 自适应图标三件套 / splash 图
│       │   └── vendor/               内联的 epubjs、jszip 源码（离线 EPUB 渲染引擎）
│       └── src/
│           ├── App.tsx               导航栈 + 登录态
│           ├── theme.ts              颜色主题
│           ├── api/
│           │   ├── client.ts         后端请求封装（进度上报带 position/percentage）
│           │   └── file-cache.ts     云端文件本地缓存（离线下载）
│           ├── reader/
│           │   └── offline-epub.ts   离线 EPUB 骨架页生成：内联引擎、手势桥接、
│           │                          CFI 恢复（含二次校准）、惰性 locations、进度上报
│           ├── screens/
│           │   ├── LibraryScreen.tsx 书架：本地书 + 云端书、下载、进度
│           │   ├── ReaderScreen.tsx  阅读器：EPUB（WebView）/ TXT（原生）/ PDF，设置面板
│           │   ├── LoginScreen.tsx   登录（含注册入口）
│           │   ├── RegisterScreen.tsx 注册（自动适配邀请码门禁）
│           │   └── SettingsScreen.tsx 设置：服务器地址、主题偏好
│           └── storage/
│               ├── local-books.ts    本地书库持久化（AsyncStorage，含进度/CFI）
│               ├── reading-prefs.ts  阅读偏好持久化（字号/行距/边距/翻页方式/轴向/方向/双列）
│               └── settings.ts       服务器地址等设置
│
├── packages/
│   └── shared/                       三端共享的类型定义与阅读交互模型（无运行时依赖）
│       └── src/
│           ├── book.ts               Book / UserPublic 等实体类型
│           ├── progress.ts           ReadingProgress / UpdateProgressRequest / ShelfItem
│           └── reading.ts            阅读交互唯一权威：PageMode / SwipeLayout / VerticalStyle /
│                                     SwipeDirection / tapZoneAction() / 档位常量
│
├── deploy/                           生产部署资产
│   ├── docker-compose.yml            starcloud（后端+管理后台）+ caddy（reader + 反代）
│   ├── Dockerfile                    后端多阶段构建镜像（构建期编译 server/admin/reader + seed）
│   ├── Caddyfile                     Caddy 配置：reader SPA 根路径、/api 与 /uploads 反代
│   ├── caddy.Dockerfile              Caddy 镜像（内置 reader 静态产物）
│   └── .env.example                  生产环境变量模板（JWT_SECRET / 管理员 / 域名）
│
├── docs/                             文档
│   ├── reader-interaction.md         阅读交互冻结规格（翻页/轴向/方向/双列的权威定义）
│   ├── mobile-spec.md                App 规格（三端对齐、离线方案、双列）
│   ├── deploy.md                     生产部署全流程（Docker 安装→配置→启动→备份→排障）
│   └── reader-preview.jpg            效果预览图
│
├── Dockerfile                        部署用的后端镜像定义（与 deploy/ 配合）
├── .dockerignore                     构建上下文排除（node_modules、dist、.git、数据）
└── package.json                      工作区根：脚本编排（dev/build/typecheck/lint/seed）
```

### 阅读交互体系（冻结规格）

翻页交互是三端共享的唯一权威定义（`packages/shared/src/reading.ts`），Web 与 App 不各自硬编码：

- **翻页方式**：点击翻页（tap，左右半区分区，含义随方向偏好）/ 滑动翻页（swipe）
- **滑动轴向**：左右滑动（horizontal）/ 上下滑动（vertical）
- **上下滑动样式**：无缝滚动（continuous，滚到底自动接下一章）/ 单页翻动（paged）
- **方向偏好**：向左下一页（left-next，日式漫画方向）/ 向右下一页（right-next）
- **双列排版**：视口 ≥768px 且横向占优（平板横屏/桌面）且开启双列偏好时生效；
  上下滑动 / 桌面滑动固定单列；键盘翻页带 400ms 防连击冷却
- **EPUB 精确书签**：进度上报携带 epubjs CFI（精确到段落），恢复时 `display(cfi)` 直接落回
  离开位置；移动端首帧后二次校准修正分页偏移
- **全书百分比**：EPUB 首次进入后空闲调度 `locations.generate()`（不阻塞阅读），
  locations 就绪前百分比自动回退章节粒度

### 数据流

```
浏览器 / 手机 App
      │  HTTP + JSON（Authorization: Bearer <JWT>）
      ▼
NestJS 后端（端口 3000）
  ├─ AuthModule     POST /api/auth/login · POST /api/auth/register · GET /api/auth/registration · GET /api/auth/me
  ├─ BooksModule    GET/POST/PATCH/DELETE /api/books · GET /api/books/:id/download
  │                 POST/DELETE /api/books/:id/cover · POST /api/books/batch-delete
  ├─ ProgressModule POST /api/progress · GET /api/shelf
  ├─ UsersModule    GET/POST/PATCH/DELETE /api/users · POST /api/users/change-password
  │                 POST /api/users/:id/reset-password
  ├─ 托管 /uploads 静态文件与 admin/dist（生产环境全站一个进程）
  └─ Prisma → SQLite（apps/server/prisma/data/starcloud.db）
```

生产环境（Docker）：

```
公网（80/443 或非标端口）
      │
      ▼
Caddy（reader SPA 静态托管 + 自动 HTTPS）
      │  /api/*、/uploads/* 反代
      ▼
starcloud 容器（NestJS + SQLite，仅监听 127.0.0.1:3000）
      └─ 数据卷：deploy/data/db（数据库）、deploy/data/uploads（书籍与封面）
```

### 设计决策

- **单体仓 + 共享类型**：`Book` 等类型只定义一次，前后端字段改名时编译期即报错。
- **交互模型三端同源**：翻页方式 / 滑动轴向 / 方向偏好 / 点击分区等语义只定义在
  `@starcloud/shared/reading.ts`（含 `tapZoneAction()`），Web 与 App 直接引用，
  档位常量（字号/行距/边距）与持久化键名（`starcloud.*`）也一一对应。
- **令牌双通道**：默认从 `Authorization: Bearer` 取 JWT；iframe 加载 PDF 等无法携带
  自定义头的场景允许 `?access_token=` 兜底。
- **上传校验**：mimetype 白名单优先（PDF / EPUB / TXT），浏览器误标为
  `application/octet-stream` 时按扩展名兜底；被拒文件即时清理不留孤儿。
- **EPUB 元数据自动识别**：上传时解析 zip 内的 OPF，提取封面图、内嵌书名与作者；
  卷数从标题/文件名启发式识别（第N卷 / Vol.N / 结尾数字等）。
- **排版设置**：字号八档、行距四档、页边距四档，全部离散档位并持久化到本地，
  行距通过向章节 iframe 注入 `!important` 样式压过书籍自带 CSS，避免裁切。
- **移动端离线 EPUB**：epubjs / JSZip 打包资产内联进 WebView 骨架页，书文件由
  RN 分块推送 base64 后直接以 base64 编码模式解压（不走 XHR，无 data: URI 限制）；
  手势桥接只上报原始手势，翻页语义统一在 RN 侧按 shared 模型判定。
- **进度上报防丢**：客户端 3 秒防抖 + 退出即刷（卸载/关页用 keepalive 兜底），
  翻完一章立刻退出也不丢进度；percentage 仅在有效正数时采信，防止 epubjs
  未生成 locations 时的 0 值污染真实进度。
- **账号删除为硬删除**：删除用户时阅读记录随外键级联清理、上传者引用置空；
  「停用」（isActive 标记位）作为不删数据的软手段保留，两者并存。
  删书时进度随外键级联清理，封面与书文件同步清理不留孤儿。
- **安全约定**：`.env` 与 `admins.json` 均被 gitignore，真实凭据永不进仓库；
  部署资产只提供 `.example` 模板；生产容器仅监听本机端口，公网入口只有 Caddy。

## 技术栈

| 端 | 技术栈 |
|----|--------|
| server | NestJS 11 · Prisma 6 · SQLite · JWT（@nestjs/jwt）· class-validator · multer · adm-zip（EPUB 解析）· fast-xml-parser |
| admin / reader | Vite 7 · React 19 · react-router-dom 7 · epubjs（仅 reader） |
| mobile | Expo 57 · React Native 0.86 · react-navigation 7 · react-native-webview · expo-splash-screen · expo-document-picker（导入）· @react-native-async-storage/async-storage（持久化） |
| shared | TypeScript（纯类型 + 常量/函数，无运行时依赖） |

## 配置说明

后端所有配置集中在 `apps/server/.env`（不入库，仓库提供 `.env.example` 模板）：

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | ✅ | SQLite 文件路径，相对 `prisma/` 目录，默认 `file:./data/starcloud.db` |
| `JWT_SECRET` | ✅ | JWT 签名密钥；生产环境必须换成长随机串，泄露等于任何人可伪造登录态 |
| `INVITE_CODE` | ❌ | 注册口令门禁开关，见下节「注册口令（可选）」；留空即关闭 |

初始管理员凭据存放在 `apps/server/prisma/admins.json`（不入库，仓库提供
`admins.example.json` 模板），格式为 JSON 数组，支持一次声明多个初始管理员：

```json
[
  { "username": "管理员A", "password": "至少4位密码" },
  { "username": "管理员B", "password": "另一个密码" }
]
```

> 安全约定：`.env` 与 `admins.json` 均被 gitignore，真实凭据永不进仓库；
> 两者的模板文件（`.env.example` / `admins.example.json`）入库供复制。

### 注册口令（可选）

自助注册接口默认对所有人开放；如需限制注册，可在 `apps/server/.env` 中配置一个邀请码：

```env
# 非空 = 启用注册门禁：注册请求必须携带匹配的 inviteCode，否则 403
INVITE_CODE="star2026"
```

- **启用**：设置非空 `INVITE_CODE` 后重启后端即可；阅读端注册表单会自动出现「注册口令」输入框
  （前端通过公开接口 `GET /api/auth/registration` 探测是否需要，该接口只返回
  `{ inviteCodeRequired: boolean }`，不会泄露口令本身）。
- **更换口令**：修改 `INVITE_CODE` 的值并重启后端，旧口令立即失效。
- **关闭**：将值留空（`INVITE_CODE=""`）或删除该行并重启，注册不再校验，阅读端输入框自动消失。
- **彻底卸载**：删除 `.env` 中的 `INVITE_CODE` 行即可，无需改动任何代码
  （校验与开关逻辑集中在 `apps/server/src/auth/invite-gate.ts` 一个文件中）。

> 该门禁只作用于自助注册（`POST /api/auth/register`）；管理员在用户管理页创建用户不受影响。

## API 一览

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/auth/login` | 公开 | 登录，返回 JWT 与用户信息 |
| POST | `/api/auth/register` | 公开 | 自助注册（启用邀请码门禁时需携带 `inviteCode`），成功即登录 |
| GET | `/api/auth/registration` | 公开 | 注册配置：是否需要邀请码（不泄露口令） |
| GET | `/api/auth/me` | 登录 | 当前用户信息 |
| GET | `/api/books?q=&category=` | 登录 | 书籍列表（含读者数、分类、标签）；`q` 对书名/作者模糊搜索，`category` 精确过滤 |
| GET | `/api/books/:id` | 登录 | 书籍详情 |
| GET | `/api/books/:id/download` | 登录 | 下载文件（支持 query token） |
| POST | `/api/books` | 管理员 | 上传新书（multipart，字段名 `file`，上限 100MB；可选 `category`/`tags` 逗号分隔） |
| PATCH | `/api/books/:id` | 管理员 | 编辑元数据（书名/卷数/作者/简介/分类/标签，标签整体替换） |
| POST | `/api/books/:id/cover` | 管理员 | 上传/替换封面（png/jpeg/webp，上限 10MB） |
| DELETE | `/api/books/:id/cover` | 管理员 | 移除封面并删除文件 |
| POST | `/api/books/batch-delete` | 管理员 | 批量删除（事务内清理文件与进度，返回 deleted/skipped） |
| DELETE | `/api/books/:id` | 管理员 | 删除书籍及其文件与封面 |
| POST | `/api/progress` | 登录 | 上报/更新阅读进度（含 CFI 书签 position 与可选 percentage） |
| GET | `/api/shelf` | 登录 | 我的书架（书籍 + 个人进度） |
| GET/POST | `/api/users` | 管理员 | 用户列表 / 创建用户 |
| PATCH | `/api/users/:id` | 管理员 | 修改用户名 / 权限 / 停用启用 |
| DELETE | `/api/users/:id` | 管理员 | 删除用户（硬删除，进度级联清理；不能删除自己） |
| POST | `/api/users/:id/reset-password` | 管理员 | 管理员直接设定某用户新密码 |
| POST | `/api/users/change-password` | 登录 | 修改自己的密码（需旧密码验证） |

## 常用命令

| 命令 | 作用 |
|------|------|
| `npm run dev:server` | 后端热重载开发（:3000） |
| `npm run dev:admin` | 管理后台开发（:5173） |
| `npm run dev:reader` | 阅读端开发（:5174） |
| `npm run dev:mobile` | Expo 开发服务器（dev-client） |
| `npm run build` | 构建全部含 build 脚本的工作区（server / admin / reader） |
| `npm run typecheck --workspace @starcloud/server` | 后端类型检查 |
| `npm run typecheck --workspace @starcloud/admin` | 管理后台类型检查 |
| `npm run typecheck --workspace @starcloud/reader` | Web 阅读端类型检查 |
| `npm run typecheck --workspace @starcloud/mobile` | App 类型检查 |
| `npm run typecheck --workspace @starcloud/shared` | 共享包类型检查 |
| `npm run lint` | ESLint 全仓检查（质量护栏：拦截死代码与低级错误） |
| `npm run lint:fix` | ESLint 检查并自动修复可修复项 |
| `npm run seed --workspace @starcloud/server` | 初始化默认管理员 |

## 部署

完整生产部署（Docker + Caddy，含 HTTPS、备份、排障）见 **[docs/deploy.md](docs/deploy.md)**。

概要：

```bash
cd /opt/starcloud                        # 服务器上 git clone 仓库
cp deploy/.env.example deploy/.env       # 修改 JWT_SECRET / 管理员 / 域名
docker compose -f deploy/docker-compose.yml up -d --build   # 起整套服务
docker compose -f deploy/docker-compose.yml exec starcloud node dist/seed.js  # 播种管理员
```

生产架构：一个 `starcloud` 容器承载 API + 管理后台 + 书籍文件；一个 `caddy` 容器
承载 reader 阅读端并反代 `/api`、`/uploads`。数据落在 `deploy/data/`（数据库、书籍、
证书），迁移服务器时整目录带走即可。

**上线前安全清单**：

- [ ] `.env` 的 `JWT_SECRET` 已换成长随机串（不是模板默认值）
- [ ] `prisma/admins.json` 已创建且口令不是模板示例值
- [ ] 决定是否启用注册口令（公网实例建议启用，见「注册口令（可选）」）
- [ ] 确认 `.env` 与 `admins.json` 未被意外提交进 git

## 文档索引

| 文档 | 内容 |
|------|------|
| [docs/reader-interaction.md](docs/reader-interaction.md) | 阅读交互冻结规格（三端权威定义） |
| [docs/mobile-spec.md](docs/mobile-spec.md) | 安卓 App 规格（离线方案、三端对齐） |
| [docs/deploy.md](docs/deploy.md) | 生产部署全流程 |

## 历史

v1 原型（Express + sqlite3 + 原生 HTML 管理页）已被完全重写为当前的 monorepo 架构。

## License / 许可证

本项目采用 [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html)（GPL-3.0）开源，
完整许可条款见仓库根目录 [LICENSE](LICENSE) 文件。

- SPDX 标识：`GPL-3.0-only`
- Copyright (C) 2026 AirLibrax

> 个人学习项目，以 GPL-3.0 条款发布；使用、修改或分发本项目代码即表示接受该协议的条款与条件。
