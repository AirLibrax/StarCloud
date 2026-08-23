# 星辰云图书馆

个人云端图书馆：上传书籍，在任何设备上阅读并同步进度。

## 架构

npm workspaces 单体仓，三端共享一份类型定义：

```
apps/
  server/    NestJS + Prisma + SQLite 后端 API
  admin/     Vite + React 管理后台（建设中）
  mobile/    Expo React Native 手机端（建设中）
packages/
  shared/    三端共用的 TypeScript 类型
```

## 功能

- JWT 认证，管理员 / 普通用户两级权限
- 书籍上传下载（PDF / EPUB / TXT，mimetype 白名单校验）
- 阅读进度同步，跨设备续读
- 用户管理：创建、停用、改密

## 开发

```bash
npm install                          # 安装依赖

cd apps/server
npx prisma migrate dev               # 建表
npx ts-node prisma/seed.ts           # 创建默认管理员
npm run start:dev                    # 启动后端 http://localhost:3000
```

## 历史

v1 原型见 `legacy` 分支。
