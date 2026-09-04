# whistle.jmeter-exporter

基于 [Whistle](https://wproxy.org/whistle/) 的插件：捕获经过代理的 HTTP/HTTPS 流量，在插件 UI 中勾选请求，一键导出 **JMeter `.jmx` 脚本** 或 **CSV 报文数据**。

适合把真实浏览器操作转成压测脚本草稿，或把请求/响应落地成表格做分析。

---

## 功能一览

| 类别 | 能力 |
|------|------|
| 捕获 | 实时抓取请求/响应；**WebSocket 握手与双向帧** / gRPC 协议标记；过滤静态资源；二进制体标记；multipart 文件落盘 |
| 控制 | 暂停捕获；按主机/路径过滤；连续相同请求去重 |
| 列表 | 摘要列表、筛选、详情、勾选、删除、暂停刷新 |
| 存储 | 默认 SQLite 落盘（最多 10000 条）；可改用已配置的 MySQL / **PostgreSQL**；无 sqlite 时回退 JSON；重启不丢 |
| 参数关联 | Token / 游标 / 响应头 / Location / CSRF；导出前可预览勾选；签名字段跳过 |
| 后置操作 | 响应报文侧提取变量、断言、数据库操作；顶部可管理数据库连接；导出写入 JMeter 提取器 / 断言 / JDBC |
| JMX | Cookie Manager、JDBC 连接配置、状态码断言、察看结果树、HTTP Request Defaults、可配线程/循环/Ramp-up、`${uploadDir}` |
| CSV | UTF-8 BOM、ISO 时间列、Multipart 列，可直接用 Excel 打开 |
| 压测 | 内置 HTTP 压测（并发用户、Ramp-up、时长）；报告列表、趋势图、PDF 导出；阈值告警 + Webhook（飞书/lark/json） |
| 分享文档 | Markdown/HTML/DOC 在线分享；媒体上传；`.wjesync` 跨节点同步；MemoryBridge 记忆锚点 |
| 规则 | 插件内编辑 Whistle `rules.txt` |
| Agent | MemoryBridge handover 约定；`npm run check:memory-bridge` 自检；分享区 MB 状态徽章 |

**当前版本**：见 `package.json`（当前为 `1.1.22`）。**Node**：`>=22.5.0`（内置 `node:sqlite`）。

---

## 功能说明

### 1. 流量捕获

经过 Whistle 的 HTTP/HTTPS 请求由 `resStatsServer` 入库，业务流量 `passThrough`，不中断页面。

- 基于 HTTP/HTTPS 捕获；**WebSocket 升级握手**与 **gRPC**（`content-type: application/grpc`）会在列表与详情中标记（帧级流量后续扩展）
- 自动跳过 Whistle 自身流量（`local.whistlejs.com`、本机 `8899/8900`、插件路径），避免把插件轮询写进列表
- 按 URL pathname 后缀过滤静态资源：`css` / `js` / 图片 / 字体 / 音视频等
- 若响应带 `gzip` / `deflate` / `br`（或 body 是 gzip 魔数），入库前先解压
- 普通请求/响应体超过 **1MB** 截断
- 疑似二进制体不保存文本，记录标记为 `*BodyBinary`，详情和 CSV 显示 `[binary]`
- `multipart/form-data` 单独解析（见「文件上传」）
- 捕获或落盘出错时，插件页顶部显示错误条（可关闭）

#### 协议支持边界

| 协议或模式 | 当前能力 | 说明 |
|------|------|------|
| HTTP / HTTPS | 支持完整请求级录制 | 记录请求/响应头、Body、状态码、耗时，并支持 JMX、CSV、k6、Postman 导出 |
| REST / HTTP RPC | 支持 | REST、JSON-RPC over HTTP 等均按普通 HTTP 请求处理 |
| WebSocket / WSS | 支持握手和帧级旁路录制 | 通过 Whistle `wsReqRead/wsResRead` hook 捕获双向帧；支持 JSON-RPC 解码，不改变原始转发数据 |
| gRPC over HTTP/2 | 支持请求标记 | 根据 `application/grpc` 等特征识别；当前不解析 HTTP/2/gRPC 帧、Protobuf 方法和流式消息 |
| Multipart HTTP | 支持 | 解析文本字段并保存上传文件，属于 HTTP 请求体能力 |

HTTP 记录仍由 `resStatsServer.js` 的请求事件驱动；WebSocket 帧则由插件入口的 `wsReqRead/wsResRead` hook 旁路捕获，独立保存到 `data/websocket-frames.json`，不会混入 HTTP `records` 表。

#### 可扩展协议

建议按以下优先级扩展：

1. **WebSocket 帧与 JSON-RPC**：当前已通过 Whistle hook 实现；采集 `connectionId`、方向、时间、opcode、payload，并在识别 JSON-RPC 后提取 `id`、`method`、`params`、`result`。
2. **Socket.IO / STOMP over WebSocket**：复用 WebSocket 帧采集器，增加协议解码器，不应把协议解析硬编码到 `resStatsServer.js`。
3. **SSE**：在 HTTP 流式响应上增加事件分片和断线重连信息，不能依赖等待完整 response end。
4. **gRPC unary / streaming**：需要 HTTP/2 帧和 `.proto` 或反射信息，解析成本高于 WebSocket JSON-RPC，应独立实现 Protobuf 解码与流消息模型。
5. **MQTT over WebSocket**：在 WebSocket 帧之上增加 MQTT packet 解码器，保留 topic、QoS、packet id 等字段。

推荐的扩展结构是“传输层采集器 → 协议解码器注册表 → 统一消息模型 → 存储与导出器”：

```text
HTTP request / WebSocket frame / HTTP2 frame
  -> capture adapter
  -> protocol decoder (json-rpc / socket.io / grpc / mqtt)
  -> session + message records
  -> UI replay / assertion / JMX or k6 exporter
```

当前已提供 `lib/protocolDecoders.js`、`lib/websocketFrameAdapter.js` 和 `lib/websocketFrameCapture.js`：Whistle 2.10.9 及支持 `wsReqRead/wsResRead` 的版本会自动捕获双向帧；独立代理也可调用 `createWebSocketFrameAdapter(options).attach(source)` 接入。帧查询 API 为 `GET /api/websocket-frames`，可用 `connectionId` 过滤；清空 API 为 `POST /api/websocket-frames/clear`。不支持这些 hook 的 Whistle 版本会继续保留握手标记，但不会自动产生帧记录。详细操作见 [`docs/websocket-frame-capture.md`](docs/websocket-frame-capture.md)。

### 2. 捕获控制

在插件 UI 工具栏配置，写入 `data/config.json`，重启后仍生效。

| 项 | 说明 |
|----|------|
| 暂停捕获 | 停止写入列表；代理仍透传。与「暂停刷新」独立 |
| 只捕获主机 | 主机名包含该字符串才入库，如 `api.example.com` |
| 只捕获路径 | 路径或 query 包含该关键字才入库 |
| 去重连续相同请求 | 默认开启；连续相同 Method + URL 只保留一条，避免轮询刷爆 |

Whistle Rules 仍可先收窄范围，例如：

```text
www.example.com whistle.jmeter-exporter://
```

### 3. 列表、筛选与详情

- 列表按时间倒序，最新请求始终在最上（导出 / 参数关联仍按捕获先后）
- URL 后显示 **name**（路径末段）、**Type**（响应 Content-Type）、**Initiator**（Referer）、**Size**（响应大小）、**response Time**（请求开始至响应结束总耗时；默认 ms，满 1 秒自动换成 s；超过 3 秒标红）、**captured_time**（捕获时间）
- 点击一行再拉完整请求/响应；JSON 体会格式化
- 顶部 **数据库连接**：列表管理 MySQL / PostgreSQL / SQL Server / MongoDB 连接（名称、说明、地址）；SQL 后置数据库操作可选用前三种关系型数据库，MongoDB 支持账号密码连接测试
- 响应报文右侧 **后置操作 → 提取变量 / 断言 / 数据库操作**：JSONPath 工具；断言支持 JSON / Header / Text / HTTP Code；数据库操作用于导出 JDBC 后置处理器
- 可按 URL、HTTP 方法、状态码（2xx/3xx/4xx/5xx）筛选；默认隐藏 OPTIONS
- 有上传文件的请求在 URL 后标 📎
- 全选只作用于当前筛选结果
- 默认每 5 秒刷新，保留勾选；可暂停自动刷新
- **删除勾选** 只删选中行；**清空** 删除全部记录及对应上传文件
- 顶部统计：条数、筛选数、已选数；旁侧徽章标明当前存储（SQLite / MySQL / JSON），点击可切换落盘方式

未勾选就导出时，会确认后导出**当前筛选结果**，不是内存里的全部记录。

### 4. 数据落盘

| 文件 | 用途 |
|------|------|
| `data/records.sqlite` | 默认存储（Node 22.5+ 内置 `node:sqlite`） |
| `data/records.json` | sqlite 不可用时的回退；旧 JSON 会在首次启动迁入 SQLite |
| MySQL 表 `wje_records` | 可选；独立列写入请求/响应头、请求体、响应体大小、Timing、Status、时间 |
| `data/config.json` | 捕获开关、过滤条件、落盘引擎 |
| `data/uploads/` | multipart 上传文件，按记录 id 分目录 |
| `data/extractVars.json` | 提取变量备份；表 `wje_extract_vars` |
| `data/assertions.json` | 断言备份；表 `wje_assertions` |
| `data/postOps.sqlite` | 后置操作 SQLite：提取 / 断言 / 数据库操作 |
| `data/dbConnections.sqlite` | 数据库连接表 `wje_db_connections`（密码 AES-256-GCM 加密，密钥 `data/.vault-key`） |
| `data/dbConnections.json` | 连接备份；首次启动迁入 SQLite |
| `data/dbOps.json` | 数据库操作备份；表 `wje_db_ops` + `wje_db_op_extracts` |

- 内存与磁盘同步，最多 **10000** 条，超出删除最早记录及对应上传文件
- 单条 Body 落盘上限 **1024KB**（与捕获截断一致）
- `data/` 已加入 `.gitignore`

SQLite `records` 与 MySQL `wje_records` 除完整 JSON 外，还写入下列列，便于直接查库：

| 捕获字段 | 列名 |
|----------|------|
| Request Headers | `request_headers` |
| Request Body | `request_body` |
| Response Headers | `response_headers` |
| Response Body | `response_body`（文本；二进制为空） |
| Response Body Size | `response_body_size`（与列表 Size 相同：优先 Content-Length） |
| Timing | `duration_time`（毫秒） |
| Status | `response_status` |
| Time | `timestamp`（毫秒）+ `captured_time`（ISO / DATETIME） |

后置操作写入 `data/postOps.sqlite`；**记录存储切换为 MySQL 时**会建表并把本机已有后置操作全量同步到同一库，之后每次保存也会写入：

| 后置操作 | 表 |
|----------|------|
| 提取变量 | `wje_extract_vars`（record_id、var_name、source、json_path、header_name 等） |
| 断言 | `wje_assertions`（operator、expected、source 等） |
| 数据库操作 | `wje_db_ops` + 子表 `wje_db_op_extracts` |

界面标题旁用徽章标明当前存储。点击徽章打开 **记录存储**：默认 SQLite，也可选类型为 MySQL 且已填数据库名的连接。捕获记录的 SQLite 与 MySQL 相互独立、切换不迁移；后置操作在切到 MySQL 时会同步过去。MySQL 连不上时回退本机 SQLite，徽章为橙色。

### 5. 参数关联（导出 JMX 时，默认开启）

导出前可取消「参数关联」，或点 **预览关联** 勾选/改名/改提取表达式后再导出。开启时按捕获顺序分析响应，把后续请求里再次出现的值换成 JMeter 变量。

**会提取**

- **Token**：`access_token` / `token` / `jwt` 等，且**后续请求确实用到**才生成 `${authToken}`
- **Refresh Token**：`refresh_token` → `${refreshToken}`，与 access token 分开
- **业务 ID / 游标**：首次出现且后续复用，如 `orderId`、`cursor`、`nextToken`、`pageToken`、`offset`
- **响应头 / Location**：如 `X-Request-Id`，以及重定向 URL 里的 `code` / `ticket`
- **HTML CSRF**、表单 body、简单 XML 文本节点
- **嵌套 JSON 字符串**里的字段（用正则提取）

- **后置操作提取**：在响应报文里手动指定的 JSONPath / 响应头变量，即使后续未复用也会生成提取器
- **后置数据库操作**：JDBC 后置处理器；`{{var}}` 转 `${var}`；`$[0].id` 提取第一行列值

**不会提取**

- 更早请求里已经出现过的静态配置
- `sign` / `signature` / `nonce` / `timestamp` / `requestId` 等签名类字段
- JWT 内部声明（`sub` / `uid` 等）：预览里会提示，需在 JMeter 自行解码

**预览与清单**

- 可改变量名、JSONPath / 正则，取消勾选则导出时不替换
- **下载关联清单** 得到 JSON 报告（来源采样器、用于哪些请求的哪些字段）
- Query 按参数值替换（`?id=${orderId}`），避免短 ID 误伤整段 URL

关联仍是启发式的，导出后建议在预览里核对一遍。识别用的字段名写在 `lib/tokenCorrelate.js` 顶部常量里（改代码即可适配业务字段，例如 `ticket` / `sid` / `openId`）：

| 常量 | 用途 |
|------|------|
| `TOKEN_KEYS` | access / id / auth token、jwt |
| `REFRESH_TOKEN_KEYS` | refresh_token |
| `CURSOR_KEY_RE` | cursor、nextToken、pageToken、offset 等 |
| `SKIP_KEY_RE` | 跳过 msg/status/sign/nonce/timestamp/requestId 等 |
| `JWT_CLAIM_KEYS` | 仅报告的 JWT 声明（sub / uid / tenantId / openId） |

### 6. JMX 导出

生成 JMeter 5.x（标注 5.5）可打开的 Test Plan。

**结构**

- Test Plan：有上传文件时带用户变量 `uploadDir`
- Thread Group：线程数 / 循环 / Ramp-up 可在 UI 配置（默认均为 1）
- 线程组级：HTTP Cookie Manager、用到的 **JDBC Connection Configuration**（数据库操作所选连接：URL / Driver / 账号密码 / Variable Name of Pool）、HTTP Request Defaults（全部请求同协议/域名/端口时）、察看结果树
- 每个请求一个 `HTTPSamplerProxy`，名称如 `1. POST /api/login`
- Sampler 下：Header Manager；后置提取器；数据库操作对应 **JDBC PostProcessor**（Pool 名指向上方连接配置；`{{var}}` 会转成 `${var}`）；有数字状态码时加 Response Assertion（断言响应码等于捕获值）
- 参数关联成功时：JSON 提取器或正则提取器

**请求体**

| Content-Type | 处理 |
|--------------|------|
| JSON 等 | raw body（`postBodyRaw`） |
| `application/x-www-form-urlencoded` | 拆成 HTTP Argument |
| `multipart/form-data` | 文本域 → Argument；文件 → `HTTPFileArg`，`DO_MULTIPART_POST=true` |
| 二进制 / 空 | 不写 Body |

**Header**

- 读取 `requestHeaders`；数组值会拼接（Cookie 用 `; `，其余用 `, `）
- 跳过 hop-by-hop 头（`content-length`、`host`、`connection`、`accept-encoding` 等）
- 跳过 `Cookie`（改由 Cookie Manager 在回放时维护）
- multipart 请求额外跳过 `Content-Type`（由 JMeter 自己生成 boundary）

**文件路径**

- 文件写在 `data/uploads/{记录id}/`
- JMX 中路径为 `${uploadDir}/{记录id}/文件名`
- `uploadDir` 默认指向本机 uploads 目录；换机器只需改这一处变量，并拷贝 `data/uploads`

无效 URL 或非 HTTP(S) 会跳过；若全部被跳过，导出会报错而不是生成空脚本。

### 7. CSV 导出

带 UTF-8 BOM，Excel 可直接打开。

| 列 | 说明 |
|----|------|
| ID | 记录 id |
| Timestamp | 毫秒时间戳 |
| Time | ISO 8601 |
| URL / Method | 请求地址与方法 |
| Request Headers / Body | 请求头（JSON 字符串）、请求体；二进制为 `[binary]` |
| Response Status / Headers / Body | 响应；二进制为 `[binary]` |
| Multipart | 文本域与落盘文件信息（JSON） |

字段内的逗号、引号、换行按 CSV 规范转义。

### 8. k6 与 Postman 导出

- **k6**：将选中的 HTTP(S) 请求生成可直接修改的 JavaScript 脚本，保留请求方法、URL、请求头、请求体和参数关联结果。
- **Postman**：生成 Postman Collection JSON，适合导入 Postman 后继续调试或补充环境变量。
- 两种导出都使用当前勾选记录；未勾选时使用当前筛选结果。无有效 HTTP(S) 记录时返回 `400`。

对应 API 为 `POST /api/export-k6` 和 `POST /api/export-postman`，请求体与 `/api/export` 的 `ids`、`correlateToken`、`correlateEdits` 参数一致。

### 9. 插件 UI 控件

| 控件 | 作用 |
|------|------|
| 刷新 | 立即刷新列表 |
| 暂停刷新 | 停止/恢复列表自动刷新（不影响捕获） |
| 暂停捕获 | 停止/恢复把流量写入列表 |
| 删除勾选 | 删除当前勾选的记录及对应上传文件 |
| 清空 | 清空全部记录及 `data/uploads` |
| 导出 JMeter / CSV | 按勾选或当前筛选结果下载 |
| 帮助文档 | 右上角超链接，新标签页预览 README |
| URL / 方法 / 状态筛选 | 只显示匹配行 |
| 隐藏 OPTIONS | 默认勾选 |
| 线程 / 循环 / Ramp-up | 写入 Thread Group |
| 参数关联 | 默认勾选；关闭则不做 Token/ID/CSRF 替换 |
| 预览关联 | 列出提取项，可勾选、改名、改表达式；下载关联清单 |
| 只捕获主机 / 路径 | 捕获阶段过滤 |
| 去重连续相同请求 | 默认勾选 |
| 点击行 | 查看完整报文；multipart 会列出字段和文件路径 |
| WebSocket 帧 | 打开独立帧列表；支持连接/方向/Payload 筛选、自动刷新和 JSON-RPC 详情 |

---

## 环境要求

- [Node.js](https://nodejs.org/) **22.5.0+**（使用内置 `node:sqlite`）
- [Whistle](https://wproxy.org/whistle/)
- 可选 MySQL / PostgreSQL：在「数据库连接」里添加连接并填写数据库名后，可用于记录落盘或后置数据库操作
- 可选 SQL Server：可保存连接并用于后置数据库操作；当前不作为记录落盘引擎
- 可选 [MemoryBridge](https://github.com/)，仅在使用 handover、Wiki 或记忆锚点时需要；安装执行 `npm run setup:memory-bridge`
- 可选 [Playwright](https://playwright.dev/)，仅运行浏览器 UI 回归测试时需要
- 打开导出脚本需要 [Apache JMeter](https://jmeter.apache.org/) 5.x

数据目录默认在插件下的 `data/`。可用环境变量 `JMETER_EXPORTER_DATA_DIR` 改到其他路径。

## 安装

详见 [DEPLOY.md](./DEPLOY.md)（一键部署、手动分步、Whistle / npm 命令一览）。

```bash
npm install
npm test
npm install -g whistle
w2 start
w2 install <本仓库绝对路径>
```

Windows 也可以直接跑：

```bat
scripts\run-unit-tests.cmd
```

或 PowerShell：`.\scripts\run-unit-tests.ps1`。macOS / Linux：`bash scripts/run-unit-tests.sh`。

**测试脚本政策**：`test/*.test.js` 与 `scripts/run-unit-tests*`、`scripts/ci.js` 均纳入 Git 并推送远端；用例索引见 [test/README.md](./test/README.md)，最近一次完整报告见 `test-results/unit-test-latest.txt`。

也可在 Whistle **Plugins → Install** 中选择本地目录。改代码后：

```bash
w2 restart
```

改代码后一键打包、安装到本机 Whistle 并重启：

```bat
scripts\pack-install-restart.cmd
```

PowerShell：`.\scripts\pack-install-restart.ps1`。macOS / Linux：`bash scripts/pack-install-restart.sh`。或 `npm run deploy`。

步骤依次是 `npm pack` → `w2 install <tgz 绝对路径>` → `w2 restart`。装完后插件页请 Ctrl+F5。

手动打包给同事（不发布 npm）：

```bash
npm pack
w2 install ./whistle.jmeter-exporter-<version>.tgz
```

## 使用步骤

1. 浏览器/系统代理指向 Whistle（默认 `127.0.0.1:8899`）。HTTPS 需信任 [Whistle 根证书](https://wproxy.org/whistle/webui/https.html)。
2. 确认规则：`* whistle.jmeter-exporter://`（或收窄到目标域名）。
3. 在业务系统中操作；打开 Whistle → **Plugins** → `jmeter-exporter`。
4. 按需设置主机过滤、暂停捕获；勾选请求后导出 `.jmx` 或 `.csv`。
5. 用 JMeter 打开脚本：按环境改域名或 `uploadDir`，核对提取器和断言后再跑。

---

## HTTP API

路径相对插件根地址。

### `GET /api/records`

记录摘要（不含 Body）。

```json
{
  "code": 0,
  "total": 1,
  "storage": "sqlite",
  "capture": {
    "paused": false,
    "includeHost": "",
    "includePath": "",
    "skipDuplicates": true,
    "persistEngine": "sqlite",
    "mysqlConnectionId": ""
  },
  "storageInfo": {
    "type": "sqlite",
    "persistEngine": "sqlite",
    "mysqlConnectionId": "",
    "fallback": false
  },
  "lastError": null,
  "data": [
    {
      "id": "k1a2b3c4",
      "url": "https://example.com/api/list",
      "method": "GET",
      "responseStatus": 200,
      "timestamp": 1700000000000,
      "name": "list",
      "initiator": "index.html",
      "initiatorUrl": "https://example.com/index.html",
      "size": 128,
      "duration": 45,
      "resourceType": "json",
      "requestBodySize": 0,
      "responseBodySize": 128,
      "hasUpload": false
    }
  ]
}
```

`storage` 为实际引擎：`sqlite`、`mysql`、`json` 或 `memory`。`storageInfo.persistEngine` 为配置项（`sqlite` / `mysql`）；若配置了 MySQL 但连不上，`type` 仍为 `sqlite` 且 `fallback` 为 `true`。

### `GET /api/records/:id`

单条完整记录。不存在时 `404`。

### `GET /api/websocket-frames`

返回 Whistle `wsReqRead/wsResRead` hook 捕获的 WebSocket 帧和连接关闭事件。支持 `connectionId`、`direction`、`limit`、`offset` 查询参数，默认返回最近 500 条，单次最多 1000 条。文本帧的 `payload` 为 UTF-8 文本，二进制帧的 `payload` 为 Base64；帧包含 `direction`、`opcode`、`fin`、`timestamp` 和连接 ID；关闭事件包含 `code`、`reason` 和 `timestamp`。

### `POST /api/websocket-frames/clear`

清空 WebSocket 帧记录。帧数据独立保存于 `data/websocket-frames.json`，不会修改 HTTP `records` 数据。

### `POST /api/clear`

清空全部记录。

### `POST /api/delete`

```json
{ "ids": ["记录id"] }
```

### `GET /api/settings` / `POST /api/settings`

捕获配置：`paused`、`includeHost`、`includePath`、`skipDuplicates`、`persistEngine`（`sqlite` | `mysql` | `postgres`）、`mysqlConnectionId`、`postgresConnectionId`。切换落盘引擎时会加载对应存储中的记录，不迁移数据。远程数据库连接失败时回退本机 SQLite，并返回错误状态。

### `POST /api/storage/test`

```json
{ "connectionId": "数据库连接id" }
```

对所选 MySQL 或 PostgreSQL 连接做真实登录并建表 `wje_records`（若尚不存在）。

### `POST /api/errors/ack`

清除插件页顶部错误条对应的最近一次错误。

### `POST /api/correlate-preview`

```json
{ "ids": ["记录id1", "记录id2"] }
```

返回参数关联清单（变量、来源、提取表达式、用于哪些后续字段）。`ids` 空则分析全部记录。含后置操作里保存的手动提取项。

### `GET /api/extract-vars?recordId=`

列出该捕获记录上已保存的后置提取变量。

### `POST /api/extract-vars`

```json
{ "recordId": "记录id", "items": [{ "varName": "dataSourceUrl", "source": "json", "jsonPath": "$.data.url" }] }
```

覆盖保存该记录的提取列表。`source` 可为 `json` / `header` / `text`。

### `POST /api/extract-vars/preview`

按当前 JSONPath / 响应头对指定记录试提取，返回 `preview` 文本。

### `GET /api/db-connections`

列出已保存的数据库连接（不含密码明文，`hasPassword` 表示是否已存密码）。

### `POST /api/db-connections`

```json
{ "name": "local-mysql", "type": "mysql", "host": "127.0.0.1", "port": 3306, "database": "test", "username": "root", "password": "secret" }
```

新增或更新连接。编辑时 `password` 留空则保留原密码。`type` 为 `mysql` / `postgres` / `sqlserver`。可选 `description`。

### `POST /api/db-connections/test`

```json
{ "host": "127.0.0.1", "port": 3306 }
```

探测主机端口是否可达（不校验账号密码）。

### `POST /api/db-connections/delete`

```json
{ "id": "连接id" }
```

### `GET /api/db-ops?recordId=`

列出该捕获记录上已保存的后置数据库操作。

### `POST /api/db-ops`

```json
{
  "recordId": "记录id",
  "items": [{
    "name": "查用户",
    "connectionId": "连接id",
    "sql": "SELECT id FROM user WHERE name='{{username}}'",
    "extracts": [{ "varName": "userId", "jsonPath": "$[0].id" }]
  }]
}
```

覆盖保存该记录的数据库操作。SQL 中的 `{{var}}` 导出时转为 `${var}`。查询结果按数组理解，`$[0].id` 对应 JDBC 第一行 `id` 列并复制到 `userId`。

### `POST /api/export`

```json
{
  "ids": ["记录id1", "记录id2"],
  "threads": 1,
  "loops": 1,
  "rampTime": 1,
  "correlateToken": true,
  "correlateEdits": { "disabled": [], "rename": {}, "jsonPath": {}, "regex": {} }
}
```

`ids` 为空或不传则导出全部。`correlateToken` 缺省 `true`。成功返回 `.jmx` 文件流。

### `POST /api/export-csv`

参数与 `/api/export` 相同，返回 `.csv`。无记录时两个导出接口返回 `400`：

```json
{ "code": -1, "msg": "No records to export" }
```

---

## 内置压测

插件页 **压力测试** 区可对当前环境发起 HTTP 压测（Node 单进程，非 JMeter 集群）：

- 配置并发用户数、持续时间、Ramp-up；可选绑定后置断言参与压测校验
- 运行中可停止；完成后写入 `data/stressReports/`
- **测试报告**：列表、趋势、接口明细；支持 PDF 导出（含中文）
- **基线固定**：报告页「设为基线」后，对比弹窗自动选中；删除基线报告时自动解除
- **对比报告**：叠图趋势、接口 delta；可下载对比 JSON
- **通用设置 → 阈值**：错误率 / 响应时间阈值；超限时 Webhook 通知（格式 `auto` / `feishu` / `lark` / `json`）

API 示例：`POST /api/stress/start`、`POST /api/stress/stop`、`GET /api/stress/status`、`GET /api/stress/reports`、`POST /api/stress/baseline`、`POST /api/stress/reports/compare`。压测在 Node.js 单进程内直接回放 HTTP(S) 请求，不等同于 JMeter 分布式压测。

## 架构与数据流

```text
客户端流量
  -> Whistle + rules.txt
  -> resStatsServer.js（过滤、解压、协议识别、multipart 解析）
  -> lib/dataStore.js（内存摘要 + SQLite / MySQL / PostgreSQL / JSON）
  -> ui/app.js（Koa 页面与 REST API）
  -> ui/*.js（列表、后置操作、导出、压测、分享）
```

导出链路为 `records -> extractVars/assertions/dbOps -> tokenCorrelate -> JMX/CSV/k6/Postman`；压测链路为 `stressTest -> stressPostOps/assertions -> stressReportStore -> stressThresholds/stressNotify/pdfReport`。完整模块快照见 [`docs/wiki/architecture/plugin-modules.md`](docs/wiki/architecture/plugin-modules.md)。

---

## 分享文档与同步

分享根目录默认 `docs/`（`files/`、`media/`、`.index.json` 由插件管理）：

- 支持 md / html / doc 格式；slug 访问 `/share/:slug`
- 导入本地 `.md/.html/.docx`；上传 png/jpg/gif/webp/mp4/webm 媒体
- **同步包** `.wjesync`：gzip JSON，含文档站、文档、引用媒体
  - 导出：`GET /api/share/sync/export`（可选 `?memoryAnchors=1`）
  - 导入 JSON base64：`POST /api/share/sync/import`
  - 导入二进制：`POST /api/share/sync/import/binary`（推荐，免 base64）
- UI 分享区显示 **MemoryBridge 状态徽章**；单篇文档可写记忆锚点
- 支持文档版本列表、恢复、文本差异、下载，以及 Markdown/HTML/DOC 在线预览

## 项目设置、通知与 Wiki

- **项目设置**：可配置项目名称、报告标题和通知标签，压测报告列表与通知内容会复用这些信息。
- **通知设置**：可配置错误率、延迟、数据库延迟等阈值，以及 Webhook 地址、通知格式和“通过时是否通知”；支持 Webhook 探测。
- **Wiki 入库**：分享文档可写入 `docs/raw/` 和 `docs/wiki/`，同时更新 Wiki 索引与日志；相关 API 为 `/api/wiki/articles`、`/api/wiki/ingest`。

---

## MemoryBridge 与 Agent 协作

- 约定见 `docs/wiki/memory/handover-convention.md` 与根目录 `AGENTS.md`
- handover 五行卡：`goal / done / failed / next / refs`，`--kind handover`
- 插件通过 `lib/memoryBridge.js` 调用 CLI（自动回退 `python -m membridge`）
- 自检：`npm run check:memory-bridge` 或 `GET /api/memory-bridge/status`
- 分享文档锚点只写指针，**不改写**正文

---

## Whistle 规则编辑

插件 UI **编辑规则** 读写 Whistle 规则文件（默认 `rules.txt`），便于在捕获前收窄域名。

API：`GET/POST /api/rules`。

---

## 捕获记录字段

| 字段 | 说明 |
|------|------|
| `id` | 时间戳 + 随机后缀，或 Whistle session id |
| `url` / `method` | 完整 URL、HTTP 方法 |
| `requestHeaders` / `responseHeaders` | 头对象 |
| `requestBody` / `responseBody` | 文本体；二进制则为空 |
| `requestBodyBinary` / `responseBodyBinary` | 是否二进制 |
| `multipart` | `{ fields, files }`；`files[].path` 为落盘绝对路径 |
| `responseStatus` | 状态码 |
| `timestamp` | 捕获时间（毫秒） |

---

## 持续集成（Gitee Go）

仓库已附带 Pipeline 模板 `.gitee/pipelines/unit-test.yml`，执行 `npm run ci`（单元测试门禁）。

**启用步骤（Gitee 网页）：**

1. 打开仓库 → **流水线** → **新建流水线**
2. 选择「使用已有 YAML」或从 `.gitee/pipelines/unit-test.yml` 导入
3. 触发方式建议：**推送 master** + **Pull Request**
4. 首次运行需 Node.js 22+ 构建镜像（模板默认 `npm ci || npm install`）

本地自检：`npm run ci`（与 CI 相同，含 `scripts/verify-ci-yml.js` 校验 YAML）。

详细图文步骤见 [`docs/gitee-pipeline-setup.md`](docs/gitee-pipeline-setup.md)。

---

## 技术栈

| 层次 | 技术与用途 |
|------|------|
| 运行时 | Node.js `>=22.5.0`，CommonJS 模块；使用内置 `node:sqlite` 作为默认本地存储 |
| 插件宿主 | Whistle 插件机制；`index.js` 暴露 `uiServer` 与 `resStatsServer` |
| 服务端 | Koa、`koa-router`、`koa-bodyparser`；提供插件页面、REST API 和静态脚本 |
| 数据存储 | SQLite / JSON 本地回退；可选 MySQL（`mysql2`）和 PostgreSQL（`pg`） |
| 生成与处理 | `xmlbuilder2` 生成 JMeter `.jmx`；内置 CSV、k6、Postman、Markdown、PDF 与参数关联处理 |
| 前端 | 原生 HTML/CSS/JavaScript，多文件脚本按功能拆分；无独立前端构建工具或打包步骤 |
| 测试 | Node.js 自定义单元测试 harness；Playwright 浏览器测试用于 UI 回归 |
| 交付 | `npm pack` 打包，Gitee Go CI 执行 `npm run ci`；运行时数据位于 `data/` |

---

## 目录结构

```text
whistle-jmeter-framework-ai/   # 仓库目录名；npm 包名 whistle.jmeter-exporter
├── package.json
├── index.js                  # Whistle 插件入口
├── resStatsServer.js         # HTTP/HTTPS 流量捕获入口
├── rules.txt                 # 默认 Whistle 规则
├── lib/
│   ├── dataStore.js          # 内存 + SQLite/MySQL/JSON 存储
│   ├── dbConnections.js      # 数据库连接与加密凭据
│   ├── dbOps.js              # 后置数据库操作
│   ├── extractVars.js        # 变量提取
│   ├── assertions.js         # 响应断言
│   ├── tokenCorrelate.js     # 参数关联
│   ├── protocolDecoders.js   # JSON-RPC 与可注册协议解码器
│   ├── websocketFrameAdapter.js # WebSocket 帧事件适配器
│   ├── websocketFrameCapture.js # Whistle 双向帧捕获与持久化
│   ├── jmxGenerator.js       # JMeter 生成
│   ├── k6Generator.js        # k6 生成
│   ├── postmanGenerator.js   # Postman 生成
│   ├── csvGenerator.js       # CSV 生成
│   ├── stress*.js            # 压测、报告、阈值与通知
│   ├── shareDocs.js          # 分享文档与 .wjesync
│   ├── markdown.js           # Markdown 转 HTML
│   └── 其他模块              # multipart、配置、路径、存储及通用工具
├── ui/
│   ├── app.js                # Koa UI/API 服务
│   ├── index.html            # 页面骨架与导出初始化
│   ├── records-core-ui.js    # 请求列表、详情与滚动
│   ├── postops-ui.js         # 提取、断言、数据库后置操作
│   ├── stress-ui.js          # 压测、报告、PDF
│   ├── share-ui.js           # 文档分享、同步、MemoryBridge
│   ├── websocket-ui.js       # WebSocket 帧列表与详情
│   ├── general-settings-ui.js # 通用设置
│   └── rules-correlate-ui.js # Rules 编辑与参数关联预览
├── docs/                     # 使用文档、wiki 与架构快照
├── data/                     # 运行时数据（git 忽略）
├── scripts/
│   ├── ci.js                 # CI 门禁
│   ├── run-unit-tests-report.js
│   ├── verify-ci-yml.js
│   └── 其他打包、部署与检查脚本
├── test/                     # 自定义 harness 与 Node.js 单元测试
│   └── playwright/            # Playwright UI 回归测试与截图证据
├── CODE_LOGIC.md             # 核心流程说明
├── DEPLOY.md                 # 部署说明
└── README.md
```

---

## 已知限制

1. 最多 10000 条；落盘 Body 超过 1024KB 截断。
2. 参数关联是启发式的；可用后置操作手动指定 JSONPath。非 JSON 业务字段（除常见 CSRF）不会自动提取。
3. 普通二进制体不写入 JMX/CSV 文本。
4. multipart 单请求体上限 500MB、最多 12 个文件；换机器需改 `uploadDir` 并带上 `data/uploads`。
5. gRPC 当前仅标记 content-type，不解析 HTTP/2/gRPC 帧；WebSocket 已支持 Whistle hook 帧旁路录制和 JSON-RPC 解码，但尚未提供 UI 回放或 JMX/k6 的 WebSocket 消息导出。单帧持久化上限为 1MB，超限记录 `truncated=true`。
6. 数据库操作不在插件内执行 SQL；导出的 JMX 需要 JMeter 类路径中有对应 JDBC 驱动（MySQL `com.mysql.cj.jdbc.Driver`、PostgreSQL `org.postgresql.Driver` 等）。连接保存在本机 SQLite 表 `wje_db_connections`；MySQL 连接另写入目标库同名表。密码会写入 JMX。

## License

MulanPSL-2.0（木兰宽松许可证，第 2 版）
