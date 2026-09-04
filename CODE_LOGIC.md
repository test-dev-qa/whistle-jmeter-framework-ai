# Whistle JMeter Exporter - 代码逻辑详解

## 📋 项目概述

**Whistle JMeter Exporter** 是一个 Whistle 代理插件，用于：
- 实时捕获 HTTP/HTTPS 流量
- 将真实浏览器操作转换成 JMeter 压测脚本（`.jmx` 格式）
- 导出 CSV 格式的请求/响应数据
- 自动提取并关联 Token、CSRF 等参数

---

## 🏗️ 代码架构

```
核心流程：
浏览器流量 → Whistle代理 → resStatsServer(捕获) → dataStore(存储) → UI界面(展示) → 导出(JMX/CSV)
```

### 完整处理链路

```
HTTP 请求
   ↓
shouldCapture() 检查
   ├─ URL 是否有效 (http/https)
   ├─ 是否为静态资源 (css/js/图片等) - 过滤
   ├─ 是否符合主机/路径过滤条件
   └─ 是否为连续重复请求 - 去重
   ↓
captureViaStream() 或 saveFromSession()
   ├─ 流式读取请求体 (limit: 1MB)
   ├─ 流式读取响应体 (limit: 1MB)
   ├─ 检测二进制体
   └─ 解析 multipart 文件
   ↓
dataStore.addRecord()
   ├─ 内存缓存 (最多 1000 条)
   ├─ SQLite 持久化 (或 JSON 备份)
   └─ 触发淘汰策略
   ↓
UI 展示 + 用户勾选
   ↓
导出 (JMX/CSV)
   ├─ 参数关联 (tokenCorrelate)
   ├─ 生成 XML 结构
   └─ 返回文件
```

---

## 📦 核心模块详解

### 1️⃣ **流量捕获层** - `resStatsServer.js`

**职责**：拦截 Whistle 流量，进行初步处理和存储决策

#### 关键函数

- **`shouldCapture(url)`** - 决定是否捕获该请求
  ```javascript
  // 检查条件：
  // 1. URL 非空
  // 2. 协议为 http/https
  // 3. 非静态资源 (css/js/图片/字体等)
  // 4. 符合用户配置的过滤条件
  ```

- **`isConsecutiveDuplicate(method, url)`** - 检测连续重复请求
  ```javascript
  // 比较最后一条记录的 Method + URL
  // 去重策略在 captureConfig 中开启/关闭
  ```

- **`captureViaStream(req, originalReq, url)`** - 流式捕获请求/响应
  ```javascript
  // 使用缓冲区逐块读取，防止大文件爆内存
  // 核心逻辑：
  // 1. 监听 req.req 的 'data' 事件，累积请求体
  // 2. 监听 res 的 'data' 事件，累积响应体
  // 3. 当两个流都完成时，触发 trySave()
  // 4. 检查去重 + 保存到 addRecord()
  ```

- **`saveFromSession(session, originalReq)`** - 从 Session 对象直接保存
  ```javascript
  // 应用于 Whistle 已提前整合好请求/响应的场景
  // 性能优于流式方案
  ```

#### 捕获流程示意

```
HTTP 响应到达
   ↓
resStatsServer 注册的中间件触发
   ↓
shouldCapture() → 否 → return (忽略)
   ↓ 是
isConsecutiveDuplicate() → 真 → return (去重)
   ↓ 假
captureViaStream() 开始
   ├─ 挂载 req 'data' 事件
   ├─ 挂载 res 'data' 事件
   ├─ 挂载 res 'end' 事件
   └─ 挂载 res 'error' 事件
   ↓ (异步等待两个流完成)
trySave() 触发
   ├─ 检查 reqFinished && resFinished
   ├─ 再次检查去重
   ├─ 调用 addRecord()
   └─ 触发回调
```

---

### 2️⃣ **数据存储层** - `dataStore.js`

**职责**：统一管理记录的内存缓存和持久化

#### 存储架构

```
┌─────────────────────────────────────┐
│  内存数组 records[]                  │ (最多 1000 条)
│  + Map<id, record> byId              │ (快速查询)
└────────────┬────────────────────────┘
             │
    ┌────────┴─────────┐
    ↓                  ↓
SQLite              JSON
(优先)             (备份)
```

#### 数据模型

```javascript
{
  id: string,                    // 唯一标识
  url: string,                   // 请求 URL
  method: string,                // 请求方法 (GET/POST/PUT/DELETE)
  
  // 请求信息
  requestHeaders: { [key]: value },
  requestBody: string,           // 文本部分
  requestBodyBinary: boolean,    // 是否为二进制
  multipart: {                   // multipart 元数据
    fields: [...],
    files: [{ name, filename, ... }]
  },
  
  // 响应信息
  responseStatus: number,        // HTTP 状态码
  responseHeaders: { [key]: value },
  responseBody: string,          // 文本部分
  responseBodyBinary: boolean,   // 是否为二进制
  
  timestamp: number              // 捕获时间戳
}
```

#### SQLite 表结构

```sql
CREATE TABLE records (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  method TEXT,
  requestHeaders TEXT,      -- JSON 字符串
  requestBody TEXT,         -- 最多 256KB
  requestBodyBinary TEXT,   -- '*BodyBinary' 标记
  multipart TEXT,           -- JSON 序列化
  responseStatus TEXT,
  responseHeaders TEXT,
  responseBody TEXT,        -- 最多 256KB
  responseBodyBinary TEXT,
  timestamp INTEGER
)
```

#### 关键函数

- **`pushMemory(record)`** - 添加到内存
  ```javascript
  // 1. 加入 records 数组尾部
  // 2. 在 byId Map 中建立索引
  // 3. 如超过 MAX_RECORDS，删除最旧的，收集已移除 ID
  // 4. 返回被移除的 ID 列表
  ```

- **`openSqlite()`** - 初始化 SQLite
  ```javascript
  // 1. 创建 data/ 目录
  // 2. 使用 DatabaseSync (Node.js 内置)
  // 3. 设置 WAL 日志 + NORMAL 同步
  // 4. 创建 records 表（如不存在）
  ```

- **`addRecord(record)`** - 同时添加到内存和数据库
  ```javascript
  // 1. hydrate(record) - 补齐 ID
  // 2. pushMemory(record) - 加入内存
  // 3. 如 SQLite 可用，插入 DB
  // 4. 如内存超限，从 DB 同步删除
  ```

- **`getRecords()`** - 获取全部记录
  ```javascript
  // 返回内存中的所有记录 (内存优先)
  ```

- **`getRecordsByIds(ids)`** - 按 ID 列表查询
  ```javascript
  // 从 byId Map 中高效查询
  ```

- **`getRecordSummaries()`** - 获取摘要（用于列表展示）
  ```javascript
  // 返回: [{ id, url, method, status, timestamp }, ...]
  // 简化的数据结构，不包含 body
  ```

- **`capBody(text, maxBytes)`** - 截断 body
  ```javascript
  // 持久化前截断超大 body (默认 256KB)
  // 保留内存中的完整版本
  ```

#### 生命周期

```
启动
   ↓
loadData()
   ├─ 尝试打开 SQLite
   ├─ 从 DB 恢复历史记录到内存
   └─ 若失败，从 JSON 加载备份
   ↓
运行中 (实时捕获)
   ├─ addRecord() → 内存 + DB
   └─ 定时 persist() → JSON 备份
   ↓
清理操作
   ├─ clearRecords() → 清空内存 + DB + 文件
   └─ deleteRecordsByIds(ids) → 删除指定记录
```

---

### 3️⃣ **捕获配置层** - `captureConfig.js`

**职责**：管理用户的捕获策略配置

#### 配置项

```javascript
{
  "pauseCapture": false,         // 暂停捕获开关
  "onlyHost": "api.example.com", // 仅捕获包含该主机名的请求
  "onlyPath": "/api/",           // 仅捕获包含该路径的请求
  "skipDuplicates": true         // 去重连续相同请求
}
```

#### 持久化位置

`data/config.json` - 重启后仍生效

#### 关键函数

- **`allowsUrl(url)`** - 检查 URL 是否符合过滤条件
  ```javascript
  // 1. pauseCapture 为真 → 返回 false (暂停中)
  // 2. onlyHost 已设置 → URL 必须包含该主机
  // 3. onlyPath 已设置 → URL path/query 必须包含该关键字
  // 4. 都通过 → 返回 true
  ```

- **`setCaptureConfig(config)`** - 更新配置
  ```javascript
  // 1. 验证配置项
  // 2. 更新内存
  // 3. 持久化到 data/config.json
  ```

---

### 4️⃣ **Multipart 处理** - `multipart.js`

**职责**：解析并落盘 multipart/form-data 上传

#### 特点

- 识别 `Content-Type: multipart/form-data; boundary=xxx`
- 按 boundary 分割，提取字段和文件
- 文件保存到 `data/uploads/{recordId}/` 目录
- 生成元数据便于 JMX 中引用

#### 数据结构

```javascript
{
  fields: [
    { name: "username", value: "admin" },
    { name: "email", value: "user@example.com" }
  ],
  files: [
    { 
      name: "avatar",                    // 字段名
      filename: "photo.jpg",             // 原始文件名
      filepath: "data/uploads/{id}/photo.jpg"  // 保存路径
    }
  ]
}
```

#### 关键函数

- **`captureRequestPayload(id, headers, body)`** - 处理请求体
  ```javascript
  // 1. 检查是否为 multipart
  // 2. 若是，调用 parseMultipart()
  // 3. 文件落盘到 data/uploads/{id}/
  // 4. 返回 { text, binary, multipart }
  ```

- **`toUploadVarPath(filepath)`** - 转换为 JMX 变量
  ```javascript
  // 输入: "data/uploads/xxx/photo.jpg"
  // 输出: "${uploadDir}/photo.jpg"
  ```

---

### 5️⃣ **JMX 生成** - `jmxGenerator.js`

**职责**：将 HTTP 记录转换为 JMeter 脚本

#### JMX 结构

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2">
  <hashTree>
    <!-- 1. 测试计划 -->
    <TestPlan guiclass="TestPlanGui" ...>
      <elementProp name="TestPlan.user_defined_variables" />
    </TestPlan>
    
    <!-- 2. 线程组 -->
    <ThreadGroup guiclass="ThreadGroupGui" ...>
      <stringProp name="ThreadGroup.num_threads">1</stringProp>
      <stringProp name="ThreadGroup.ramp_time">1</stringProp>
      <elementProp name="ThreadGroup.main_controller" />
    </ThreadGroup>
    
    <!-- 3. HTTP 请求默认值 -->
    <ConfigTestElement guiclass="HttpDefaultsGui" ...>
      <Arguments name="TestPlan.user_defined_variables">
        <!-- 提取的 host/port/protocol -->
      </Arguments>
    </ConfigTestElement>
    
    <!-- 4. Cookie 管理器 -->
    <CookieManager guiclass="CookiePanel" />
    
    <!-- 5. HTTP 采样器 (重复) -->
    <HTTPSamplerProxy guiclass="HttpTestSampleGui" ...>
      <elementProp name="HTTPsampler.Arguments">
        <!-- 请求参数 -->
      </elementProp>
      <elementProp name="HTTPsampler.header_manager">
        <!-- 请求头 -->
      </elementProp>
    </HTTPSamplerProxy>
    
    <!-- 6. 状态码断言 -->
    <ResponseAssertion guiclass="AssertionGui" ...>
      <stringProp name="Assertion.test_strings">${expectedStatus}</stringProp>
    </ResponseAssertion>
    
    <!-- 7. JSON/正则提取器 (Token 关联) -->
    <JSONPostProcessor guiclass="JSONPostProcessorGui" ...>
      <stringProp name="JSONPostProcessor.referenceNames">token</stringProp>
      <stringProp name="JSONPostProcessor.jsonPathExprs">$.access_token</stringProp>
    </JSONPostProcessor>
    
    <!-- 8. 察看结果树 -->
    <ResultCollector guiclass="ViewResultsFullVisualizer" />
  </hashTree>
</jmeterTestPlan>
```

#### 导出选项

```javascript
{
  threads: 1,              // 线程数 (1-1000)
  loops: 1,                // 循环次数 (1-10000)
  rampTime: 1,             // Ramp-up 时间 (秒)
  correlateToken: true     // 是否启用 Token 自动关联
}
```

#### 生成过程

```
输入: records[], options
   ↓
1. 创建根 XML 节点
   ↓
2. 添加 TestPlan (线程数/循环等)
   ↓
3. 添加 ThreadGroup (main_controller)
   ↓
4. 添加 HTTPDefaults (host/port/protocol/超时)
   ↓
5. 添加 CookieManager (从 Cookie 头提取)
   ↓
6. 对每条记录:
   ├─ 创建 HTTPSamplerProxy
   ├─ 设置 method/path/port/protocol
   ├─ 添加 Query parameters
   ├─ 添加 Body (json/form/text)
   ├─ 添加 Headers (排除 Host/Content-Length 等)
   ├─ 添加 ResponseAssertion (状态码)
   ├─ 若有 multipart 文件，引用 ${uploadDir}
   └─ 若 correlateToken=true，添加提取器
   ↓
7. 添加 ResultCollector (察看结果树)
   ↓
8. 序列化为 XML 字符串
```

#### 跳过的请求头

```javascript
SKIP_HEADERS = [
  'content-length',      // 自动计算
  'host',                // HTTPDefaults 已设置
  'connection',
  'accept-encoding',
  'transfer-encoding',
  'keep-alive',
  'proxy-connection',
  'te', 'trailer', 'upgrade', 'expect',
  'cookie'               // CookieManager 处理
]
```

---

### 6️⃣ **参数关联** - `tokenCorrelate.js`

**职责**：从响应中自动提取 Token/ID/CSRF，在后续请求中替换

#### Token 检测规则

```javascript
// 1. 字段名匹配
TOKEN_KEYS = [
  'access_token', 'accesstoken', 'access-token',
  'id_token', 'idtoken',
  'auth_token', 'authtoken',
  'authorization', 'token', 'jwt'
]

// 2. 值的合法性检查
isTokenValue(value):
  - 类型: 字符串
  - 长度 >= 16 字符
  - 不是布尔值/null/简单单词
  - 若有空格，长度 >= 48
```

#### 关键字过滤

```javascript
// 跳过无关的 response key
SKIP_KEY_RE = /(msg|message|error|code|status|type|...)/i

// 跳过无关的 header
SKIP_SUB_HEADER_RE = /(content-type|user-agent|sec-|cache-control|...)/i

// 最多提取 8 个 extractor 每条记录
// 最多保留 40 个变量
```

#### 提取策略

```
从 response 中寻找 Token:
   ├─ JSON body → JSONPath 提取
   ├─ HTML body → 正则 + HTML 解析
   ├─ Headers → 直接复制
   └─ 生成 JSONPostProcessor / RegexExtractor
   
在后续请求中替换:
   ├─ Header 值中出现 token → ${token}
   ├─ URL query 中出现 token → ${token}
   ├─ Body 中出现 token → ${token}
   └─ 生成 PreProcessor 进行字符串替换
```

#### JSONPath 示例

```
响应体: { "data": { "access_token": "abc123xyz" } }
   ↓
JSONPath: $.data.access_token
   ↓
提取器配置: 
{
  "referenceNames": "accessToken",
  "jsonPathExprs": "$.data.access_token"
}
   ↓
后续使用: ${accessToken}
```

---

### 7️⃣ **工具函数** - `utils.js`

**职责**：公共工具函数库

#### 常用函数

- **`isStaticAsset(url)`** - 检查是否为静态资源
  ```javascript
  // 按 pathname 后缀判断:
  // css, js, gif, jpg, jpeg, png, ico, woff, woff2, 
  // ttf, eot, svg, mp4, webm, ogg, mp3, wav
  ```

- **`normalizeHeaders(headers)`** - 统一 header 格式
  ```javascript
  // 1. 遍历所有 key-value
  // 2. 转换为小写
  // 3. 处理数组值 (多个同名 header)
  // 4. 返回平展的对象
  ```

- **`decodeCapturedBody(body)`** - 解码响应体
  ```javascript
  // 1. 检测编码 (gzip/deflate/br)
  // 2. 解压
  // 3. 尝试转为文本 (UTF-8/Latin-1)
  // 4. 返回 { text, binary }
  ```

- **`sanitizeXmlText(text)`** - XML 转义
  ```javascript
  // 替换特殊字符:
  // & → &amp;
  // < → &lt;
  // > → &gt;
  // " → &quot;
  // ' → &apos;
  ```

- **`createRecordId()`** - 生成唯一 ID
  ```javascript
  // 格式: {timestamp}-{random}
  // 如: 1693560000123-a1b2c3
  ```

---

### 8️⃣ **CSV 导出** - `csvGenerator.js`

**职责**：将记录转换为 CSV 格式

#### CSV 列结构

| 列 | 含义 |
|----|------|
| ID | 记录 ID |
| Time | ISO 8601 时间戳 |
| Method | HTTP 方法 |
| URL | 完整 URL |
| Status | 响应状态码 |
| Request Headers | JSON 格式 |
| Request Body | 文本/[binary]/Multipart 标记 |
| Response Headers | JSON 格式 |
| Response Body | 文本/[binary] |

#### 特点

- UTF-8 with BOM (Excel 识别)
- 时间戳为 ISO 格式
- 大文件体标记为 `[binary]`
- Multipart 行显示文件列表

---

### 9️⃣ **UI 服务** - `ui/app.js`

**职责**：基于 Koa 的 REST API 服务器

#### API 端点

| 方法 | 路由 | 功能 |
|------|------|------|
| `GET` | `/` | 返回 HTML 前端 |
| `GET` | `/api/records` | 获取记录摘要列表 |
| `GET` | `/api/records/:id` | 获取单条记录详情 |
| `POST` | `/api/export/jmx` | 导出 JMX 脚本 |
| `POST` | `/api/export/csv` | 导出 CSV 数据 |
| `POST` | `/api/delete` | 删除指定记录 |
| `POST` | `/api/clear` | 清空所有记录 |
| `POST` | `/api/config` | 更新捕获配置 |
| `PUT` | `/api/records/:id` | 更新记录 |

#### 请求示例

**导出 JMX：**
```bash
POST /api/export/jmx
Content-Type: application/json

{
  "ids": ["123-abc", "456-def"],
  "threads": 10,
  "loops": 5,
  "rampTime": 60,
  "correlateToken": true
}
```

**导出 CSV：**
```bash
POST /api/export/csv
Content-Type: application/json

{
  "ids": ["123-abc"]
}
```

#### 响应格式

**成功：**
```json
{
  "code": 0,
  "msg": "success",
  "data": {...}
}
```

**失败：**
```json
{
  "code": -1,
  "msg": "错误消息",
  "error": "详细错误"
}
```

---

## 🔄 完整数据流示例

```
场景：用户在浏览器中登录某 API，系统捕获并导出 JMeter 脚本

1. 浏览器登录
   POST https://api.example.com/login
   Body: { username: "user", password: "pass" }
   ↓

2. resStatsServer 拦截
   shouldCapture() ✓
   isConsecutiveDuplicate() ✗
   captureViaStream() 开始流式读取
   ↓

3. 响应完全到达
   HTTP 200 OK
   Body: { code: 0, data: { access_token: "eyJhbG..." } }
   ↓

4. trySave() 触发
   生成 ID: 1693560000123-a1b2c3
   addRecord() 保存到内存 + SQLite
   ↓

5. UI 列表显示
   ID: 1693560000123-a1b2c3
   URL: /login
   Method: POST
   Status: 200
   ↓

6. 用户勾选 + 点击"导出 JMX"
   前端 POST /api/export/jmx
   {
     ids: ["1693560000123-a1b2c3"],
     threads: 1,
     loops: 1,
     rampTime: 1,
     correlateToken: true
   }
   ↓

7. 服务端处理
   a) 获取记录详情
   b) tokenCorrelate.correlateTokens()
      - 检测响应中的 access_token 字段
      - 生成 JSONPath: $.data.access_token
      - 添加 JSONPostProcessor 提取器
   c) jmxGenerator.generateJMX()
      - 创建 HTTPSamplerProxy
      - 添加 RequestHeaders (去除 Host/Content-Length)
      - 添加 Body (JSON)
      - 添加 ResponseAssertion (status=200)
      - 添加 JSONPostProcessor 提取器
      - 添加 CookieManager
   d) 生成 XML 并返回
   ↓

8. 用户保存 .jmx 文件
   在 JMeter 中打开
   ↓

9. JMeter 运行压测
   第 1 次迭代: 
     POST /login
     → 响应中提取 token = "eyJhbG..."
     
   第 2+ 次迭代:
     若有后续请求，可在其中使用 ${access_token} 替换
```

---

## 🎯 关键特性解析

| 特性 | 实现细节 |
|------|---------|
| **双存储** | 内存 (快速) + SQLite (持久) + JSON (备份) |
| **去重** | 比较连续请求的 Method + URL |
| **体积限制** | 捕获时 1MB、持久化时 256KB |
| **文件上传** | multipart 解析、文件落盘、JMX 中 `${uploadDir}` 引用 |
| **Token 关联** | 字段名/值长度检测、JSONPath 提取、后续自动替换 |
| **流式处理** | 缓冲区分块读取，避免大文件爆内存 |
| **SQLite 优化** | WAL 模式 + NORMAL 同步，平衡性能和可靠性 |
| **重启持久化** | SQLite + JSON 双备份，任何情况不丢数据 |

---

## 🚀 快速开发指南

### 添加新的过滤条件

编辑 `lib/captureConfig.js`，在 `allowsUrl()` 中添加条件：
```javascript
function allowsUrl(url) {
  // ... 现有逻辑
  
  // 新条件：过滤特定 query 参数
  if (config.excludeQuery) {
    const urlObj = new URL(url);
    const params = urlObj.searchParams;
    if (params.get('_debug')) return false; // 跳过 debug 请求
  }
  
  return true;
}
```

### 自定义 JMX 元素

编辑 `lib/jmxGenerator.js`，在生成流程中插入新元素：
```javascript
// 添加自定义 Assertion
function addCustomAssertion(parent, record) {
  const assertion = parent.ele('SizeAssertion', { 
    guiclass: 'SizeAssertionGui',
    testclass: 'SizeAssertion',
    testname: 'Response Size Assertion',
    enabled: 'true'
  });
  // 配置断言参数...
}
```

### 扩展 Token 检测

编辑 `lib/tokenCorrelate.js`，添加新的 token 字段：
```javascript
const TOKEN_KEYS = [
  // ... 现有的
  'session_id',
  'refresh_token',
  'app_key'
];
```

---

## 📊 性能优化建议

1. **SQLite 调优**
   - WAL 模式已启用，确保并发写入性能
   - 考虑添加索引加速 URL 查询

2. **内存管理**
   - 1000 条记录上限适合多数场景
   - 若捕获量大，可考虑时间滑动窗口替代 FIFO

3. **流式读取**
   - 已采用缓冲区分块方案
   - 可调整 chunk size 平衡吞吐量和延迟

4. **JSON/XMLBuilder**
   - 大量记录导出时，考虑流式 XML 生成
   - 当前方案适合 < 1000 条记录

---

## 🔒 安全考虑

1. **Body 截断** - 防止超大 payload 爆内存
2. **二进制检测** - 避免乱码，标记为 `[binary]`
3. **XML 转义** - 防止 XML 注入
4. **Header 过滤** - 移除 Host/Content-Length，避免冲突
5. **Token 提取** - 自动识别敏感字段，便于替换

---

## 📝 常见问题

**Q: 为什么某些请求没被捕获？**
A: 检查以下条件：
- URL 是否为 http/https
- 是否被识别为静态资源（css/js）
- 是否符合 captureConfig 的过滤条件
- 是否与上一条请求重复（去重开启）

**Q: JMX 中的 `${uploadDir}` 如何使用？**
A: 在 JMeter 中设置用户变量：`uploadDir=/path/to/uploads`，JMeter 会自动替换路径。

**Q: Token 自动关联失败怎么办？**
A: 检查 response 中是否有匹配 TOKEN_KEYS 的字段，且值长度 >= 16。

---

**最后更新**：2026-08-31
**版本**：1.0.0
