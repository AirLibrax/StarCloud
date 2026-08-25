# StarCloud Production Deployment Guide

> Written for the project owner, from scratch, executed in order.
> Target environment: Alibaba Cloud ECS · Ubuntu 24.04 LTS · 2C2G · 3 Mbps bandwidth.

---

## 0. TL;DR

```bash
# on the server (inside the repo)
cp deploy/.env.example deploy/.env      # set JWT_SECRET / admin / domain
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml exec starcloud node dist/seed.js
```

When done:
- Reader: `https://your.domain` (automatic HTTPS)
- Admin console: SSH tunnel to `http://localhost:3000` (not exposed publicly)

---

## 1. Architecture & ports

```
                        Public (80 / 443 open)
                                  │
                     ┌────────────▼────────────┐
                     │  caddy  (starcloud-caddy)│  Official Caddy image + reader static assets
                     │  · reader SPA (root path)│  · auto HTTPS (Let's Encrypt)
                     │  · /api/*    → starcloud │  · SPA fallback to index.html
                     │  · /uploads/*→ starcloud │
                     └────────────┬────────────┘
                                  │ container network (service name)
                     ┌────────────▼────────────┐
                     │  starcloud (NestJS:3000)│  binds 127.0.0.1:3000 only
                     │  · /api business APIs    │  · serves admin/dist (admin console)
                     │  · /uploads static files │  · SQLite + book files on volumes
                     └─────────────────────────┘
```

| Data | Host location (deploy/data/) | Container mount |
|---|---|---|
| SQLite database | `deploy/data/db/` | `/app/apps/server/prisma/data` |
| Book files + covers | `deploy/data/uploads/` | `/app/apps/server/uploads` |
| TLS certs / ACME state | `deploy/data/caddy/` | `/data` |
| Caddy config state | `deploy/data/caddy-config/` | `/config` |

### Why the reader is served by Caddy (decision record)

**Decision: Caddy hosts the reader SPA at the domain root (with SPA fallback) and reverse-proxies
`/api/*` and `/uploads/*` to the starcloud container; the admin console stays served by NestJS on
`127.0.0.1:3000`.**

Rationale:

1. **Same-origin deployment, zero CORS.** In dev, the reader relies on Vite's proxy for `/api`;
   in production the browser and the API share one origin (same domain, same protocol). The JWT
   stays within a single origin end to end, the token in `localStorage` never crosses origins —
   no CORS configuration cost.
2. **Zero code changes.** No `apps/server` source needs touching: the existing `ServeStaticModule`
   (admin + uploads) and `app.enableCors()` (for the mobile app's cross-origin calls) keep their
   exact behavior.
3. **"Serving the reader from NestJS too" was rejected.** The server root path is already taken
   by the admin console (`ServeStaticModule` rootPath points at `apps/admin/dist`); adding another
   root static module for the reader would collide. Moving admin to a sub-path would require
   changing admin's Vite `base` and altering its existing URL semantics — violating the hard
   constraint of "no runtime behavior changes".
4. **Admin stays LAN-visible only.** The console listens on `127.0.0.1:3000`, unreachable from
   the public internet, accessed via SSH tunnel — one less public attack surface.
5. **The Caddy image approach.** The official Caddy image ships no static files, and parallel
   multi-service builds can't reliably COPY artifacts from another image. So
   `deploy/caddy.Dockerfile` starts from official `caddy:2-alpine` and builds the reader in its
   own stage within the same file (installing only the reader/shared workspace deps — small,
   cache-friendly), baking `apps/reader/dist` into the image. A single
   `docker compose up -d --build` does everything: no build-order dependencies, no runtime
   volume-sync races.

---

## 2. Alibaba Cloud console: open security-group ports

1. Console → ECS instances → security group → configure rules → inbound:
   | Port | Protocol | Source | Purpose |
   |---|---|---|---|
   | 22 | TCP | your IP or 0.0.0.0/0 | SSH management |
   | 80 | TCP | 0.0.0.0/0 | HTTP (cert issuance + HTTPS redirect) |
   | 443 | TCP | 0.0.0.0/0 | HTTPS |
2. **Do not** open 3000 — the backend and admin console are localhost-only.
3. (Optional but recommended) point an A record for `star.example.com` at the server's public IP
   at your DNS provider; wait for it to propagate (`ping your.domain` should show your IP).

> Note: both the Alibaba security group and the Ubuntu host firewall (ufw, if enabled) must allow
> the traffic.

---

## 3. Install Docker

Log in via SSH and install with the official script (Docker Engine + Compose plugin):

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
docker --version && docker compose version   # verify
```

> On mainland-China servers, pulling base images from Docker Hub can be slow; if it times out,
> configure a registry mirror once:
> `sudo mkdir -p /etc/docker && sudo tee /etc/docker/daemon.json <<< '{"registry-mirrors":["https://docker.m.daocloud.io"]}' && sudo systemctl restart docker`
> (mirror addresses go stale; search for a current one if this fails).

---

## 4. Get the code

```bash
sudo mkdir -p /opt/starcloud && sudo chown $USER /opt/starcloud
cd /opt/starcloud
git clone <your-repo-url> .
```

(No push access locally? rsync/scp an existing code directory up — as long as it has
`Dockerfile`, `deploy/`, and `docs/deploy.md`, it works.)

---

## 5. Configure environment variables

```bash
cp deploy/.env.example deploy/.env
nano deploy/.env   # or vi
```

**Three required changes:**

1. `JWT_SECRET`: generate a random string
   ```bash
   openssl rand -hex 32
   ```
2. `SEED_ADMIN_NAME` / `SEED_ADMIN_PASSWORD`: admin console credentials
3. `CADDY_DOMAIN`: your domain (bare domain, no `https://`, must resolve to this server)

Leave the rest at defaults (`DATABASE_URL` stays as-is; the in-container path is fixed by the
volume mount).

---

## 6. First start

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

- The first build installs dependencies and builds all three packages — **roughly 10–25 minutes
  on 3 Mbps** (npm deps are hundreds of MB; watch the log). Incremental builds after code changes
  take one or two minutes.
- To speed up builds, use a China npm mirror:
  ```bash
  docker compose -f deploy/docker-compose.yml build --build-arg NPM_REGISTRY=https://registry.npmmirror.com
  docker compose -f deploy/docker-compose.yml up -d
  ```
- On startup the container runs database migrations automatically (`prisma migrate deploy`,
  idempotent), then NestJS listens on 3000.

Check status:

```bash
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs -f starcloud caddy
```

---

## 7. First seed (create the admin)

Run once on a fresh database (idempotent: an existing admin with the same name is skipped):

```bash
docker compose -f deploy/docker-compose.yml exec starcloud node dist/seed.js
```

`已创建管理员: xxx` ("created admin: xxx") means success.

---

## 8. Acceptance

1. Open `https://your.domain` in a browser → reader homepage.
2. Log into the reader; the shelf should be empty (fresh database).
3. Admin console (SSH tunnel):
   ```bash
   ssh -L 3000:127.0.0.1:3000 your-user@server-ip
   ```
   then open `http://localhost:3000` locally and log in with `SEED_ADMIN_NAME/PASSWORD`.
4. Upload a test book (PDF/EPUB/TXT) from the console; confirm it appears on the shelf and opens.

> The production database is a fresh one. Book file paths are stored as in-container absolute
> paths (as of upload time) — **do not** copy your dev machine's
> `apps/server/prisma/data/starcloud.db` into the production volume, or books will be "lost".
> The correct way to bring books to production is re-uploading through the console.

---

## 9. Daily updates

```bash
cd /opt/starcloud
git pull
docker compose -f deploy/docker-compose.yml up -d --build
```

- Backend code/dependency changes → `up -d --build` rebuilds the image with a rolling update.
- Database schema changes (new migration files) → applied automatically by
  `prisma migrate deploy` at container start; no manual step.
- Caddyfile-only changes (e.g. new routes) need no rebuild:
  ```bash
  docker compose -f deploy/docker-compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
  ```
- Certificates: Let's Encrypt renews automatically (the `deploy/data/caddy` volume keeps ACME state).

---

## 10. Backup & restore

### Backup (recommend a weekly cron)

```bash
cd /opt/starcloud
tar -czf backup-$(date +%F).tar.gz \
  deploy/data/db \
  deploy/data/uploads \
  deploy/data/caddy \
  deploy/data/caddy-config \
  deploy/.env
```

Store `backup-*.tar.gz` somewhere off-box (object storage / cloud drive).

### Restore

```bash
cd /opt/starcloud
docker compose -f deploy/docker-compose.yml down
rm -rf deploy/data
tar -xzf backup-XXXX-XX-XX.tar.gz   # restores deploy/data and deploy/.env
docker compose -f deploy/docker-compose.yml up -d
```

---

## 11. What 3 Mbps means

- 3 Mbps ≈ **375 KB/s** (3000 kbps ÷ 8).
- A 30 MB EPUB downloads in ~**80 s**; a 100 MB PDF in ~**4.5 min**.
- The site itself (HTML/JS/CSS, tens of KB) loads instantly; `encode gzip zstd` compresses text
  resources.
- The reader streams via `/api/books/:id/download` — read-as-you-download, good for long sessions.
  Acceptable, but **avoid** heavy upload/download churn (>200MB files) on 3 Mbps.
- To speed up later: upgrade bandwidth, or put a CDN in front of Caddy for static assets.

---

## 12. Troubleshooting

| Symptom | Check |
|---|---|
| Certificate never issues | A record not live / ports 80,443 not open; `docker compose logs caddy` |
| Page loads but APIs 401/404 | Make sure you're on `https://domain` (reader & API must be same-origin) |
| Admin console unreachable | Tunnel not up or 3000 occupied; `curl 127.0.0.1:3000` should return the admin page |
| Container restarting in a loop | `docker compose logs starcloud`: check whether a migration failed (schema/data mismatch) |
| Want to reset everything | `docker compose down` then delete `deploy/data/db` (wipes all accounts & progress — be careful) |

---

## 13. Directory quick reference

```
Dockerfile                 # multi-stage backend image (build packages / trim runtime)
.dockerignore              # build-context excludes (node_modules, uploads, secrets…)
deploy/
  docker-compose.yml       # service orchestration (starcloud + caddy)
  caddy.Dockerfile         # frontend container: official caddy base + reader static assets
  Caddyfile                # routing (/api /uploads reverse proxy + SPA fallback)
  .env.example             # env template (copy to .env)
  data/                    # runtime data (db / uploads / caddy certs), gitignored
docs/deploy.md             # this guide (Chinese)
```
