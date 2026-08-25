# syntax=docker/dockerfile:1
# ============================================================================
# StarCloud 生产镜像（多阶段构建）
#
# stage1  build   : 全量依赖（含 devDependencies）→ prisma generate → 构建
#                   server / admin / reader 三个包
# stage2  runtime : 生产依赖裁剪 + 仅拷贝运行必需物
#
# 说明：
#   - mobile 工作区（Expo）不参与构建、不进入镜像
#   - 构建时可用 --build-arg NPM_REGISTRY=... 指定 npm 镜像加速（如 npmmirror）
#   - 启动时 ENTRYPOINT 先执行 prisma migrate deploy（幂等），再起服务
# ============================================================================

# ---------------------------------------------------------------------------
# Stage 1: build
# ---------------------------------------------------------------------------
FROM node:20-slim AS build

# Prisma generate 需要能解析 datasource 里的环境变量（并不连接数据库）
ENV DATABASE_URL=file:./data/starcloud.db

# ca-certificates: npm 走 HTTPS 需要；openssl: Prisma 引擎依赖的系统库
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先只拷贝依赖清单，最大化利用 Docker 层缓存
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/reader/package.json apps/reader/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/shared/package.json packages/shared/package.json

# 全量安装（含 devDependencies，构建必需）。mobile 工作区不参与，避免拖入 Expo 依赖。
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm ci \
      --registry=$NPM_REGISTRY \
      --workspace @starcloud/server \
      --workspace @starcloud/admin \
      --workspace @starcloud/reader \
      --workspace @starcloud/shared \
      --include-workspace-root

# 源码与共享包
COPY apps ./apps
COPY packages ./packages

# 生成 Prisma Client（server 依赖它）
RUN npm run prisma:generate --workspace @starcloud/server

# 构建三个包（server -> NestJS dist；admin / reader -> Vite dist）
RUN npm run build --workspace @starcloud/server \
 && npm run build --workspace @starcloud/admin \
 && npm run build --workspace @starcloud/reader

# 把 prisma/seed.ts 编译为 CJS，供运行阶段执行首次播种
# （生产 node_modules 已裁剪，ts-node 不可用，故在构建期预编译）
RUN cd apps/server \
 && npx tsc prisma/seed.ts \
      --rootDir prisma \
      --outDir dist \
      --module commonjs \
      --target ES2022 \
      --esModuleInterop \
      --skipLibCheck \
      --moduleResolution node

# ---------------------------------------------------------------------------
# Stage 2: runtime
# ---------------------------------------------------------------------------
FROM node:20-slim

ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    PORT=3000 \
    DATABASE_URL=file:./data/starcloud.db

# openssl: Prisma 引擎依赖（bookworm slim 需显式安装）
# tzdata: 让 TZ=Asia/Shanghai 生效（容器时区默认上海）
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl tzdata \
 && ln -snf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
 && echo Asia/Shanghai > /etc/timezone \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 生产依赖：只装 server 工作区（含 @prisma/client），再补 prisma CLI
# （migrate deploy 需要 CLI；锁 6.19.3 与 package-lock.json 完全一致；
#   --no-save 不写回 package.json / lockfile）
ARG NPM_REGISTRY=https://registry.npmjs.org
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/reader/package.json apps/reader/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci \
      --omit=dev \
      --registry=$NPM_REGISTRY \
      --workspace @starcloud/server \
      --include-workspace-root \
 && npm install --no-save --omit=dev --registry=$NPM_REGISTRY prisma@6.19.3

# 运行必需物：server 构建产物、Prisma schema+迁移、admin / reader 静态产物
COPY --from=build /app/apps/server/dist   ./apps/server/dist
COPY --from=build /app/apps/server/prisma ./apps/server/prisma
COPY --from=build /app/apps/admin/dist    ./apps/admin/dist
COPY --from=build /app/apps/reader/dist   ./apps/reader/dist

# schema 就位后再生成 Prisma Client（@prisma/client 的 postinstall 找不到
# schema 时会跳过，必须显式生成一次）
RUN cd apps/server && npx --no-install prisma generate

# 空 uploads 目录；实际数据由 compose 挂载卷提供
RUN mkdir -p apps/server/uploads

WORKDIR /app/apps/server

# 启动顺序：迁移（幂等，重启安全）→ 服务
# --no-install：prisma 缺失时直接报错，避免 npx 交互式安装把容器挂起
ENTRYPOINT ["/bin/sh", "-c", "npx --no-install prisma migrate deploy && exec node dist/main.js"]