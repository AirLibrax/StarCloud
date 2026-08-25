# syntax=docker/dockerfile:1
# ============================================================================
# StarCloud 前端容器：官方 Caddy 镜像为底座 + 内置 reader 静态产物
#
# 为什么让 caddy 自己构建 reader，而不是从 starcloud 镜像里拷：
#   - compose 多服务并行构建，跨镜像 COPY --from 依赖构建顺序，首次部署会失败
#   - reader 构建只需 reader/shared 两个工作区的依赖，npm ci 很小、层缓存友好
#   - 两个镜像互不耦合，单条 `docker compose up -d --build` 即可完成部署
# ============================================================================

# ---------- reader 构建 ----------
FROM node:20-slim AS reader-build

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmjs.org

# 依赖清单先行，利用层缓存
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/reader/package.json apps/reader/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/shared/package.json packages/shared/package.json

# 只安装 reader + shared 两个工作区（vite 通过 alias 直接编译 shared 源码，无需预构建）
RUN npm ci \
      --registry=$NPM_REGISTRY \
      --workspace @starcloud/reader \
      --workspace @starcloud/shared \
      --include-workspace-root

COPY apps/reader ./apps/reader
COPY packages/shared ./packages/shared

# 构建 reader（tsc --noEmit && vite build），产物在 apps/reader/dist
RUN npm run build --workspace @starcloud/reader

# ---------- caddy 运行时 ----------
FROM caddy:2-alpine

# reader 静态产物挂到 Caddy 默认站点根目录 /srv
COPY --from=reader-build /app/apps/reader/dist /srv

# Caddyfile 由 compose 只读挂载到 /etc/caddy/Caddyfile
# 证书 / ACME 状态写入 /data、/config（compose 已持久化为卷）