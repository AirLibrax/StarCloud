# StarCloud 生产部署指南

> 面向项目作者本人，从零开始，按顺序执行即可。
> 目标环境：阿里云 ECS · Ubuntu 24.04 LTS · 2C2G · 3M 带宽。

---

## 0. 一句话总结

```bash
# 在服务器上（仓库目录内）
cp deploy/.env.example deploy/.env      # 改 JWT_SECRET / 管理员 / 域名
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml exec starcloud node dist/seed.js
```

完成后：
- 读者端：`https://你的域名`（自动 HTTPS）
- 管理后台：本机 SSH 隧道访问 `http://localhost:3000`（不暴露公网）

---

## 1. 架构与端口

```
                        公网（80 / 443 已放行）
                                  │
                     ┌────────────▼────────────┐
                     │  caddy  (starcloud-caddy)│  官方 Caddy 镜像 + reader 静态产物
                     │  · reader SPA（根路径）  │  · 自动 HTTPS（Let's Encrypt）
                     │  · /api/*    → starcloud │  · SPA fallback 到 index.html
                     │  · /uploads/*→ starcloud │
                     └────────────┬────────────┘
                                  │ 容器内网（service name）
                     ┌────────────▼────────────┐
                     │  starcloud (NestJS:3000)│  仅绑定 127.0.0.1:3000
                     │  · /api 业务接口         │  · 托管 admin/dist（管理后台）
                     │  · /uploads 静态文件     │  · SQLite + 书籍文件在卷里
                     └─────────────────────────┘
```

| 数据 | 宿主位置（deploy/data/） | 容器内挂载点 |
|---|---|---|
| SQLite 数据库 | `deploy/data/db/` | `/app/apps/server/prisma/data` |
| 书籍文件 + 封面 | `deploy/data/uploads/` | `/app/apps/server/uploads` |
| TLS 证书 / ACME 状态 | `deploy/data/caddy/` | `/data` |
| Caddy 配置状态 | `deploy/data/caddy-config/` | `/config` |

### Reader 生产托管方案（决策记录）

**决策：reader 由 Caddy 以域名根路径托管（SPA fallback），`/api/*` 与 `/uploads/*` 反代到 starcloud 容器；admin 维持现状由 NestJS 托管在 `127.0.0.1:3000`。**

理由：

1. **同域部署，天然无 CORS。** dev 下 reader 依赖 Vite 代理 `/api`；生产让浏览器与 API 同源（同一域名同一协议），JWT 从头到尾只在同一个源里流转，`localStorage` 里的令牌不跨源，零 CORS 配置成本。
2. **零代码改动。** 不需要动 `apps/server` 的任何源码：现有 `ServeStaticModule`（托管 admin 与 uploads）、`app.enableCors()`（服务移动端等跨域场景）的行为语义完全不变。
3. **拒绝「把 reader 也塞给 NestJS」的方案。** 服务器根路径已被 admin 占用（`ServeStaticModule` rootPath 指向 `apps/admin/dist`），再加一个 reader 的 root 静态模块会路径冲突；把 admin 挪到子路径则必须改 admin 的 Vite `base` 并改变其现有 URL 语义——违反「不改运行时代码行为」的硬约束。
4. **admin 保持内网可见。** 管理后台只监听 `127.0.0.1:3000`，公网不可达，通过 SSH 隧道使用；少一个公网攻击面。
5. **caddy 镜像解法。** 官方 Caddy 镜像本身不含任何静态文件，而 compose 多服务并行构建时无法可靠地「从另一个镜像 COPY 产物」。因此 `deploy/caddy.Dockerfile` 以官方 `caddy:2-alpine` 为底座，在同文件内自建一个 reader 构建阶段（只装 reader/shared 两个工作区的依赖，体积小、层缓存友好），把 `apps/reader/dist` 烤进镜像。单条 `docker compose up -d --build` 即可完成，无构建顺序依赖、无运行时卷同步竞态。

---

## 2. 阿里云控制台：安全组放行端口

1. 控制台 → ECS 实例 → 安全组 → 配置规则 → 入方向添加：
   | 端口 | 协议 | 授权对象 | 用途 |
   |---|---|---|---|
   | 22 | TCP | 你的 IP 或 0.0.0.0/0 | SSH 管理 |
   | 80 | TCP | 0.0.0.0/0 | HTTP（证书签发 + 跳转 HTTPS） |
   | 443 | TCP | 0.0.0.0/0 | HTTPS |
2. **不要**放行 3000 端口——后端与管理后台只在本机可见。
3. （可选但推荐）在域名服务商把 `star.example.com` 的 A 记录解析到本机公网 IP，等 DNS 生效（`ping 域名` 能看到你的 IP 即可）。

> 注意：阿里云安全组与 Ubuntu 系统防火墙（如果有 ufw）都要放行。

---

## 3. 安装 Docker

SSH 登录服务器，用官方脚本安装（会装好 Docker Engine + Compose 插件）：

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
docker --version && docker compose version   # 验证
```

> 大陆服务器访问 Docker Hub 拉基础镜像可能偏慢；若超时可执行一次
> `sudo mkdir -p /etc/docker && sudo tee /etc/docker/daemon.json <<< '{"registry-mirrors":["https://docker.m.daocloud.io"]}' && sudo systemctl restart docker`
> （镜像加速地址时效性强，如失效请自行搜索最新的可用源）。

---

## 4. 取得代码

```bash
sudo mkdir -p /opt/starcloud && sudo chown $USER /opt/starcloud
cd /opt/starcloud
git clone <你的仓库地址> .
```

（本机没有推送权限也没关系：既有的代码目录直接 `rsync/scp` 上来也可以，只要有 `Dockerfile`、`deploy/`、`docs/deploy.md` 这些文件即可。）

---

## 5. 配置环境变量

```bash
cp deploy/.env.example deploy/.env
nano deploy/.env   # 或 vi
```

**必改三项：**

1. `JWT_SECRET`：生成随机串
   ```bash
   openssl rand -hex 32
   ```
2. `SEED_ADMIN_NAME` / `SEED_ADMIN_PASSWORD`：管理后台登录账号密码
3. `CADDY_DOMAIN`：你的域名（只填域名，不带 `https://`，且必须已解析到本机）

其余保持默认（`DATABASE_URL` 不用动，容器内路径已由卷挂载固定）。

---

## 6. 首次启动

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

- 首次构建要装依赖 + 构建三个包，**3M 带宽下约 10 ～ 25 分钟**（npm 依赖几百 MB，可从屏幕日志看到进度）。之后代码有改动时增量构建只要一两分钟。
- 不想等 / 想提速：构建时可用国内 npm 镜像：
  ```bash
  docker compose -f deploy/docker-compose.yml build --build-arg NPM_REGISTRY=https://registry.npmmirror.com
  docker compose -f deploy/docker-compose.yml up -d
  ```
- 启动时容器内会自动执行数据库迁移（`prisma migrate deploy`，幂等），完成后 NestJS 监听 3000。

查看状态：

```bash
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs -f starcloud caddy
```

---

## 7. 首次播种（创建管理员）

只在全新数据库上执行一次（幂等：已存在同名管理员会自动跳过）：

```bash
docker compose -f deploy/docker-compose.yml exec starcloud node dist/seed.js
```

看到 `已创建管理员: xxx` 即成功。

---

## 8. 验收

1. 浏览器打开 `https://你的域名` → 阅读端首页。
2. 登录阅读端，书架应为空（新库无书）。
3. 管理后台（SSH 隧道）：
   ```bash
   ssh -L 3000:127.0.0.1:3000 你的用户@服务器IP
   ```
   然后本机浏览器开 `http://localhost:3000`，用 `SEED_ADMIN_NAME/PASSWORD` 登录。
4. 在后台上传一本测试书（PDF/EPUB/TXT），回到阅读端确认出现在书架、能打开。

> 生产库是全新库。书籍文件的路径以「上传时所在容器」为准（数据库里存的是
> 容器内绝对路径），**不要**把开发机上的 `apps/server/prisma/data/starcloud.db`
> 拷进生产卷使用，否则书籍文件会「已丢失」。生产书的正确导入方式就是后台重新上传。

---

## 9. 日常更新

```bash
cd /opt/starcloud
git pull
docker compose -f deploy/docker-compose.yml up -d --build
```

- 后端代码/依赖变化 → `up -d --build` 重建镜像滚动更新。
- 数据库结构变化（新增迁移文件）→ 容器启动时自动 `prisma migrate deploy` 应用，无需手动干预。
- 仅改 `deploy/Caddyfile`（如加路由）不必重建镜像：
  ```bash
  docker compose -f deploy/docker-compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
  ```
- 证书：Let's Encrypt 自动续期，无需任何操作（`deploy/data/caddy` 卷保留 ACME 状态）。

---

## 10. 备份与恢复

### 备份（建议配合 cron 每周执行）

```bash
cd /opt/starcloud
tar -czf backup-$(date +%F).tar.gz \
  deploy/data/db \
  deploy/data/uploads \
  deploy/data/caddy \
  deploy/data/caddy-config \
  deploy/.env
```

三个文件 `backup-*.tar.gz` 拿到别处（对象存储 / 网盘）保存即可。

### 恢复

```bash
cd /opt/starcloud
docker compose -f deploy/docker-compose.yml down
rm -rf deploy/data
tar -xzf backup-XXXX-XX-XX.tar.gz   # 还原出 deploy/data 与 deploy/.env
docker compose -f deploy/docker-compose.yml up -d
```

---

## 11. 3M 带宽的预期

- 3 Mbps ≈ **375 KB/s**（3000 kbps ÷ 8）。
- 一本 30 MB 的 EPUB 下载约 **80 秒**；100 MB 的 PDF 约 **4.5 分钟**。
- 网站本身（HTML/JS/CSS，几十 KB）秒开；`encode gzip zstd` 已对文本资源开启压缩。
- reader 在线阅读走 `/api/books/:id/download`（流式下载），边下边读，适合长线阅读；体验可接受，但**不建议**在 3M 带宽下上传/下载超大文件（>200MB）频繁折腾。
- 后续如需提速：升级带宽，或在 Caddy 前再加 CDN 缓存静态资源。

---

## 12. 常见问题

| 现象 | 排查 |
|---|---|
| 证书一直申请不下来 | 域名 A 记录未生效 / 80、443 未放行；`docker compose logs caddy` 看报错 |
| 页面能开但接口 401/404 | 确认访问的是 `https://域名`（reader 与 API 必须同域） |
| 管理后台打不开 | 隧道未建立或 3000 被占用；`curl 127.0.0.1:3000` 应返回 admin 页面 |
| 容器反复重启 | `docker compose logs starcloud`：先看迁移是否失败（schema 与 data 是否配套） |
| 想重置全部数据 | `docker compose down` 后删除 `deploy/data/db`（会清空所有账号与进度，谨慎） |

---

## 13. 目录速查

```
Dockerfile                 # 后端多阶段构建（构建包 / 运行时裁剪）
.dockerignore              # 构建上下文排除（node_modules、uploads、密钥……）
deploy/
  docker-compose.yml       # 服务编排（starcloud + caddy）
  caddy.Dockerfile         # 前端容器：官方 caddy 底座 + reader 静态产物
  Caddyfile                # 路由（/api /uploads 反代 + SPA fallback）
  .env.example             # 环境变量模板（复制为 .env 使用）
  data/                    # 运行时数据（db / uploads / caddy 证书），git 忽略
docs/deploy.md             # 本指南
```