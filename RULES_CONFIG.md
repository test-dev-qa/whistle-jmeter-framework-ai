# Whistle Rules 配置说明

## 📌 概述

`rules.txt` 是 Whistle 代理的**规则配置文件**，用于指定哪些请求应该被 Whistle 拦截并交给 `whistle.jmeter-exporter` 插件处理。

---

## 🎯 当前配置

### rules.txt 内容

```
# 默认将匹配的请求交给插件 resStatsServer 统计
* whistle.jmeter-exporter://
```

### 含义

| 部分 | 含义 |
|------|------|
| `*` | 通配符，匹配**所有请求** |
| `whistle.jmeter-exporter://` | 将匹配的请求交给该插件处理 |

**效果**：所有经过 Whistle 代理的 HTTP/HTTPS 请求都会被拦截并送到本插件进行流量捕获。

---

## 🔄 Whistle 规则匹配流程

```
浏览器请求
  ↓
Whistle 代理接收
  ↓
加载 rules.txt 规则
  ↓
逐条匹配规则
  ├─ 检查 URI 匹配
  ├─ 检查协议匹配
  └─ 检查 Host/Path 匹配
  ↓
找到匹配的规则
  ↓
根据规则执行对应的操作
  ├─ 代理转发
  ├─ 本地映射
  ├─ 重定向
  └─ 交给插件处理 ← 本项目的做法
  ↓
请求继续处理或返回响应
```

---

## 📖 规则语法详解

### 基本格式

```
<pattern> <target>
```

### Pattern（请求模式）

Pattern 用于匹配请求，支持以下语法：

#### 1️⃣ 通配符 `*`

```
# 匹配所有请求
* whistle.jmeter-exporter://

# 匹配任意 host
*.example.com whistle.jmeter-exporter://

# 匹配任意路径
https://api.example.com/* whistle.jmeter-exporter://
```

#### 2️⃣ 精确匹配

```
# 匹配特定域名
https://api.example.com whistle.jmeter-exporter://

# 匹配特定路径
https://api.example.com/user/login whistle.jmeter-exporter://

# 匹配特定端口
https://api.example.com:8443 whistle.jmeter-exporter://
```

#### 3️⃣ 正则表达式

```
# 使用 /pattern/ 语法
/api\/v\d+\/.*/ whistle.jmeter-exporter://

# 匹配所有 api 相关路由
/https?:\/\/.*api.*/ whistle.jmeter-exporter://
```

#### 4️⃣ 协议过滤

```
# 只匹配 HTTPS
https://api.example.com whistle.jmeter-exporter://

# 只匹配 HTTP
http://api.example.com whistle.jmeter-exporter://

# 同时匹配 HTTP 和 HTTPS
https://api.example.com whistle.jmeter-exporter://
http://api.example.com whistle.jmeter-exporter://
```

#### 5️⃣ 协议和域名组合

```
# 形式 1：protocol://host[:port]/path
https://api.example.com/v1 whistle.jmeter-exporter://

# 形式 2：仅 host（默认 http 和 https）
api.example.com whistle.jmeter-exporter://

# 形式 3：带端口
api.example.com:8080 whistle.jmeter-exporter://
```

---

## 💡 常见配置示例

### 示例 1：捕获所有请求（默认）

```
# 规则文件：rules.txt
* whistle.jmeter-exporter://
```

**效果**：所有请求都被捕获

**适用场景**：希望记录完整的用户行为链路

### 示例 2：仅捕获特定域名

```
# 仅捕获 api.example.com 的请求
api.example.com whistle.jmeter-exporter://

# 其他域名不被拦截
```

**效果**：
- ✅ `https://api.example.com/login` → 被捕获
- ❌ `https://cdn.example.com/jquery.js` → 不被拦截
- ❌ `https://www.example.com` → 不被拦截

**适用场景**：只关心特定后端服务的流量

### 示例 3：捕获特定路径前缀

```
# 捕获 /api/ 路径下的所有请求
https://api.example.com/api/* whistle.jmeter-exporter://
```

**效果**：
- ✅ `https://api.example.com/api/user/list` → 被捕获
- ✅ `https://api.example.com/api/order/create` → 被捕获
- ❌ `https://api.example.com/admin/user/list` → 不被拦截

**适用场景**：只需要捕获业务 API，排除管理后台

### 示例 4：多个规则

```
# 优先级：从上到下，匹配即停止

# 1. 排除图片资源
https://cdn.example.com/*.{jpg|png|gif|webp} -
https://api.example.com/image/* -

# 2. 捕获所有 API 请求
https://api.example.com/* whistle.jmeter-exporter://

# 3. 捕获其他域名的特定路径
https://*.example.com/api/* whistle.jmeter-exporter://

# 4. 默认规则：什么都不做
* -
```

**优先级说明**：
- Whistle 按**从上到下**的顺序逐条匹配规则
- 一旦某条规则匹配成功，就不再检查后续规则
- 因此应该将**更具体的规则**写在**更宽泛的规则**之前

### 示例 5：排除静态资源

```
# 排除常见静态资源
/\.(js|css|jpg|jpeg|png|gif|svg|webp|woff|woff2|ttf|eot|ico)(\?.*)?$/i -

# 排除 CDN 域名
*.cdn.example.com -

# 排除 WebSocket
/^wss?:/ -

# 捕获剩余的请求
* whistle.jmeter-exporter://
```

**效果**：
- ❌ `.js/.css/.jpg` 等静态资源 → 不被拦截
- ❌ CDN 域名的所有请求 → 不被拦截
- ❌ WebSocket 连接 → 不被拦截
- ✅ 其他所有请求 → 被捕获

**适用场景**：快速加载，只关心业务数据请求

### 示例 6：按环境区分

```
# 测试环境：捕获所有
test.example.com whistle.jmeter-exporter://

# 预发环境：仅捕获 API
pre.example.com/api/* whistle.jmeter-exporter://

# 生产环境：不捕获（使用默认代理）
prod.example.com -
```

**适用场景**：测试和生产环境需要不同的拦截策略

### 示例 7：使用正则表达式

```
# 捕获所有 API 版本路由
/https?:\/\/api\.example\.com\/v\d+\/.*/ whistle.jmeter-exporter://

# 捕获带 token 的请求
/.*\?.*token=.*/ whistle.jmeter-exporter://

# 排除所有 OPTIONS 请求（CORS 预检）
OPTIONS whistle.jmeter-exporter:// -
```

---

## 🔧 Target（操作类型）

当请求与 Pattern 匹配时，Whistle 会执行 Target 指定的操作。

### 常见 Target 类型

| Target | 含义 | 示例 |
|--------|------|------|
| `whistle.jmeter-exporter://` | 交给插件处理 | `* whistle.jmeter-exporter://` |
| `-` | 不做任何处理（透传） | `*.cdn.example.com -` |
| `http://127.0.0.1:8080` | 转发到本地服务 | `* http://127.0.0.1:8080` |
| `https://other.com` | 转发到其他服务 | `* https://other.com` |
| `file:///path/to/file` | 本地文件映射 | `api.example.com file:///var/www/index.html` |
| `127.0.0.1:8080` | 代理转发 | `* 127.0.0.1:8080` |

### 本项目使用的 Target

```
whistle.jmeter-exporter://
```

**含义**：将请求交给 `whistle.jmeter-exporter` 插件的 `resStatsServer` 进行流量捕获。

**等价于**：Whistle 调用插件的入口函数，插件决定是否记录该请求。

---

## 📂 rules.txt 位置和加载

### 文件位置

Whistle 启动时会自动加载项目根目录的 `rules.txt`：

```
whistle-jmeter-framework-ai/
├── rules.txt          ← 规则文件（Whistle 自动加载）
├── index.js
├── package.json
└── ...
```

### 动态加载

Whistle 支持在运行时修改规则，有多种方式：

#### 方式 1：编辑 rules.txt + 重启 Whistle

```bash
# 1. 编辑规则
vim rules.txt

# 2. 重启 Whistle
w2 restart
```

#### 方式 2：在 Web 控制台修改

```
http://127.0.0.1:8899 → Rules → 编辑规则 → 保存
```

#### 方式 3：使用 Whistle 代理的域名动态加载

```
http://127.0.0.1:8899 → Network → Rules → 输入 rules 地址
```

---

## 🎯 与 captureConfig 的关系

注意：`rules.txt` 和 `captureConfig` 是**两个不同的过滤层**

```
HTTP 请求到达
  ↓
┌─────────────────────────────────────────┐
│ 第 1 层：Whistle Rules 过滤              │
│ ├─ rules.txt 中的规则匹配              │
│ ├─ 如果不匹配 → 直接透传，不进插件    │
│ └─ 如果匹配 → 交给插件处理            │
└────────────┬────────────────────────────┘
             ↓
┌─────────────────────────────────────────┐
│ 第 2 层：Plugin captureConfig 过滤      │
│ ├─ pauseCapture：暂停捕获              │
│ ├─ onlyHost：按主机过滤                │
│ ├─ onlyPath：按路径过滤                │
│ ├─ skipDuplicates：去重                │
│ └─ 决定是否将请求存储到数据库         │
└────────────┬────────────────────────────┘
             ↓
        存储到 SQLite/JSON
```

### 配置协作示例

```
rules.txt:
  # 让所有请求都到插件
  * whistle.jmeter-exporter://

captureConfig (UI 中设置):
  pauseCapture: false       # 启用捕获
  onlyHost: "api.example"   # 仅捕获 API 主机
  onlyPath: "/api/"         # 仅捕获 /api/ 路径
  skipDuplicates: true      # 去重
```

**效果**：
- 所有请求都进入插件 ✓（rules.txt 第 1 层）
- 但仅 `api.example.com/api/xxx` 的请求被保存 ✓（captureConfig 第 2 层）

---

## 🚨 常见错误

### 错误 1：规则配置后看不到被拦截的请求

**原因**：
- rules.txt 规则不匹配
- Whistle 未重启
- 请求没有通过 Whistle 代理

**排查**：
```bash
# 1. 检查 rules.txt 是否正确
cat rules.txt

# 2. 重启 Whistle
w2 stop
w2 start

# 3. 在 Whistle 控制台查看是否有请求
http://127.0.0.1:8899 → Network

# 4. 检查浏览器是否配置了 Whistle 代理
# Windows: 设置 → 代理设置 → 127.0.0.1:8888
# Mac: 系统偏好设置 → 网络 → 代理 → 127.0.0.1:8888
```

### 错误 2：规则过于宽泛，导致数据库爆满

**原因**：
- `* whistle.jmeter-exporter://` 捕获所有请求，包括图片、CSS、JS

**解决**：
```
# 改为排除静态资源
/\.(js|css|jpg|jpeg|png|gif|svg|webp|ico)(\?.*)?$/i -
*.cdn.* -
* whistle.jmeter-exporter://
```

### 错误 3：某个特定域名的请求未被捕获

**原因**：
- 规则顺序不对（更具体的规则应写在前面）
- 协议匹配不正确（http vs https）
- 使用了正则表达式但语法错误

**排查**：
```
# 检查规则匹配
# Whistle 控制台 → Rules → 测试规则匹配

# 或使用 curl 测试
curl -x 127.0.0.1:8888 https://api.example.com/test

# 查看是否出现在 Network 面板
```

---

## 📊 规则优先级

Whistle 按**从上到下**的顺序逐条检查规则，遇到第一个匹配的规则就停止。

### 优先级设计原则

```
# ✅ 正确的顺序：具体到宽泛
1. 排除规则（前置）
2. 特定域名的捕获规则
3. 通用捕获规则（最后）

# ❌ 错误的顺序：宽泛到具体
1. * whistle.jmeter-exporter://  # 匹配了所有，下面的规则永不执行
2. api.example.com -              # 永远无法执行
```

### 正确的多规则配置

```
# 第 1 层：排除项目组（前置）
*.cdn.example.com -
/\.(js|css|png|jpg|gif)$/i -
OPTIONS -

# 第 2 层：具体的捕获规则
https://api.example.com/* whistle.jmeter-exporter://
https://test.example.com/api/* whistle.jmeter-exporter://

# 第 3 层：通用规则（最后）
* whistle.jmeter-exporter://
```

---

## 🔗 与插件入口的关系

当 rules.txt 规则匹配后，Whistle 会这样调用插件：

```javascript
// index.js
module.exports = require('./ui/app');
module.exports.resStatsServer = require('./resStatsServer');

// resStatsServer.js 中的入口
module.exports = (server) => {
  server.on('request', (req) => {
    // 处理被规则选中的请求
    const originalReq = req.originalReq || {};
    const url = originalReq.fullUrl || originalReq.url || '';
    if (shouldCapture(url)) {
      // ... 捕获请求
    }
  });
};
```

**流程**：
1. Whistle 规则匹配 → 交给 resStatsServer
2. resStatsServer 再次过滤（shouldCapture）
3. 最终决定是否存储

---

## ✅ 推荐配置

### 针对生产压测

```
# rules.txt - 仅捕获业务 API

# 排除静态资源和非关键请求
/\.(js|css|jpg|jpeg|png|gif|svg|webp|ico|ttf|woff|woff2)(\?.*)?$/i -
*.cdn.* -
/^(OPTIONS|HEAD)/ -
/healthcheck/ -
/favicon.ico -

# 捕获核心 API
https://api.example.com/api/* whistle.jmeter-exporter://
https://api.example.com/rpc/* whistle.jmeter-exporter://

# 默认不捕获其他
* -
```

### 针对开发调试

```
# rules.txt - 捕获所有请求便于调试

# 仅排除明确不需要的
*.cdn.* -
/favicon.ico -

# 捕获其他所有
* whistle.jmeter-exporter://
```

### 针对多环境

```
# rules.txt - 按环境区分

# 测试环境：全捕获
test-api.example.com whistle.jmeter-exporter://

# 预发环境：仅 API
pre-api.example.com/api/* whistle.jmeter-exporter://
pre-api.example.com/rpc/* whistle.jmeter-exporter://

# 生产环境：不捕获（注释掉）
# prod-api.example.com whistle.jmeter-exporter://

# 本地开发：全捕获
localhost whistle.jmeter-exporter://
127.0.0.1 whistle.jmeter-exporter://
```

---

## 📚 参考资源

### Whistle 官方文档
- 规则匹配：https://wproxy.org/whistle/rules/
- 正则表达式：https://wproxy.org/whistle/rules/regex.html
- 规则优先级：https://wproxy.org/whistle/rules/priority.html

### 快速查询

| 需求 | 配置 |
|------|------|
| 捕获所有 | `* whistle.jmeter-exporter://` |
| 捕获特定域名 | `api.example.com whistle.jmeter-exporter://` |
| 捕获特定路径 | `https://api.example.com/api/* whistle.jmeter-exporter://` |
| 排除某个域名 | `*.cdn.example.com -` |
| 排除文件类型 | `/\.(js\|css\|png)$/i -` |
| 仅 HTTPS | `https://api.example.com whistle.jmeter-exporter://` |
| 仅 HTTP | `http://api.example.com whistle.jmeter-exporter://` |

---

## 📝 总结

| 概念 | 说明 |
|------|------|
| **rules.txt** | Whistle 规则文件，第 1 层过滤 |
| **Pattern** | 请求模式（支持通配符、正则）|
| **Target** | 操作类型（本项目为 whistle.jmeter-exporter://） |
| **优先级** | 从上到下，遇第一个匹配即停止 |
| **captureConfig** | 第 2 层过滤（在插件 UI 中配置）|
| **协作** | rules.txt 决定请求是否进插件，captureConfig 决定是否存储 |

---

**最后更新**：2026-08-31
