# 多平台内容聚合 API 系统

基于 FastAPI 的可插拔内容聚合系统，从知乎、微博、Bilibili、抖音、百度、今日头条、IT之家等平台采集热点，并提供统一 RESTful API。

## 核心功能

| 功能 | 说明 |
|------|------|
| 可插拔采集 | 内置 7 个平台插件，标准化 REST 接口输出 |
| 插件热加载 | 运行时动态加载/重载/卸载插件，无需重启服务 |
| 统一数据模型 | `HotItem` 统一字段 + `field_mapper` 映射层 |
| 反爬策略 | User-Agent 轮换、按 host 限流、Cookie 池、指数退避重试 |
| 分级缓存 | Redis 优先，未配置或故障时自动回退内存缓存；成功/失败差异化 TTL |
| 故障隔离 | 单平台抓取失败降级为 `source_status=error`，不影响其余平台 |
| 前端看板 | 零依赖原生实现，纸绘手稿风格，View Transitions 主题切换 |
| 可观测性 | `/stats` 命中率与响应时延，`/system/status` 依赖真实探活 |

## 架构

```
app/
├── main.py              FastAPI 入口：路由、图片代理、缓存头中间件
├── models.py            Pydantic 数据模型（HotItem / HotspotCollection / ...）
├── schemas.py           请求响应 Schema
├── core/                基础设施层（不依赖上层）
│   ├── config.py        环境变量 → 冻结 dataclass
│   ├── cookie_pool.py   按域名的 Cookie 轮换池
│   ├── rate_limiter.py  按 host 的最小请求间隔
│   └── field_mapper.py  平台异构字段 → HotItem 归一化
├── plugins/             插件层
│   ├── base.py          HotspotPlugin 抽象基类
│   ├── registry.py      运行时插件注册表
│   ├── loader.py        importlib 动态发现 / 重载 / 文件加载
│   └── sources/         7 个内置平台插件
└── services/            服务层
    ├── http_client.py   带反爬策略的统一出站客户端
    ├── cache.py         CacheBackend 抽象 + Redis/内存双实现
    ├── hotspot_service.py  抓取编排、缓存读写、降级
    ├── plugin_manager.py   注册表与加载器的协调
    └── system_status.py    依赖探活
```

请求链路：

```
GET /hotspots
  └─ HotspotService.get_all
       └─ 逐平台 get_platform
            ├─ cache.get_json          命中 → 直接返回（Redis 或内存）
            └─ plugin.fetch(limit)     未命中 → 走 http_client
                 ├─ HostRateLimiter    按 netloc 等待最小间隔
                 ├─ UA 轮换 + Cookie 池注入
                 ├─ 失败重试（仅网络类异常，线性退避）
                 └─ field_mapper       异构字段 → HotItem
            └─ cache.set_json          成功 TTL 900s / 失败 TTL 30s
```

## 技术实现

### 插件系统：三种加载路径

[loader.py](app/plugins/loader.py) 用 `importlib` 的三套 API 覆盖不同场景：

| 场景 | 实现 |
|---|---|
| 启动时发现内置插件 | `pkgutil.iter_modules` 扫描 `app.plugins.sources` 包 |
| 重载已加载的插件 | `importlib.reload(sys.modules[name])`，改代码后无需重启 |
| 加载任意路径的外部插件 | `importlib.util.spec_from_file_location` + `exec_module` |

插件类的提取靠 `inspect.getmembers` + `issubclass` 反射，并显式跳过抽象类（`inspect.isabstract`），避免把中间基类误注册。外部加载时模块名带上路径哈希（`dynamic_plugin_{stem}_{hash}`），防止同名文件互相覆盖 `sys.modules`；同时强制"一个文件一个插件"，出现多个直接抛错而不是静默取第一个。

新增平台只需继承 [`HotspotPlugin`](app/plugins/base.py) 并实现 `fetch(limit)`，抽象基类只有一个必需方法。

### 数据归一化

各平台接口字段五花八门（`hot_value` / `heat_score` / `hotIndex`…），[field_mapper.py](app/core/field_mapper.py) 收敛到统一的 [`HotItem`](app/models.py)：

- `map_to_hot_item()` — 单条映射。空标题直接抛 `ValueError`（脏数据早失败），空字符串统一转 `None`，原始载荷完整保留在 `raw` 字段供插件二次使用。
- `map_batch()` — 批量映射，各字段的源 key 可逐个覆盖；`rank` 缺失时按枚举序号回填。

`HotItem.url` / `cover_url` 用 Pydantic 的 `HttpUrl` 类型，非法 URL 在模型层就被拦下，不会流到前端。

### 缓存：抽象后端 + 差异化 TTL

[cache.py](app/services/cache.py) 定义 `CacheBackend` 抽象，`RedisCache` 与 `MemoryCache` 两个实现，`build_cache()` 按 `REDIS_URL` 是否配置来选择。两个设计点：

**Redis 故障不影响可用性** —— `RedisCache` 把所有 `RedisError` 吞掉并计为 miss，Redis 挂掉时服务退化为直连抓取而不是 500。

**成功与失败用不同 TTL** —— 见 [hotspot_service.py:72](app/services/hotspot_service.py#L72)：

```python
ttl = settings.cache_ttl_seconds if ok else settings.error_cache_ttl_seconds
```

成功缓存 900 秒，失败只缓存 30 秒。如果失败也按 900 秒缓存，一次网络抖动会把某个平台钉死在"不可用"状态整整 15 分钟。

### 反爬与网络健壮性

[http_client.py](app/services/http_client.py) 是唯一的出站入口，所有插件共用一个 `requests.Session`：

- **UA 轮换** — 5 个真实浏览器 UA（Win/Mac/Linux/iOS 混合），每次请求随机选，重试时也会换新的。
- **按 host 限流** — [`HostRateLimiter`](app/core/rate_limiter.py) 以 `netloc` 为键记录上次请求时间，加锁保证多线程下不会突刺。FastAPI 的同步端点跑在线程池里，这个锁是必需的。
- **Cookie 池** — [`CookiePool`](app/core/cookie_pool.py) 按域名分配，支持后缀匹配（`weibo.com` 命中 `s.weibo.com`）与 `*` 兜底，`round_robin` / `random` 两种轮换策略。
- **选择性重试** — 只对 `ConnectionError` / `Timeout` 重试（SSL EOF、RST 这类瞬时故障），HTTP 4xx/5xx 经 `raise_for_status()` 直接抛出不重试，避免对着 403 空转。退避时长随尝试次数线性增长。
- **默认不吃系统代理** — `session.trust_env = False`，容器内不会因为宿主机的 `HTTP_PROXY` 环境变量意外走代理。

7 个插件中 6 个走平台 JSON 接口，IT之家走 HTML 解析（BeautifulSoup）。

### 故障隔离

[hotspot_service.py:52-64](app/services/hotspot_service.py#L52-L64) 对每个平台单独 try/except。任一平台抓取失败时，返回体里该平台标记为 `source_status="error"` 并附上 `error` 信息与 `fallback_items()` 的兜底内容，其余平台正常返回。聚合接口因此不会被单个平台拖垮。

### 图片代理与 SSRF 防护

封面图多在 http-only 且开了防盗链的 CDN 上，浏览器直连拿不到。[`/img`](app/main.py#L109-L133) 端点服务端转发：

- **SSRF 白名单** — 17 个已知图片 CDN 域名后缀，`_host_matches` 做精确的后缀边界匹配（`host == suffix or host.endswith("." + suffix)`），杜绝 `evil-hdslb.com` 这类绕过，更不允许指向内网地址。
- **按 host 匹配 Referer** — 不同 CDN 认不同的来源站，映射表逐一对应。
- **Content-Type 收敛** — 上游返回非 `image/*` 时强制改写为 `image/jpeg`，防止把 HTML 当图片吐给浏览器。
- **失败转 404** — 上游 403/超时统一转成 404，前端 `onerror` 直接移除缩略图节点，退化为纯文字条目。

### 可观测性

- `/stats` — 平台数、缓存内条目总数、平均响应时延（最近 200 次的滑动窗口）、缓存命中率。刻意只读缓存，不触发外部抓取。
- `/system/status` — Redis 走真实 `PING` 探活而非看配置项，MySQL 走 TCP `create_connection` 探活，进程 uptime 取自模块导入时刻。未配置 Redis 时诚实返回 `memory` 而不是伪装成 online。

## 前端看板

访问 `http://127.0.0.1:8000/` 打开聚合视图。**零构建、零依赖** —— 448 行原生 JS + 891 行 CSS，没有框架也没有打包步骤，改完刷新即生效。

- **纸绘手稿风格** — 蓝图纸底 `#d9eaf8` + 铁锈红强调 `#b8442e`，手写体（Caveat / 芝麻行楷）与 Inter 混排。边框的手绘抖动由 SVG `feTurbulence` + `feDisplacementMap` 位移滤镜实现，**只作用于轮廓伪元素**——直接作用在含文字的盒子上会把 13–16px 的中文糊成一团。
- **交错聚合** — 各平台按 rank 逐层交错（`platforms[i]` 轮流取第 i 条），首页读起来是一条聚合信息流，而不是七个平台分块罗列。
- **墨色扩散主题切换** — View Transitions API 配合 `clipPath: circle()` 从按钮圆心扩散，半径取到视口最远角。不支持的浏览器降级为瞬时切换，切换期间加锁防连点。主题三态循环 `system → light → dark`，`localStorage` 持久化，跟随系统时监听 `matchMedia` 变化。
- **客户端分类** — 关键词匹配划分 AI / 科技 / 互联网 / 财经 / 娱乐 / 体育 六类，未命中归入"社会"，各分类实时计数。
- **分页** — 每页 20 条，`buildPageRange` 生成带省略号的页码（`1 … 4 5 6 … 12`）。
- **XSS 防护** — 所有动态插值经 `esc()` 转义（`& < > " '` 五字符）。
- **骨架屏** — shimmer 占位而非转圈 spinner；缩略图 `loading="lazy"` + `decoding="async"`，加载失败自动移除节点。
- **响应式** — 1024 / 768 / 480 / 360 四档断点，并适配 `prefers-reduced-motion` 与 `prefers-color-scheme`。

后端中间件对 `/` 和 `/static` 强制 `Cache-Control: no-cache`（见 [main.py:87-96](app/main.py#L87-L96)），走 ETag 重新校验——UI 改动普通刷新就能看到，未变更的文件仍返回 304。

## 技术栈

| 层 | 选型 |
|---|---|
| Web 框架 | FastAPI 0.115 + Uvicorn（standard extras） |
| 数据校验 | Pydantic 2.10（`HttpUrl`、`model_validate`、`model_dump(mode="json")`） |
| 采集 | requests 2.32 + BeautifulSoup4 4.12 |
| 缓存 | Redis 7（`redis-py` 5.2），内存缓存兜底 |
| 前端 | 原生 JS / CSS，无框架无构建；View Transitions API、SVG Filters |
| 部署 | Docker Compose + nginx 反代 + Let's Encrypt |
| 测试 | pytest 8.3 + `httpx` / FastAPI `TestClient` |

## 本地运行

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
```

可选环境变量（完整列表见 [.env.example](.env.example)）：

```bash
# Redis 缓存，不配置则自动使用内存缓存
export REDIS_URL=redis://127.0.0.1:6379/0

# Cookie 池（JSON 格式，按域名分配，"*" 为兜底）
export COOKIE_POOL='{"weibo.com":["your_cookie"],"*":["fallback_cookie"]}'
export COOKIE_STRATEGY=round_robin

# 外部插件目录
export PLUGIN_DIR=plugins
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/platforms` | 已注册平台列表 |
| GET | `/hotspots?limit=50&refresh=false` | 聚合全部平台热点，`refresh=true` 跳过缓存 |
| GET | `/hotspots/{platform}?limit=10` | 单平台热点 |
| GET | `/stats` | 平台数、条目数、平均时延、缓存命中率 |
| GET | `/system/status` | 依赖组件探活与 uptime |
| GET | `/img?url=<封面URL>` | 封面图代理（防盗链绕过，仅白名单 CDN） |
| POST | `/plugins/load` | 热加载外部插件文件 |
| POST | `/plugins/reload` | 重载全部插件 |
| POST | `/plugins/reload/{platform}` | 重载单个插件 |
| DELETE | `/plugins/{platform}` | 卸载插件 |

交互式文档：`/docs`（Swagger UI）与 `/redoc`。

## Docker 运行

```bash
cp .env.example .env      # 可选：配置 Cookie 池等
docker compose up -d --build
```

`static/` 与 `plugins/` 以只读卷挂载进容器，改动这两个目录无需重建镜像。

## 生产部署

nginx 反向代理 + Let's Encrypt HTTPS 的完整流程见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)，站点配置模板见 [deploy/nginx.conf](deploy/nginx.conf)。

两点务必注意：

- `/plugins/*` 接口无鉴权且会按传入路径 import Python 文件，公网必须由 nginx 封禁。
- Docker 发布端口会绕过 ufw，Redis 与 8000 端口只能绑定 `127.0.0.1`，不能指望防火墙。

## 新增平台插件

1. 在 `app/plugins/sources/` 新增插件文件，继承 `HotspotPlugin`。
2. 使用 `http_client` 发起请求，通过 `map_to_hot_item()` 映射字段。
3. 重启服务或通过 `POST /plugins/reload` 热加载。

完整开发指南与示例代码见 [docs/PLUGIN_DEVELOPMENT.md](docs/PLUGIN_DEVELOPMENT.md)，可运行示例见 [examples/sample_plugin.py](examples/sample_plugin.py)。

## 测试

```bash
pytest tests/ -q
```

覆盖插件注册表、动态加载器、Cookie 池轮换、API 端点与模块导入路径。
