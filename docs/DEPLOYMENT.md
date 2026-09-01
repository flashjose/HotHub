# 部署指南

以 Ubuntu 24.04 + Docker + nginx 反代 + Let's Encrypt 为例，域名 `hot.clashrose.cn`。

## 目录

- [前置条件](#前置条件)
- [1. 部署应用](#1-部署应用)
- [2. nginx 反向代理](#2-nginx-反向代理)
- [3. HTTPS 证书](#3-https-证书)
- [4. 防火墙](#4-防火墙)
- [日常运维](#日常运维)
- [排错](#排错)

## 前置条件

**DNS** — 在域名商处添加 A 记录，主机名指向服务器公网 IP：

```bash
dig +short hot.clashrose.cn     # 应返回服务器 IP
```

**关键：确认境外能解析。** Let's Encrypt 的验证节点全在境外，且采用多点校验。如果域名的权威 NS 只部署在中国大陆（阿里云免费版 DNS 就是这样，NS 为 `dnsXX.hichina.com`），境外递归解析器查询时会间歇性超时，证书签发和三个月后的自动续期都会失败。

```bash
# 从境外公共解析器验证，连查 5 次确认稳定性
for i in 1 2 3 4 5; do dig @1.1.1.1 +short +time=3 hot.clashrose.cn; sleep 5; done
```

也可以用 https://unboundtest.com/ ——它完全复刻了 Let's Encrypt 的 Unbound 配置。若结果时好时坏，把 DNS 托管迁到 Cloudflare（免费，全球 anycast）再继续。

**备案** — `.cn` 域名 + 中国大陆服务器，80/443 需要 ICP 备案。境外服务器不涉及；更换 DNS 服务商也不影响备案状态。

**Docker**

```bash
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
sudo usermod -aG docker $USER && newgrp docker    # 免 sudo，注意该组等价 root
```

## 1. 部署应用

```bash
git clone <repo> ~/HotHub && cd ~/HotHub

cp .env.example .env      # 需要 Cookie 池时编辑，否则可跳过
docker compose up -d --build

docker compose ps                       # api / redis 均为 running (healthy)
curl -sS http://127.0.0.1:8000/health   # {"status":"ok"}
```

`docker compose ps` 的 PORTS 列应显示 `127.0.0.1:8000->8000/tcp`，redis 那行为空。**若看到 `0.0.0.0:6379`，立即停下** —— 无密码 Redis 正暴露在公网上，且 ufw 挡不住（见[排错](#redis-或-8000-暴露在公网)）。

## 2. nginx 反向代理

```bash
sudo apt update && sudo apt install -y nginx

sudo cp deploy/nginx.conf /etc/nginx/sites-available/hothub
sudo ln -sf /etc/nginx/sites-available/hothub /etc/nginx/sites-enabled/hothub
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t && sudo systemctl reload nginx
curl -I http://hot.clashrose.cn         # 200
```

配置要点见 [deploy/nginx.conf](../deploy/nginx.conf) 内的注释，其中 `/plugins/` 必须封禁：该接口无鉴权且会按传入路径 import 服务器上的 Python 文件。

## 3. HTTPS 证书

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d hot.clashrose.cn --redirect
```

首次运行会询问邮箱（用于到期提醒）。certbot 自动改写站点配置、追加 443 块、把 80 改为 301 跳转并 reload。

```bash
curl -I https://hot.clashrose.cn        # HTTP/2 200
curl -I http://hot.clashrose.cn         # 301 -> https
sudo systemctl status certbot.timer     # active，负责自动续期
sudo certbot renew --dry-run            # 演练续期流程
```

> **失败配额**：同一域名验证失败每小时上限 5 次，用完锁一小时。先把 DNS 确认好再跑，别循环重试。

## 4. 防火墙

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

云厂商的安全组（Azure NSG、阿里云安全组等）同样只放行 22 / 80 / 443。**8000 和 6379 不要开。**

## 日常运维

| 操作 | 命令 |
|---|---|
| 前端改动生效 | `git pull` —— static/ 是挂载卷，无需重启 |
| 插件改动生效 | `git pull && curl -X POST 127.0.0.1:8000/plugins/reload` |
| 后端代码更新 | `git pull && docker compose up -d --build` |
| 查看日志 | `docker compose logs -f api` |
| 重启 | `docker compose restart api` |
| 停止 | `docker compose down`（加 `-v` 会一并删除 Redis 数据卷） |
| 健康状态 | `docker compose ps` 的 STATUS 列 |

改动 `.env` 后需 `docker compose up -d` 让容器带新环境变量重建（`restart` 不会重读 .env）。

## 排错

### 页面 502 Bad Gateway

nginx 通了但后端没起来：

```bash
curl -sS http://127.0.0.1:8000/health
docker compose ps
docker compose logs --tail 50 api
```

### certbot 报 `query timed out looking up A`

不是服务器问题，是权威 DNS 从境外查不到。注意区分两种报错：

- `NXDOMAIN` / `no valid A records` → 记录没生效或写错了
- `query timed out` → 查询收不到应答，权威服务器境外不可达

后者按[前置条件](#前置条件)里的方案迁移 DNS 托管。报错中出现 `During secondary validation` 说明主验证点已成功连上你的 nginx —— HTTP 链路（安全组、nginx、后端容器）都是通的，问题纯在 DNS。

### Redis 或 8000 暴露在公网

`docker compose ps` 显示 `0.0.0.0:6379` 或 `0.0.0.0:8000` 即为暴露。**ufw 不管用** —— Docker 发布端口时直接往 iptables 的 DOCKER 链插规则，绕过 ufw 的 INPUT 链。唯一可靠的办法是不发布端口，或绑定到 `127.0.0.1`，即本仓库 [docker-compose.yml](../docker-compose.yml) 的做法。

### 某个平台列表为空

```bash
docker compose logs api | grep -i <平台名>
```

多数是目标站点要求 Cookie（微博尤其明显）或改了接口。前者在 `.env` 里配置 `COOKIE_POOL`，后者需要更新对应插件，见 [PLUGIN_DEVELOPMENT.md](PLUGIN_DEVELOPMENT.md)。

### favicon / 前端改了没变化

favicon 是浏览器缓存最顽固的资源，用 `Ctrl+Shift+R` 强刷。若仍旧，确认容器内文件已更新：

```bash
docker compose exec api ls -l /app/static/img/
```
