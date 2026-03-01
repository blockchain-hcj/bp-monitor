# BweNewsSource 执行逻辑

本文档说明 `apps/news-feed/src/sources/bweNews.ts` 的运行流程、状态字段和 WS/HTTP 协同策略。

## 1. 目标

`BweNewsSource` 实现 `DataSource` 接口，职责是：

- 从 BWEnews WebSocket 持续接收新闻
- 在启动阶段补一轮 HTTP“最新消息”
- 在 WS 断连或陈旧时启用 HTTP 轮询兜底
- 将消息统一转换为 `NewsEvent` 并通过 `onEvent` 向上游输出
- 提供可观测健康状态（`health()`）

## 2. 构造参数

来自 `BweNewsSourceOptions`：

- `wsUrl`: WebSocket 地址（必填）
- `httpUrl`: HTTP 拉取地址（可选）
- `httpFallbackEnabled`: 是否开启 HTTP 兜底轮询
- `httpPollMs`: HTTP 轮询间隔，最小钳制为 `1000ms`
- `wsStaleMs`: WS 陈旧阈值，最小钳制为 `3000ms`

## 3. 生命周期

### 3.1 `start()`

启动顺序：

1. `closed=false`
2. 建立 WS 连接：`openWs()`
3. 立即执行一次 HTTP 拉取：`pollHttpLatest("bootstrap")`（不阻塞）
4. 若满足 `httpFallbackEnabled && httpUrl`，启动定时器周期执行 `pollHttpLatest("fallback")`

### 3.2 `close()`

关闭顺序：

1. 标记 `closed=true`、`connected=false`
2. 清理重连定时器 `reconnectTimer`
3. 清理 HTTP 轮询定时器 `httpPollTimer`
4. 解绑并关闭 WS

## 4. WS 主链路

`openWs()` 内部行为：

- `open`: 设置 `connected=true`，清空 `lastError`
- `message`:
  1. 更新 `lastMessageAtMs=Date.now()`
  2. JSON parse（失败写入 `lastError`）
  3. 结构校验：必须是对象且 `news_title` 非空
  4. 转换为 `NewsEvent`
  5. 走 `emitIfNew(event)` 去重后回调 `onEvent`
- `error`: 更新 `lastError`
- `close`: 设置 `connected=false`，若未关闭则进入指数退避重连

## 5. 重连策略

`scheduleReconnect()`：

- `reconnects += 1`
- 延迟 `delayMs = min(10000, 250 * 2^min(reconnects, 6))`
- 到时若未 `closed`，重新 `openWs()`

即：250ms, 500ms, 1s, 2s, 4s, 8s, 10s(封顶)...

## 6. HTTP 逻辑（补偿 + 兜底）

`pollHttpLatest(mode)` 规则：

- 前置条件：`httpUrl` 存在且未关闭
- `bootstrap`：总是尝试一次
- `fallback`：仅在以下任一条件成立时才拉取：
  - `!connected`（WS 未连接）
  - `Date.now() - lastMessageAtMs > wsStaleMs`（WS 消息陈旧）

拉取流程：

1. `GET httpUrl`，`accept: application/json`
2. 非 2xx：`lastError = "http_<status>"`
3. 按响应类型解析：
   - `content-type` 或 body 特征为 XML/RSS/Atom：走 XML 解析
   - 否则走 JSON 解析
4. 选择输出策略：
   - `bootstrap`：只发当前最新一条
   - `fallback`：优先发“新于 lastEmittedTsSec”的增量；若无增量，仅尝试当前最新一条
5. 逐条走 `emitIfNew`

JSON 支持三种响应形态：

- 数组：`[...]`
- 对象数组字段：`{ data: [...] }` 或 `{ items: [...] }`
- 单对象：`{ ... }`

XML 支持：

- RSS `<item>`（`title/description/link/pubDate/guid`）
- Atom `<entry>`（`title/summary|content/link href/updated|published/id`）
- 标题/正文清洗：处理 `<br/>`、移除噪音行（例如 `Auto match could be wrong`）并做基础文本归一化

## 7. 去重策略

`emitIfNew(event)` 的 key：

`<timestamp>|<title>|<url>`

实现方式：

- `seenKeys: Set` 判重
- `seenQueue: string[]` 维护插入顺序
- 最大容量 `maxSeen=500`，超出时淘汰最老 key

目的：消除 WS 与 HTTP 重叠推送，以及短时重连重复消息。

## 8. 字段转换规则

输入字段（BWE payload）：

- `source_name`
- `news_title`
- `news_body`
- `coins_included`
- `url`
- `timestamp`

输出 `NewsEvent`：

- `sourceName`: `source_name`，缺省为 `"bwenews"`
- `title`: `news_title.trim()`
- `body`: `news_body?.trim()`
- `url`: `url?.trim()`
- `coins`: `coins_included` 映射为大写币种数组
- `timestamp`: 秒级时间戳（毫秒输入会自动除以 1000）
- `raw`: 原始对象

## 9. 健康状态定义

`health()` 返回：

- `source`: `"bwenews"`
- `connected`: WS 是否在线
- `reconnects`: 累计重连次数
- `lastMessageAtMs`: 最近收到 WS 消息时间（毫秒）
- `lastError`: 最近错误（可空）

注意：`lastMessageAtMs` 仅由 WS 消息更新，不包含 HTTP 拉取时间。

## 10. 与上游 index.ts 的协作

`index.ts` 对 `BweNewsSource` 的使用流程：

1. 注入配置并创建 source
2. 绑定 `source.onEvent`
3. 执行币种过滤（`WATCH_COINS`）
4. 映射为 Alert（`severity/source/group/meta`）
5. `AlertClient.fire()` 推送到 `alert-hub`

## 11. 已知边界

- 若 `BWE_NEWS_HTTP_URL` 为空，则仅 WS 模式
- HTTP 端字段变化时，可能导致抽取为空（不会抛错，只是不产出事件）
- 去重 key 不含 `body/raw`，同标题同时间同 URL 会被视为同一条
