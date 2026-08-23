# 星辰云图书馆 StarCloud

个人云端图书馆：在服务器上存放书籍，在任何设备的浏览器或手机 App 中阅读，阅读进度跨设备同步。

![阅读器效果预览](docs/reader-preview.jpg)

## 项目状态

| 模块 | 状态 | 说明 |
|------|------|------|
| `apps/server` 后端 API | ✅ 完成 | 认证 / 书籍 / 进度 / 用户管理 |
| `apps/admin` 管理后台 | ✅ 完成 | 登录、书籍上传、列表、删除 |
| `apps/reader` Web 阅读端 | ✅ 基本完成 | TXT / PDF 已支持；EPUB 渲染器已接入 |
| `apps/mobile` 安卓 App | 🚧 暂未完成 | 计划使用 Expo + React Native，[功能规格](docs/mobile-spec.md)已冻结 |
| 部署配置 | ⏳ 暂未完成 | 生产部署脚本与 HTTPS 配置待补充 |

## 架构

npm workspaces 单体仓（monorepo），TypeScript 全栈，三端共享一份类型定义：

```
StarCloud/
├── apps/
│   ├── server/          ✅ 后端 API（NestJS 11 + Prisma 6 + SQLite）
│   │   ├── src/
│   │   │   ├── auth/        登录、JWT 签发、认证与管理员守卫
│   │   │   ├── books/       书籍上传（multipart）、下载、删除；
│   │   │   │                EPUB 元数据解析（封面 / 书名 / 卷数）
│   │   │   ├── progress/    阅读进度上报与「我的书架」聚合查询
│   │   │   ├── users/       用户管理（管理员）与改密
│   │   │   ├── prisma/      数据库客户端单例
│   │   │   └── types/       Express 类型扩充
│   │   └── prisma/
│   │       ├── schema.prisma    数据模型（User / Book / ReadingProgress）
│   │       └── seed.ts          默认管理员种子脚本
│   │
│   ├── admin/           ✅ 管理后台（Vite 7 + React 19 + TypeScript）
│   │   └── 构建产物由后端托管，部署后与 API 同域
│   │
│   ├── reader/          🔶 Web 阅读端（Vite 7 + React 19 + TypeScript）
│   │   ├── EPUB: epubjs 渲染，章节级进度定位
│   │   ├── PDF:  浏览器原生渲染（iframe + query token）
│   │   └── TXT:  滚动式阅读，滚动位置换算进度
│   │
│   └── mobile/          🚧 暂未完成。计划 Expo + React Native：
│                          双书源（本地导入 + 云端书架）、零多余权限、
│                          分页式/滚动式双翻页引擎。
│                          详见 docs/mobile-spec.md
│
├── packages/
│   └── shared/          ✅ 三端共用的 TypeScript 类型定义
│                          （Book / UserPublic / ReadingProgress 等）
│
└── docs/                效果图等文档资源
```

### 数据流

```
浏览器 / 手机 App
      │  HTTP + JSON（Authorization: Bearer <JWT>）
      ▼
NestJS 后端（端口 3000）
  ├─ AuthModule     POST /api/auth/login · GET /api/auth/me
  ├─ BooksModule    GET/POST/DELETE /api/books · GET /api/books/:id/download
  ├─ ProgressModule POST /api/progress · GET /api/shelf
  ├─ UsersModule    GET/POST/PATCH/DELETE /api/users · POST /api/users/change-password
  ├─ 托管 admin/dist 静态文件（生产环境全站一个进程）
  └─ Prisma → SQLite（apps/server/prisma/data/starcloud.db）
```

### 设计决策

- **单体仓 + 共享类型**：`Book` 等类型只定义一次，前后端字段改名时编译期即报错。
- **令牌双通道**：默认从 `Authorization: Bearer` 取 JWT；iframe 加载 PDF 等无法携带
  自定义头的场景允许 `?access_token=` 兜底。
- **上传校验**：mimetype 白名单优先（PDF / EPUB / TXT），浏览器误标为
  `application/octet-stream` 时按扩展名兜底；被拒文件即时清理不留孤儿。
- **EPUB 元数据自动识别**：上传时解析 zip 内的 OPF，提取封面图、内嵌书名与作者；
  卷数从标题/文件名启发式识别（第N卷 / Vol.N / 结尾数字等）。
- **排版设置**：字号八档、行距四档、页边距四档，全部离散档位并持久化到本地，
  行距通过向章节 iframe 注入 `!important` 样式压过书籍自带 CSS，避免裁切。
- **软删除**：用户停用为标记位，阅读记录保留；删书时进度随外键级联清理。

## 快速开始

```bash
npm install                      # 安装全部工作区依赖

cd apps/server
npx prisma migrate dev           # 创建数据库表
npx ts-node prisma/seed.ts       # 创建默认管理员（见 .env 可自定义）
npm run start:dev                # 启动后端 http://localhost:3000
```

另开终端：

```bash
npm run dev:admin                # 管理后台 http://localhost:5173
npm run dev:reader               # 阅读端   http://localhost:5174
```

开发模式下两个前端的 `/api` 与 `/uploads` 请求由 Vite 代理转发至后端。

## API 一览

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/auth/login` | 公开 | 登录，返回 JWT 与用户信息 |
| GET | `/api/auth/me` | 登录 | 当前用户信息 |
| GET | `/api/books` | 登录 | 书籍列表（含读者数） |
| GET | `/api/books/:id` | 登录 | 书籍详情 |
| GET | `/api/books/:id/download` | 登录 | 下载文件（支持 query token） |
| POST | `/api/books` | 管理员 | 上传新书（multipart，字段名 `file`） |
| DELETE | `/api/books/:id` | 管理员 | 删除书籍及其文件 |
| POST | `/api/progress` | 登录 | 上报/更新阅读进度 |
| GET | `/api/shelf` | 登录 | 我的书架（书籍 + 个人进度） |
| GET/POST | `/api/users` | 管理员 | 用户列表 / 创建用户 |
| PATCH/DELETE | `/api/users/:id` | 管理员 | 修改 / 停用用户 |
| POST | `/api/users/change-password` | 登录 | 修改自己的密码 |

## 部署（概要）

1. `npm run build --workspace @starcloud/admin` 构建管理后台静态文件
2. `npm run build --workspace @starcloud/server` 编译后端
3. 服务器上运行 `node apps/server/dist/main.js`，一个进程承载 API、
   管理后台静态文件、封面与书籍文件
4. 反向代理（nginx/caddy）配 HTTPS；SQLite 数据库与 uploads 目录定期备份

> 详细的生产部署文档暂未完成。

## 历史

v1 原型（Express + sqlite3 + 原生 HTML 管理页）封存于 [`legacy`](../../tree/legacy) 分支。

## 许可

个人学习项目。
