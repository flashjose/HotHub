# 多平台内容聚合 API 系统

基于 FastAPI 的可插拔内容聚合系统，从知乎、微博、Bilibili、抖音、百度、今日头条、IT之家等平台采集热点，并提供统一 RESTful API。

## 核心功能

| 功能 | 说明 |
|------|------|
| 可插拔采集 | 内置 7 个平台插件，标准化 REST 接口输出 |
| 插件热加载 | 运行时动态加载/重载/卸载插件，无需重启服务 |
| 统一数据模型 | `HotItem` 统一字段 + `field_mapper` 映射层 |
| 反爬策略 | User-Agent 轮换、按 host 限流、Cookie 池 |
| Redis 缓存 | 接口缓存层，未配置 Redis 时自动回退内存缓存 |
| 前端看板 | Swiss Minimalism 纯黑白极简风格，文字驱动排名列表 |
| 插件文档 | 见 [docs/PLUGIN_DEVELOPMENT.md](docs/PLUGIN_DEVELOPMENT.md) |

## 前端看板

访问 `http://127.0.0.1:8000/` 打开聚合视图：

- **文字驱动列表** — 单列排名布局，标题为主、图片为辅（右侧小缩略图）
- **分类/平台筛选** — 按 AI、科技、互联网等分类 + 7 个平台独立过滤
- **客户端分页** — 每页 20 条，翻页控件支持页码省略（`1 … 4 5 6 … 12`）
- **亮/暗双主题** — 纯黑白 Swiss Modernism 调色板，墨色渲染圆形扩散切换动画
- **封面图代理** — 后端 `/img` 端点绕过防盗链，SSRF 白名单保护
- **骨架屏加载** — shimmer 动画占位，无转圈 spinner
- **响应式** — 375 / 720 / 1024 / 1440 四档断点适配

## 技术栈

Python · FastAPI · requests · BeautifulSoup4 · Redis · Docker · Vanilla JS/CSS

## 本地运行

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
```

可选环境变量：

```bash
# Redis 缓存
export REDIS_URL=redis://127.0.0.1:6379/0

# Cookie 池（JSON 格式，按域名分配）
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
| GET | `/hotspots?limit=50` | 聚合全部平台热点 |
| GET | `/hotspots/{platform}?limit=10` | 单平台热点 |
| GET | `/img?url=<封面URL>` | 封面图代理（防盗链绕过，仅白名单 CDN） |
| POST | `/plugins/load` | 热加载外部插件文件 |
| POST | `/plugins/reload` | 重载全部插件 |
| POST | `/plugins/reload/{platform}` | 重载单个插件 |
| DELETE | `/plugins/{platform}` | 卸载插件 |

## Docker 运行

```bash
docker compose up --build
```

## 新增平台插件

1. 在 `app/plugins/sources/` 新增插件文件，继承 `HotspotPlugin`。
2. 使用 `http_client` 发起请求，通过 `map_to_hot_item()` 映射字段。
3. 重启服务或通过 `POST /plugins/reload` 热加载。

完整开发指南与示例代码见 [docs/PLUGIN_DEVELOPMENT.md](docs/PLUGIN_DEVELOPMENT.md)。

## 测试

```bash
pytest tests/ -q
```
