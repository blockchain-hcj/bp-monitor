# Monitors Monorepo

CEX 跨所价差监控 + 量化交易系统。TypeScript monorepo，Node.js 22+。

## 项目结构

```
monitors/
├── src/                    # 主服务：价差监控 (port 18081)
│   ├── connectors/         # 交易所 WebSocket (Binance, OKX, DeepBook)
│   ├── worker/             # Worker Thread，按 CPU 核分片处理 symbol
│   ├── spread/             # BPS 价差计算
│   ├── publisher/          # NATS JetStream 发布 SpreadEvent
│   ├── storage/            # PostgreSQL 存储
│   ├── control/            # uWebSockets HTTP 控制面 + 可视化页面
│   ├── strategy/           # 基差候选 + 均值回归分析
│   ├── discovery/          # Binance/OKX symbol 交集发现
│   ├── universe/           # CORE/WATCH symbol 池管理
│   ├── observability/      # Prometheus metrics
│   └── utils/              # logger, asyncQueue, hash, taskLimiter
│
├── apps/
│   ├── arb-engine/         # 套利执行引擎 (port 18180)
│   ├── basis-cli/          # 基差交易 TUI 工具
│   ├── alert-hub/          # 告警聚合服务 (port 18280)
│   ├── alert-bar/          # macOS 菜单栏告警 App (Electron)
│   └── news-feed/          # 外部信息源接入与新闻告警桥接 (port 18380)
│
├── sdks/
│   └── alert-sdk/          # 告警 SDK (AlertClient + 类型定义)
│
├── db/schema.sql           # PostgreSQL schema
├── docker-compose.yml      # nats + postgres + monitor + arb-engine + alert-hub + news-feed
└── docs/                   # 文档
```

## 核心数据流

```
Binance/OKX WS → connectors → spreadCalculator → NATS (spread.binance_okx.<SYMBOL>)
                                                      ↓
                                                  arb-engine (订阅 → 信号 → 执行)
                                                  basis-cli  (订阅 → TUI 展示)
                                                      ↓
                                              spread_events 表 (PostgreSQL)
```

## 告警链路

```
任意服务 → alert-sdk POST /alerts → alert-hub → WS 广播 → alert-bar (macOS 菜单栏)
外部信息源(BWEnews/Polymarket/RSS) → news-feed → alert-sdk.fire() → alert-hub
```

## 关键类型

- `SpreadEvent` — 定义在 `src/types.ts`，包含 symbol、exchange_a/b、bps_a_to_b/b_to_a、quality_flag 等
- `Alert` / `AckedAlert` — 定义在 `sdks/alert-sdk/src/types.ts`，severity: info|warn|error|critical
- `RuntimeConfig` — 定义在 `src/types.ts`，所有环境变量配置
- `NewsEvent` / `DataSource` — 定义在 `apps/news-feed/src/types.ts`，用于多外部源统一接入

## NATS Subjects

- `spread.binance_okx.<SYMBOL>` — 价差事件（JetStream stream: SPREAD_EVENTS）
- `alerts.>` — 告警事件（可选）

## 数据库

- 表 `spread_events`: PK `(event_time, symbol, event_id)`，payload JSONB
- 索引: `(symbol, event_time DESC)`, `(event_time DESC)`, `(payload->>'exchange_a')`, `(payload->>'exchange_b')`
- 保留 7 天，每小时清理

## 端口

| 服务 | 端口 |
|------|------|
| Monitor 控制面 | 18081 |
| Arb Engine | 18180 |
| Alert Hub | 18280 |
| News Feed | 18380 |
| NATS | 4222 |
| PostgreSQL | 5432 |

## 开发命令

```bash
# 主服务
npm run dev

# 各 app
cd apps/<app> && npm run dev

# Docker 全启
docker compose up -d --build

# 测试 (vitest)
npm test
cd apps/arb-engine && npm test
```

## 技术约定

- ES modules (`"type": "module"`)，TypeScript strict
- 配置全部走环境变量，各 app 有 `.env.example`
- Worker Thread 多核并行（主服务）
- NATS JetStream 做服务间通信
- uWebSockets.js 做主服务 HTTP，其他 app 用 node:http
- alert-bar: Electron + menubar，renderer 用 `<script type="module">` 加载

## News Feed 数据源接入约定

- 统一入口：`apps/news-feed`（单 app 多数据源）
- 每个数据源单文件实现 `DataSource` 接口，注册在 `apps/news-feed/src/index.ts`
- 当前已实现数据源：`BWEnews` (`apps/news-feed/src/sources/bweNews.ts`)
- BWEnews WS：`wss://bwenews-api.bwe-ws.com/ws`，重连策略 `250ms * 2^n`，上限 `10s`
- 启动时可通过 `BWE_NEWS_HTTP_URL` 做一次“拉最新”补偿
- 当 WS 断连或消息陈旧超过 `BWE_NEWS_WS_STALE_MS` 时，可用 HTTP 轮询保底（`BWE_NEWS_HTTP_FALLBACK_ENABLED` + `BWE_NEWS_HTTP_POLL_MS`）
- NewsEvent -> Alert 映射：
  - `source`: `news:<sourceName>`（如 `news:bwenews`）
  - `group`: `news`
  - `severity` 按标题关键字分级（critical/warn/info）
  - `meta`: `coins`, `url`, `source_ts`, `raw`
- `WATCH_COINS` 非空时仅推送命中的币种
