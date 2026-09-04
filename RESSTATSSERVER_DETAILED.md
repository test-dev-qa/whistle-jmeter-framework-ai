# resStatsServer 模块深度解析

## 📌 模块职责

**resStatsServer.js** 是 Whistle 插件的**流量捕获引擎**，核心职责：
1. 拦截经过 Whistle 代理的所有 HTTP/HTTPS 请求
2. 判断请求是否应该被捕获（过滤、去重、限制）
3. 异步读取请求/响应体，处理大文件和编码
4. 将处理后的数据存储到 dataStore

---

## 🏗️ 代码结构总览

```
resStatsServer.js
├─ 导入依赖
│  ├─ dataStore: 添加记录、查询最后一条
│  ├─ captureConfig: 获取捕获配置、允许 URL 检查
│  ├─ multipart: 处理 multipart 请求体
│  └─ utils: 通用工具（去静态资源、规范化 header 等）
│
├─ shouldCapture(url) ─────────→ 第一层过滤
│
├─ isConsecutiveDuplicate() ───→ 去重检查
│
├─ appendLimited() ────────────→ 缓冲区管理
│
├─ saveFromSession() ──────────→ 捕获方式 A：Session 方式
│
├─ captureViaStream() ─────────→ 捕获方式 B：流式方式
│
└─ module.exports (server) ────→ Whistle 插件入口
```

---

## 🔍 详细函数分析

### 1️⃣ `shouldCapture(url)` - 第一层过滤

```javascript
function shouldCapture(url) {
  return Boolean(url) && /^https?:\/\//i.test(url) && !isStaticAsset(url) && allowsUrl(url);
}
```

**职责**：决定一个 URL 是否值得捕获

**过滤条件链**（&&，全部通过才返回 true）：

| 条件 | 检查内容 | 作用 |
|------|---------|------|
| `Boolean(url)` | URL 非空 | 防止 undefined/null/空字符串 |
| `/^https?:\/\//i.test(url)` | 协议为 http/https | 忽略 ws/wss/ftp 等 |
| `!isStaticAsset(url)` | **非**静态资源 | 过滤 css/js/图片等 |
| `allowsUrl(url)` | 符合配置过滤 | 检查 captureConfig 的规则 |

**过滤示例**：

```javascript
shouldCapture('https://api.example.com/login')  
  // Boolean ✓, https ✓, 非静态 ✓, allowsUrl ✓ → true ✓

shouldCapture('https://cdn.example.com/app.js')
  // 非静态 ✗ → false ✗

shouldCapture('https://api.example.com/style.css')
  // 非静态 ✗ → false ✗

shouldCapture('https://api.example.com/api.jpg')
  // 非静态 ✗ → false ✗

shouldCapture('')
  // Boolean ✗ → false ✗
```

**调用时机**：
- 在 `module.exports` 的 `server.on('request')` 事件中，**每个请求**都会调用
- 作为第一道防线，减少后续处理的开销

---

### 2️⃣ `isConsecutiveDuplicate(method, url)` - 去重检查

```javascript
function isConsecutiveDuplicate(method, url) {
  if (!getCaptureConfig().skipDuplicates) return false;
  const last = getLastRecord();
  return Boolean(last && last.method === method && last.url === url);
}
```

**职责**：检查该请求是否与上一条请求完全相同，若是则跳过

**工作流程**：

```
1. 检查配置
   getCaptureConfig().skipDuplicates
   ├─ false → 直接返回 false (去重禁用)
   └─ true → 继续检查

2. 获取最后一条记录
   getLastRecord()
   ├─ 无记录 → 返回 false (首条必然不重复)
   └─ 有记录 → 继续比对

3. 比对
   POST /api/login === POST /api/login
   ├─ method 相同 ✓
   ├─ url 相同 ✓
   └─ 返回 true (重复，跳过)
```

**对比示例**：

```javascript
// 场景 1：轮询相同 API
GET /api/status
GET /api/status  ← isConsecutiveDuplicate = true (跳过)
GET /api/status  ← isConsecutiveDuplicate = true (跳过)

// 场景 2：相同方法不同 URL
GET /api/status
GET /api/health  ← url 不同，isConsecutiveDuplicate = false (保留)

// 场景 3：相同 URL 不同方法
GET /api/user
POST /api/user   ← method 不同，isConsecutiveDuplicate = false (保留)

// 场景 4：重复去重禁用
skipDuplicates: false
GET /api/status
GET /api/status  ← isConsecutiveDuplicate = false (保留，配置禁用去重)
```

**设计意图**：
- 浏览器常见自动轮询行为（心跳、status check）
- 避免爆满数据库和内存
- **仅去重连续相同请求**（非全局去重）

**调用时机**：
- 在 `saveFromSession()` 和 `captureViaStream()` 中各调用一次
- 确保两种捕获方式都受去重影响

---

### 3️⃣ `appendLimited(chunk, chunks, size, maxBytes)` - 缓冲区管理

```javascript
function appendLimited(chunk, chunks, size, maxBytes) {
  const limit = maxBytes || MAX_BODY_BYTES;  // 默认 1MB
  if (size >= limit) return size;             // 已达上限，不再追加
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const remain = limit - size;
  chunks.push(buf.length > remain ? buf.subarray(0, remain) : buf);
  return size + Math.min(buf.length, remain);
}
```

**职责**：流式读取数据时，逐块累积，同时不超过指定大小限制

**参数含义**：
| 参数 | 类型 | 说明 |
|------|------|------|
| `chunk` | Buffer/string | 新到达的数据块 |
| `chunks` | Array | 累积缓冲区（引用传递，可被修改） |
| `size` | number | 当前已累积字节数 |
| `maxBytes` | number | 最大允许字节数（可选，默认 MAX_BODY_BYTES=1MB） |

**核心逻辑**：

```
输入: chunk="Hello", chunks=[], size=0, maxBytes=10
  ↓
1. limit = 10
2. size >= limit? 0 >= 10? NO
3. buf = Buffer.from("Hello")
4. remain = 10 - 0 = 10
5. buf.length (5) > remain (10)? NO
   → chunks.push(buf) // 全部加入，不截断
6. return 0 + min(5, 10) = 5


第二个块: chunk="World!", chunks=[buf1], size=5, maxBytes=10
  ↓
1. limit = 10
2. size >= limit? 5 >= 10? NO
3. buf = Buffer.from("World!")
4. remain = 10 - 5 = 5
5. buf.length (6) > remain (5)? YES
   → chunks.push(buf.subarray(0, 5)) // 截断为"World"
6. return 5 + min(6, 5) = 10


第三个块: chunk="!!!", chunks=[buf1, buf2], size=10, maxBytes=10
  ↓
1. limit = 10
2. size >= limit? 10 >= 10? YES
   → return size (10) // 不再处理
```

**结果**：
```
chunks = [Buffer("Hello"), Buffer("World")]
Buffer.concat(chunks).toString() = "HelloWorld"  // 截断了 "!!!"
```

**应用场景**：

```javascript
// 在 captureViaStream 中
const reqLimit = isMultipart(...) ? MAX_MULTIPART_BYTES : MAX_BODY_BYTES;
req.on('data', (chunk) => {
  reqSize = appendLimited(chunk, reqChunks, reqSize, reqLimit);
});
// 每次接收 chunk，都通过 appendLimited 过滤和截断
```

**设计优势**：
- 内存高效：不需要预先分配大缓冲区
- 大文件保护：自动截断超大 body
- 灵活限制：multipart 和普通请求可以设置不同限制

---

### 4️⃣ `saveFromSession(session, originalReq)` - 快速捕获方式

```javascript
function saveFromSession(session, originalReq) {
  if (!session) return;
  const url = session.url || originalReq.fullUrl || originalReq.url || '';
  if (!shouldCapture(url)) return;

  const reqInfo = session.req || {};
  const resInfo = session.res || {};
  const method = String(reqInfo.method || originalReq.method || 'GET').toUpperCase();
  if (isConsecutiveDuplicate(method, url)) return;

  const reqHeaders = normalizeHeaders(reqInfo.headers || originalReq.headers);
  const id = String(session.id || createRecordId());
  const reqBody = captureRequestPayload(id, reqHeaders, reqInfo.body);
  const resBody = decodeCapturedBody(resInfo.body);
  addRecord({
    id,
    url,
    method,
    requestHeaders: reqHeaders,
    requestBody: reqBody.text,
    requestBodyBinary: reqBody.binary,
    multipart: reqBody.multipart || undefined,
    responseStatus: resInfo.statusCode != null ? Number(resInfo.statusCode) || resInfo.statusCode : '',
    responseHeaders: normalizeHeaders(resInfo.headers),
    responseBody: resBody.text,
    responseBodyBinary: resBody.binary,
    timestamp: Number(session.startTime) || Date.now()
  });
}
```

**职责**：从 Whistle 的 Session 对象直接提取数据并保存

**工作流程**：

```
输入: Session 对象
  session = {
    id: "session-123",
    url: "https://api.example.com/login",
    startTime: 1693560000000,
    req: {
      method: "POST",
      headers: { "content-type": "application/json", ... },
      body: Buffer.from('{"username":"admin"}')
    },
    res: {
      statusCode: 200,
      headers: { "content-type": "application/json", ... },
      body: Buffer.from('{"token":"abc123"}')
    }
  }
  originalReq = { url: "...", fullUrl: "...", ... }
  ↓

1. 验证 session
   if (!session) return;

2. 提取 URL（3 个备选）
   session.url || originalReq.fullUrl || originalReq.url

3. 第一层过滤
   if (!shouldCapture(url)) return;

4. 提取请求信息
   reqInfo = session.req || {}
   resInfo = session.res || {}
   method = reqInfo.method || originalReq.method || 'GET'

5. 去重检查
   if (isConsecutiveDuplicate(method, url)) return;

6. 规范化处理
   reqHeaders = normalizeHeaders(reqInfo.headers)
   id = session.id || createRecordId()

7. 处理请求体
   reqBody = captureRequestPayload(id, reqHeaders, reqInfo.body)
   // 返回: { text, binary, multipart }

8. 处理响应体
   resBody = decodeCapturedBody(resInfo.body)
   // 返回: { text, binary }

9. 构建记录对象
   record = {
     id,
     url,
     method,
     requestHeaders,
     requestBody: reqBody.text,
     requestBodyBinary: reqBody.binary,
     multipart: reqBody.multipart,
     responseStatus: resInfo.statusCode,
     responseHeaders: normalizeHeaders(resInfo.headers),
     responseBody: resBody.text,
     responseBodyBinary: resBody.binary,
     timestamp: session.startTime || Date.now()
   }

10. 保存到数据存储
    addRecord(record)
```

**关键特点**：

| 特点 | 说明 |
|------|------|
| **速度快** | Whistle 已预先整合了 req/res，无需流式读取 |
| **体积小** | 适合快速、低开销的捕获 |
| **完整** | Session 已包含完整的请求/响应信息 |
| **依赖 Session** | 需要 Whistle 的 req.getSession() 接口支持 |

**使用时机**：
```javascript
if (typeof req.getSession === 'function') {
  req.getSession((session) => saveFromSession(session, originalReq));
}
```

---

### 5️⃣ `captureViaStream(req, originalReq, url)` - 流式捕获方式

这是最复杂的函数，负责逐块读取请求和响应数据。

#### 5.1 初始化

```javascript
function captureViaStream(req, originalReq, url) {
  const reqData = req.req || req;
  const reqChunks = [];    // 请求体块数组
  const resChunks = [];    // 响应体块数组
  let reqSize = 0;         // 请求体已读字节数
  let resSize = 0;         // 响应体已读字节数
  let statusCode = '';     // 响应状态码
  let responseHeaders = {};// 响应头
  let reqFinished = false; // 请求流是否完成
  let resFinished = false; // 响应流是否完成
  let saved = false;       // 是否已保存（防重复保存）
```

**状态机**：

```
初始状态
  ├─ reqFinished: false (请求未读完)
  ├─ resFinished: false (响应未读完)
  └─ saved: false (未保存)
  
当请求 end 事件
  ├─ reqFinished: true
  └─ trySave() 检查条件
  
当响应 end 事件
  ├─ resFinished: true
  └─ trySave() 检查条件
  
当两者都为 true 且 saved=false
  ├─ saved: true
  └─ 执行保存逻辑
```

#### 5.2 trySave 函数

```javascript
const trySave = () => {
  if (saved || !reqFinished || !resFinished) return;
  saved = true;
  const method = String(reqData.method || originalReq.method || 'GET').toUpperCase();
  if (isConsecutiveDuplicate(method, url)) return;
  const reqHeaders = normalizeHeaders(reqData.headers || originalReq.headers);
  const id = createRecordId();
  const reqBody = captureRequestPayload(id, reqHeaders, Buffer.concat(reqChunks));
  const resBody = decodeCapturedBody(Buffer.concat(resChunks));
  addRecord({...});
};
```

**核心逻辑**：

```
trySave()
  ↓
1. 保护：防重复调用
   if (saved || !reqFinished || !resFinished) return;
   // saved=true 或任一流未完成 → 直接返回

2. 标记已保存
   saved = true
   // 后续调用 trySave 都会立即返回

3. 去重检查
   if (isConsecutiveDuplicate(method, url)) return;
   // 若是重复请求，放弃保存

4. 缓冲区合并
   reqBody = captureRequestPayload(id, reqHeaders, Buffer.concat(reqChunks))
   resBody = decodeCapturedBody(Buffer.concat(resChunks))
   // 将分散的块合并成完整 Buffer，然后解析

5. 调用 addRecord 保存
```

**关键特性**：
- **幂等性**：`saved` 标志确保只保存一次
- **协调**：等待 req 和 res 都完成后才保存
- **时间限制**：60 秒超时（见下文）

#### 5.3 请求流监听

```javascript
const reqLimit = isMultipart(originalReq.headers || reqData.headers || {})
  ? MAX_MULTIPART_BYTES
  : MAX_BODY_BYTES;

req.on('data', (chunk) => {
  reqSize = appendLimited(chunk, reqChunks, reqSize, reqLimit);
});

req.on('end', () => {
  reqFinished = true;
  trySave();
});

req.on('error', () => {
  reqFinished = true;
  resFinished = true;
  trySave();
});
```

**流程**：

```
HTTP 请求体开始到达
  ↓
req.on('data')
  ├─ 判断是否 multipart
  │  ├─ 是 → reqLimit = MAX_MULTIPART_BYTES (更大)
  │  └─ 否 → reqLimit = MAX_BODY_BYTES (1MB)
  ├─ 调用 appendLimited 逐块累积
  └─ reqSize 递增

请求体完全到达
  ↓
req.on('end')
  ├─ reqFinished = true
  └─ trySave() 检查是否同时满足 resFinished

请求过程中发生错误
  ↓
req.on('error')
  ├─ reqFinished = true
  ├─ resFinished = true (强制完成响应)
  └─ trySave() 立即保存（可能响应未完成）
```

#### 5.4 响应流监听

```javascript
req.on('response', (response) => {
  statusCode = response.statusCode;
  responseHeaders = response.headers || {};
  
  response.on('data', (chunk) => {
    resSize = appendLimited(chunk, resChunks, resSize);
  });
  
  response.on('end', () => {
    resFinished = true;
    trySave();
  });
  
  response.on('error', () => {
    resFinished = true;
    trySave();
  });
});
```

**流程**：

```
HTTP 响应头到达
  ↓
req.on('response') 触发
  ├─ 捕获 response.statusCode
  ├─ 捕获 response.headers
  └─ 挂载 response 事件监听

响应体开始到达
  ↓
response.on('data')
  ├─ 调用 appendLimited 逐块累积
  └─ resSize 递增

响应体完全到达
  ↓
response.on('end')
  ├─ resFinished = true
  └─ trySave() 检查是否同时满足 reqFinished

响应过程中发生错误
  ↓
response.on('error')
  ├─ resFinished = true
  └─ trySave() 立即保存
```

#### 5.5 超时保护

```javascript
setTimeout(() => {
  if (saved) return;
  reqFinished = true;
  resFinished = true;
  trySave();
}, 60000);  // 60 秒
```

**作用**：
- 防止卡死：若某个流长期未完成（如文件下载），60 秒后强制保存
- 异常恢复：在错误处理失败时的备用方案
- 记录部分数据：已接收的部分仍会被保存

**场景**：
```
场景 1：正常完成
  req end → reqFinished=true
  res end → resFinished=true
  trySave() 执行保存
  ✓ 3 秒内完成

场景 2：响应缓慢
  req end → reqFinished=true
  (等待中，响应仍在传输)
  res end → resFinished=true
  trySave() 执行保存
  ✓ 例如 30 秒内完成

场景 3：文件下载（大文件）
  req end → reqFinished=true
  (响应仍在传输，且持续 > 60 秒)
  setTimeout 触发
  ├─ reqFinished = true (已是)
  ├─ resFinished = true (强制标记)
  └─ trySave() 执行保存 (已接收的部分)
  ✓ 60 秒后强制完成，接收到的数据被保存（可能被截断）
```

---

### 6️⃣ `module.exports(server)` - Whistle 插件入口

```javascript
module.exports = (server) => {
  server.on('request', (req) => {
    try {
      const originalReq = req.originalReq || {};
      const url = originalReq.fullUrl || originalReq.url || '';
      if (shouldCapture(url)) {
        if (typeof req.getSession === 'function') {
          req.getSession((session) => saveFromSession(session, originalReq));
        } else {
          captureViaStream(req, originalReq, url);
        }
      }
    } catch (err) {
      // 捕获失败不能影响业务流量
    } finally {
      if (typeof req.passThrough === 'function') {
        req.passThrough();
      }
    }
  });
};
```

**职责**：Whistle 插件的入口函数，注册请求事件监听

**工作流程**：

```
Whistle 接收 HTTP 请求
  ↓
调用 resStatsServer 插件
  ├─ 参数 server 是 Whistle 服务器实例
  └─ 插件返回一个处理函数

处理函数注册到 server.on('request')
  ↓
每个请求到达时触发
  ↓

try 块
  ├─ 提取 URL
  ├─ 第一层过滤：shouldCapture(url)
  │  ├─ 不符合 → 直接返回，不捕获
  │  └─ 符合 ↓
  ├─ 选择捕获方式
  │  ├─ req.getSession 可用 → saveFromSession (快速方式)
  │  └─ 否则 → captureViaStream (流式方式)
  └─ 捕获异常
     └─ 记录到 err（静默处理，不抛出）

finally 块
  └─ req.passThrough()
     // **关键**：不管捕获成功或失败
     //         都必须调用 passThrough
     //         确保请求继续传输，不中断业务
```

**业务流透传原理**：

```
┌──────────────────────────────────────────┐
│ 浏览器请求                                │
└──────────────┬───────────────────────────┘
               ↓
        ┌─────────────────┐
        │ Whistle 代理    │
        └────────┬────────┘
                 ↓
         ┌──────────────────────┐
         │ resStatsServer       │
         │ 拦截、捕获、分析     │
         │ (记录到数据库)        │
         └────────┬─────────────┘
                  ↓
         req.passThrough()
         // 请求继续透传，不被中断
                  ↓
        ┌─────────────────┐
        │ 真实服务器      │
        └────────┬────────┘
                 ↓
        ┌─────────────────┐
        │ 响应返回浏览器  │
        └─────────────────┘
```

**错误处理设计**：

```javascript
try {
  // 捕获逻辑
} catch (err) {
  // 捕获失败不能影响业务流量
  // err 被静默处理（未记录）
} finally {
  req.passThrough();
  // 无论捕获成功或失败
  // 都必须透传业务请求
}
```

**安全考虑**：
- 捕获异常不会导致请求中断
- 即使数据库写入失败，业务仍可继续
- 用户体验不受影响

---

## 🔄 两种捕获方式对比

| 特性 | saveFromSession | captureViaStream |
|------|-----------------|------------------|
| **速度** | 🚀 快（预整合） | 🐢 较慢（逐块读取） |
| **依赖** | req.getSession | Node.js Stream API |
| **内存** | 一次性加载 | 流式缓冲 |
| **大文件** | 可能爆内存 | 有 1MB 限制保护 |
| **超时** | 无 | 60 秒强制完成 |
| **适用场景** | Whistle 支持 Session | 通用方案 |

**选择策略**：
```javascript
if (typeof req.getSession === 'function') {
  // Whistle 版本较新，支持 Session API
  saveFromSession(session, originalReq);
} else {
  // 回退方案：使用流式读取
  captureViaStream(req, originalReq, url);
}
```

---

## 📊 数据流时序图

### 快速路径（saveFromSession）

```
时间轴
  ↓
server.on('request')
  ↓
shouldCapture(url) ✓
  ↓
req.getSession() [异步回调]
  ↓
saveFromSession(session)
  ├─ 提取 URL
  ├─ 验证 shouldCapture
  ├─ 检查 isConsecutiveDuplicate
  ├─ 处理 body (captureRequestPayload, decodeCapturedBody)
  ├─ 构建 record 对象
  └─ addRecord() [同步写入]
  ↓
finally → req.passThrough()
  ↓
业务请求继续透传
  ↓
✓ 完成（< 100ms）
```

### 流式路径（captureViaStream）

```
时间轴
  ↓
server.on('request')
  ↓
shouldCapture(url) ✓
  ↓
captureViaStream(req)
  ├─ 初始化状态变量和缓冲区
  ├─ 挂载事件监听
  │  ├─ req.on('data') → appendLimited
  │  ├─ req.on('end') → reqFinished=true, trySave()
  │  ├─ req.on('response')
  │  │  ├─ 捕获 statusCode/headers
  │  │  ├─ response.on('data') → appendLimited
  │  │  ├─ response.on('end') → resFinished=true, trySave()
  │  │  └─ response.on('error') → resFinished=true, trySave()
  │  └─ setTimeout(60s) → 强制 trySave()
  └─ 返回 (立即返回，事件异步处理)
  ↓
finally → req.passThrough()
  ↓
业务请求继续透传
  ↓
(异步等待) 
  ├─ 请求体数据到达 → req.on('data')
  ├─ 请求完成 → req.on('end') → reqFinished=true
  ├─ 响应体数据到达 → response.on('data')
  ├─ 响应完成 → response.on('end') → resFinished=true
  └─ trySave() 检查条件并执行
  ↓
trySave() 执行
  ├─ 检查 reqFinished && resFinished && !saved
  ├─ 合并缓冲区 Buffer.concat()
  ├─ 处理 body
  ├─ 构建 record
  └─ addRecord() [同步写入]
  ↓
✓ 完成（通常 < 5s，最多 60s）
```

---

## 🎯 关键设计模式

### 1. 防守式编程

```javascript
// 链式的 OR 操作符提供备选
const url = session.url || originalReq.fullUrl || originalReq.url || '';
const method = String(reqInfo.method || originalReq.method || 'GET').toUpperCase();
```

### 2. 协调模式（Coordination Pattern）

```javascript
// 状态变量 + 条件检查，确保两个异步流都完成后才执行
let reqFinished = false;
let resFinished = false;

const trySave = () => {
  if (!reqFinished || !resFinished) return;  // 条件未满足，直接返回
  // ... 执行保存逻辑
};
```

### 3. 幂等性保护

```javascript
// saved 标志确保 trySave 的逻辑只执行一次
let saved = false;
const trySave = () => {
  if (saved) return;  // 已执行过，直接返回
  saved = true;       // 标记已执行
  // ... 保存逻辑
};
```

### 4. 缓冲区管理（Buffer Management）

```javascript
// 流式读取时，逐块累积到数组，最后一次性合并
const chunks = [];
req.on('data', (chunk) => {
  chunks.push(chunk);
});
req.on('end', () => {
  const fullBuffer = Buffer.concat(chunks);
});
```

### 5. 优雅降级（Graceful Degradation）

```javascript
// 优先使用快速方式，回退到流式方式
if (typeof req.getSession === 'function') {
  saveFromSession(...);
} else {
  captureViaStream(...);  // 备选方案
}
```

### 6. 异常隔离

```javascript
try {
  // 捕获逻辑
} catch (err) {
  // 静默处理，不影响业务
} finally {
  req.passThrough();  // 保证业务流量透传
}
```

---

## 🔗 与其他模块的关系

```
resStatsServer.js
  │
  ├─→ dataStore.js
  │   └─ addRecord()      ：存储捕获的记录
  │
  ├─→ captureConfig.js
  │   ├─ allowsUrl()      ：检查是否符合过滤条件
  │   └─ getCaptureConfig()：获取配置的 skipDuplicates
  │
  ├─→ multipart.js
  │   └─ captureRequestPayload() ：处理 multipart 请求体
  │
  └─→ utils.js
      ├─ isStaticAsset()    ：检查是否为静态资源
      ├─ normalizeHeaders() ：规范化 HTTP 头
      ├─ decodeCapturedBody()：解码响应体
      ├─ isMultipart()      ：检查是否为 multipart
      └─ createRecordId()   ：生成唯一 ID
```

---

## 📈 性能特征

| 操作 | 时间复杂度 | 空间复杂度 | 备注 |
|------|-----------|---------|------|
| shouldCapture | O(1) | O(1) | 正则 + 配置查询 |
| isConsecutiveDuplicate | O(1) | O(1) | 直接比对最后一条 |
| appendLimited | O(n) | O(n) | n=chunk size |
| saveFromSession | O(m) | O(m) | m=body size |
| captureViaStream | O(m) | O(m) | m=body size，分多次 |
| addRecord | O(1) 摊销 | O(k) | k=记录数，最多 1000 |

---

## 🚨 常见问题排查

### Q1: 某些请求未被捕获
**排查流程**：
1. 检查 URL 协议是否为 http/https
2. 检查是否被识别为静态资源（后缀）
3. 检查 captureConfig 的 onlyHost/onlyPath 过滤
4. 检查是否与上一条请求重复（skipDuplicates=true）

### Q2: 大文件导出失败
**可能原因**：
- 请求/响应超过 1MB，被截断
- multipart 超过 MAX_MULTIPART_BYTES
- 60 秒超时强制完成，数据不完整

### Q3: 内存持续增长
**可能原因**：
- 捕获配置过于宽松，捕获了轮询请求
- 启用去重（skipDuplicates=true）无效
- addRecord 后未触发淘汰（超过 1000 条）

### Q4: 业务流量被中断
**不应该发生** 原因：
- finally 块一定会执行 req.passThrough()
- 即使捕获异常，业务仍透传

---

## 🎓 总结

**resStatsServer.js** 是 Whistle 插件的核心，主要责任：

1. **过滤决策** - shouldCapture 四层过滤
2. **去重策略** - isConsecutiveDuplicate 防止冗余
3. **流式处理** - appendLimited 缓冲区管理
4. **两种方式** - saveFromSession（快）vs captureViaStream（通用）
5. **状态协调** - 异步等待请求和响应完成
6. **异常恢复** - try-catch-finally 确保业务流畅
7. **时间保护** - 60 秒超时防卡死

设计上充分考虑了**性能、可靠性、向后兼容性**。

---

**最后更新**：2026-08-31
